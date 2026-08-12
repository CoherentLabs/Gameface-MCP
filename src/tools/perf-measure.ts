/**
 * Perf Measure Tool
 *
 * Injects the fixed scenario in tools/perf/calibrate.js into whatever page is
 * already loaded on the live connection, waits for it to finish, and reports
 * p50/p95/p99 - the same methodology, frame count, and warmup discard used to
 * record tools/perf/noise-floor.md, so the two are directly comparable.
 *
 * This does NOT boot a fresh Player (that's scripts/measure-frame-noise-floor.mjs,
 * used only for calibration) - it measures whatever is currently connected and
 * rendered, which is the point: checking a live view's frame cost against the
 * recorded floor. "Same resolution" is therefore the caller's responsibility
 * (boot/keep the Player at the resolution noise-floor.md was recorded at,
 * i.e. 1920x1080); this tool can't resize the Player window at runtime (that's
 * a boot-time argument, not something CDP can change), so it instead reports
 * the live resolution and flags whether it matches the recorded baseline.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getConnectionManager } from "./connect-browser.js";
import { PerfMeasureParams, PerfMeasureResult } from "../types.js";
import { withTimeout } from "../utils/with-timeout.js";
import { createLogger } from "../logger.js";

const log = createLogger("PerfMeasure");

const TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 150;

const CALIBRATE_SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../tools/perf/calibrate.js");
const NOISE_FLOOR_MD_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../tools/perf/noise-floor.md");

const BASELINE_RESOLUTION = { width: 1920, height: 1080 };

interface NoiseFloorBaseline {
  resolution: { width: number; height: number };
  frames: number;
  warmup: number;
  spread: {
    p50: { min: number; max: number };
    p95: { min: number; max: number };
    p99: { min: number; max: number };
  };
}

function loadBaseline(): NoiseFloorBaseline | null {
  let markdown: string;
  try {
    markdown = readFileSync(NOISE_FLOOR_MD_PATH, "utf8");
  } catch {
    return null;
  }
  const match = markdown.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

async function runMeasurement(frames: number, warmup: number): Promise<PerfMeasureResult> {
  const manager = getConnectionManager();
  const calibrateScript = readFileSync(CALIBRATE_SCRIPT_PATH, "utf8");

  // Set the frame count before injecting the scenario, so calibrate.js's own
  // `window.__calibrateFrameCount || 600` default picks it up.
  await manager.sendCommand("Runtime", "evaluate", {
    expression: `window.__calibrateFrameCount = ${frames};`,
  });

  const inject = await manager.sendCommand("Runtime", "evaluate", { expression: calibrateScript });
  if (inject.exceptionDetails) {
    const text = inject.exceptionDetails.exception?.description || inject.exceptionDetails.text || "Unknown exception";
    throw new Error(`Failed to inject calibration scenario: ${text}`);
  }

  // Poll for completion. The outer withTimeout() is what actually bounds this
  // loop - it's intentionally open-ended here.
  for (;;) {
    const doneCheck = await manager.sendCommand("Runtime", "evaluate", {
      expression: "window.__calibrateDone === true",
      returnByValue: true,
    });
    if (doneCheck.result?.value === true) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const dataResult = await manager.sendCommand("Runtime", "evaluate", {
    expression: "({ frameTimes: window.__calibrateFrameTimes, resolution: window.__calibrateResolution })",
    returnByValue: true,
  });

  const { frameTimes, resolution } = dataResult.result.value as {
    frameTimes: number[];
    resolution: { width: number; height: number };
  };

  const measured = frameTimes.slice(warmup);
  const sorted = [...measured].sort((a, b) => a - b);

  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  const baseline = loadBaseline();
  const resolutionMatchesBaseline =
    resolution.width === (baseline?.resolution.width ?? BASELINE_RESOLUTION.width) &&
    resolution.height === (baseline?.resolution.height ?? BASELINE_RESOLUTION.height);

  const result: PerfMeasureResult = {
    success: true,
    p50,
    p95,
    p99,
    sampleCount: measured.length,
    resolution,
    resolutionMatchesBaseline,
  };

  if (baseline) {
    result.noiseFloor = baseline.spread;
    result.withinNoiseFloor = {
      p50: p50 <= baseline.spread.p50.max,
      p95: p95 <= baseline.spread.p95.max,
      p99: p99 <= baseline.spread.p99.max,
    };
  } else {
    log.warn(`No baseline found at ${NOISE_FLOOR_MD_PATH} - returning raw numbers without a comparison`);
  }

  return result;
}

export async function perfMeasure(params: PerfMeasureParams): Promise<PerfMeasureResult> {
  const manager = getConnectionManager();

  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const frames = params.frames ?? 600;
  const warmup = params.warmup ?? 120;

  log.info(`Running perf measure (frames: ${frames}, warmup: ${warmup})`);

  try {
    const result = await withTimeout(
      runMeasurement(frames, warmup),
      TIMEOUT_MS,
      `perf_measure timed out after ${TIMEOUT_MS}ms - the page may be too slow to complete ${frames} frames, or its JS thread is blocked`
    );
    log.info(`p50=${result.p50?.toFixed(3)}ms p95=${result.p95?.toFixed(3)}ms p99=${result.p99?.toFixed(3)}ms`);
    return result;
  } catch (error: any) {
    const timedOut = error.message.includes("timed out");
    log.error(`perf_measure failed: ${error.message}`);
    return { success: false, timedOut, error: error.message };
  }
}
