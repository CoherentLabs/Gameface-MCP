/**
 * Shared trace capture and aggregation.
 *
 * perf_profile and perf_trace must measure identically or their numbers cannot
 * be compared, so both go through here - the same discipline tools/perf/calibrate.js
 * enforces for perf_measure and its calibration script.
 *
 * Gameface emits its own phases into the standard Chrome trace-event stream.
 * Verified on Cohtml 3.2.0.2: Coherent_Advance, Coherent_Styling, Coherent_Paint
 * and the rest arrive as balanced begin/end pairs carrying args.frameId, plus
 * per-frame UpdateCounters instants holding node and heap counts.
 *
 * Two things shape the aggregation:
 *  - Phases run on several threads (styling is not on the advance thread), so
 *    begin/end pairing is keyed per thread, not per name.
 *  - Phases nest and cross threads, so their durations do not sum to frame time
 *    and no percentage breakdown of a frame can honestly be derived from them.
 *
 * On the noise floor: repeated captures of an unchanged page vary considerably.
 * Measured across six consecutive captures, paint-side phases moved by up to
 * 20% and summed engine cost by 11%, with nothing changed between them. The
 * first capture or two also run consistently hotter, so a warmup capture is
 * discarded. Any judgement about whether an edit helped has to be made against
 * that spread, measured in the same session, rather than against a baseline
 * recorded on another machine under other conditions.
 */

import { getConnectionManager } from "./connect-browser.js";
import { withTimeout } from "../utils/with-timeout.js";
import { createLogger } from "../logger.js";

const log = createLogger("TraceCapture");

/** Grace period after Tracing.end for the backend to flush its buffer. */
const FLUSH_MS = 1500;

export const DEFAULT_CAPTURE_MS = 2000;
export const DEFAULT_WARMUP_RUNS = 1;
export const DEFAULT_SAMPLE_RUNS = 3;

interface TraceRecord {
  name: string;
  category?: string;
  ph: string;
  ts: number;
  dur?: number;
  tid?: number;
  args?: Record<string, any>;
}

export interface PhaseTiming {
  name: string;
  category: string;
  count: number;
  perFrameUs: number;
  /** Per-frame cost with nested child phases subtracted. Engine phases nest
   *  heavily (Paint contains ExecutePaint contains Backend and so on), so total
   *  cost points at the same work five times over. Self time is what identifies
   *  the one place the work actually happens. */
  selfPerFrameUs: number;
  meanUs: number;
  maxUs: number;
}

export interface Capture {
  phases: PhaseTiming[];
  frameCount: number;
  capturedMs: number;
  framePeriodUs: number;
  framesPerSecond: number;
  /** Summed per-frame cost of every timed phase. Nesting means this over-counts
   *  as a share of the frame, but it is consistent run to run, which is what a
   *  before/after comparison needs. */
  totalPerFrameUs: number;
  counters?: Record<string, { first: number; last: number; delta: number }>;
  recordCount: number;
  unpairedEvents: number;
}

export interface Spread {
  mean: number;
  min: number;
  max: number;
  /** Half-range as a percentage of the mean: the smallest change that could be
   *  called real rather than run-to-run variance. */
  spreadPct: number;
}

export interface CaptureSeries {
  captures: Capture[];
  discardedWarmup: number;
  total: Spread;
  framePeriodUs: number;
  framesPerSecond: number;
  /** Per-phase spread across the sampled captures, keyed by phase name. The
   *  spread is over SELF time, since that is what a change to one phase moves. */
  phases: Map<string, Spread & { category: string; count: number; maxUs: number; totalPerFrameUs: number }>;
}

function spreadOf(values: number[]): Spread {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    mean,
    min,
    max,
    spreadPct: mean > 0 ? ((max - min) / 2 / mean) * 100 : 0,
  };
}

/**
 * Resolves user-facing system names to the category strings the engine wants.
 * Asked of the engine rather than hard-coded, since getTraceSystemsAndLevels is
 * a Gameface addition and the names are what the caller sees.
 */
