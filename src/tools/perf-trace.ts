/**
 * Perf Trace Tool
 *
 * Reports where the UI's engine time goes, per phase - but only once a human
 * has said how much time the UI is allowed.
 *
 * Two gates stand between a measurement and a suggested change, and both exist
 * because an agent optimising without them has no stopping condition:
 *
 *  1. A budget, set by the user and stored in a file they own (see
 *     src/perf-budget.ts). Without it this tool returns no breakdown at all.
 *     Withholding the data is the enforcement; asking the agent not to act on
 *     it would only be a norm.
 *  2. The noise floor, measured live in the same session. Repeated captures of
 *     an unchanged page vary by up to 20% on paint-side phases, so a phase is
 *     only worth reporting if its cost stands outside that spread. Otherwise an
 *     agent chases variance and calls it progress.
 *
 * A phase is reported as actionable only when the UI is over budget AND that
 * phase is large enough to matter against its own measured repeatability.
 *
 * On units: per-frame microseconds is the number that transfers between
 * environments, because the phases do the same work regardless of how long the
 * Player waits between frames. Engine cost as a share of the observed frame
 * period is not comparable - measured on the same page it ranged from 3% to
 * 12% purely on how the Player was being driven - so it is not reported as a
 * headline. Budget comparison is against the user's stated milliseconds.
 */

import { getConnectionManager } from "./connect-browser.js";
import { captureSeries, resolveCategories, DEFAULT_CAPTURE_MS } from "./trace-capture.js";
import { budgetRequestMessage, loadBudget } from "../perf-budget.js";
import { PerfTraceParams, PerfTracePhase, PerfTraceResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("PerfTrace");

const MAX_DURATION_MS = 30000;

/**
 * A phase has to be worth at least this share of the overspend before it is
 * called actionable. Below it, removing the phase entirely would not bring the
 * UI inside budget, so pointing at it invites work that cannot pay off.
 */
const MATERIAL_SHARE_OF_OVERSPEND = 0.1;

export async function perfTrace(params: PerfTraceParams): Promise<PerfTraceResult> {
  const manager = getConnectionManager();

  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  // Gate one: no budget, no breakdown. Checked before measuring so a refusal
  // costs nothing.
  const { budget, path, problem } = loadBudget();
  if (!budget) {
    return {
      success: false,
      budgetSet: false,
      budgetPath: path,
      phases: [],
      capturesTaken: 0,
      message:
        `No performance budget is set${problem ? ` (${problem})` : ""}, so no breakdown will be produced. ` +
        `Run perf_profile, show the user what the UI costs, and let them decide the budget. ` +
        `Do not write ${path} yourself and do not make performance changes in the meantime.`,
      userMessage: budgetRequestMessage(null, 0, path),
    };
  }

  const durationMs = Math.min(Math.max(params.durationMs ?? DEFAULT_CAPTURE_MS, 100), MAX_DURATION_MS);
  const level = Math.min(Math.max(params.level ?? 1, 1), 3);

  const resolved = await resolveCategories(params.systems, level);
  if ("error" in resolved) {
    return {
      success: false,
      budgetSet: true,
      budgetMs: budget.uiFrameBudgetMs,
      budgetPath: path,
      phases: [],
      capturesTaken: 0,
      availableSystems: resolved.availableSystems,
      message: resolved.error,
    };
  }

  log.info(`Tracing against a ${budget.uiFrameBudgetMs}ms budget`);
  const series = await captureSeries({
    categories: resolved.categories,
    durationMs,
    sampleRuns: params.sampleRuns ?? 3,
  });

  const measuredMs = series.total.mean / 1000;
  const budgetMs = budget.uiFrameBudgetMs;
  const overBy = measuredMs - budgetMs;
  const withinBudget = overBy <= 0;

  // Gate two: inside budget means there is nothing to report. The breakdown is
  // withheld here too, for the same reason it is withheld with no budget - a
  // ranked list of phases is an invitation to optimise something that is
  // already fast enough.
  if (withinBudget) {
    return {
      success: true,
      budgetSet: true,
      budgetMs,
      budgetPath: path,
      uiCostPerFrameMs: Math.round(measuredMs * 1000) / 1000,
      repeatabilityPct: Math.round(series.total.spreadPct * 10) / 10,
      withinBudget: true,
      phases: [],
      capturesTaken: series.captures.length,
      framesPerSecond: Math.round(series.framesPerSecond * 10) / 10,
      message: `The UI costs ${measuredMs.toFixed(2)}ms per frame, inside its ${budgetMs}ms budget. There is nothing to optimise and no breakdown is provided. Do not make performance changes. If the user wants a tighter target they can lower uiFrameBudgetMs in ${path}.`,
    };
  }

  const overspendUs = overBy * 1000;

  const phases: PerfTracePhase[] = [...series.phases.entries()]
    .map(([name, s]) => {
      // Judged on self time throughout. Engine phases nest several levels deep,
      // so ranking on total cost points at the same work repeatedly: Paint,
      // ExecutePaint, Backend and BackendExecute are one hotspot wearing four
      // names, and only the innermost has meaningful self time.
      const noiseUs = (s.spreadPct / 100) * s.mean;
      const material = s.mean >= overspendUs * MATERIAL_SHARE_OF_OVERSPEND;
      const measurable = s.mean > noiseUs * 2;
      return {
        name,
        category: s.category,
        selfPerFrameUs: Math.round(s.mean * 10) / 10,
        totalPerFrameUs: Math.round(s.totalPerFrameUs * 10) / 10,
        repeatabilityPct: Math.round(s.spreadPct * 10) / 10,
        minUs: Math.round(s.min * 10) / 10,
        maxUs: Math.round(s.max * 10) / 10,
        shareOfOverspendPct: Math.round((s.mean / overspendUs) * 1000) / 10,
        actionable: material && measurable,
      };
    })
    .sort((a, b) => b.selfPerFrameUs - a.selfPerFrameUs);

  const actionable = phases.filter((p) => p.actionable);

  return {
    success: true,
    budgetSet: true,
    budgetMs,
    budgetPath: path,
    uiCostPerFrameMs: Math.round(measuredMs * 1000) / 1000,
    repeatabilityPct: Math.round(series.total.spreadPct * 10) / 10,
    withinBudget: false,
    overBudgetByMs: Math.round(overBy * 1000) / 1000,
    phases,
    actionablePhases: actionable.map((p) => p.name),
    capturesTaken: series.captures.length,
    framesPerSecond: Math.round(series.framesPerSecond * 10) / 10,
    counters: series.captures[series.captures.length - 1]?.counters,
    availableSystems: resolved.availableSystems,
    message:
      `The UI costs ${measuredMs.toFixed(2)}ms per frame against a ${budgetMs}ms budget, over by ${overBy.toFixed(2)}ms. ` +
      (actionable.length
        ? `${actionable.length} phase(s) are large enough to be worth addressing: ${actionable.map((p) => p.name).join(", ")}. ` +
          `Phases marked actionable:false are either too small to close the gap or within their own measurement noise - changing them cannot be shown to help. ` +
          `Re-run this tool after a change; a difference smaller than repeatabilityPct is not a real improvement.`
        : `No single phase is both large enough to close the gap and above its own measurement noise, so the overspend is spread thin. Look at reducing overall work (element count, layer count via perf_lint) rather than tuning one phase.`),
  };
}
