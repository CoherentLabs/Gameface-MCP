# Gameface MCP Server

An MCP (Model Context Protocol) server that gives an LLM agent direct control
over a [Gameface](https://coherent-labs.com/products/gameface/) Player
instance via the Chrome DevTools Protocol (CDP) — launch/connect, inspect the
DOM and computed styles, interact with elements, run layout/overlap
assertions, lint for known-expensive Gameface layout patterns, measure frame
timing against a recorded noise floor, and search a Gameface documentation
corpus. Only Gameface Player is ever allowed to be launched or connected to
— every connection is verified by CDP identity (`navigator.userAgent`
must contain `cohtml`) and refused/killed otherwise.

Version history is in [CHANGELOG.md](CHANGELOG.md).

## Prerequisites

- Node.js 18+ (the server uses the global `fetch` API).
- A local Gameface/Cohtml SDK install with a Player executable. This repo
  does not ship one — you need your own Gameface license/SDK. On Windows
  that's typically `.../Player/Player.exe` inside your SDK's install
  directory (note: `Player.exe` usually lives in a `Player` *subfolder*
  under the SDK root, not at the SDK root itself).

## Build

```bash
npm install
npm run build
```

This compiles `src/` to `build/`, producing `build/index.js` — the server's
stdio entry point. `npm run watch` recompiles on change during development.

## Setting the Player path

There are two ways to tell the server where your Player executable is. A
CLI flag always overrides the config file.

### Option A — config file (recommended)

Create `~/.gameface-mcp/config.json` (one per developer machine, not per
project — this server is meant to be reused across multiple game repos, so
the path lives once on your machine rather than being hardcoded into every
project's committed MCP config):

```json
{
  "browserExecutable": "D:/path/to/your/sdk/Player/Player.exe",
  "browserArgs": ["--enable-gui=false"],
  "port": 9444,
  "cdpHost": "localhost"
}
```

Every field is optional. `browserArgs` here are merged in on every
`launch_browser` call — `--enable-gui=false` is worth setting by default:
without it, Player's own toolbar/bookmark-bar chrome consumes an
inconsistent chunk of your requested `--height`, so the actual viewport
never quite matches what you asked for.

Point at a different file with `-c`/`--config <path>` if you want more than
one profile (e.g. a different Player build per project).

### Option B — CLI flags

```bash
node build/index.js --browser-executable "D:/path/to/Player.exe"
```

Full flag list:

| Flag | Short | Meaning | Default |
|---|---|---|---|
| `--browser-executable <path>` | `-b` | Path to Player.exe | (required, one way or another) |
| `--browser-args <args>` | `-a` | Comma-separated extra CLI args passed to Player | none |
| `--port <port>` | `-p` | CDP remote-debugging port | `9444` |
| `--cdp-host <host>` | `-h` | Host for the CDP connection | `localhost` |
| `--config <path>` | `-c` | Path to the JSON config file | `~/.gameface-mcp/config.json` |
| `--perf-budget <path>` | | Path to this project's performance budget file | `./gameface-perf-budget.json` |
| `--help` | | Print this list | |

## Connecting from an LLM client

This is a plain stdio MCP server: any client just needs to run
`node <path-to-build/index.js>` and speak MCP over stdin/stdout. The exact
file the client config lives in — and the top-level key it uses
(`mcpServers` vs `servers`) — differs per client.

### Claude Code

`.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "gameface": {
      "command": "node",
      "args": ["/absolute/path/to/Gameface-MCP/build/index.js"]
    }
  }
}
```

### VS Code (GitHub Copilot / MCP extension)

`.vscode/mcp.json` at your project root — this repo already ships one you
can copy:

```json
{
  "servers": {
    "gameface_local": {
      "command": "node",
      "args": ["build/index.js"]
    }
  }
}
```

Note the key is `servers`, not `mcpServers` — copying a config from another
client without changing this key is the most common mistake here.

### Gemini CLI

`.gemini/settings.json` (project-level) or `~/.gemini/settings.json`
(user-level, applies to every project):

```json
{
  "mcpServers": {
    "gameface": {
      "command": "node",
      "args": ["/absolute/path/to/Gameface-MCP/build/index.js"],
      "timeout": 30000,
      "trust": false
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`, Windows:
`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gameface": {
      "command": "node",
      "args": ["/absolute/path/to/Gameface-MCP/build/index.js"]
    }
  }
}
```

In every case above, if you've set up `~/.gameface-mcp/config.json` (Option
A above) the `args` array needs nothing beyond the path to `build/index.js`
— the Player path, port, etc. are picked up automatically. Add
`--browser-executable`/other flags to `args` only if you want to override
the config file for a specific client or project.

## Available tools

| Tool | What it does |
|---|---|
| `launch_browser` | Launches Player with remote debugging enabled. Refuses and kills anything that isn't Gameface Player. |
| `connect_browser` | Connects to an already-running, debuggable Player instance. Same Gameface-only guard. |
| `gameface_get_status` | Reports current connection status. |
| `gameface_restart` | Disconnects, closes, relaunches, and reconnects using the last-used launch/connect parameters. |
| `navigate` | Navigates the connected view to a different URL. |
| `get_dom_tree` | Snapshot of the DOM tree (node IDs, names, attributes, children). |
| `search_dom` | Searches the DOM for nodes matching a text or XPath query. |
| `get_computed_styles` | Computed CSS styles for a given node. |
| `interact_element` | Click, type, hover, focus, scrollIntoView, or touch on an element. |
| `take_screenshot` | Captures a screenshot (full page, viewport, or a custom clip rect). |
| `eval_js` | Executes arbitrary JavaScript in the connected page and returns the result. |
| `get_console_logs` | Buffered console messages and Log-domain entries (errors, warnings, deprecations). |
| `assert_text_fits` | Checks whether an element's content overflows its own box (`scrollWidth`/`scrollHeight` vs `clientWidth`/`clientHeight`). |
| `assert_no_overlap` | Checks whether two elements' rendered boxes intersect. |
| `assert_within_parent` | Checks whether an element stays within its parent/an ancestor/the viewport. |
| `search_gameface_docs` | Searches the Gameface RAG documentation corpus (`prompts/rag/`) for guidance relevant to a query. |
| `perf_lint` | Static, deterministic structural check for layout patterns the Gameface docs name as expensive (e.g. `align-items: stretch`, unsized flex items, `display: simple` misuse). No timing involved. |
| `perf_measure` | Injects the fixed frame-timing scenario from `tools/perf/calibrate.js` into the live connection and reports p50/p95/p99 against the recorded baseline in `tools/perf/noise-floor.md`. |
| `perf_profile` | Measures what the UI costs the engine per frame, and stops. No breakdown, no verdict - whether that cost is acceptable is the user's call. |
| `perf_trace` | Per-phase breakdown for an over-budget UI. Requires a budget the user set; returns nothing to act on without one, or when already within budget. |
| `check_memory` | Reads JS heap and GPU texture memory; with a trigger expression, runs a before/after leak test around a forced garbage collection. |
| `get_image_cache_stats` | Reports resident texture memory per image, largest first, in decoded GPU bytes rather than file size. |
| `get_data_binding_models` | Lists the data-binding models the engine holds and reads their live values, tagging each as a JS mock or an engine-side (C++-registered) model. |
| `inspect_data_bindings` | Debugs `data-bind-*` attributes: per-expression current value, type, sync state, and any parse/compile/evaluation error. Sweeps the whole document by default. |
| `set_data_binding_value` | Writes one scalar into a bound model and pushes it to the DOM, to drive the UI through states without the game running. |
| `set_data_binding_model` | Creates a model, or replaces one wholesale, then synchronizes. This is how you stand up mock models with no game attached. |
| `sync_data_binding_models` | Runs a synchronization pass so the DOM catches up with model values, and waits for the engine to confirm it. |

## Performance and memory tools

`perf_lint` finds expensive structure without running anything. `perf_measure`
reports frame-time percentiles observed from JavaScript. `perf_profile` and
`perf_trace` measure engine cost and break it down.

### The budget gate

Trace output has no natural stopping point. There is always a most expensive
phase and always a few percent to shave, so an agent handed a ranked breakdown
and told to make the UI fast will optimise indefinitely against a target nobody
set. How fast is fast enough depends on what else the frame has to do, which is
a decision only the team can make.

So the per-phase data is gated, and the gate is enforced by withholding the
data rather than by asking the agent to hold back:

1. `perf_profile` measures and stops. It returns one number, the UI's engine
   cost per frame, plus how repeatable that number is. No breakdown, no
   ranking, no verdict. There is nothing in its output to optimise toward.
2. Whether that cost is acceptable is put to the user. Where the client
   supports MCP elicitation the question goes through the protocol, which an
   agent cannot answer on the user's behalf. Otherwise the tool hands back a
   message to relay and stops.
3. The answer is stored in `gameface-perf-budget.json` in the project root, a
   file the user owns, can review, edit or delete. Its location is overridable
   with `--perf-budget`. It persists, so the question is asked once per project
   rather than once per conversation.
4. `perf_trace` produces a breakdown only when that file exists **and** the UI
   is over the budget in it. Within budget, it reports that and returns no
   phases. A missing, malformed or non-positive budget unlocks nothing.

If the user declines, nothing further happens. No changes, no suggestions.

### How the trace is measured

`perf_trace` wraps the CDP `Tracing` domain, which Gameface extends with
`getTraceSystemsAndLevels`. The engine emits its own phases into the standard
Chrome trace-event stream as balanced begin/end pairs carrying a frame ID.

Three details shape the numbers:

- **Phases run across several threads**, so begin/end pairing is keyed per
  thread. Styling is not on the advance thread.
- **Phases nest several levels deep.** Ranking on total cost points at the same
  work repeatedly, since `Coherent_Paint`, `Coherent_ExecutePaint`,
  `Coherent_Backend` and `Coherent_BackendExecute` are one hotspot wearing four
  names. Both ranking and the budget total use **self time**, with nested
  children subtracted, so each cost is counted once.
- **The noise floor is measured live**, not read from a committed baseline.
  Each call takes a warmup capture, discards it, then averages several more and
  reports the spread. Repeated captures of an unchanged page vary by up to 20%
  on paint-side phases, so a phase is only marked actionable when it is both
  large enough to close the gap and above its own variance. Re-run after a
  change: a difference smaller than the reported repeatability is not an
  improvement.

Engine cost as a share of the observed frame period is deliberately **not**
reported. Measured on the same page it ranged from 3% to 12% purely on how the
Player was being driven, since frame pacing depends on window focus and on the
debugging connection. Per-frame microseconds transfer between environments;
that ratio does not.

The CDP `Memory` domain is **not implemented** by Gameface — every command in
it, `getDOMCounters` and `prepareForLeakDetection` included, returns "wasn't
found". `Tracing.requestMemoryDump` is accepted but returns nothing, and the
HeapProfiler allocation-tracking event stream never fires. `check_memory` is
built on what does work: `Runtime.getHeapUsage`, `HeapProfiler.collectGarbage`
and the engine's image cache.

Two engine behaviours worth knowing when reading these numbers:

- Image cache sizes are **decoded GPU cost, not file size**. A 424-byte 128×128
  PNG is reported as 65536 bytes, which is its width × height × 4.
- Removing an element from the DOM does **not** release its texture. Images stay
  resident at full size until something calls `clearCachedUnusedImages`, which
  `get_image_cache_stats` exposes as `releaseUnused`. A screen that swaps art
  repeatedly accumulates GPU memory silently.
- Inline `data:` URI and SVG assets are not tracked by the image cache at all,
  so an all-inline page reports zero.

### Stacking contexts in perf_lint

`perf_lint` reports how many elements the engine puts in their own stacking
context and why. Each context is a separate paint grouping, so the count drives
how much the engine can batch.

These rules are **not Chrome's**. They were calibrated by dumping
`CohtmlDebug.dumpStackingContext` against a page isolating each trigger, and
checking the engine's own verdict per element. Cohtml 3.2.0.2 differs from
Chrome in three ways:

- `position: relative` promotes on its own, with no `z-index` needed.
- `overflow: auto` and `overflow: hidden` promote.
- `will-change` and `contain: paint` do **not** promote, though Chrome's rules
  say they should.

Ubiquitous causes (position, overflow) are counted into a summary rather than
raised per element, since flagging every `position: relative` would bury the
output. Only the avoidable, expensive causes — `filter`, `backdrop-filter`,
`mix-blend-mode`, `isolation`, `perspective` — are reported per element.
`contain: paint` is flagged as an ineffective hint. `will-change` is not checked
at all, because Gameface does not expose it: the computed property is undefined,
`getPropertyValue("will-change")` returns empty, and `element.style.willChange`
is undefined even for an inline declaration.

## Data binding tools

The five tools above wrap Gameface's own extensions to the CDP `DOM` domain —
`getDataBindingModelNames`, `getDataBindingModels`, `getDataBindingDataForNode`,
`updateDataBindingValue`, `importDataBindingModels`, plus the
`DOM.dataBindingModelsSynchronized` event. None exist in upstream Chrome, so
they are sent as raw CDP methods through `ConnectionManager.sendRaw()` rather
than through the domain objects `chrome-remote-interface` builds from its
bundled protocol descriptor.

They work the same whether the models come from a JS mock or from the game's
C++ side. A model is reported with `source: "engine"` when the engine knows it
but the page has no global of that name, which is how a C++-registered model
appears; `sync_data_binding_models` lists those as skipped, since the game
drives them itself.

Engine behaviour these tools work around, verified on Cohtml 3.2.0.2:

- `updateDataBindingValue` accepts scalars only. Objects, arrays and `null`
  come back `succeeded: false` and leave the model untouched — use
  `set_data_binding_model` for those.
- Neither a value write nor a model import updates the rendered DOM on its own.
  The DOM only catches up after a synchronization pass, and a value write needs
  its model marked dirty first. Both tools do this by default.
- `engine.updateWholeModel` takes the model **object**; a name string is
  silently ignored.
- `engine.unregisterModel` takes the model object too, and a string argument
  crashes the Player process, so these tools never call it.

## Available resources

- `gameface://code-instructions` — Gameface UI coding constraints (unsupported
  CSS/HTML/JS, negative rules) for code generation.
- `gameface://rag/index` — index of the Gameface documentation topic files.
- `gameface://rag/<file>.md` — one resource per topic file under
  `prompts/rag/` (layout, performance, components, accessibility,
  localization, animations, tooling, etc.).

## Gameface UI Conductor skill

`.claude/skills/gameface-conductor/` runs *before and around* the tools
above: it clarifies unstated requirements for a new UI feature request
(interaction, animation, data/state, scale, accessibility, localization) in
up to three question rounds, gets explicit sign-off on a written spec, then
implements and — if a Gameface MCP connection is available — validates the
result with the assertion/lint/perf tools above before calling it done.

This one set of files is shared across clients, not duplicated per client,
but *how* it gets invoked differs:

| Client | How it's triggered |
|---|---|
| Claude Code | Automatic — matches the skill's `description` against your request, or invoke explicitly with `/gameface-conductor`. |
| GitHub Copilot (VS Code) | Automatic — Copilot's "Agent Skills" scans `.claude/skills/` by default (in addition to `.github/skills/`), so this file is picked up as-is, no extra setup. |
| Gemini CLI | **Explicit only** — Gemini CLI has no auto-triggered skill concept, only user-invoked custom commands. Run `/gameface-conductor <your request>`; `.gemini/commands/gameface-conductor.toml` embeds the same `SKILL.md` and `dimensions.md` content via `@{...}` file injection rather than duplicating it. |

Because the same file is read by more than one host, its wording avoids
naming host-specific tools (no literal `TodoWrite`/`AskUserQuestion`
references) in favor of generic instructions ("track this explicitly",
"ask as one batch") that each host can fulfill with whatever it has.

I haven't been able to verify the Gemini CLI path against a live session —
the TOML file is structurally valid and the `@{...}` file-injection syntax
matches Gemini CLI's documented custom-commands format, but I'd treat it as
unverified until someone runs `/gameface-conductor` for real.

## Performance tooling

- `tools/perf/calibrate.js` — the fixed, page-agnostic frame-timing scenario
  used both by `perf_measure` (against a live connection) and by the
  standalone calibration script below (against a freshly booted Player).
- `tools/perf/noise-floor.md` — the recorded baseline: p50/p95/p99 across 5
  runs of 600 frames (120 discarded as warmup) at 1920x1080, Player
  restarted between runs. `perf_measure` compares new readings against this.
- `scripts/measure-frame-noise-floor.mjs` — regenerates the above. Boots
  Player fresh per run (not via the MCP connection, so it needs its own path
  to Player.exe — reads `~/.gameface-mcp/config.json` the same way the
  server does, or pass `--browser-executable <path>` to override):
  ```bash
  node scripts/measure-frame-noise-floor.mjs --runs 5 --frames 600 --warmup 120
  ```

## Version awareness

This server talks to Gameface over CDP, and CDP support has changed across
Gameface/Cohtml versions — some commands this server depends on behave
differently, or aren't available, on older builds. `launch_browser`,
`connect_browser`, and `gameface_get_status` all report the connected
`cohtmlVersion` (parsed from `navigator.userAgent`), plus a `versionWarning`
when it's below `MIN_RECOMMENDED_COHTML_VERSION` (currently `3.1.2`, per a
user report that this version introduced additional CDP protocol support and
fixes). `perf_measure` similarly reports `cohtmlVersionMatchesBaseline`
against whatever version `tools/perf/noise-floor.md` was last calibrated
against, the same way it flags a resolution mismatch.

