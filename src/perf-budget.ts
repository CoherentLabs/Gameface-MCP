/**
 * Performance budget: the UI's allowed engine cost per frame.
 *
 * The point of this file is to keep one specific decision out of the model's
 * hands. Trace numbers on their own never say "stop" - there is always a most
 * expensive phase and always a few percent to be shaved - so an agent asked to
 * make a UI fast can optimise indefinitely against a target it invented. The
 * target has to come from a human.
 *
 * Two things follow from that, and both are deliberate:
 *
 *  - The budget lives in a file the user owns and can review, edit or delete,
 *    not in a tool parameter the model can fill in. It persists across sessions
 *    so the question is asked once per project rather than once per chat.
 *  - Where a client supports MCP elicitation, the question is put to the user
 *    through the protocol, which an agent cannot answer on its behalf. Client
 *    support varies, so this degrades to "report and stop" rather than
 *    depending on it.
 *
 * The budget is a single number: how many milliseconds of a frame the UI is
 * allowed to spend. That is the figure a team actually negotiates ("the HUD
 * gets 2ms of our 16.7ms frame"), and it stays meaningful when the target frame
 * rate changes. Per-phase budgets are deliberately not supported - nobody can
 * meaningfully decide that styling deserves 200 microseconds.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { createLogger } from "./logger.js";

const log = createLogger("PerfBudget");

export const DEFAULT_BUDGET_FILENAME = "gameface-perf-budget.json";

export interface PerfBudget {
  /** Milliseconds of engine time per frame the UI is allowed to spend. */
  uiFrameBudgetMs: number;
  /** Optional context: the frame rate the budget was reasoned about at. */
  targetFps?: number;
  /** Free-text note from whoever set it. */
  note?: string;
  updatedAt?: string;
}

let budgetPathOverride: string | undefined;

/** Set from the --perf-budget CLI flag / config file at startup. */
export function setBudgetPath(path: string | undefined): void {
  budgetPathOverride = path;
}

/**
 * Absolute path of the budget file. Defaults to the working directory the
 * server was launched in, which for a game project is that project's root, so
 * the budget travels with the UI it describes rather than the machine.
 */
export function getBudgetPath(): string {
  if (budgetPathOverride) {
    return isAbsolute(budgetPathOverride) ? budgetPathOverride : resolve(process.cwd(), budgetPathOverride);
  }
  return resolve(process.cwd(), DEFAULT_BUDGET_FILENAME);
}

export interface BudgetLoadResult {
  budget: PerfBudget | null;
  path: string;
  /** Set when a file exists but could not be used, so the caller can say why. */
  problem?: string;
}

export function loadBudget(): BudgetLoadResult {
  const path = getBudgetPath();

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      return { budget: null, path };
    }
    return { budget: null, path, problem: `Could not read ${path}: ${error.message}` };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    return { budget: null, path, problem: `${path} is not valid JSON: ${error.message}` };
  }

  const value = parsed?.uiFrameBudgetMs;
  if (typeof value !== "number" || !isFinite(value) || value <= 0) {
    return {
      budget: null,
      path,
      problem: `${path} does not contain a usable "uiFrameBudgetMs" (expected a positive number of milliseconds, found ${JSON.stringify(value)}).`,
    };
  }

  return {
    budget: {
      uiFrameBudgetMs: value,
      targetFps: typeof parsed.targetFps === "number" ? parsed.targetFps : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    },
    path,
  };
}

/**
 * Writes the budget file. Only ever called with a number that came back from an
 * elicitation prompt the user answered - never with a value the model chose.
 */
export function saveBudget(budget: PerfBudget): string {
  const path = getBudgetPath();
  mkdirSync(dirname(path), { recursive: true });

  const body = {
    _comment:
      "Engine time per frame the UI is allowed to spend, in milliseconds. The Gameface MCP server's perf_trace tool " +
      "will not report anything to optimise while the measured cost is inside this budget. Edit uiFrameBudgetMs to " +
      "change the target, or delete this file to stop performance work being suggested at all.",
    uiFrameBudgetMs: budget.uiFrameBudgetMs,
    targetFps: budget.targetFps,
    note: budget.note,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(path, JSON.stringify(body, null, 2) + "\n", "utf8");
  log.info(`Wrote performance budget to ${path}`);
  return path;
}

/**
 * The message handed back when no budget is set. It is addressed to the user,
 * not the agent, and tools carrying it must relay it rather than act on the
 * measurement it accompanies.
 */
export function budgetRequestMessage(measuredMs: number | null, spreadPct: number, path: string): string {
  const opening =
    measuredMs === null
      ? `No performance budget is set for this UI.\n\n`
      : `This UI currently costs ${measuredMs.toFixed(2)}ms of engine time per frame, repeatable to within ` +
        `${spreadPct.toFixed(0)}%. Whether that is acceptable is your call, not something I can work out: it ` +
        `depends on what else your frame has to do.\n\n`;

  return (
    opening +
    `I am not going to suggest changes without a budget. If you want performance work done, ` +
    `decide how many milliseconds per frame this UI is allowed and save it to:\n\n` +
    `  ${path}\n\n` +
    `  { "uiFrameBudgetMs": 2.0 }\n\n` +
    `Once that file exists, perf_trace will show where the time goes and flag only what is genuinely over budget. ` +
    `If you would rather leave this alone, do nothing - no further performance work will happen.`
  );
}
