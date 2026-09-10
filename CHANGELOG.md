# Changelog

All notable changes to the Gameface MCP server are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
