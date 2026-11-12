/**
 * Docs Sites
 *
 * The documentation sites search_gameface_docs can answer from. Each one
 * publishes an export (gameface-mcp-docs.json + .md) built by the Astro
 * integration in astro-integration/ during its production build; the server
 * downloads it (docs-sync.ts) into one generated file per site, so a site
 * that is down or publishes a broken export doesn't affect the others. A site
 * that publishes no export is skipped - the server never converts pages itself.
 *
 * Every site is synced. Engine-specific pages (the C++, Unity and Unreal
 * integration docs) are searched only for the engine a query is about - see
 * searchEngines() - so a generic question never gets another engine's steps.
 */

export const ENGINES = ["cpp", "unity", "unreal"] as const;
export type Engine = (typeof ENGINES)[number];

type PathRule = string | RegExp;

export interface DocsSite {
  /** Short name: the generated file's suffix, and what logs use. */
  id: string;
  title: string;
  root: string;
  /** Pages to keep: path prefixes or patterns, relative to root. */
  include: PathRule[];
  exclude?: RegExp[];
  /** The whole site is engine-specific: its TOPIC tags start with this engine (see engineOf). */
  engine?: Engine;
  /** The TOPIC tag of a page, from its path. Default: `<id>/<first path segment>`. Engine pages must start with `<engine>/`. */
  topic?: (path: string) => string;
}

const matches = (rules: PathRule[], path: string) => rules.some((r) => (typeof r === "string" ? path.startsWith(r) : r.test(path)));

