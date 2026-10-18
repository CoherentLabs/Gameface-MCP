/**
 * The frame-timing noise floor perf_measure compares against: recording it
 * (perf_calibrate, scripts/measure-frame-noise-floor.mjs) and reading it back.
 *
 * Idle frame times follow the display's refresh rate, so a floor only holds for
 * the machine it was recorded on. It is saved next to the user's config
 * (~/.gameface-mcp/noise-floor.json by default) - one per machine, never
 * shipped with the package or committed to a project.
 *
 * Each run boots a fresh Player on its own port, loads a throwaway harness page
 * that runs tools/perf/calibrate.js, and is closed before the next one, so
 * process-level variance is captured rather than hidden. The user's own Player
 * and connection are left alone.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserLauncher } from "./browser-launcher.js";
import { ConnectionManager } from "./connection-manager.js";
import { getConfigPath } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("PerfCalibration");

export const CALIBRATE_SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../tools/perf/calibrate.js");

// Not 9444 (launch_browser's default), so calibration never collides with the
// Player the user is working in.
const CALIBRATION_PORT = 9556;
const HARNESS_DIR = join(tmpdir(), "gameface-mcp-calibrate");
const HARNESS_FILE = "calibrate-harness.html";
const POLL_INTERVAL_MS = 100;
const PER_FRAME_ALLOWANCE_MS = 50;
const RESTART_PAUSE_MS = 1500;

// An idle UI makes its fastest frames on vsync, so a low percentile of the frame
// times estimates the display's refresh period. perf_measure uses the same one.
export const FRAME_PERIOD_PERCENTILE = 5;

export const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };
export const DEFAULT_RUNS = 5;
export const DEFAULT_FRAMES = 600;
export const DEFAULT_WARMUP = 120;

interface Spread {
  min: number;
  max: number;
  range: number;
  stddev: number;
}

export interface NoiseFloorRun {
  run: number;
  sampleCount: number;
  p5: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
}

export interface NoiseFloor {
  scenario: "S0-idle";
  resolution: { width: number; height: number };
  cohtmlVersion?: string;
  playerPath: string;
  framePeriodMs: number;
  frames: number;
  warmup: number;
  runs: number;
  generatedAt: string;
  perRun: NoiseFloorRun[];
  spread: { p50: Spread; p95: Spread; p99: Spread };
}

export interface CalibrationOptions {
  playerPath: string;
  runs?: number;
  frames?: number;
  warmup?: number;
  width?: number;
  height?: number;
  /** Called after each run, for progress reporting. */
  onRun?: (done: number, total: number, run: NoiseFloorRun) => void | Promise<void>;
}

export function getNoiseFloorPath(): string {
  return join(dirname(getConfigPath()), "noise-floor.json");
}

/** The saved floor, or `problem` saying why there is none usable. */
export function loadNoiseFloor(): { floor?: NoiseFloor; path: string; problem?: string } {
  const path = getNoiseFloorPath();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: any) {
    return { path, problem: error.code === "ENOENT" ? "missing" : `could not be read (${error.message})` };
  }
  try {
    const floor = JSON.parse(raw) as NoiseFloor;
    if (!floor?.spread?.p50 || typeof floor.framePeriodMs !== "number") {
      return { path, problem: "is not a noise floor this version understands" };
    }
    return { floor, path };
  } catch (error: any) {
    return { path, problem: `is not valid JSON (${error.message})` };
  }
}

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function spreadOf(values: number[]): Spread {
  const m = mean(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, range: max - min, stddev: Math.sqrt(mean(values.map((v) => (v - m) ** 2))) };
}

function writeHarness(frames: number): void {
  const calibrateScript = readFileSync(CALIBRATE_SCRIPT_PATH, "utf8");
  mkdirSync(HARNESS_DIR, { recursive: true });
  writeFileSync(
    join(HARNESS_DIR, HARNESS_FILE),
    `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>calibrate</title></head>
<body>
<script>window.__calibrateFrameCount = ${frames};</script>
<script>
${calibrateScript}
</script>
</body>
</html>
`,
    "utf8"
  );
}

