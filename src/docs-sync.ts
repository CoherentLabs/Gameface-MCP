/**
 * Official Docs Sync
 *
 * Keeps a local copy of the official documentation sites (docs-sites.ts), as
 * compact search-sized chunks: search_gameface_docs loads one generated file
 * per site alongside the curated files (prompts/rag/*.md), so agents find the
 * official content locally instead of fetching the website - a fetched page
 * costs roughly 6k-9k tokens of text (68k-94k as raw HTML) where a search
 * result is a few hundred.
 *
 * Each site publishes an export during its production build (the Astro
 * integration in astro-integration/): llms-full.txt, every page as chunks
 * (also the site's llms.txt full file), and gameface-mcp-docs.json, a manifest
 * naming its version and file - older exports named it gameface-mcp-docs.md. The
 * server runs this itself (startDocsAutoSync): on startup, then once a day
 * while it keeps running, it fetches each site's manifest and downloads the
 * file only when its version changed, into ~/.gameface-mcp/docs. A site that
 * publishes no export is skipped: the server never converts pages itself.
 *
 * `gameface-mcp sync-docs` does the same by hand, and also writes a coverage
 * report per site: which sections the curated corpus covers.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type DocsSite,
  DOCS_SITES,
  generatedFile,
  isIncluded,
  topicFor,
} from "./docs-sites.js";
import {
  RAG_DIR,
  DOCS_DIR,
  listRagDocFiles,
  parseChunks,
  readGenerated,
  invalidateDocsCache,
  awaitInitialDocsSync,
} from "./tools/search-gameface-docs.js";
import { createLogger } from "./logger.js";

// The export format, as coherent-docs-theme's agentDocs integration writes it. The
// file to download is the one the manifest names; this name only labels chunks.
const HOSTED_DOCS_FILE = "llms-full.txt";
const HOSTED_MANIFEST_FILE = "gameface-mcp-docs.json";
/** The export format this server reads; an export in another one is skipped. */
const HOSTED_FORMAT = 1;

interface HostedManifest {
  format: number;
  /** Content hash: changes only when the docs text does. */
  version: string;
  updated: string;
  pages: number;
  bytes: number;
  sha256: string;
  file: string;
}

// Coverage thresholds, calibrated against pages the curated corpus is known to
// cover (layout, data binding) and ones it doesn't (supported-feature tables).
const COVERED_AT = 0.42;
const PARTIAL_AT = 0.25;

export interface DocsSyncOptions {
  site: DocsSite;
  outDir: string;
  checkOnly: boolean;
  /** Write the coverage report (the CLI does; the server's auto-sync doesn't). */
  writeReport: boolean;
}

/** A section of an official page, as the export's chunks give it (the parts of a long one joined). */
interface Section {
  source: string;
  url: string;
  pageTitle: string;
  heading: string;
  body: string;
}

type Status = "covered" | "partial" | "missing";

interface SectionReport {
  section: Section;
  status: Status;
  coverage: number;
  bestMatch?: string;
  missingTerms: string[];
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "gameface-mcp-docs-sync" } });
      return { status: res.status, text: await res.text() };
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

// ---------------------------------------------------------------------------
// Coverage scoring
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  "the and for with that this from are you your can will not but have has was its into use used using also when which such than then them they their there these those each more most other some only any all one two how what where while about over like just been being does should would could may might must make makes made get gets set sets via per see example examples below above following following note".split(" ")
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

