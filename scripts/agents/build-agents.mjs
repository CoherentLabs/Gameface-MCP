#!/usr/bin/env node
/**
 * Generates the Claude Code, Copilot, Cursor, Codex and Gemini CLI versions of
 * the agents in agents/, which is the single source of truth.
 *
 * Source agents use Claude Code's format. On top of that:
 * - `<client>.<key>: value` frontmatter lines set or override a key for one
 *   client only (e.g. `gemini.max_turns: 60`).
 * - `<!-- only: gemini -->` ... `<!-- end -->` and `<!-- except: gemini -->`
 *   ... `<!-- end -->` body blocks (comma-separated clients) keep text for, or
 *   drop it from, those clients.
 *
 * Per client, the script translates the frontmatter:
 * - tool names: Claude built-ins and mcp__gameface__* are mapped to the
 *   client's names; the wildcard and disallowedTools are expanded against the
 *   tools registered in src/index.ts into an explicit allowlist.
 * - clients without a tool allowlist (Cursor, Codex) get the restriction
 *   written into the prompt instead, plus readonly / features.* switches.
 *
 * Every file in the output directories is treated as generated: files with no
 * source agent are removed.
 *
 * Usage:
 *   node scripts/agents/build-agents.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_DIR = join(ROOT, "agents");
const MCP_SERVER = "gameface";
const MCP_PREFIX = `mcp__${MCP_SERVER}__`;

// Claude built-in tool -> each client's names. null: the client has no
// equivalent, so the tool is dropped. Unlisted tools are an error.
const BUILTINS = {
  Read: { copilot: ["read"], gemini: ["read_file", "read_many_files"] },
  Grep: { copilot: ["search"], gemini: ["grep_search"] },
  Glob: { copilot: ["search"], gemini: ["glob"] },
  Write: { copilot: ["edit"], gemini: ["write_file"] },
  Edit: { copilot: ["edit"], gemini: ["replace"] },
  Bash: { copilot: ["execute"], gemini: ["run_shell_command"] },
  WebFetch: { copilot: ["web"], gemini: ["web_fetch"] },
  WebSearch: { copilot: ["web"], gemini: ["google_web_search"] },
  Agent: { copilot: ["agent"], gemini: null },
  ReadMcpResourceTool: { copilot: null, gemini: ["read_mcp_resource"] },
  ListMcpResourcesTool: { copilot: null, gemini: ["list_mcp_resources"] },
};
const ALIASES = { Task: "Agent" };
const WRITE_TOOLS = ["Write", "Edit", "Bash"];

// ---------------------------------------------------------------------------
// Parsing

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

/**
 * Splits a source agent into its frontmatter and body. Frontmatter is flat
 * `key: value` lines; `<client>.<key>` lines go to `perClient[client]`.
 * Values are kept as raw YAML.
 */
function parseAgentFile(path, clients) {
  const text = readText(path);
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${rel(path)}: missing --- frontmatter ---`);
  const fields = {};
  const perClient = Object.fromEntries(clients.map((c) => [c, {}]));
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const kv = /^(?:([a-z]+)\.)?([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${rel(path)}: unsupported frontmatter line (only flat "key: value"): ${line}`);
    const [, client, key, value] = kv;
    if (client && !(client in perClient)) throw new Error(`${rel(path)}: unknown client "${client}" in: ${line}`);
    if (client && (key === "name" || key === "tools" || key === "disallowedTools")) {
      throw new Error(`${rel(path)}: ${key} is shared by all clients and can't be set per client: ${line}`);
    }
    (client ? perClient[client] : fields)[key] = value.trim();
  }
  return { fields, perClient, body: match[2] };
}

