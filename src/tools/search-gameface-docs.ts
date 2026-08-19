/**
 * Search Gameface Docs Tool
 *
 * Retrieval over the Gameface RAG documentation corpus (prompts/rag/*.md). Each
 * source file is a sequence of chunks separated by `---` rules, each tagged with
 * bracketed metadata like `[TOPIC: layout] [TYPE: concept] [SEVERITY: critical]`
 * followed by a heading and body. This module parses those chunks once (cached
 * for the process lifetime, since the docs don't change while the server runs)
 * and scores them against a query so agents can pull in just the guidance
 * relevant to what they're about to build, instead of the whole corpus.
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SearchGamefaceDocsParams, SearchGamefaceDocsResult, GamefaceDocResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("SearchGamefaceDocs");

export const RAG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts/rag");

interface DocChunk {
  file: string;
  topic?: string;
  type?: string;
  severity?: string;
  source?: string;
  heading: string;
  content: string;
}

let cachedChunks: DocChunk[] | null = null;

/**
 * Lists the RAG doc filenames (sorted), used both for search and for registering
 * each file as a browsable MCP resource.
 */
export async function listRagDocFiles(): Promise<string[]> {
  const files = await readdir(RAG_DIR);
  return files.filter((f) => f.endsWith(".md")).sort();
}

function parseChunks(file: string, raw: string): DocChunk[] {
  // Chunks are separated by a line containing only "---"; files vary between a
  // single delimiter and a blank-line-padded double delimiter, so splitting on
  // the single-rule pattern and dropping empty segments handles both.
  const segments = raw.split(/\r?\n---\r?\n/);
  const chunks: DocChunk[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/m);
    if (!headingMatch) continue; // file-level preamble / comment-only segments have no heading

    const metadata: Record<string, string> = {};
    const tagRegex = /\[([\w-]+):\s*([^\]]+)\]/g;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagRegex.exec(trimmed)) !== null) {
      metadata[tagMatch[1].toUpperCase()] = tagMatch[2].trim();
    }

    chunks.push({
      file,
      topic: metadata["TOPIC"],
      type: metadata["TYPE"],
      severity: metadata["SEVERITY"],
      source: metadata["SOURCE"],
      heading: headingMatch[1].trim(),
      content: trimmed,
    });
  }

  return chunks;
}

async function loadChunks(): Promise<DocChunk[]> {
  if (cachedChunks) {
    return cachedChunks;
  }

  const files = await listRagDocFiles();
  const chunks: DocChunk[] = [];

  for (const file of files) {
    const raw = await readFile(resolve(RAG_DIR, file), "utf8");
    chunks.push(...parseChunks(file, raw));
  }

  log.info(`Loaded ${chunks.length} documentation chunks from ${files.length} files`);
  cachedChunks = chunks;
  return chunks;
}

function scoreChunk(chunk: DocChunk, queryLower: string, tokens: string[]): number {
  const headingLower = chunk.heading.toLowerCase();
  const contentLower = chunk.content.toLowerCase();
  const topicLower = (chunk.topic || "").toLowerCase();

  let score = 0;

  if (queryLower) {
    if (headingLower.includes(queryLower)) score += 15;
    if (topicLower.includes(queryLower)) score += 8;
    if (contentLower.includes(queryLower)) score += 10;
  }

  for (const token of tokens) {
    if (!token) continue;
    if (headingLower.includes(token)) score += 5;
    if (topicLower.includes(token)) score += 4;
    const occurrences = contentLower.split(token).length - 1;
    score += Math.min(occurrences, 5);
  }

  return score;
}

/**
 * Searches the Gameface RAG documentation for chunks relevant to a query.
 * Optionally narrows by [TOPIC] (substring match) or [SEVERITY] (exact match).
 */
export async function searchGamefaceDocs(params: SearchGamefaceDocsParams): Promise<SearchGamefaceDocsResult> {
  const { query, topic, severity, maxResults = 5 } = params;

  if (!query || query.trim() === "") {
    throw new Error("'query' parameter is required and cannot be empty");
  }

  const chunks = await loadChunks();
  const queryLower = query.trim().toLowerCase();
  const tokens = queryLower.split(/\s+/).filter(Boolean);

  let candidates = chunks;
  if (topic) {
    const topicLower = topic.toLowerCase();
    candidates = candidates.filter((c) => (c.topic || "").toLowerCase().includes(topicLower));
  }
  if (severity) {
    const severityLower = severity.toLowerCase();
    candidates = candidates.filter((c) => (c.severity || "").toLowerCase() === severityLower);
  }

  const scored = candidates
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, queryLower, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  log.info(`Search "${query}" (topic: ${topic || "any"}, severity: ${severity || "any"}) -> ${scored.length} results`);

  const results: GamefaceDocResult[] = scored.map(({ chunk, score }) => ({
    file: chunk.file,
    topic: chunk.topic,
    type: chunk.type,
    severity: chunk.severity,
    source: chunk.source,
    heading: chunk.heading,
    content: chunk.content,
    score,
  }));

  return {
    resultCount: results.length,
    results,
  };
}
