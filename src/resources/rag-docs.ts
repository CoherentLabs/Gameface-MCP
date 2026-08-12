import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RAG_DIR, listRagDocFiles } from "../tools/search-gameface-docs.js";

const RESOURCE_URI_PREFIX = "gameface://rag/";
const INDEX_URI = "gameface://rag/index";

export interface RagResourceInfo {
  file: string;
  uri: string;
  title: string;
}

/**
 * Discovers RAG doc files and reads each file's title (first markdown heading)
 * so they can be registered as individually browsable MCP resources.
 */
export async function listRagResources(): Promise<RagResourceInfo[]> {
  const files = await listRagDocFiles();
  const infos: RagResourceInfo[] = [];

  for (const file of files) {
    const raw = await readFile(resolve(RAG_DIR, file), "utf8");
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    infos.push({
      file,
      uri: `${RESOURCE_URI_PREFIX}${file}`,
      title: titleMatch ? titleMatch[1].trim() : file,
    });
  }

  return infos;
}

/**
 * MCP resource callback that returns the full contents of one RAG doc file.
 */
export async function getRagDocResource(uri: string, file: string) {
  const content = await readFile(resolve(RAG_DIR, file), "utf8");

  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: content,
      },
    ],
  };
}

/**
 * Synthesizes an index resource summarizing every RAG doc topic file, so agents
 * can discover what's available without reading each file in full, and are
 * pointed at search_gameface_docs for targeted retrieval instead.
 */
export async function getRagIndexResource(infos: RagResourceInfo[]) {
  const lines = [
    "# Gameface Documentation Index",
    "",
    "This lists the Gameface RAG documentation topic files available as MCP resources.",
    "Prefer calling the `search_gameface_docs` tool with a specific query instead of",
    "reading these files in full - the corpus is large, and the tool returns only the",
    "relevant tagged chunks (each with [TOPIC]/[TYPE]/[SEVERITY]/[SOURCE] metadata).",
    "Call it before writing or modifying Gameface UI markup/CSS/JS, and whenever a",
    "layout, performance, or component question comes up.",
    "",
    "## Topics",
    "",
    ...infos.map((info) => `- **${info.title}** - \`${info.uri}\``),
  ];

  return {
    contents: [
      {
        uri: INDEX_URI,
        mimeType: "text/markdown",
        text: lines.join("\n"),
      },
    ],
  };
}

export { INDEX_URI };