**This is a floor, not a guarantee.** Meeting it doesn't mean every tool is
unaffected by every CDP quirk — our own dev SDK (3.2.0.2, comfortably above
the floor) still has real ones, found and worked around:
- `DOM.resolveNode` (both by `nodeId` and `backendNodeId`) returns an empty
  `{}` — no error, just nothing usable — rather than a JS object reference.
- `DOM.setAttributeValue` silently no-ops: it doesn't throw, but the
  mutation never reaches the CDP-tracked tree or the live DOM.
- `DOM.performSearch` (what `search_dom` uses) never returns a `searchId`.

`assert_text_fits`/`assert_no_overlap`/`assert_within_parent` work around the
first two by resolving a `nodeId` to a live element via `DOM.getBoxModel`
(confirmed working) plus `document.elementFromPoint` at its center (see the
comments in `src/tools/assertions.ts`) — `search_dom` doesn't have an
equivalent fix yet. None of this is likely to be an exhaustive list; treat it
as what's been verified so far, not a guarantee of what hasn't been hit.

## Notes

- stdout is reserved for MCP protocol traffic — all logging goes to stderr.
- The server maintains a single browser/connection at a time; `launch_browser`
  and `connect_browser` actively verify a tracked process/connection is
  still alive before refusing to start a new one, so a manually-closed
  Player won't leave the server stuck thinking it's still connected.
