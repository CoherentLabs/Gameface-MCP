# Gameface MCP Server

An MCP (Model Context Protocol) server that gives an LLM agent direct control
over a [Gameface](https://coherent-labs.com/products/gameface/) Player
instance via the Chrome DevTools Protocol (CDP) — launch/connect, inspect the
DOM and computed styles, interact with elements, run layout/overlap
assertions, lint for known-expensive Gameface layout patterns, measure frame
timing against a recorded noise floor, and search a Gameface documentation
corpus. Only Gameface Player is ever allowed to be launched or connected to
— every connection is verified by CDP identity (`navigator.userAgent`
must contain `cohtml`) and refused/killed otherwise.

## Prerequisites

- Node.js 18+ (the server uses the global `fetch` API).
- A local Gameface/Cohtml SDK install with a Player executable. This repo
  does not ship one — you need your own Gameface license/SDK. On Windows
  that's typically `.../Player/Player.exe` inside your SDK's install
  directory (note: `Player.exe` usually lives in a `Player` *subfolder*
  under the SDK root, not at the SDK root itself).

## Build

```bash
npm install
npm run build
```

This compiles `src/` to `build/`, producing `build/index.js` — the server's
stdio entry point. `npm run watch` recompiles on change during development.

## Setting the Player path

There are two ways to tell the server where your Player executable is. A
CLI flag always overrides the config file.

### Option A — config file (recommended)

Create `~/.gameface-mcp/config.json` (one per developer machine, not per
project — this server is meant to be reused across multiple game repos, so
the path lives once on your machine rather than being hardcoded into every
project's committed MCP config):

```json
{
  "browserExecutable": "D:/path/to/your/sdk/Player/Player.exe",
  "browserArgs": ["--enable-gui=false"],
  "port": 9444,
  "cdpHost": "localhost"
}
```

Every field is optional. `browserArgs` here are merged in on every
`launch_browser` call — `--enable-gui=false` is worth setting by default:
without it, Player's own toolbar/bookmark-bar chrome consumes an
inconsistent chunk of your requested `--height`, so the actual viewport
never quite matches what you asked for.

Point at a different file with `-c`/`--config <path>` if you want more than
one profile (e.g. a different Player build per project).

### Option B — CLI flags

```bash
node build/index.js --browser-executable "D:/path/to/Player.exe"
```

Full flag list:

| Flag | Short | Meaning | Default |
|---|---|---|---|
| `--browser-executable <path>` | `-b` | Path to Player.exe | (required, one way or another) |
| `--browser-args <args>` | `-a` | Comma-separated extra CLI args passed to Player | none |
| `--port <port>` | `-p` | CDP remote-debugging port | `9444` |
| `--cdp-host <host>` | `-h` | Host for the CDP connection | `localhost` |
| `--config <path>` | `-c` | Path to the JSON config file | `~/.gameface-mcp/config.json` |
| `--help` | | Print this list | |

## Connecting from an LLM client

This is a plain stdio MCP server: any client just needs to run
`node <path-to-build/index.js>` and speak MCP over stdin/stdout. The exact
file the client config lives in — and the top-level key it uses
(`mcpServers` vs `servers`) — differs per client.

### Claude Code

`.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "gameface": {
      "command": "node",
      "args": ["/absolute/path/to/Gameface-MCP/build/index.js"]
    }
  }
}
```

### VS Code (GitHub Copilot / MCP extension)

`.vscode/mcp.json` at your project root — this repo already ships one you
can copy:

```json
{
  "servers": {
    "gameface_local": {
      "command": "node",
      "args": ["build/index.js"]
    }
  }
}
```

Note the key is `servers`, not `mcpServers` — copying a config from another
client without changing this key is the most common mistake here.

### Gemini CLI

`.gemini/settings.json` (project-level) or `~/.gemini/settings.json`
(user-level, applies to every project):

```json
{
  "mcpServers": {
    "gameface": {
      "command": "node",
      "args": ["/absolute/path/to/Gameface-MCP/build/index.js"],
      "timeout": 30000,
      "trust": false
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`, Windows:
`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gameface": {
      "command": "node",
      "args": ["/absolute/path/to/Gameface-MCP/build/index.js"]
    }
  }
}
```

In every case above, if you've set up `~/.gameface-mcp/config.json` (Option
A above) the `args` array needs nothing beyond the path to `build/index.js`
— the Player path, port, etc. are picked up automatically. Add
`--browser-executable`/other flags to `args` only if you want to override
the config file for a specific client or project.

## Available tools

| Tool | What it does |
|---|---|
| `launch_browser` | Launches Player with remote debugging enabled. Refuses and kills anything that isn't Gameface Player. |
| `connect_browser` | Connects to an already-running, debuggable Player instance. Same Gameface-only guard. |
| `gameface_get_status` | Reports current connection status. |
| `gameface_restart` | Disconnects, closes, relaunches, and reconnects using the last-used launch/connect parameters. |
| `navigate` | Navigates the connected view to a different URL. |
| `get_dom_tree` | Snapshot of the DOM tree (node IDs, names, attributes, children). |
| `search_dom` | Searches the DOM for nodes matching a text or XPath query. |
| `get_computed_styles` | Computed CSS styles for a given node. |
| `interact_element` | Click, type, hover, focus, scrollIntoView, or touch on an element. |
| `take_screenshot` | Captures a screenshot (full page, viewport, or a custom clip rect). |
| `eval_js` | Executes arbitrary JavaScript in the connected page and returns the result. |
| `get_console_logs` | Buffered console messages and Log-domain entries (errors, warnings, deprecations). |
| `assert_text_fits` | Checks whether an element's content overflows its own box (`scrollWidth`/`scrollHeight` vs `clientWidth`/`clientHeight`). |
| `assert_no_overlap` | Checks whether two elements' rendered boxes intersect. |
| `assert_within_parent` | Checks whether an element stays within its parent/an ancestor/the viewport. |
| `search_gameface_docs` | Searches the Gameface RAG documentation corpus (`prompts/rag/`) for guidance relevant to a query. |
| `perf_lint` | Static, deterministic structural check for layout patterns the Gameface docs name as expensive (e.g. `align-items: stretch`, unsized flex items, `display: simple` misuse). No timing involved. |
| `perf_measure` | Injects the fixed frame-timing scenario from `tools/perf/calibrate.js` into the live connection and reports p50/p95/p99 against the recorded baseline in `tools/perf/noise-floor.md`. |

## Available resources

- `gameface://code-instructions` — Gameface UI coding constraints (unsupported
  CSS/HTML/JS, negative rules) for code generation.
- `gameface://rag/index` — index of the Gameface documentation topic files.
- `gameface://rag/<file>.md` — one resource per topic file under
  `prompts/rag/` (layout, performance, components, accessibility,
  localization, animations, tooling, etc.).

## Gameface UI Conductor skill

`.claude/skills/gameface-conductor/` runs *before and around* the tools
above: it clarifies unstated requirements for a new UI feature request
(interaction, animation, data/state, scale, accessibility, localization) in
up to three question rounds, gets explicit sign-off on a written spec, then
implements and — if a Gameface MCP connection is available — validates the
result with the assertion/lint/perf tools above before calling it done.

This one set of files is shared across clients, not duplicated per client,
but *how* it gets invoked differs:

| Client | How it's triggered |
|---|---|
| Claude Code | Automatic — matches the skill's `description` against your request, or invoke explicitly with `/gameface-conductor`. |
| GitHub Copilot (VS Code) | Automatic — Copilot's "Agent Skills" scans `.claude/skills/` by default (in addition to `.github/skills/`), so this file is picked up as-is, no extra setup. |
| Gemini CLI | **Explicit only** — Gemini CLI has no auto-triggered skill concept, only user-invoked custom commands. Run `/gameface-conductor <your request>`; `.gemini/commands/gameface-conductor.toml` embeds the same `SKILL.md` and `dimensions.md` content via `@{...}` file injection rather than duplicating it. |

Because the same file is read by more than one host, its wording avoids
naming host-specific tools (no literal `TodoWrite`/`AskUserQuestion`
references) in favor of generic instructions ("track this explicitly",
"ask as one batch") that each host can fulfill with whatever it has.

I haven't been able to verify the Gemini CLI path against a live session —
the TOML file is structurally valid and the `@{...}` file-injection syntax
matches Gemini CLI's documented custom-commands format, but I'd treat it as
unverified until someone runs `/gameface-conductor` for real.

## Performance tooling

- `tools/perf/calibrate.js` — the fixed, page-agnostic frame-timing scenario
  used both by `perf_measure` (against a live connection) and by the
  standalone calibration script below (against a freshly booted Player).
- `tools/perf/noise-floor.md` — the recorded baseline: p50/p95/p99 across 5
  runs of 600 frames (120 discarded as warmup) at 1920x1080, Player
  restarted between runs. `perf_measure` compares new readings against this.
- `scripts/measure-frame-noise-floor.mjs` — regenerates the above. Boots
  Player fresh per run (not via the MCP connection, so it needs its own path
  to Player.exe — reads `~/.gameface-mcp/config.json` the same way the
  server does, or pass `--browser-executable <path>` to override):
  ```bash
  node scripts/measure-frame-noise-floor.mjs --runs 5 --frames 600 --warmup 120
  ```

## Notes

- stdout is reserved for MCP protocol traffic — all logging goes to stderr.
- The server maintains a single browser/connection at a time; `launch_browser`
  and `connect_browser` actively verify a tracked process/connection is
  still alive before refusing to start a new one, so a manually-closed
  Player won't leave the server stuck thinking it's still connected.