export const DOCS_SITES: DocsSite[] = [
  {
    id: "gameface",
    title: "Gameface",
    root: "https://docs.coherent-labs.com/cpp-gameface/",
    // The UI docs: the same for every engine. The C++ API reference and release
    // notes are left out - they'd only crowd UI queries with C++ results.
    include: [
      "content_development/",
      "performance_optimization/",
      "integration/ui_scripting/",
      "integration/optional_features/",
      "quick_start/player/",
      "what_is_gfp/",
      // Release notes and changelogs: which version added, changed or removed a feature.
      "releases/",
      "changelog/",
      // The C++ integration: data binding and JS binding in C++, input, localization, setup.
      /_native\/$/,
    ],
    // hdrprimer is a long colour-science article; the HDR pages next to it carry the usable facts.
    exclude: [/hdrprimer\/$/],
    topic: (path) => {
      if (/_native\/$/.test(path)) return `cpp/${path.split("/")[0]}`;
      if (path.startsWith("performance_optimization/")) return "official-docs/performance";
      if (path.includes("supported_features_tables/") || path.startsWith("what_is_gfp/htmlfeaturesupport")) return "official-docs/supported-features";
      if (path.includes("htmldatabinding")) return "official-docs/data-binding";
      if (path.startsWith("integration/ui_scripting/")) return "official-docs/engine-bridge";
      if (path.startsWith("integration/optional_features/")) return "official-docs/features";
      if (path.includes("pages_guides/")) return "official-docs/guides";
      if (path.includes("components/")) return "official-docs/components";
      if (path.startsWith("quick_start/")) return "official-docs/tooling";
      return "official-docs/content";
    },
  },
  {
    id: "gameface-ui",
    title: "Gameface UI (SolidJS components)",
    root: "https://gameface-ui.coherent-labs.com/",
    include: ["docs/", "components/", "recipes/", "changelog/"],
  },
  {
    id: "frontend-tools",
    title: "Gameface frontend tools",
    root: "https://frontend-tools.coherent-labs.com/",
    // Every tool, with its changelog: the E2E framework, interaction manager, lint and Vite plugins, CLI.
    // The top-level changelog repeats the tools' own ones.
    include: [""],
    exclude: [/^changelog\//],
  },
  {
    id: "workflow-guide",
    title: "UI Workflow Guide",
    root: "https://guide.coherent-labs.com/",
    include: [""],
  },
  {
    id: "unity",
    title: "Gameface for Unity",
    root: "https://docs.coherent-labs.com/unity-gameface/",
    engine: "unity",
    // The Unity-specific pages only; the rest repeats the Gameface site's UI docs.
    include: [/_unity\//],
  },
  {
    id: "unreal",
    title: "Gameface for Unreal Engine",
    root: "https://docs.coherent-labs.com/unreal-gameface/",
    engine: "unreal",
    include: ["overview/", "integration/", "advanced-features/", "performance-optimization/", "tutorials/", "faq/", "knownissues/"],
  },
];

export function isIncluded(site: DocsSite, path: string): boolean {
  return !site.exclude?.some((re) => re.test(path)) && matches(site.include, path);
}

/** The engine a chunk's TOPIC tag belongs to, e.g. "unreal/integration" -> unreal; none for UI docs. */
export function engineOf(topic: string | undefined): Engine | undefined {
  const head = topic?.split("/")[0];
  return (ENGINES as readonly string[]).includes(head ?? "") ? (head as Engine) : undefined;
}

// How a query names an engine. Lookarounds instead of \b, since "C#" and "C++" end in symbols.
const ENGINE_TERMS: Record<Engine, RegExp> = {
  cpp: /(?<![\w#+])(c\+\+|cpp|native)(?![\w#+])/i,
  unity: /(?<![\w#+])(unity|c#|csharp|monobehaviou?r|gameobject)(?![\w#+])/i,
  unreal: /(?<![\w#+])(unreal|ue[45]?|blueprints?|umg|uobject|uclass|ustruct)(?![\w#+])/i,
};

/**
 * The engines whose integration pages a search includes: the one asked for,
 * else the ones the query names, else C++ (the default integration). The UI
 * docs are searched for every engine.
 */
export function searchEngines(query: string, engine?: Engine): Engine[] {
  if (engine) return [engine];
  const named = namedEngines(query);
  return named.length ? named : ["cpp"];
}

/** The engines a query names, e.g. "data binding in UE5" -> unreal. */
export const namedEngines = (query: string): Engine[] => ENGINES.filter((e) => ENGINE_TERMS[e].test(query));

/** Release notes and changelogs, which search ranks below the current docs. */
export const isChangelog = (path: string) => /(^|\/)(changelog|releases)\//.test(path);

/** The TOPIC tag of a page: `<site>/changelog` for release notes, so a search can filter to them. */
export const topicFor = (site: DocsSite, path: string) =>
  isChangelog(path) ? `${site.id}/changelog` : (site.topic?.(path) ?? `${site.id}/${path.split("/")[0] || "overview"}`);

/**
 * A page URL as search shows it, `<site id>:<path>`: the site root is the same
 * in every result from a site, so it isn't repeated (~15 tokens a result).
 */
export function shortSource(url: string): string {
  const site = DOCS_SITES.find((s) => url.startsWith(s.root));
  return site ? `${site.id}:${url.slice(site.root.length)}` : url;
}

/**
 * How the short sources in one response map to page URLs, one line per site
 * that appears, so the agent can open or fetch a page without looking elsewhere.
 */
export function sourceLegend(urls: string[]): string {
  const sites = DOCS_SITES.filter((s) => urls.some((u) => u.startsWith(s.root)));
  return sites.length ? `Page URLs: ${sites.map((s) => `${s.id}:<path> = ${s.root}<path>`).join("; ")}` : "";
}

/** The page URL for a short source (or a full URL, unchanged). */
export function fullSource(source: string): string {
  const [, id, path] = /^([\w-]+):(?!\/\/)(.*)$/.exec(source.trim()) ?? [];
  const site = DOCS_SITES.find((s) => s.id === id);
  return site ? site.root + path : source.trim();
}

/** One generated file per site, in the docs folder. */
export const generatedFile = (site: DocsSite) => `90-official-docs-${site.id}.generated.md`;
