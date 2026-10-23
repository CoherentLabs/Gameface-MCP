# Changelog

All notable changes to the Gameface MCP server are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Added

- `get_code_instructions` returns the same coding constraints as the
  `gameface://code-instructions` resource, for agents that can't read MCP
  resources, such as subagents limited to an explicit `tools` list. The server
  instructions now point to this tool instead of the resource.

### Changed

- Code instructions and RAG docs now require transform transition endpoints
  to use the same function list and units, and to route the animated value
  through a custom property so Vite's minifier can't strip the unit from zeros.
  The animation and layout examples that used `translateY(0)` as an endpoint
  now use matching units.
- The RAG media docs now describe the Gameface UI 5.0.0 `Image` API (dot
  paths, `options` background mode, atlas plugin) and mark `BackgroundImage`
  and `Icon` as deprecated. The `MaskImage` chunk gains the missing `options`
  prop.

## [1.3.0] - 2026-10-20

### Added

- `perf_calibrate` records this machine's frame-timing noise floor and saves
  it to `~/.gameface-mcp/noise-floor.json`. It starts a separate Player for
  each run (5 by default) using the Player last launched, at the live viewport
  size, and sends a progress notification after each run.

### Fixed

- `assert_text_fits`, `assert_no_overlap` and `assert_within_parent` no longer
  refuse elements whose center is covered by something else. They used to find
  the element with `elementFromPoint` at its center, which hit a child for most
  containers, hit the overlay for anything under one, and hit a slightly
  different box for transformed elements. They now look up the node's position
  in the `DOM.getDocument` tree and walk the same path in JS, so any element in
  the tree can be checked. Passing a text node or a stale ID now gives a clear
  error.
- Tool descriptions no longer describe a generic browser. `connect_browser`
  said "Connects to a running browser via Chrome DevTools Protocol", which
  read as an invitation to point it at Chrome. It and the other
  connection-related tools now name Gameface Player.
- `launch_browser` no longer leaves Player files in your project. Player wrote
  `CohtmlApplication*.log`, `PlayerConfig.ini`, `imgui.ini` and driver cache
  folders into its working directory, which was the server's (usually the
  project root). It now runs from its own folder, as when started by
  double-clicking. Relative `--root`, `--config` and page URLs are made
  absolute against the server's directory first, so they still point where
  they did.
- `take_screenshot` works with no arguments. It defaulted to `fullPage: true`,
  which needs `Page.getLayoutMetrics`, and Gameface returns that empty, so the
  first screenshot always failed. Gameface also can't capture outside the
  viewport, so full-page capture isn't possible. The tool now captures the
  viewport, and `fullPage: true` adds a note when part of the page is
  off-screen. `clipArea` no longer needs `fullPage: false` to take effect.
- `take_screenshot` returns an MCP image the agent can see, not the base64 PNG
  inside a JSON text block.
- `perf_measure` compares against a noise floor recorded on this machine
  instead of the one shipped in the package. Idle frame times follow the
  display's refresh rate, and the shipped floor was recorded over Remote
  Desktop at 32 Hz, so on a 120 Hz display every reading passed, even for a UI
  three times slower. With no floor saved, `perf_measure` now returns
  `needsCalibration: true` and tells the agent to run `perf_calibrate` first.
- `perf_measure` checks the display's frame period against the floor's. It
  reports `framePeriodMs`, `baselineFramePeriodMs` and
  `framePeriodMatchesBaseline`. On a faster display it omits
  `withinNoiseFloor` and explains why in `warning`; on a slower one it keeps
  the verdict and warns. Resolution and Cohtml version mismatches now add a
  warning suggesting `perf_calibrate` too.
- `perf_measure` no longer times out on slow displays. The fixed 15 s limit was
  shorter than 600 frames take at 30 Hz; the limit now scales with the frame
  count.

### Security

- `npm audit` is clean. `@modelcontextprotocol/sdk` now requires `^1.32.1`,
  past the 1.12.0–1.30.1 advisory, and the lockfile was refreshed. This clears
  the advisories in `proxy-addr`, `hono`, `@hono/node-server`, `ip-address`,
  `fast-uri`, `ws`, `body-parser` and `qs`. None were reachable over the stdio
  transport, but an HTTP transport would expose them.

### Changed

