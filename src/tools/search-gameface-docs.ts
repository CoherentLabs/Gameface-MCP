/**
 * Search Gameface Docs Tool
 *
 * Retrieval over the Gameface RAG documentation corpus (prompts/rag/*.md). Each
 * source file is a sequence of chunks separated by `---` rules, each tagged with
 * bracketed metadata like `[TOPIC: layout] [TYPE: concept] [SEVERITY: critical]`
 * followed by a heading and body. This module parses those chunks once, builds
 * a BM25 index over them, and ranks chunks against a query so agents can pull
 * in just the guidance relevant to what they're about to build, instead of the
 * whole corpus.
 *
 * Two tiers, searched in order:
 * 1. the curated topic files shipped in prompts/rag - distilled guidance, used
 *    on their own whenever they cover the query;
 * 2. the official docs sites the server syncs into ~/.gameface-mcp/docs, one
 *    generated file per site (see docs-sites.ts and docs-sync.ts) - searched
 *    when the curated files don't cover the query, and their best section
 *    joins the curated results when it matches as strongly.
 */

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type DocsSite, type Engine, DOCS_SITES, engineOf, fullSource, generatedFile, namedEngines, searchEngines, shortSource, sourceLegend } from "../docs-sites.js";
import { SearchGamefaceDocsParams, SearchGamefaceDocsResult, GamefaceDocResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("SearchGamefaceDocs");

export const RAG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts/rag");

/** Per-user folder the synced official docs are written to. */
export const DOCS_DIR = join(homedir(), ".gameface-mcp", "docs");

// The curated tier answers on its own when its best chunk holds at least this
// share of the query's terms (weighted by rarity); otherwise the official docs
// are searched too. Curated chunks still win ties then, being distilled
// guidance rather than raw doc text.
const CURATED_COVERAGE = 0.75;
const GENERATED_WEIGHT = 0.85;
// When curated chunks answer, the best official section still joins them, and
// leads once it outscores the best curated one by this factor (a tool's own API
// page, a full code example); a near-tie keeps the curated guidance first.
const OFFICIAL_LEAD = 1.1;
// Release notes and changelogs mention most features, usually in passing; they
// rank below the current docs unless the query asks about versions.
const CHANGELOG_WEIGHT = 0.5;
// A version question's release note must hold this share of its other terms.
const CHANGELOG_COVERAGE = 0.6;
const VERSION_QUERY = /\b(v?\d+\.\d+(\.\d+)?|versions?|changelog|release notes?|releases?|since|added|removed|deprecated|introduced|lts)\b/i;

// BM25 parameters: the usual defaults. Heading words count three times, since
// a heading naming the query term is the strongest signal a chunk is about it.
const K1 = 1.2;
const B = 0.75;
const HEADING_BOOST = 3;
// Results scoring under this share of the best one are dropped, so a specific
// question returns its one or two answers instead of always filling maxResults.
// Measured on 35 agent questions: 0.5 -> 4.1 results/query, 0.65 -> 3.0, 0.8 -> 2.0,
// all with every answer still returned; 0.65 leaves headroom for broad queries.
const RELATIVE_CUTOFF = 0.65;

export interface DocChunk {
  file: string;
  topic?: string;
  type?: string;
  severity?: string;
  source?: string;
  heading: string;
  /** Full chunk text, metadata line and heading included - what scoring runs against. */
  content: string;
  /** The text after the heading - what search returns, since the metadata is already in its own fields. */
  body: string;
  generated?: boolean;
}

interface DocIndex {
  chunks: DocChunk[];
  /** term -> (chunk index -> weighted term frequency) */
  postings: Map<string, Map<number, number>>;
  lengths: number[];
  avgLength: number;
}

let cachedIndex: Promise<DocIndex> | null = null;
let initialSync: Promise<void> | null = null;
const INITIAL_SYNC_WAIT_MS = 60_000;

/**
 * Lists the RAG doc filenames (sorted) shipped in prompts/rag, used both for
 * search and for registering each file as a browsable MCP resource.
 */
export async function listRagDocFiles(): Promise<string[]> {
  const files = await readdir(RAG_DIR);
  return files.filter((f) => f.endsWith(".md")).sort();
}

export function parseChunks(file: string, raw: string): DocChunk[] {
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
      body: trimmed.slice((headingMatch.index ?? 0) + headingMatch[0].length).trim(),
    });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// The pending load is cached rather than its result, so concurrent first
// searches share one read of the corpus.
function loadIndex(): Promise<DocIndex> {
  cachedIndex ??= readChunks().then(buildIndex);
  return cachedIndex;
}

/** Drops the loaded corpus so the next search re-reads it - called after a docs sync. */
export function invalidateDocsCache(): void {
  cachedIndex = null;
}