/** Identifier-like terms (CSS properties, attributes, APIs) - the facts an agent actually looks up. */
function identifiers(body: string): string[] {
  // Inline code spans only: prose has hyphenated English ("performance-wise")
  // and code samples have throwaway names, neither of which says anything
  // about what the corpus is missing.
  const prose = body.replace(/```[\s\S]*?```/g, "");
  const terms = new Set<string>();
  for (const m of prose.matchAll(/`([^`\n]{3,40})`/g)) {
    const term = m[1].trim().toLowerCase().replace(/\(\)$/, "");
    if (!/^[\w:.\-@#]+$/.test(term)) continue;
    if (/\.(css|js|ts|html|png|jpe?g|svg|json|dll|exe)$/.test(term) || /^[\d.x%px-]+$/.test(term)) continue;
    terms.add(term);
  }
  return [...terms];
}

type Vector = Map<string, number>;

class CorpusIndex {
  private idf = new Map<string, number>();
  private vectors: { heading: string; file: string; vec: Vector }[] = [];
  readonly text: string;

  constructor(chunks: { heading: string; file: string; content: string }[]) {
    const df = new Map<string, number>();
    const tokenized = chunks.map((c) => tokenize(c.content));
    for (const tokens of tokenized) for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    for (const [t, n] of df) this.idf.set(t, Math.log((chunks.length + 1) / (n + 1)) + 1);
    this.vectors = chunks.map((c, i) => ({ heading: c.heading, file: c.file, vec: this.vectorize(tokenized[i]) }));
    this.text = chunks.map((c) => c.content.toLowerCase()).join("\n");
  }

  vectorize(tokens: string[]): Vector {
    const maxIdf = Math.log(this.vectors.length + 2) + 1;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec: Vector = new Map();
    let norm = 0;
    for (const [t, n] of tf) {
      const w = (1 + Math.log(n)) * (this.idf.get(t) ?? maxIdf);
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  }

  bestMatch(text: string): { score: number; heading?: string } {
    const query = this.vectorize(tokenize(text));
    let best = { score: 0, heading: undefined as string | undefined };
    for (const { heading, file, vec } of this.vectors) {
      let dot = 0;
      for (const [t, w] of query) dot += w * (vec.get(t) ?? 0);
      if (dot > best.score) best = { score: dot, heading: `${file} > ${heading}` };
    }
    return best;
  }
}

function scoreSection(index: CorpusIndex, section: Section): SectionReport {
  const text = `${section.heading}\n${section.body}`;
  const match = index.bestMatch(text);
  const terms = identifiers(section.body);
  const missingTerms = terms.filter((t) => !index.text.includes(t));
  const termCoverage = terms.length ? 1 - missingTerms.length / terms.length : match.score;
  const coverage = 0.6 * match.score + 0.4 * termCoverage;
  const status: Status = coverage >= COVERED_AT ? "covered" : coverage >= PARTIAL_AT ? "partial" : "missing";
  return { section, status, coverage, bestMatch: match.heading, missingTerms };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

interface DocsChunk {
  source: string;
  heading: string;
  body: string;
}

/**
 * Which pages a generated file holds: a hash of the site's page rules. A
 * change to them filters the installed export again, without waiting for a new
 * docs version.
 */
function scopeOf(site: DocsSite): string {
  const rules = JSON.stringify([site.include, site.exclude], (_, v) => (v instanceof RegExp ? v.source : v));
  return sha256(rules).slice(0, 6);
}

function renderGenerated(site: DocsSite, chunks: DocsChunk[], info: { pages: number; version: string; scope: string }): string {
  const out = [
    `# Official ${site.title} Documentation (generated)`,
    `<!-- Generated by gameface-mcp - do not edit; updated by \`gameface-mcp sync-docs\`. Synced ${new Date().toISOString()} from ${site.root} (pages: ${info.pages}, rules: ${info.scope}, version: ${info.version}) -->`,
    "<!-- All UI-relevant sections; search ranks the curated topic files first. -->",
  ];
  for (const chunk of chunks) {
    // No TYPE/SEVERITY: they'd be the same on every chunk
    out.push("", "---", `[TOPIC: ${topicFor(site, chunk.source.slice(site.root.length).split("#")[0])}] [SOURCE: ${chunk.source}]`, `## ${chunk.heading}`, "", chunk.body);
  }
  return out.join("\n") + "\n";
}

