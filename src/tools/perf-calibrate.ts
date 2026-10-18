/**
 * Perf Calibrate Tool
 *
 * Records this machine's frame-timing noise floor - what perf_measure compares
 * against - and saves it next to the user's config. perf_measure asks for this
 * when no floor is saved yet.
 *
 * It calibrates the Player the user is working with (the one launch_browser
 * last started, else the default) at the live viewport size, so the floor
 * matches what perf_measure will see. Each run boots a separate Player on its
 * own port; the user's Player and connection are left alone.
 */

import { getConnectionManager } from "./connect-browser.js";
import { getLastLaunchParams } from "./launch-browser.js";
import { resolveDefaultPlayer } from "../player-paths.js";
import { calibrateNoiseFloor, DEFAULT_RESOLUTION, NoiseFloorRun } from "../perf-calibration.js";
import { PerfCalibrateParams, PerfCalibrateResult } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("PerfCalibrate");

async function liveViewport(): Promise<{ width: number; height: number } | undefined> {
  const manager = getConnectionManager();
  if (!manager.isConnected()) return undefined;
  try {
    const result = await manager.sendCommand("Runtime", "evaluate", {
      expression: "({ width: window.innerWidth, height: window.innerHeight })",
      returnByValue: true,
    });
    const size = result?.result?.value;
    return size?.width > 0 && size?.height > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

export async function perfCalibrate(
  params: PerfCalibrateParams,
  onRun?: (done: number, total: number, run: NoiseFloorRun) => void | Promise<void>
): Promise<PerfCalibrateResult> {
  const playerPath = params.playerPath ?? getLastLaunchParams()?.executablePath ?? resolveDefaultPlayer().path;
  if (!playerPath) {
    return {
      success: false,
      error: "No Player to calibrate with. Set one with set_player_path, or pass playerPath.",
    };
  }

  const viewport = await liveViewport();
  const width = params.width ?? viewport?.width ?? DEFAULT_RESOLUTION.width;
  const height = params.height ?? viewport?.height ?? DEFAULT_RESOLUTION.height;

  log.info(`Calibrating noise floor with ${playerPath} at ${width}x${height}`);
  try {
    const { floor, path } = await calibrateNoiseFloor({
      playerPath,
      runs: params.runs,
      frames: params.frames,
      warmup: params.warmup,
      width,
      height,
      onRun,
    });
    return {
      success: true,
      noiseFloorPath: path,
      resolution: floor.resolution,
      cohtmlVersion: floor.cohtmlVersion,
      framePeriodMs: floor.framePeriodMs,
      runs: floor.runs,
      spread: floor.spread,
      message:
        `Saved this machine's noise floor to ${path} (${floor.resolution.width}x${floor.resolution.height}, ` +
        `frame period ${floor.framePeriodMs.toFixed(2)} ms ~${Math.round(1000 / floor.framePeriodMs)} Hz). perf_measure can now compare against it.`,
    };
  } catch (error: any) {
    log.error(`Calibration failed: ${error.message}`);
    return { success: false, error: `Calibration failed: ${error.message}` };
  }
}
