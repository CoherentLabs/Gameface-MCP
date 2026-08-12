/**
 * Fixed frame-timing scenario, shared by:
 *   - the standalone noise-floor calibration runner (scripts/measure-frame-noise-floor.mjs),
 *     which boots a fresh Player per run and injects this via --url + a throwaway harness page
 *   - the perf_measure MCP tool (src/tools/perf-measure.ts), which injects this directly into
 *     whatever page is already loaded on the live CDP connection
 *
 * Both call sites inject this exact file's text as a single Runtime.evaluate expression, so the
 * measurement methodology is identical wherever it runs. It is deliberately page-agnostic (S0 /
 * idle only - zero model updates, no input): it does not know or care what page it's running on,
 * it only measures the passive per-frame cost of whatever is currently rendered.
 *
 * Contract (read by the caller after injection):
 *   window.__calibrateResolution -> { width, height }               (set immediately)
 *   window.__calibrateDone       -> boolean, true once frames collected
 *   window.__calibrateFrameTimes -> number[] (ms deltas between consecutive rAF callbacks)
 *
 * Frame count is fixed at 600 to match the recorded noise floor (tools/perf/noise-floor.md).
 * Warmup discard (first 120 frames) is NOT done here - callers apply it identically so the
 * discard logic lives in exactly one place per consumer, not duplicated into the injected page.
 */
(function () {
  "use strict";

  if (window.__calibrateRunning) {
    return; // already in flight - don't start a second concurrent loop
  }
  window.__calibrateRunning = true;
  window.__calibrateDone = false;
  window.__calibrateFrameTimes = [];
  window.__calibrateResolution = { width: window.innerWidth, height: window.innerHeight };

  var TOTAL_FRAMES = window.__calibrateFrameCount || 600;

  var frameCount = 0;
  var lastTs = null;

  function tick(ts) {
    if (lastTs !== null) {
      window.__calibrateFrameTimes.push(ts - lastTs);
      frameCount++;
    }
    lastTs = ts;

    if (frameCount < TOTAL_FRAMES) {
      requestAnimationFrame(tick);
    } else {
      window.__calibrateDone = true;
      window.__calibrateRunning = false;
    }
  }

  requestAnimationFrame(tick);
})();
