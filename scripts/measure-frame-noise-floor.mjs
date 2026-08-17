#!/usr/bin/env node
/**
 * Frame-timing noise-floor calibration for Gameface Player.
 *
 * Boots the Player at a fixed resolution, loads a throwaway harness page that
 * runs the exact scenario in tools/perf/calibrate.js, records per-frame cost,
 * and repeats with a full Player restart between runs so process-level
 * variance is captured rather than hidden. The harness page is generated at
 * runtime (embeds calibrate.js verbatim) and deleted afterward - it is not
 * part of any real UI.
 *
 * This is the calibration counterpart to the perf_measure MCP tool
 * (src/tools/perf-measure.ts), which injects the same tools/perf/calibrate.js
 * into whatever page is already loaded on the live connection instead of
 * booting a fresh Player. Both consume the identical scenario file so numbers
 * are comparable.
 *
 * Usage:
 *   node scripts/measure-frame-noise-floor.mjs [--runs 5] [--frames 600] [--warmup 120]
 *
 * Writes tools/perf/noise-floor.md with the recorded baseline (including a
 * machine-readable JSON block that perf_measure reads to judge new numbers).
 */

import CDP from "chrome-remote-interface";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CALIBRATE_SCRIPT_PATH = resolve(REPO_ROOT, "tools/perf/calibrate.js");
const NOISE_FLOOR_MD_PATH = resolve(REPO_ROOT, "tools/perf/noise-floor.md");

// Same config file the MCP server itself reads (src/config.ts) - read
// directly rather than importing build/config.js, so this script doesn't
// depend on a fresh build existing and doesn't collide with this script's
// own --runs/--frames/--warmup flags the way reusing that module's argv
// parser would.
const GAMEFACE_CONFIG_PATH = resolve(homedir(), ".gameface-mcp", "config.json");

function loadPlayerExecutable(cliOverride) {
  if (cliOverride) return cliOverride;
  try {
    const parsed = JSON.parse(readFileSync(GAMEFACE_CONFIG_PATH, "utf8"));
    if (parsed.browserExecutable) return parsed.browserExecutable;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `No Player executable configured. Set "browserExecutable" in ${GAMEFACE_CONFIG_PATH}, ` +
      `or pass --browser-executable <path>.`
  );
}

// A dedicated subfolder of the OS temp dir, not this repo - avoids
// polluting the repo and works on any machine (not tied to any one
// session's own temp path).
const SCRATCH_DIR = resolve(tmpdir(), "gameface-mcp-calibrate");
const HARNESS_FILE = "calibrate-harness.html";
const HARNESS_PATH = `${SCRATCH_DIR}/${HARNESS_FILE}`;

// Deliberately NOT 9444 (this server's own default / the port launch_browser
// uses) - avoid contending with or touching a Player instance a real MCP
// session may already have open.
const PORT = 9556;
const WIDTH = 1920;
const HEIGHT = 1080;

function parseArgs(argv) {
  const out = { runs: 5, frames: 600, warmup: 120, browserExecutable: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") out.runs = parseInt(argv[++i], 10);
    else if (a === "--frames") out.frames = parseInt(argv[++i], 10);
    else if (a === "--warmup") out.warmup = parseInt(argv[++i], 10);
    else if (a === "--browser-executable") out.browserExecutable = argv[++i];
  }
  return out;
}

function writeHarness(frames) {
  const calibrateScript = readFileSync(CALIBRATE_SCRIPT_PATH, "utf8");
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>calibrate</title></head>
<body>
<script>window.__calibrateFrameCount = ${frames};</script>
<script>
${calibrateScript}
</script>
</body>
</html>
`;
  writeFileSync(HARNESS_PATH, html, "utf8");
}

function removeHarness() {
  if (existsSync(HARNESS_PATH)) unlinkSync(HARNESS_PATH);
}

async function waitForDebuggerReady(port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // expected while the Player is still booting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Debugger port ${port} not ready after ${timeoutMs}ms`);
}

// Mirrors src/connection-manager.ts's extractCohtmlVersion - duplicated rather
// than imported since this script runs standalone against build/ output that
// may not exist yet, and the parsing is a one-line regex either way.
function extractCohtmlVersion(versionString) {
  const match = /cohtml\/([\d.]+)/i.exec(versionString || "");
  return match ? match[1] : null;
}