export async function resolveCategories(
  systems: string[] | undefined,
  level: number
): Promise<{ categories: string; availableSystems: string[] } | { error: string; availableSystems: string[] }> {
  const manager = getConnectionManager();
  const meta = await manager.sendRaw("Tracing.getTraceSystemsAndLevels");
  const systemDefs: Array<{ name: string; categoryString: string }> = meta?.systems || [];
  const levelDefs: Array<{ name: string; categoryString: string }> = meta?.levels || [];
  const availableSystems = systemDefs.map((s) => s.name);

  const wanted = systems && systems.length > 0 ? systems : ["All"];
  const strings: string[] = [];

  for (const want of wanted) {
    const match = systemDefs.find((s) => s.name.toLowerCase() === want.toLowerCase());
    if (!match) {
      return { error: `Unknown trace system "${want}". Available: ${availableSystems.join(", ")}.`, availableSystems };
    }
    strings.push(match.categoryString);
  }

  const levelMatch = levelDefs.find((l) => l.categoryString.endsWith(`L${level}`)) || levelDefs[level - 1];
  if (levelMatch) strings.push(levelMatch.categoryString);

  return { categories: strings.join(","), availableSystems };
}

interface PhaseTotals {
  count: number;
  total: number;
  /** Time spent inside nested child phases, subtracted to get self time. */
  childTotal: number;
  max: number;
  category: string;
}

interface OpenFrame {
  name: string;
  ts: number;
  childTotal: number;
}

/**
 * Pairs begin/end records into per-phase totals and self time.
 *
 * One stack per thread, not per phase name: nesting is what distinguishes
 * Coherent_Paint's 350us of total cost from the handful of microseconds it
 * actually spends outside its children. Keying the stack by name as well would
 * lose that and make one hotspot look like five.
 */
function aggregate(records: TraceRecord[]): { phases: Map<string, PhaseTotals>; unpaired: number } {
  const phases = new Map<string, PhaseTotals>();
  const stacks = new Map<number, OpenFrame[]>();
  let unpaired = 0;

  const add = (name: string, dur: number, childTotal: number, category: string) => {
    const entry = phases.get(name) || { count: 0, total: 0, childTotal: 0, max: 0, category };
    entry.count++;
    entry.total += dur;
    entry.childTotal += childTotal;
    entry.max = Math.max(entry.max, dur);
    if (!entry.category && category) entry.category = category;
    phases.set(name, entry);
  };

  const stackFor = (tid: number) => {
    const existing = stacks.get(tid);
    if (existing) return existing;
    const created: OpenFrame[] = [];
    stacks.set(tid, created);
    return created;
  };

  for (const r of records) {
    const category = r.category || "";
    const tid = r.tid ?? -1;
    const stack = stackFor(tid);

    if (r.ph === "X" && typeof r.dur === "number") {
      add(r.name, r.dur, 0, category);
      if (stack.length > 0) stack[stack.length - 1].childTotal += r.dur;
      continue;
    }

    if (r.ph === "B") {
      stack.push({ name: r.name, ts: r.ts, childTotal: 0 });
    } else if (r.ph === "E") {
      // Find the innermost open frame with this name. Normally that is the top
      // of the stack; anything else means the capture began mid-phase.
      let index = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === r.name) {
          index = i;
          break;
        }
      }
      if (index === -1) {
        unpaired++;
        continue;
      }
      unpaired += stack.length - 1 - index;
      const frame = stack[index];
      stack.length = index;

      const dur = r.ts - frame.ts;
      add(r.name, dur, frame.childTotal, category);
      if (stack.length > 0) stack[stack.length - 1].childTotal += dur;
    }
  }

  for (const stack of stacks.values()) unpaired += stack.length;
  return { phases, unpaired };
}

function counters(records: TraceRecord[]) {
  const samples = records
    .filter((r) => r.name === "UpdateCounters" && r.args && r.args.data)
    .map((r) => r.args!.data as Record<string, number>);
  if (samples.length < 2) return undefined;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const out: Record<string, { first: number; last: number; delta: number }> = {};
  for (const key of Object.keys(first)) {
    if (typeof first[key] === "number" && typeof last[key] === "number") {
      out[key] = { first: first[key], last: last[key], delta: last[key] - first[key] };
    }
  }
  return out;
}