/** Decodes a raw YAML scalar (plain, 'single' or "double" quoted). */
function decodeScalar(raw) {
  if (raw.startsWith('"')) return JSON.parse(raw);
  if (raw.startsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
  return raw;
}

function splitList(value) {
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Keeps the body lines meant for `client`, per the only/except blocks. */
function bodyFor(agent, client, clients) {
  const out = [];
  let block = null;
  agent.body.split("\n").forEach((line, i) => {
    const where = `${rel(agent.path)}:${i + 1 + agent.bodyOffset}`;
    const open = /^<!--\s*(only|except):\s*([a-z,\s]+?)\s*-->$/.exec(line.trim());
    if (open) {
      if (block) throw new Error(`${where}: blocks can't be nested`);
      const list = splitList(open[2]);
      for (const c of list) if (!clients.includes(c)) throw new Error(`${where}: unknown client "${c}"`);
      block = { keep: open[1] === "only" ? list.includes(client) : !list.includes(client) };
    } else if (/^<!--\s*end\s*-->$/.test(line.trim())) {
      if (!block) throw new Error(`${where}: <!-- end --> without an open block`);
      block = null;
    } else if (!block || block.keep) {
      out.push(line);
    }
  });
  if (block) throw new Error(`${rel(agent.path)}: unclosed only/except block`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function registeredMcpTools() {
  const src = readText(join(ROOT, "src", "index.ts"));
  const names = [...src.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("no registerTool(...) calls found in src/index.ts");
  return names;
}

/**
 * Resolves an agent's tools/disallowedTools into the allowed Claude built-ins
 * and gameface MCP tools (bare names), in source order.
 */
function resolveTools(agent, mcpTools) {
  const where = rel(agent.path);
  if (!agent.fields.tools) throw new Error(`${where}: "tools" is required so every client gets the same allowlist`);
  const add = (entry, builtinSet, mcpSet) => {
    if (entry.startsWith("mcp__")) {
      if (!entry.startsWith(MCP_PREFIX)) throw new Error(`${where}: only ${MCP_SERVER} MCP tools are supported: ${entry}`);
      const name = entry.slice(MCP_PREFIX.length);
      if (name === "*") mcpTools.forEach((t) => mcpSet.add(t));
      else if (mcpTools.includes(name)) mcpSet.add(name);
      else throw new Error(`${where}: ${entry} is not registered in src/index.ts`);
    } else {
      const name = ALIASES[entry] ?? entry;
      if (!(name in BUILTINS)) throw new Error(`${where}: no client mapping for built-in tool "${entry}" - add it to BUILTINS`);
      builtinSet.add(name);
    }
  };
  const builtins = new Set();
  const mcp = new Set();
  for (const entry of splitList(agent.fields.tools)) add(entry, builtins, mcp);
  const deniedBuiltins = new Set();
  const deniedMcp = new Set();
  for (const entry of splitList(agent.fields.disallowedTools)) add(entry, deniedBuiltins, deniedMcp);
  return {
    builtins: [...builtins].filter((t) => !deniedBuiltins.has(t)),
    mcp: [...mcp].filter((t) => !deniedMcp.has(t)),
  };
}

// ---------------------------------------------------------------------------
// Rendering helpers

/** A YAML scalar: plain when that parses back unchanged, else double-quoted. */
function yamlScalar(value) {
  if (/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(value)) return value;
  const plainSafe = value === value.trim() && value !== "" && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) && !/: |\s#/.test(value);
  return plainSafe ? value : JSON.stringify(value);
}

function tomlValue(raw) {
  return /^(true|false|-?\d+(\.\d+)?)$/.test(raw) ? raw : JSON.stringify(decodeScalar(raw));
}

function markdown(fields, body) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) lines.push(`${key}:`, ...value.map((v) => `  - ${yamlScalar(v)}`));
    else lines.push(`${key}: ${value}`);
  }
  return `---\n${lines.join("\n")}\n---\n\n${body}\n`;
}

/**
 * For clients that can't restrict tools: the restriction in words. Lists
 * whichever of allowed/forbidden gameface tools is shorter.
 */
function restrictionNote(tools, mcpTools) {
  const lines = [];
  const forbidden = mcpTools.filter((t) => !tools.mcp.includes(t));
  const code = (names) => names.map((n) => `\`${n}\``).join(", ");
  if (forbidden.length > 0) {
    if (tools.mcp.length === 0) lines.push(`Never call any ${MCP_SERVER} tools.`);
    else if (tools.mcp.length < forbidden.length) lines.push(`Of the ${MCP_SERVER} tools, only call: ${code(tools.mcp)}.`);
    else lines.push(`Never call these ${MCP_SERVER} tools: ${code(forbidden)}.`);
  }
  if (!tools.builtins.includes("Agent")) lines.push("Never spawn other agents.");
  return lines.join(" ");
}

function withNote(body, note) {
  return note ? `${body}\n\n${note}` : body;
}

// ---------------------------------------------------------------------------
// Clients. render(agent, tools, extra, body, mcpTools): `extra` is the
// agent's raw `<client>.<key>` frontmatter, `body` its body for this client.

const CLIENTS = {
  claude: {
    dir: ".claude/agents",
    file: (name) => `${name}.md`,
    render(agent, tools, extra, body) {
      return markdown({ ...agent.fields, ...extra }, body);
    },
  },
  copilot: {
    dir: ".github/agents",
    file: (name) => `${name}.agent.md`,
    render(agent, tools, extra, body) {
      const list = [
        ...tools.builtins.flatMap((t) => BUILTINS[t].copilot ?? []),
        ...tools.mcp.map((t) => `${MCP_SERVER}/${t}`),
      ];
      const fields = { name: agent.name, description: agent.fields.description, tools: JSON.stringify([...new Set(list)]).replace(/","/g, '", "') };
      return markdown({ ...fields, ...extra }, body);
    },
  },
  cursor: {
    dir: ".cursor/agents",
    file: (name) => `${name}.md`,
    render(agent, tools, extra, body, mcpTools) {
      const fields = { name: agent.name, description: agent.fields.description, model: "inherit" };
      if (!WRITE_TOOLS.some((t) => tools.builtins.includes(t))) fields.readonly = "true";
      return markdown({ ...fields, ...extra }, withNote(body, restrictionNote(tools, mcpTools)));
    },
  },
  codex: {
    dir: ".codex/agents",
    file: (name) => `${name}.toml`,
    render(agent, tools, extra, body, mcpTools) {
      const instructions = withNote(body, restrictionNote(tools, mcpTools));
      if (instructions.includes("'''")) throw new Error(`${rel(agent.path)}: body contains ''' which can't go in a TOML literal string`);
      const fields = {
        name: JSON.stringify(agent.name),
        description: tomlValue(agent.fields.description),
        "features.shell_tool": String(tools.builtins.includes("Bash")),
        "features.apps": "false",
        "features.plugins": "false",
        ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, tomlValue(v)])),
      };
      const lines = Object.entries(fields).map(([k, v]) => `${k} = ${v}`);
      return `${lines.join("\n")}\ndeveloper_instructions = '''\n${instructions}\n'''\n`;
    },
  },
  gemini: {
    dir: ".gemini/agents",
    file: (name) => `${name}.md`,
    render(agent, tools, extra, body) {
      const list = [
        ...tools.builtins.flatMap((t) => BUILTINS[t].gemini ?? []),
        ...tools.mcp.map((t) => `mcp_${MCP_SERVER}_${t}`),
      ];
      const fields = { name: agent.name, description: agent.fields.description, tools: [...new Set(list)] };
      return markdown({ ...fields, ...extra }, body);
    },
  },
};

