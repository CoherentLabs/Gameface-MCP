/**
 * Perf Measure Tool
 *
 * Injects the fixed scenario in tools/perf/calibrate.js into whatever page is
 * already loaded on the live connection, waits for it to finish, and reports
 * p50/p95/p99 - the same methodology, frame count, and warmup discard used to
 * record this machine's noise floor (see src/perf-calibration.ts), so the two
 * are directly comparable.
 *
 * This does NOT boot a fresh Player (perf_calibrate does that, to record the
 * floor) - it measures whatever is currently connected and rendered, which is
 * the point: checking a live view's frame cost against the recorded floor.
 * It can't resize the Player window at runtime (a boot-time argument, not
 * something CDP can change), so it reports the live resolution and flags
 * whether it matches the floor's.
 *
 * With no floor saved on this machine it measures nothing and tells the agent
 * to run perf_calibrate first - a floor from another machine (or display) would
 * make every verdict meaningless.
 */

import { readFileSync } from "node:fs";
import { getConnectionManager } from "./connect-browser.js";
import { PerfMeasureParams, PerfMeasureResult } from "../types.js";
import { withTimeout } from "../utils/with-timeout.js";
import { CALIBRATE_SCRIPT_PATH, FRAME_PERIOD_PERCENTILE, loadNoiseFloor, NoiseFloor, percentile } from "../perf-calibration.js";
import { createLogger } from "../logger.js";

const log = createLogger("PerfMeasure");

const POLL_INTERVAL_MS = 150;

// Fixed overhead plus a per-frame allowance. A flat limit can't work: the
// scenario takes frames x the display's frame period, so 600 frames on a 32 Hz
// remote-desktop display (~31 ms/frame) need ~19 s on their own.
const TIMEOUT_BASE_MS = 5000;
const TIMEOUT_PER_FRAME_MS = 50;

// Readings are only comparable to the floor when the display's frame period
// matches the one it was recorded with.
const FRAME_PERIOD_TOLERANCE = 0.1;

async function runMeasurement(frames: number, warmup: number, floor: NoiseFloor): Promise<PerfMeasureResult> {
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
  const framePeriodMs = percentile(sorted, FRAME_PERIOD_PERCENTILE);

  const resolutionMatchesBaseline = resolution.width === floor.resolution.width && resolution.height === floor.resolution.height;

  const cohtmlVersion = manager.getCohtmlVersion() ?? undefined;
  // Frame timing characteristics can differ across Cohtml versions same as
  // resolution can, so a mismatch here is reported the same way - informational,
  // not a failure, since the caller may be intentionally testing an older/newer
  // build than the one the floor was recorded with.
  const cohtmlVersionMatchesBaseline =
    floor.cohtmlVersion !== undefined && cohtmlVersion !== undefined ? cohtmlVersion === floor.cohtmlVersion : undefined;

  const ratio = framePeriodMs / floor.framePeriodMs;
  const warnings: string[] = [];
  const result: PerfMeasureResult = {
    success: true,
    p50,
    p95,
    p99,
    sampleCount: measured.length,
    resolution,
    resolutionMatchesBaseline,
    cohtmlVersion,
    cohtmlVersionMatchesBaseline,
    framePeriodMs,
    baselineFramePeriodMs: floor.framePeriodMs,
    framePeriodMatchesBaseline: Math.abs(ratio - 1) <= FRAME_PERIOD_TOLERANCE,
    noiseFloor: floor.spread,
  };

  const live = `${framePeriodMs.toFixed(2)} ms (~${Math.round(1000 / framePeriodMs)} Hz)`;
  const recorded = `${floor.framePeriodMs.toFixed(2)} ms (~${Math.round(1000 / floor.framePeriodMs)} Hz)`;
  if (ratio < 1 - FRAME_PERIOD_TOLERANCE) {
    // Staying under the floor's max proves nothing on a faster display - a UI
    // could get several times slower and still pass - so give no verdict.
    warnings.push(
      `The frame period here is ${live}, shorter than the noise floor's ${recorded}: this display refreshes faster than when the floor was recorded. ` +
        `Readings aren't comparable, so withinNoiseFloor is omitted. Run perf_calibrate to re-record the floor, then measure again.`
    );
  } else {
    result.withinNoiseFloor = {
      p50: p50 <= floor.spread.p50.max,
      p95: p95 <= floor.spread.p95.max,
      p99: p99 <= floor.spread.p99.max,
    };
    if (ratio > 1 + FRAME_PERIOD_TOLERANCE) {
      warnings.push(
        `The frame period here is ${live}, longer than the noise floor's ${recorded}. Either this display now refreshes slower than when the floor was recorded, ` +
          `or the UI can't render even its fastest frames within the floor's frame period. If the display changed, run perf_calibrate to re-record the floor.`
      );
    }
  }
  if (!resolutionMatchesBaseline) {
    warnings.push(
      `The viewport is ${resolution.width}x${resolution.height} but the noise floor was recorded at ${floor.resolution.width}x${floor.resolution.height}. ` +
        `Run perf_calibrate (it records at the live viewport size) for a comparable floor.`
    );
  }
  if (cohtmlVersionMatchesBaseline === false) {
    warnings.push(`This Player is Cohtml ${cohtmlVersion}; the noise floor was recorded with ${floor.cohtmlVersion}. Run perf_calibrate to record one for this version.`);
  }
  if (warnings.length > 0) {
    result.warning = warnings.join(" ");
  }

  return result;
}

export async function perfMeasure(params: PerfMeasureParams): Promise<PerfMeasureResult> {
  const manager = getConnectionManager();

  if (!manager.isConnected()) {
    throw new Error("Not connected to a browser. Please connect first using the connect_browser tool.");
  }

  const { floor, path, problem } = loadNoiseFloor();
  if (!floor) {
    log.info(`No usable noise floor at ${path} (${problem}) - asking for calibration`);
    return {
      success: false,
      needsCalibration: true,
      noiseFloorPath: path,
      error:
        (problem === "missing"
          ? `No noise floor is saved on this machine yet (${path}).`
          : `The noise floor at ${path} ${problem}.`) +
        ` Frame times depend on the machine and display, so perf_measure needs one recorded here. ` +
        `Tell the user you're recording it, call perf_calibrate (it starts a separate Player several times, about a minute or two), then call perf_measure again.`,
    };
  }

  // Default to the floor's own settings so the two stay comparable.
  const frames = params.frames ?? floor.frames;
  const warmup = params.warmup ?? floor.warmup;

  log.info(`Running perf measure (frames: ${frames}, warmup: ${warmup})`);

  try {
    const timeoutMs = TIMEOUT_BASE_MS + frames * TIMEOUT_PER_FRAME_MS;
    const result = await withTimeout(
      runMeasurement(frames, warmup, floor),
      timeoutMs,
      `perf_measure timed out after ${timeoutMs}ms - the page may be too slow to complete ${frames} frames, or its JS thread is blocked`
    );
    log.info(`p50=${result.p50?.toFixed(3)}ms p95=${result.p95?.toFixed(3)}ms p99=${result.p99?.toFixed(3)}ms`);
    return result;
  } catch (error: any) {
    const timedOut = error.message.includes("timed out");
    log.error(`perf_measure failed: ${error.message}`);
    return { success: false, timedOut, error: error.message };
  }
}