/** Runs one trace and aggregates it. */
export async function captureOnce(categories: string, durationMs: number): Promise<Capture> {
  const manager = getConnectionManager();
  const client = manager.getClient();
  if (!client) throw new Error("Not connected to a browser.");

  const records: TraceRecord[] = [];
  const onData = (params: any) => {
    if (Array.isArray(params?.value)) records.push(...params.value);
  };

  (client as any).on("Tracing.dataCollected", onData);
  try {
    await manager.sendRaw("Tracing.start", { categories, transferMode: "ReportEvents" });
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await withTimeout(manager.sendRaw("Tracing.end"), 5000, "Tracing.end did not return within 5s");
    await new Promise((resolve) => setTimeout(resolve, FLUSH_MS));
  } finally {
    (client as any).removeListener?.("Tracing.dataCollected", onData);
  }

  if (records.length === 0) {
    throw new Error("The trace produced no records. The view may be idle or not rendering.");
  }

  const timestamps = records.map((r) => r.ts).filter((t) => typeof t === "number" && t > 0);
  const capturedMs = timestamps.length ? (Math.max(...timestamps) - Math.min(...timestamps)) / 1000 : durationMs;
  const frameCount = records.filter((r) => r.name === "Coherent_Advance" && r.ph === "B").length;
  const framesPerSecond = capturedMs > 0 ? (frameCount / capturedMs) * 1000 : 0;
  const framePeriodUs = framesPerSecond > 0 ? 1_000_000 / framesPerSecond : 0;

  const { phases: aggregated, unpaired } = aggregate(records);

  const phases: PhaseTiming[] = [...aggregated.entries()]
    .map(([name, e]) => ({
      name,
      category: e.category,
      count: e.count,
      perFrameUs: frameCount > 0 ? e.total / frameCount : 0,
      selfPerFrameUs: frameCount > 0 ? Math.max(e.total - e.childTotal, 0) / frameCount : 0,
      meanUs: e.total / e.count,
      maxUs: e.max,
    }))
    .sort((a, b) => b.perFrameUs - a.perFrameUs);

  return {
    phases,
    frameCount,
    capturedMs,
    framePeriodUs,
    framesPerSecond,
    // Summed over SELF time, so nested phases are counted once rather than
    // once per level. This is the figure the budget is compared against.
    totalPerFrameUs: phases.reduce((sum, p) => sum + p.selfPerFrameUs, 0),
    counters: counters(records),
    recordCount: records.length,
    unpairedEvents: unpaired,
  };
}

/**
 * Runs several captures back to back and reports the spread across them.
 *
 * This is the noise floor, measured live rather than read from a committed
 * baseline. The environment moves between sessions - frame pacing depends on
 * window focus and on the debugging connection - so a number recorded on
 * another machine cannot say whether today's change was real. Repeats of the
 * scene under test can.
 */
export async function captureSeries(options: {
  categories: string;
  durationMs?: number;
  warmupRuns?: number;
  sampleRuns?: number;
}): Promise<CaptureSeries> {
  const durationMs = options.durationMs ?? DEFAULT_CAPTURE_MS;
  const warmupRuns = options.warmupRuns ?? DEFAULT_WARMUP_RUNS;
  const sampleRuns = Math.max(options.sampleRuns ?? DEFAULT_SAMPLE_RUNS, 2);

  const captures: Capture[] = [];
  for (let i = 0; i < warmupRuns + sampleRuns; i++) {
    log.info(`Capture ${i + 1}/${warmupRuns + sampleRuns}${i < warmupRuns ? " (warmup, discarded)" : ""}`);
    captures.push(await captureOnce(options.categories, durationMs));
  }

  const sampled = captures.slice(warmupRuns);

  const phases = new Map<string, Spread & { category: string; count: number; maxUs: number; totalPerFrameUs: number }>();
  const names = [...new Set(sampled.flatMap((c) => c.phases.map((p) => p.name)))];
  for (const name of names) {
    const entries = sampled.map((c) => c.phases.find((p) => p.name === name)).filter(Boolean) as PhaseTiming[];
    // Only phases present in every sampled capture get a spread - one that came
    // and went cannot be compared against anything.
    if (entries.length !== sampled.length) continue;
    phases.set(name, {
      ...spreadOf(entries.map((e) => e.selfPerFrameUs)),
      category: entries[0].category,
      count: Math.round(entries.reduce((s, e) => s + e.count, 0) / entries.length),
      maxUs: Math.max(...entries.map((e) => e.maxUs)),
      totalPerFrameUs: entries.reduce((s, e) => s + e.perFrameUs, 0) / entries.length,
    });
  }

  return {
    captures,
    discardedWarmup: warmupRuns,
    total: spreadOf(sampled.map((c) => c.totalPerFrameUs)),
    framePeriodUs: sampled.reduce((s, c) => s + c.framePeriodUs, 0) / sampled.length,
    framesPerSecond: sampled.reduce((s, c) => s + c.framesPerSecond, 0) / sampled.length,
    phases,
  };
}
