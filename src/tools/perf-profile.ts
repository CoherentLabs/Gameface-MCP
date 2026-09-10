/**
 * Perf Profile Tool
 *
 * Measures what the UI costs, and deliberately stops there.
 *
 * This exists because trace output has no natural stopping point. There is
 * always a most expensive phase and always a few percent to shave, so an agent
 * handed a ranked breakdown and told to make things fast will keep going
 * against a target it invented. The fix is not to ask the agent to restrain
 * itself, which is a norm rather than a barrier - it is to withhold the data
 * until a human has said what "fast enough" means.
 *
 * So this tool returns a total and a repeatability figure, and no per-phase
 * breakdown, no ranking and no verdict. There is nothing in its output to
 * optimise toward. perf_trace returns the breakdown, and only once a budget
 * exists.
 *
 * If the client supports MCP elicitation the budget question goes straight to
 * the user, which the agent cannot answer for them. Otherwise the tool reports
 * the numbers and the exact file to write, and stops.
 */

import { getConnectionManager } from "./connect-browser.js";
import { captureSeries, resolveCategories, DEFAULT_CAPTURE_MS } from "./trace-capture.js";
import { budgetRequestMessage, loadBudget, saveBudget } from "../perf-budget.js";
import { canElicit, elicitBudget } from "../elicitation.js";
import { PerfProfileParams, PerfProfileResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("PerfProfile");

export async function perfProfile(params: PerfProfileParams): Promise<PerfProfileResult> {
  const manager = getConnectionManager();

  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const durationMs = params.durationMs ?? DEFAULT_CAPTURE_MS;
  const sampleRuns = params.sampleRuns ?? 3;

  const resolved = await resolveCategories(["All"], 1);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }

  log.info(`Profiling (${sampleRuns} sampled captures of ${durationMs}ms)`);
  const series = await captureSeries({ categories: resolved.categories, durationMs, sampleRuns });

  const measuredMs = series.total.mean / 1000;
  const spreadPct = series.total.spreadPct;
  const framePeriodMs = series.framePeriodUs / 1000;

  const existing = loadBudget();

  // A budget already on disk: report against it and say plainly whether there
  // is anything to do. No breakdown here either - that is perf_trace's job.
  if (existing.budget) {
    const overBy = measuredMs - existing.budget.uiFrameBudgetMs;
    const within = overBy <= 0;
    return {
      success: true,
      uiCostPerFrameMs: Math.round(measuredMs * 1000) / 1000,
      repeatabilityPct: Math.round(spreadPct * 10) / 10,
      framePeriodMs: Math.round(framePeriodMs * 100) / 100,
      framesPerSecond: Math.round(series.framesPerSecond * 10) / 10,
      capturesTaken: series.captures.length,
      warmupDiscarded: series.discardedWarmup,
      budgetSet: true,
      budgetMs: existing.budget.uiFrameBudgetMs,
      budgetPath: existing.path,
      withinBudget: within,
      message: within
        ? `The UI costs ${measuredMs.toFixed(2)}ms per frame against a budget of ${existing.budget.uiFrameBudgetMs}ms. It is within budget, so there is nothing to optimise. Do not make performance changes.`
        : `The UI costs ${measuredMs.toFixed(2)}ms per frame against a budget of ${existing.budget.uiFrameBudgetMs}ms, over by ${overBy.toFixed(2)}ms. Run perf_trace to see where the time goes.`,
    };
  }

  // No budget. Try to ask the user directly; a client that cannot ask is
  // treated exactly like a user who declined.
  const base = {
    success: true as const,
    uiCostPerFrameMs: Math.round(measuredMs * 1000) / 1000,
    repeatabilityPct: Math.round(spreadPct * 10) / 10,
    framePeriodMs: Math.round(framePeriodMs * 100) / 100,
    framesPerSecond: Math.round(series.framesPerSecond * 10) / 10,
    capturesTaken: series.captures.length,
    warmupDiscarded: series.discardedWarmup,
    budgetPath: existing.path,
  };

  if (canElicit()) {
    const outcome = await elicitBudget(measuredMs, spreadPct);

    if (outcome.status === "accepted") {
      const path = saveBudget({ ...outcome.budget, targetFps: params.targetFps });
      return {
        ...base,
        budgetSet: true,
        budgetMs: outcome.budget.uiFrameBudgetMs,
        budgetPath: path,
        withinBudget: measuredMs <= outcome.budget.uiFrameBudgetMs,
        message:
          measuredMs <= outcome.budget.uiFrameBudgetMs
            ? `The user set a budget of ${outcome.budget.uiFrameBudgetMs}ms per frame, saved to ${path}. The UI is already within it at ${measuredMs.toFixed(2)}ms, so there is nothing to optimise.`
            : `The user set a budget of ${outcome.budget.uiFrameBudgetMs}ms per frame, saved to ${path}. The UI is over it at ${measuredMs.toFixed(2)}ms. Run perf_trace to see where the time goes.`,
      };
    }

    if (outcome.status === "declined") {
      return {
        ...base,
        budgetSet: false,
        budgetDeclined: true,
        withinBudget: null,
        message: `The user was asked for a performance budget and declined. Do nothing further about performance. Report the measurement if asked, make no changes, and do not raise the subject again unless the user brings it up.`,
      };
    }

    log.warn(`Could not ask the user: ${outcome.reason}`);
  }

  // No way to ask, or asking failed. Report and stop.
  return {
    ...base,
    budgetSet: false,
    budgetDeclined: false,
    withinBudget: null,
    userMessage: budgetRequestMessage(measuredMs, spreadPct, existing.path),
    message:
      `No performance budget is set${existing.problem ? ` (${existing.problem})` : ""}. ` +
      `Show the user the userMessage field verbatim and stop. Do not choose a budget yourself, do not write the budget file on the user's behalf, and do not make performance changes. ` +
      `A per-phase breakdown is deliberately not included here, and perf_trace will refuse until the user has set a budget themselves.`,
  };
}