/**
 * Makes searches wait (up to a minute) for the first docs sync of a fresh
 * install, so they don't answer without the official docs.
 */
export function awaitInitialDocsSync(sync: Promise<unknown>): void {
  initialSync = sync.then(
    () => { initialSync = null; },
    () => { initialSync = null; }
  );
}

/** Waits (up to a minute) for a fresh install's first docs sync, if one is running. */
async function waitForInitialSync(): Promise<void> {
  if (initialSync) await Promise.race([initialSync, new Promise((r) => setTimeout(r, INITIAL_SYNC_WAIT_MS).unref())]);
}

/** A site's generated file in `dir`, or null before its first sync. */
export async function readGenerated(dir: string, site: DocsSite): Promise<string | null> {
  try {
    return await readFile(join(dir, generatedFile(site)), "utf8");
  } catch {
    return null;
  }
}

async function readChunks(): Promise<DocChunk[]> {
  const files = await listRagDocFiles();
  const chunks: DocChunk[] = [];

  for (const file of files) {
    const raw = await readFile(resolve(RAG_DIR, file), "utf8");
    chunks.push(...parseChunks(file, raw));
  }

  for (const site of DOCS_SITES) {
    const raw = await readGenerated(DOCS_DIR, site);
    if (!raw) continue;
    // Every real chunk has a SOURCE; the file's title block doesn't.
    const generated = parseChunks(generatedFile(site), raw)
      .filter((c) => c.source)
      .map((c) => ({ ...c, generated: true }));
    chunks.push(...generated);
    log.info(`Loaded ${generated.length} ${site.id} docs chunks`);
  }

  log.info(`Loaded ${chunks.length} documentation chunks (${files.length} curated files)`);
  return chunks;
}

// ---------------------------------------------------------------------------
// BM25
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  "a an and are as at be by can do for from how i in is it its of on or that the this to use using what when with you your".split(" ")
);

function stem(term: string): string {
  // Plural folding only: "animations" finds "animation". Anything heavier
  // mangles CSS and API names, which are most of what agents search for.
  return term.length > 4 && term.endsWith("s") && !term.endsWith("ss") ? term.slice(0, -1) : term;
}

/**
 * Splits text into search terms. Compound names (`text-overflow`,
 * `data-bind-for`, `engine.call`) are kept whole and also split into their
 * parts, so "text overflow" and "text-overflow" find the same chunks.
 */
function searchTerms(text: string): string[] {
  const terms: string[] = [];
  for (const word of text.toLowerCase().match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    terms.push(stem(word));
    if (/[-_.]/.test(word)) {
      for (const part of word.split(/[-_.]/)) if (part.length > 1 && !STOPWORDS.has(part)) terms.push(stem(part));
    }
  }
  return terms;
}

function buildIndex(chunks: DocChunk[]): DocIndex {
  const postings = new Map<string, Map<number, number>>();
  const lengths: number[] = [];

  chunks.forEach((chunk, i) => {
    const tf = new Map<string, number>();
    const add = (terms: string[], weight: number) => {
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + weight);
    };
    add(searchTerms(chunk.heading), HEADING_BOOST);
    add(searchTerms(`${chunk.topic ?? ""} ${chunk.body}`), 1);

    let length = 0;
    for (const [term, n] of tf) {
      length += n;
      let list = postings.get(term);
      if (!list) postings.set(term, (list = new Map()));
      list.set(i, n);
    }
    lengths.push(length);
  });

  const avgLength = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  return { chunks, postings, lengths, avgLength };
}

type Hit = { i: number; chunk: DocChunk; score: number };

const isChangelogChunk = (chunk: DocChunk) => chunk.topic?.endsWith("/changelog") ?? false;

function rank(index: DocIndex, query: string, allowed: (chunk: DocChunk) => boolean): Hit[] {
  const n = index.chunks.length;
  const scores = new Map<number, number>();

  for (const term of new Set(searchTerms(query))) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (n - list.size + 0.5) / (list.size + 0.5));
    for (const [i, tf] of list) {
      const norm = tf + K1 * (1 - B + (B * index.lengths[i]) / index.avgLength);
      scores.set(i, (scores.get(i) ?? 0) + (idf * tf * (K1 + 1)) / norm);
    }
  }

  const changelogWeight = VERSION_QUERY.test(query) ? 1 : CHANGELOG_WEIGHT;
  const weight = (chunk: DocChunk) => (chunk.generated ? GENERATED_WEIGHT : 1) * (isChangelogChunk(chunk) ? changelogWeight : 1);
  return [...scores]
    .map(([i, score]) => ({ i, chunk: index.chunks[i], score: score * weight(index.chunks[i]) }))
    .filter(({ chunk }) => allowed(chunk))
    .sort((a, b) => b.score - a.score);
}