const tokens = (chars: number) => Math.round(chars / 4).toLocaleString("en-US");

/** Joins a long section's parts (headed "Page: Section (i/n)") back into one section. */
function toSections(chunks: DocsChunk[]): Section[] {
  const bySource = new Map<string, Section>();
  for (const c of chunks) {
    const heading = c.heading.replace(/ \(\d+\/\d+\)$/, "");
    const existing = bySource.get(c.source);
    if (existing) {
      existing.body += "\n\n" + c.body;
      continue;
    }
    const pageTitle = heading.split(": ")[0];
    bySource.set(c.source, { source: c.source, url: c.source.split("#")[0], pageTitle, heading: heading.slice(pageTitle.length + 2) || heading, body: c.body });
  }
  return [...bySource.values()];
}

function renderReport(site: DocsSite, reports: SectionReport[]): string {
  const byPage = new Map<string, SectionReport[]>();
  for (const r of reports) byPage.set(r.section.url, [...(byPage.get(r.section.url) ?? []), r]);
  const count = (s: Status) => reports.filter((r) => r.status === s).length;
  const docsChars = reports.reduce((n, r) => n + r.section.body.length, 0);
  const missingTerms = new Set(reports.flatMap((r) => r.missingTerms));

  const rows = [...byPage.entries()]
    .map(([url, rs]) => {
      const chars = rs.reduce((n, r) => n + r.section.body.length, 0);
      const missingChars = rs.filter((r) => r.status !== "covered").reduce((n, r) => n + r.section.body.length, 0);
      return { url, title: rs[0].section.pageTitle, rs, gap: missingChars / (chars || 1) };
    })
    .sort((a, b) => b.gap - a.gap);

  const lines = [
    `# ${site.title} docs coverage report`,
    "",
    `Generated ${new Date().toISOString()} from ${site.root}`,
    "",
    `- Pages: ${byPage.size}`,
    `- Sections: ${reports.length} - covered ${count("covered")}, partial ${count("partial")}, missing ${count("missing")}`,
    `- Identifiers (properties, attributes, APIs) in the official docs but nowhere in the curated corpus: ${missingTerms.size}`,
    `- Official docs as compact text: ~${tokens(docsChars)} tokens`,
    "",
    "A section is *covered* when the curated corpus has a close match (TF-IDF similarity) and mentions most of its",
    "identifiers (CSS properties, attributes, APIs). Pages are sorted by the share of their text that isn't covered.",
    "",
    "| Page | Not covered | Sections (covered/partial/missing) |",
    "|---|---|---|",
    ...rows.map(({ url, title, rs, gap }) => {
      const c = (s: Status) => rs.filter((r) => r.status === s).length;
      return `| [${title}](${url}) | ${Math.round(gap * 100)}% | ${c("covered")}/${c("partial")}/${c("missing")} |`;
    }),
    "",
    "## Sections not covered",
    "",
  ];

  for (const { url, title, rs } of rows) {
    const gaps = rs.filter((r) => r.status !== "covered");
    if (!gaps.length) continue;
    lines.push(`### [${title}](${url})`, "");
    for (const r of gaps) {
      const terms = r.missingTerms.slice(0, 8).map((t) => `\`${t}\``).join(", ");
      lines.push(
        `- **${r.section.heading}** - ${r.status}, ${Math.round(r.coverage * 100)}%` +
          (r.bestMatch && r.status === "partial" ? `; closest: ${r.bestMatch}` : "") +
          (terms ? `; not in corpus: ${terms}${r.missingTerms.length > 8 ? `, +${r.missingTerms.length - 8} more` : ""}` : "")
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

async function loadCuratedChunks() {
  const chunks = [];
  for (const file of await listRagDocFiles()) {
    chunks.push(...parseChunks(file, await readFile(resolve(RAG_DIR, file), "utf8")));
  }
  return chunks;
}

// An export with much less than the last one most likely came from a broken
// docs build; the old docs are kept instead.
const MIN_PAGE_SHARE = 0.7;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

type Hosted = { status: "missing" } | { status: "current" } | { status: "new"; markdown: string; version: string };

/**
 * The site's export: one small manifest request, and the file itself only
 * when its version, or the page rules it's filtered by, differ from the
 * installed ones. "missing" when the site publishes none, or one in a format
 * this server can't read.
 */
async function fetchHosted(site: DocsSite, outDir: string, scope: string, log: (msg: string) => void): Promise<Hosted> {
  const res = await fetchText(site.root + HOSTED_MANIFEST_FILE);
  if (res.status === 404) return { status: "missing" };
  if (res.status !== 200) throw new Error(`${HOSTED_MANIFEST_FILE} returned ${res.status}`);
  const manifest = JSON.parse(res.text) as HostedManifest;
  if (manifest.format !== HOSTED_FORMAT) {
    log(`${HOSTED_MANIFEST_FILE} has format ${manifest.format}, this server reads ${HOSTED_FORMAT} - skipped`);
    return { status: "missing" };
  }

  const installed = (await readGenerated(outDir, site))?.match(/rules: (\w+), version: (\w+)\)/);
  if (installed?.[1] === scope && installed[2] === manifest.version) return { status: "current" };

  const file = await fetchText(new URL(manifest.file, site.root).href);
  if (file.status !== 200) throw new Error(`${manifest.file} returned ${file.status}`);
  if (sha256(file.text) !== manifest.sha256) throw new Error(`${manifest.file} doesn't match the checksum in ${HOSTED_MANIFEST_FILE}`);
  log(`Downloaded ${manifest.file}: version ${manifest.version}, ${manifest.pages} pages, ${Math.round(manifest.bytes / 1024)} KB`);
  return { status: "new", markdown: file.text, version: manifest.version };
}

async function writeReport(options: DocsSyncOptions, chunks: DocsChunk[], log: (msg: string) => void) {
  const { site } = options;
  const index = new CorpusIndex(await loadCuratedChunks());
  const reports = toSections(chunks).map((s) => scoreSection(index, s));
  const reportPath = join(options.outDir, `coverage-report-${site.id}.md`);
  await mkdir(options.outDir, { recursive: true });
  await writeFile(reportPath, renderReport(site, reports));
  log(`Report: ${reportPath}`);
}

export async function syncDocs(options: DocsSyncOptions, log: (msg: string) => void = console.log) {
  const { site } = options;
  const scope = scopeOf(site);
  const hosted = await fetchHosted(site, options.outDir, scope, log);
  const result = { status: hosted.status, pages: 0, written: false };
  if (hosted.status === "missing") {
    log(`No ${HOSTED_MANIFEST_FILE} published at ${site.root} - skipped`);
    return result;
  }

  let inScope: DocsChunk[];
  if (hosted.status === "current") {
    // Already installed: the report reads the installed file.
    if (!options.writeReport) return result;
    const installed = await readGenerated(options.outDir, site);
    inScope = parseChunks(generatedFile(site), installed!).filter((c) => c.source).map((c) => ({ source: c.source!, heading: c.heading, body: c.body }));
  } else {
    // The export holds the whole site; keep the pages UI authors need, all of
    // them: search puts the curated files first, so overlap costs little.
    inScope = parseChunks(HOSTED_DOCS_FILE, hosted.markdown)
      .filter((c) => c.source?.startsWith(site.root) && isIncluded(site, c.source.slice(site.root.length).split("#")[0]))
      .map((c) => ({ source: c.source!, heading: c.heading, body: c.body }));
  }
  result.pages = new Set(inScope.map((c) => c.source.split("#")[0])).size;
  if (options.writeReport) await writeReport(options, inScope, log);
  if (hosted.status === "current" || options.checkOnly) return result;

  // Changed page rules legitimately change the page count; only the same rules are compared.
  const previous = (await readGenerated(options.outDir, site))?.match(/\(pages: (\d+), rules: (\w+)/);
  if (previous?.[2] === scope && result.pages < Number(previous[1]) * MIN_PAGE_SHARE) {
    log(`Only ${result.pages} pages in the export (the last sync had ${previous[1]}) - keeping the current docs`);
    return result;
  }

  await mkdir(options.outDir, { recursive: true });
  // Written to a temp file and renamed, so a search never reads a half-written file.
  const generated = renderGenerated(site, inScope, { pages: result.pages, version: hosted.version, scope });
  const outFile = join(options.outDir, generatedFile(site));
  await writeFile(outFile + ".tmp", generated);
  await rename(outFile + ".tmp", outFile);
  invalidateDocsCache();
  log(`Generated ${inScope.length} chunks (~${tokens(generated.length)} tokens): ${outFile}`);
  return { ...result, written: true };
}

// ---------------------------------------------------------------------------
// Auto-sync (run by the server)
// ---------------------------------------------------------------------------

const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Syncs every docs site on server startup, then again a day after the last
 * sync while the server keeps running (checked hourly, so a machine waking
 * from sleep catches up). Never throws: a failed sync keeps the docs already
 * on disk. A fresh install has none, so its first searches wait for the first
 * sync.
 */
export function startDocsAutoSync(): void {
  const log = createLogger("DocsSync");
  const outDir = DOCS_DIR;
  const sites = DOCS_SITES;
  let running: Promise<void> | null = null;
  let lastRun = 0;
  const syncAll = async () => {
    for (const site of sites) {
      // syncDocs logs the details (a skipped site among them); this adds the outcome.
      await syncDocs({ site, outDir, checkOnly: false, writeReport: false }, (msg) => log.info(`[${site.id}] ${msg}`)).then(
        (r) => {
          if (r.status === "current") log.info(`Docs sync done (${site.id}): already current`);
          else if (r.status === "new") log.info(`Docs sync done (${site.id}, downloaded): ${r.pages} pages${r.written ? "" : ", not written"}`);
        },
        (error) => log.warn(`Docs sync failed (${site.id}), keeping the current docs: ${error.message}`)
      );
    }
  };
  const run = () => {
    lastRun = Date.now();
    return (running ??= syncAll().finally(() => (running = null)));
  };

  void (async () => {
    const existing = (await Promise.all(sites.map((site) => readGenerated(outDir, site)))).some(Boolean);
    const sync = run();
    if (!existing) awaitInitialDocsSync(sync);

    setInterval(() => {
      if (Date.now() - lastRun >= SYNC_EVERY_MS) run();
    }, CHECK_EVERY_MS).unref();
  })();
}

const USAGE = `Usage: gameface-mcp sync-docs [options]

Downloads the docs exports of every site into the files
search_gameface_docs loads (only the ones whose version changed), and writes a
coverage report per site: which sections the curated corpus covers, partly
covers or misses. Sites that publish no export are skipped.

Sites: ${DOCS_SITES.map((s) => s.id + (s.engine ? ` (engine ${s.engine})` : "")).join(", ")}

Options:
  --out <dir>          Output directory, also for the reports (default: ${DOCS_DIR})
  --check              Only write the coverage reports`;

export async function runDocsSyncCli(argv: string[]): Promise<number> {
  const options: Omit<DocsSyncOptions, "site"> = { outDir: DOCS_DIR, checkOnly: false, writeReport: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--out": options.outDir = resolve(value()); break;
      case "--check": options.checkOnly = true; break;
      case "-h":
      case "--help": console.log(USAGE); return 0;
      default: console.error(`Unknown option: ${arg}\n\n${USAGE}`); return 1;
    }
  }

  for (const site of DOCS_SITES) {
    console.log(`\n== ${site.title} (${site.id})`);
    await syncDocs({ ...options, site });
  }
  return 0;
}