- The noise floor is per machine, in `~/.gameface-mcp/noise-floor.json`.
  `tools/perf/noise-floor.md` is no longer shipped, and
  `scripts/measure-frame-noise-floor.mjs` now writes to the per-machine file
  and shares its implementation with `perf_calibrate`.
- Requires Node 20 or later (was 18). Node 18 is end-of-life, and the patched
  `@hono/node-server` 2.x that the SDK now resolves to declares Node 20+.

## [1.2.0] - 2026-10-15

Installed from npm instead of a clone, and a guided Player setup: the agent
asks for the Player path, can search the machine for it, and keeps a list of
Players to pick from at launch.

### Added

**npm packaging.** The server runs as `npx -y gameface-mcp`, so there's
nothing to clone or build. The package ships only `build/`, `prompts/` and
`tools/perf/`, and declares Node 18+.

**Player setup tools.**

- `set_player_path` — saves the default Player to `~/.gameface-mcp/config.json`,
  creating the file with recommended defaults if needed. With no arguments it
  asks the user directly through MCP elicitation, re-asks on a wrong path, and
  offers an automatic search after the first miss. Accepts a `Player.exe`, its
  folder, or an SDK root.
- `add_players` — adds Players to a new `players` list without changing the
  default: from paths, from a folder of Players, from a machine search, or by
  asking the user.
- Automatic Player search — runs locally in the server: home folder first, then
  other drives, skipping system folders, for at most 60 seconds. Only the
  Player paths it finds reach the model. Every Player found is added to
  `players`.

**`launch_browser` additions.**

- `choosePlayer: true` — the user picks from the default plus `players`,
  sorted by version, without changing the default.
- With no default set but Players in the list, the user picks one, which
  becomes the default.

**MCP prompts**, shown as slash commands: `launch-player`,
`change-player-path`, `scan-players`, `add-player`.

### Changed

- `--browser-executable` no longer replaces the saved Player. When the file it
  points to doesn't exist, the saved Player is launched instead and the result
  carries a `notice` to fix the flag.
- The server reports its name as `gameface-mcp` instead of
  `chrome-cdp-mcp-server`, and its help text describes Gameface Player rather
  than Chrome.

### Fixed

- A launch that failed to start the Player (a missing path, or a debug port
  that never answered) no longer blocks every later launch with "Browser is
  already running".


## [1.1.0] - 2026-09-09

Nine new tools (18 -> 27), focused on two areas:

- data-binding diagnostics, including models registered from C++
- performance and memory measurement without open-ended optimisation loops

### Added

**Data binding tools.** Wrap the five Gameface-only data-binding methods in the
CDP `DOM` domain plus `dataBindingModelsSynchronized`. Because these are not in
upstream Chrome, they are sent as raw CDP calls.

- `get_data_binding_models` — lists live engine models and values. Tags each
  model as `source: "js"` when a matching page global exists, otherwise
  `"engine"` (common for C++-registered models). This tag is heuristic.
- `inspect_data_bindings` — reports all `{{ }}` expressions on a bound element:
  value, type, DOM state, and parse/compile/eval errors. Scans the full
  document when no node or selector is provided.
- `set_data_binding_value` — writes one scalar value and syncs it to the DOM,
  useful for state-driving without a running game.
- `set_data_binding_model` — creates or replaces a full model, including nested
  objects and arrays, then synchronises.
- `sync_data_binding_models` — runs a sync pass and waits for engine
  confirmation.

**Performance tools.**

- `perf_profile` — measures the UI's engine cost per frame and stops there.
  Returns a single number plus repeatability, with no phase ranking or verdict.
- `perf_trace` — per-phase breakdown (advance, styling, painting, GPU,
  cross-thread waits), gated behind a user-set budget. See *The budget gate*
  below.

**Memory tools.**

- `check_memory` — reads JS heap and GPU texture memory. Given a trigger
  expression, it runs a leak test: collect baseline, run trigger, collect
  again, report what did not return.
- `get_image_cache_stats` — resident textures largest first, in decoded GPU
  bytes rather than file size. `releaseUnused` reveals how much is actually
  reclaimable.

**The budget gate.** Per-phase trace output is intentionally withheld until a
human sets a performance budget.

- `perf_profile` returns no optimisation target.
- Where supported, MCP elicitation asks the user directly; otherwise the tool
  returns a relay message and stops.
- The chosen budget is stored in `gameface-perf-budget.json` at project root
  (override with `--perf-budget` or `perfBudgetFile`).