function killProcess(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once("exit", () => resolve());
    proc.kill();
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already gone
      }
      resolve();
    }, 5000);
  });
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

// Gameface's CDP HTTP endpoint (/json, /json/list) echoes the request path
// into webSocketDebuggerUrl (e.g. "ws://host:port/json/list/devtools/page/0"
// instead of ".../devtools/page/0"), which breaks chrome-remote-interface's
// default target-discovery-then-connect flow. Work around it by reading the
// target id ourselves and connecting via a relative path target, which the
// library turns into a raw WS URL without re-fetching/trusting that field.
async function resolveTargetPath(port) {
  const res = await fetch(`http://localhost:${port}/json`);
  const targets = await res.json();
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("No CDP targets reported by Player");
  }
  const page = targets.find((t) => t.type === "page") || targets[0];
  return `/devtools/page/${page.id}`;
}

async function runOnce(frames, playerExe) {
  const args = [
    "--url", `coui:///${HARNESS_FILE}`,
    "--root", SCRATCH_DIR,
    "--width", String(WIDTH),
    "--height", String(HEIGHT),
    "--debugger-port", String(PORT),
    "--renderer", "dx11",
    // Without this, the Player's own toolbar/bookmarks chrome eats an
    // inconsistent chunk of --height (observed 757-986px of "missing" height
    // across runs), so window.innerHeight never actually equals the
    // requested --height and isn't stable run-to-run either. With it, the
    // viewport exactly matches --width/--height (verified: 1920x1080 in, 1920x1080 out).
    "--enable-gui=false",
  ];

  const proc = spawn(playerExe, args, { stdio: "ignore" });
  proc.on("error", (err) => {
    process.stderr.write(`  Player process error: ${err.message}\n`);
  });

  try {
    const versionInfo = await waitForDebuggerReady(PORT, 20000);
    const cohtmlVersion = extractCohtmlVersion(versionInfo && versionInfo.Browser);

    const targetPath = await resolveTargetPath(PORT);
    // local: true - use the library's bundled protocol descriptor instead of
    // fetching /json/protocol from the target, which Gameface's minimal CDP
    // server doesn't implement (mirrors connection-manager.ts's own connect()).
    const client = await CDP({ port: PORT, target: targetPath, local: true });
    try {
      await client.Runtime.enable();
      await client.Page.enable();

      const deadline = Date.now() + 60000;
      let done = false;
      while (Date.now() < deadline) {
        const evalResult = await client.Runtime.evaluate({
          expression: "window.__calibrateDone === true",
          returnByValue: true,
        });
        if (evalResult.result && evalResult.result.value === true) {
          done = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      if (!done) {
        throw new Error("Timed out waiting for calibration scenario to finish");
      }

      const dataResult = await client.Runtime.evaluate({
        expression: "JSON.stringify({ frameTimes: window.__calibrateFrameTimes, resolution: window.__calibrateResolution })",
        returnByValue: true,
      });

      return { ...JSON.parse(dataResult.result.value), cohtmlVersion };
    } finally {
      await client.close();
    }
  } finally {
    await killProcess(proc);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

function renderMarkdown(opts, perRunStats, spread, resolution, cohtmlVersion) {
  const rows = perRunStats
    .map((s) => `| ${s.run} | ${s.p50.toFixed(3)} | ${s.p95.toFixed(3)} | ${s.p99.toFixed(3)} |`)
    .join("\n");

  const json = {
    scenario: "S0-idle",
    resolution,
    cohtmlVersion,
    frames: opts.frames,
    warmup: opts.warmup,
    generatedAt: new Date().toISOString(),
    perRun: perRunStats,
    spread,
  };

  return `# Frame-timing noise floor (S0 - idle)

Generated by \`scripts/measure-frame-noise-floor.mjs\`, using the fixed scenario
in \`tools/perf/calibrate.js\`. Requested window ${WIDTH}x${HEIGHT}; actual measured
viewport (window.innerWidth/innerHeight, what perf_measure compares against -
the Player's own toolbar/chrome consumes some of the requested window height)
is ${resolution.width}x${resolution.height}. Cohtml version ${cohtmlVersion || "(unknown)"}
- frame timing can differ across versions, so \`perf_measure\` flags a mismatch
the same way it flags a resolution mismatch. ${opts.frames} frames per run, first
${opts.warmup} discarded as warmup, Player restarted between runs.

This is the baseline \`perf_measure\` compares new readings against: a change
smaller than the recorded spread at a given percentile is not distinguishable
from restart noise at that percentile.

| Run | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---|---|---|
${rows}

**Spread across the ${opts.runs} runs:**

| Metric | min | max | range | stddev |
|---|---|---|---|---|
| p50 | ${spread.p50.min.toFixed(3)} | ${spread.p50.max.toFixed(3)} | ${spread.p50.range.toFixed(3)} | ${spread.p50.stddev.toFixed(3)} |
| p95 | ${spread.p95.min.toFixed(3)} | ${spread.p95.max.toFixed(3)} | ${spread.p95.range.toFixed(3)} | ${spread.p95.stddev.toFixed(3)} |
| p99 | ${spread.p99.min.toFixed(3)} | ${spread.p99.max.toFixed(3)} | ${spread.p99.range.toFixed(3)} | ${spread.p99.stddev.toFixed(3)} |

\`\`\`json
${JSON.stringify(json, null, 2)}
\`\`\`
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const playerExe = loadPlayerExecutable(opts.browserExecutable);

  if (!existsSync(dirname(NOISE_FLOOR_MD_PATH))) {
    mkdirSync(dirname(NOISE_FLOOR_MD_PATH), { recursive: true });
  }
  if (!existsSync(SCRATCH_DIR)) {
    mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  writeHarness(opts.frames);

  const perRunStats = [];
  let lastResolution = null;
  let lastCohtmlVersion = null;

  try {
    for (let i = 0; i < opts.runs; i++) {
      process.stderr.write(`[run ${i + 1}/${opts.runs}] booting Player...\n`);
      const { frameTimes, resolution, cohtmlVersion } = await runOnce(opts.frames, playerExe);
      lastResolution = resolution;
      lastCohtmlVersion = cohtmlVersion;

      if (frameTimes.length !== opts.frames) {
        process.stderr.write(`  warning: expected ${opts.frames} frame samples, got ${frameTimes.length}\n`);
      }

      const measured = frameTimes.slice(opts.warmup);
      const sorted = [...measured].sort((a, b) => a - b);

      const stats = {
        run: i + 1,
        sampleCount: measured.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: mean(measured),
      };
      perRunStats.push(stats);
      process.stderr.write(
        `  p50=${stats.p50.toFixed(3)}ms p95=${stats.p95.toFixed(3)}ms p99=${stats.p99.toFixed(3)}ms mean=${stats.mean.toFixed(3)}ms\n`
      );
    }
  } finally {
    removeHarness();
  }

  const p50s = perRunStats.map((s) => s.p50);
  const p95s = perRunStats.map((s) => s.p95);
  const p99s = perRunStats.map((s) => s.p99);

  const spread = {
    p50: { min: Math.min(...p50s), max: Math.max(...p50s), range: Math.max(...p50s) - Math.min(...p50s), stddev: stddev(p50s) },
    p95: { min: Math.min(...p95s), max: Math.max(...p95s), range: Math.max(...p95s) - Math.min(...p95s), stddev: stddev(p95s) },
    p99: { min: Math.min(...p99s), max: Math.max(...p99s), range: Math.max(...p99s) - Math.min(...p99s), stddev: stddev(p99s) },
  };

  const markdown = renderMarkdown(opts, perRunStats, spread, lastResolution, lastCohtmlVersion);
  writeFileSync(NOISE_FLOOR_MD_PATH, markdown, "utf8");

  console.log(JSON.stringify({ frames: opts.frames, warmup: opts.warmup, perRun: perRunStats, spread }, null, 2));
  console.log(`\nWrote ${NOISE_FLOOR_MD_PATH}`);
}

main().catch((err) => {
  removeHarness();
  console.error(err);
  process.exit(1);
});