/** Share of the query's terms a chunk contains, each weighted by its IDF so rare terms count most. */
function queryCoverage(index: DocIndex, query: string, chunk: number): number {
  const n = index.chunks.length;
  let total = 0;
  let found = 0;
  for (const term of new Set(searchTerms(query))) {
    const list = index.postings.get(term);
    const idf = Math.log(1 + (n - (list?.size ?? 0) + 0.5) / ((list?.size ?? 0) + 0.5));
    total += idf;
    if (list?.has(chunk)) found += idf;
  }
  return total ? found / total : 0;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * What the tool sends the agent: plain markdown, one block per result. As JSON,
 * field names, quoting and escaped newlines were about a fifth of every
 * response and told the agent nothing.
 *
 * Several searches are answered in one response, each under its query. A chunk
 * two queries both found is printed once; one tool call instead of several
 * saves the agent a turn per query, and each turn re-sends the whole conversation.
 */
export function formatSearchResults(searches: { query: string; result: SearchGamefaceDocsResult }[]): string {
  const all = searches.flatMap((s) => s.result.results);
  const legend = sourceLegend(all.flatMap((r) => (r.source ? [r.source] : [])));
  const shown = new Set<string>();
  const block = (r: GamefaceDocResult) => {
    const key = `${r.source ?? r.file}|${r.heading}`;
    if (shown.has(key)) return `## ${r.heading}\n(shown above)`;
    shown.add(key);
    const tags = [r.topic, r.severity].filter(Boolean).join(", ");
    const meta = r.source ? shortSource(r.source) : tags ? `[${tags}]` : "";
    return `## ${r.heading}\n${meta ? meta + "\n" : ""}\n${r.content}`;
  };

  const single = searches.length === 1;
  const sections = searches.map(({ query, result }) => {
    const body = result.results.length ? result.results.map(block).join("\n\n---\n\n") : single ? (result.hint ?? "No results.") : "No match.";
    return single ? body : `# ${query}\n\n${body}`;
  });
  // With several queries, the what-to-try-next hint is given once, and so is each note.
  const hint = !single ? searches.find((s) => !s.result.results.length)?.result.hint : undefined;
  const notes = [...new Set(searches.flatMap((s) => (s.result.note ? [s.result.note] : [])))];
  return [legend, ...sections, hint, ...notes].filter(Boolean).join("\n\n");
}

/**
 * Searches the Gameface RAG documentation for chunks relevant to a query.
 * Optionally narrows by [TOPIC] (substring match) or [SEVERITY] (exact match).
 */
export async function searchGamefaceDocs(params: SearchGamefaceDocsParams): Promise<SearchGamefaceDocsResult> {
  const { query, topic, severity, engine, maxResults = 5 } = params;

  if (!query || query.trim() === "") {
    throw new Error("'query' parameter is required and cannot be empty");
  }

  await waitForInitialSync();
  const index = await loadIndex();
  const topicLower = topic?.toLowerCase();
  const severityLower = severity?.toLowerCase();
  // Another engine's integration steps would be wrong here, so only this query's engines are searched.
  const engines = searchEngines(query, engine);
  const ranked = rank(
    index,
    query,
    (c) =>
      (!c.generated || !engineOf(c.topic) || engines.includes(engineOf(c.topic)!)) &&
      (!topicLower || (c.topic || "").toLowerCase().includes(topicLower)) &&
      (!severityLower || (c.severity || "").toLowerCase() === severityLower)
  );

  const curated = ranked.filter(({ chunk }) => !chunk.generated);
  const curatedCovers = curated.length > 0 && queryCoverage(index, query, curated[0].i) >= CURATED_COVERAGE;
  const candidates = curatedCovers ? curated : ranked;

  const best = candidates[0]?.score ?? 0;
  const scored = candidates.filter(({ score }) => score >= best * RELATIVE_CUTOFF).slice(0, maxResults);
  // Curated text can name a term without showing how to use it (a support-table
  // row), so the best official section still joins when it matches as strongly.
  // It leads when it clearly outscores them, e.g. a tool's own API page.
  if (curatedCovers) {
    const official = ranked.find(({ chunk }) => chunk.generated);
    if (official && official.score >= best * RELATIVE_CUTOFF) {
      if (scored.length >= maxResults) scored.pop();
      if (official.score >= best * OFFICIAL_LEAD) scored.unshift(official);
      else scored.push(official);
    }
  }
  // A version question needs the release note even when the current docs
  // outscore it - as long as it is about the feature, not just a version.
  if (VERSION_QUERY.test(query) && !scored.some(({ chunk }) => isChangelogChunk(chunk))) {
    const feature = query.replace(new RegExp(VERSION_QUERY.source, "gi"), " ");
    const note = ranked.find(({ chunk, i }) => isChangelogChunk(chunk) && queryCoverage(index, feature, i) >= CHANGELOG_COVERAGE);
    if (note) {
      if (scored.length >= maxResults) scored.pop();
      scored.push(note);
    }
  }

  log.info(`Search "${query}" (topic: ${topic || "any"}, severity: ${severity || "any"}) -> ${scored.length} results${curatedCovers ? " (curated)" : ""}`);

  const results: GamefaceDocResult[] = scored.map(({ chunk, score }) => ({
    file: chunk.file,
    topic: chunk.topic,
    type: chunk.type,
    severity: chunk.severity,
    source: chunk.source,
    heading: chunk.heading,
    content: chunk.body,
    score: Math.round(score * 10) / 10,
  }));

  // A question about an engine whose docs aren't synced still gets UI results,
  // so the agent is told where that engine's own steps are.
  const asked = engine ? [engine] : namedEngines(query);
  const unsynced = DOCS_SITES.filter((s) => s.engine && asked.includes(s.engine) && !loadedFiles(index).has(generatedFile(s)));

  return {
    resultCount: results.length,
    results,
    ...(results.length === 0 && { hint: noMatchHint(index, engines) }),
    ...(results.length > 0 &&
      unsynced.length > 0 && {
        note: `These are the engine-independent docs: the ${unsynced.map((s) => s.title).join(" and ")} docs aren't searchable yet. For engine-side steps, fetch the pages from ${unsynced.map((s) => s.root).join(" or ")}.`,
      }),
  };
}

const loadedFiles = (index: DocIndex) => new Set(index.chunks.filter((c) => c.generated).map((c) => c.file));

/**
 * What to do after a search that found nothing: other keywords first, then the
 * website - search can't answer everything, and fetching the page is the
 * agent's fallback (its own web tools; this server doesn't fetch for it).
 * Sites not synced yet (no export published) aren't in the corpus at all, so
 * they're named as ones to fetch from directly.
 */
function noMatchHint(index: DocIndex, engines: Engine[]): string {
  const loaded = loadedFiles(index);
  const sites = DOCS_SITES.filter((s) => !s.engine || engines.includes(s.engine));
  const missing = sites.filter((s) => !loaded.has(generatedFile(s)));
  const searched = sites.filter((s) => loaded.has(generatedFile(s)));
  return (
    "No match. Retry with different keywords (e.g. the CSS property, attribute or API name) or drop the topic/severity filter." +
    (searched.length
      ? ` If that finds nothing either, find the page in the site's llms.txt and fetch its Markdown version (page URL + index.html.md, much smaller than the HTML), or the page itself if that doesn't exist: ${searched.map((s) => s.root + "llms.txt").join(", ")}.`
      : "") +
    (missing.length ? ` Not searchable yet (their docs aren't synced), so fetch from them directly: ${missing.map((s) => s.root).join(", ")}.` : "")
  );
}

// A whole page above this is answered with its outline instead (~12k tokens).
const READ_MAX_CHARS = 48_000;

/**
 * The full text of an official-docs section (a search result's source, short or
 * as a URL, with its anchor), joining the parts search returns separately, or of
 * a whole page (no anchor).
 */
export async function readGamefaceDocSection(source: string): Promise<string> {
  await waitForInitialSync();
  const wanted = fullSource(source);
  const page = wanted.split("#")[0];
  const generated = (await loadIndex()).chunks.filter((c) => c.generated && c.source);
  const matching = generated.filter((c) => (wanted.includes("#") ? c.source === wanted : c.source!.split("#")[0] === page));
  if (!matching.length) {
    return `No official-docs section at ${source}. Pass a source exactly as search_gameface_docs returned it (with or without its #anchor).`;
  }

  const sections = new Map<string, { heading: string; bodies: string[] }>();
  for (const c of matching) {
    const entry = sections.get(c.source!) ?? { heading: c.heading.replace(/ \(\d+\/\d+\)$/, ""), bodies: [] };
    entry.bodies.push(c.body);
    sections.set(c.source!, entry);
  }
  const blocks = [...sections].map(([src, s]) => `## ${s.heading}\n${shortSource(src)}\n\n${s.bodies.join("\n\n")}`);
  const text = blocks.join("\n\n---\n\n");
  if (text.length <= READ_MAX_CHARS) return `${sourceLegend([page])}\n\n${text}`;

  return (
    `${sourceLegend([page])}\n\n${shortSource(page)} is ~${Math.round(text.length / 4).toLocaleString("en-US")} tokens; read one of its sections instead:\n\n` +
    [...sections].map(([src, s]) => `- ${s.heading} (~${Math.round(s.bodies.join("").length / 4)} tokens): ${shortSource(src)}`).join("\n")
  );
}
