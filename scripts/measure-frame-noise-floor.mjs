#!/usr/bin/env node
/**
 * Frame-timing noise-floor calibration for Gameface Player, from the command
 * line. Does the same as the perf_calibrate MCP tool - both call
 * build/perf-calibration.js - and saves to the same per-machine file
 * (~/.gameface-mcp/noise-floor.json) that perf_measure reads.
 *
 * Needs a build (`npm run build`). The Player comes from --browser-executable,
 * else "browserExecutable" in ~/.gameface-mcp/config.json.
 *
 * Usage:
 *   node scripts/measure-frame-noise-floor.mjs [--runs 5] [--frames 600] [--warmup 120]
 *     [--width 1920] [--height 1080] [--browser-executable <path>]
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { calibrateNoiseFloor } from "../build/perf-calibration.js";

function parseArgs(argv) {
  const out = {};
  const numbers = { "--runs": "runs", "--frames": "frames", "--warmup": "warmup", "--width": "width", "--height": "height" };
  for (let i = 0; i < argv.length; i++) {
    if (numbers[argv[i]]) out[numbers[argv[i]]] = parseInt(argv[++i], 10);
    else if (argv[i] === "--browser-executable") out.playerPath = argv[++i];
  }
  return out;
}

function defaultPlayer() {
  const configPath = resolve(homedir(), ".gameface-mcp", "config.json");
  try {
    const { browserExecutable } = JSON.parse(readFileSync(configPath, "utf8"));
    if (browserExecutable) return browserExecutable;
  } catch {
    // fall through to the error below
  }
  throw new Error(`No Player executable configured. Set "browserExecutable" in ${configPath}, or pass --browser-executable <path>.`);
}

const opts = parseArgs(process.argv.slice(2));
try {
  const { floor, path } = await calibrateNoiseFloor({
    ...opts,
    playerPath: opts.playerPath ?? defaultPlayer(),
    onRun: (done, total, run) => {
      process.stderr.write(`[run ${done}/${total}] p50=${run.p50.toFixed(3)}ms p95=${run.p95.toFixed(3)}ms p99=${run.p99.toFixed(3)}ms\n`);
    },
  });
  console.log(JSON.stringify(floor, null, 2));
  console.log(`\nWrote ${path}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