// ---------------------------------------------------------------------------

function rel(path) {
  return relative(ROOT, path).replace(/\\/g, "/");
}

function main() {
  const clients = Object.keys(CLIENTS);
  const mcpTools = registeredMcpTools();
  const sources = readdirSync(SOURCE_DIR).filter((f) => f.endsWith(".md")).sort();
  if (sources.length === 0) throw new Error("no agents found in agents/");

  const outputs = new Map();
  for (const file of sources) {
    const path = join(SOURCE_DIR, file);
    const { fields, perClient, body } = parseAgentFile(path, clients);
    const name = file.slice(0, -3);
    if (fields.name !== name) throw new Error(`${rel(path)}: name "${fields.name}" must match the file name`);
    if (!fields.description) throw new Error(`${rel(path)}: description is required`);
    const bodyOffset = readText(path).split("\n").length - body.split("\n").length;
    const agent = { path, name, fields, body, bodyOffset };
    const tools = resolveTools(agent, mcpTools);
    if (tools.builtins.includes("Agent") && !/<!--\s*(only|except):[^>]*\bgemini\b/.test(body)) {
      throw new Error(`${rel(path)}: Gemini subagents can't spawn agents - wrap the spawning instructions in <!-- except: gemini --> and give Gemini an alternative`);
    }
    for (const [client, spec] of Object.entries(CLIENTS)) {
      const out = join(ROOT, spec.dir, spec.file(name));
      outputs.set(out, spec.render(agent, tools, perClient[client], bodyFor(agent, client, clients), mcpTools));
    }
  }

  // Files in the output directories with no source agent.
  const orphans = [];
  for (const spec of Object.values(CLIENTS)) {
    const dir = join(ROOT, spec.dir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const path = join(dir, file);
      if (!outputs.has(path)) orphans.push(path);
    }
  }

  for (const [path, text] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  for (const path of orphans) rmSync(path, { recursive: true });
  console.log(`Wrote ${outputs.size} agent files${orphans.length ? `, removed ${orphans.length} orphaned` : ""}.`);
}

try {
  main();
} catch (err) {
  console.error(`build-agents: ${err.message}`);
  process.exit(1);
}