- `perf_trace` returns breakdowns only when that file is valid **and** the UI
  is over budget. Missing, malformed, zero, or negative budgets unlock
  nothing.

**Internal.**

- `ConnectionManager.sendRaw()` for CDP methods absent from the bundled
  protocol descriptor (all Gameface-specific methods).
- Tracking for the `DOM.dataBindingModelsSynchronized` event, with
  `waitForDataBindingSync()` so synchronisation is confirmed, not assumed.
- `src/tools/trace-capture.ts`, shared by `perf_profile` and `perf_trace` so
  both tools measure the same way.

### Changed

- **`perf_lint` now reports stacking contexts.** Each is a separate paint
  grouping, so high counts reduce batching potential. Common causes (position,
  overflow) are summarised rather than emitted per element.
  Two new rules fire per element: `expensive-stacking-context` for `filter`,
  `backdrop-filter`, `mix-blend-mode`, `isolation` and `perspective`, and
  `ineffective-layer-hint` for `contain: paint`. `PerfLintResult` gains an
  optional `stackingContexts` field.


### Documentation

- `prompts/rag/01-engine-bridge.md` — corrected: `engine.updateWholeModel`
  takes the model **object**, not its name. The previous string form is
  accepted but silently ignored. Also documented: `engine.createJSModel` does
  not overwrite existing models, and `engine.unregisterModel` must not be
  passed a string.
- `prompts/rag/07-performance.md` — new entry documenting which CSS creates a
  stacking context in Cohtml, and how that differs from the browser.
- `README.md` — sections on the data binding tools, the performance and memory
  tools, the budget gate, and how the trace is measured.

### Verified engine behaviour

Recorded here because several design decisions above depend on these findings.

- `engine.updateWholeModel` takes the model object. A name string is accepted
  and silently does nothing.
- `engine.unregisterModel` passed a string **crashes the Player process**.
  Reproduced across two runs. No tool here calls it.
- `DOM.updateDataBindingValue` accepts scalars only. Objects, arrays and null
  return `succeeded: false` and leave the model untouched.
- Neither a value write nor a model import updates the rendered DOM on its own.
- The CDP `Memory` domain is **not implemented** — every command, including
  `getDOMCounters` and `prepareForLeakDetection`, returns "wasn't found".
  `Tracing.requestMemoryDump` is accepted but returns nothing, and the
  HeapProfiler allocation-tracking event stream never fires.
- `Performance.getMetrics` returns **malformed JSON** when duration metrics are
  still exactly zero, truncating mid-object. It recovers after layout/style
  has run. Naive WebSocket clients can desynchronise instead of throwing.
- Image cache sizes are decoded GPU cost, not file size: a 424-byte 128×128 PNG
  reports as 65536 bytes. Removing an element does **not** release its texture;
  images stay resident until `clearCachedUnusedImages`.
- Engine phases nest several levels deep, so ranking on total cost points at
  one hotspot repeatedly. Both ranking and the budget total use self time.
- Engine cost as a share of the observed frame period is not comparable between
  sessions (3% to 12% on identical work depending on drive conditions).
  Per-frame microseconds are reported instead.
- Repeated captures of an unchanged page vary by up to 20% on paint-side
  phases, so the noise floor is measured live per call rather than read from a
  committed baseline.
- `will-change` is unreadable in Gameface: the computed property is undefined,
  `getPropertyValue("will-change")` returns empty, and `element.style.willChange`
  is undefined even for an inline declaration. It is therefore not linted.

### Known limitations

- The budget file resolves against the working directory the server was
  launched from. In most game repos this is the project root, but clients that
  launch elsewhere will resolve elsewhere. The resolved path is logged at
  startup and returned in relevant tool output.
- `perf_trace` holds a whole capture in memory before aggregating, around two
  thousand records for a short trace. Fine at the 30-second maximum; longer
  traces would need streaming aggregation.
- The `source: "js"` / `"engine"` split on data binding models is inferred from
  page globals and has not been tested against a running game.

## [1.0.0] - 2026-08-19

Initial public version: launch and connect to Gameface Player over CDP with a
Gameface-only identity guard, DOM and computed-style inspection, element
interaction, screenshots, console and log capture, layout assertions
(`assert_text_fits`, `assert_no_overlap`, `assert_within_parent`), `perf_lint`,
`perf_measure` against a recorded frame-timing noise floor, and a searchable
Gameface documentation corpus exposed as both a tool and MCP resources.