async function runOnce(
  opts: Required<Omit<CalibrationOptions, "onRun">>
): Promise<{ frameTimes: number[]; resolution: { width: number; height: number }; cohtmlVersion?: string }> {
  const launcher = new BrowserLauncher();
  const connection = new ConnectionManager();
  const instance = await launcher.launch({
    executablePath: opts.playerPath,
    port: CALIBRATION_PORT,
    args: [
      "--url",
      `coui:///${HARNESS_FILE}`,
      "--root",
      HARNESS_DIR,
      "--width",
      String(opts.width),
      "--height",
      String(opts.height),
      // Without it the Player's toolbar takes an inconsistent share of
      // --height, so the viewport never matches the requested size.
      "--enable-gui=false",
    ],
  });

  try {
    await connection.connect({ port: CALIBRATION_PORT, target: (targets) => targets.find((t) => t.type === "page") ?? targets[0] });
    const deadline = Date.now() + 10_000 + opts.frames * PER_FRAME_ALLOWANCE_MS;
    for (;;) {
      const done = await connection.sendCommand("Runtime", "evaluate", { expression: "window.__calibrateDone === true", returnByValue: true });
      if (done.result?.value === true) break;
      if (Date.now() > deadline) throw new Error("Timed out waiting for the calibration scenario to finish");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    const data = await connection.sendCommand("Runtime", "evaluate", {
      expression: "({ frameTimes: window.__calibrateFrameTimes, resolution: window.__calibrateResolution })",
      returnByValue: true,
    });
    return { ...data.result.value, cohtmlVersion: instance.cohtmlVersion };
  } finally {
    await connection.disconnect().catch(() => {});
    await launcher.close();
    // Let the port and GPU settle before the next boot.
    await new Promise((r) => setTimeout(r, RESTART_PAUSE_MS));
  }
}

/** Records a noise floor on this machine and saves it. Returns the floor and where it went. */
export async function calibrateNoiseFloor(options: CalibrationOptions): Promise<{ floor: NoiseFloor; path: string }> {
  const opts = {
    playerPath: options.playerPath,
    runs: options.runs ?? DEFAULT_RUNS,
    frames: options.frames ?? DEFAULT_FRAMES,
    warmup: options.warmup ?? DEFAULT_WARMUP,
    width: options.width ?? DEFAULT_RESOLUTION.width,
    height: options.height ?? DEFAULT_RESOLUTION.height,
  };
  if (opts.warmup >= opts.frames) {
    throw new Error(`warmup (${opts.warmup}) must be less than frames (${opts.frames}).`);
  }

  writeHarness(opts.frames);
  const perRun: NoiseFloorRun[] = [];
  let resolution = { width: opts.width, height: opts.height };
  let cohtmlVersion: string | undefined;

  try {
    for (let i = 0; i < opts.runs; i++) {
      log.info(`Calibration run ${i + 1}/${opts.runs}`);
      const result = await runOnce(opts);
      resolution = result.resolution;
      cohtmlVersion = result.cohtmlVersion;

      const measured = result.frameTimes.slice(opts.warmup);
      const sorted = [...measured].sort((a, b) => a - b);
      const run: NoiseFloorRun = {
        run: i + 1,
        sampleCount: measured.length,
        p5: percentile(sorted, FRAME_PERIOD_PERCENTILE),
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: mean(measured),
      };
      perRun.push(run);
      await options.onRun?.(i + 1, opts.runs, run);
    }
  } finally {
    rmSync(join(HARNESS_DIR, HARNESS_FILE), { force: true });
  }

  // Median of the per-run estimates, so one odd run can't shift it.
  const p5s = perRun.map((r) => r.p5).sort((a, b) => a - b);
  const floor: NoiseFloor = {
    scenario: "S0-idle",
    resolution,
    cohtmlVersion,
    playerPath: opts.playerPath,
    framePeriodMs: p5s[Math.floor(p5s.length / 2)],
    frames: opts.frames,
    warmup: opts.warmup,
    runs: opts.runs,
    generatedAt: new Date().toISOString(),
    perRun,
    spread: {
      p50: spreadOf(perRun.map((r) => r.p50)),
      p95: spreadOf(perRun.map((r) => r.p95)),
      p99: spreadOf(perRun.map((r) => r.p99)),
    },
  };

  const path = getNoiseFloorPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(floor, null, 2) + "\n", "utf8");
  log.info(`Saved noise floor to ${path}`);
  return { floor, path };
}
