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

- Node.js 20+.
- A local Gameface/Cohtml SDK install with a Player executable. This repo
  does not ship one — you need your own Gameface license/SDK. On Windows
  that's typically `.../Player/Player.exe` inside your SDK's install
  directory (note: `Player.exe` usually lives in a `Player` *subfolder*
  under the SDK root, not at the SDK root itself).

## Quick start

1. Install the server for every project on your machine:
   ```bash
   npx add-mcp "npx -y gameface-mcp@latest" --name gameface -g
   ```
2. Optionally, install the [Gameface UI Conductor skill](#gameface-ui-conductor-skill):
   ```bash
   npx skills add CoherentLabs/Gameface-MCP --agent claude-code -g
   ```
3. Start your agent and ask it to launch the Gameface Player. The first time,
   the server asks you where your Player is — see [Player setup](#player-setup).

## Installation

**Install it once — globally or per project, never both under the same
name.** MCP clients identify servers by name, so a project entry called
`gameface` doesn't add to a global one called `gameface`, it competes with
it: only one of them runs, and its arguments are never merged with the
other's.

### With add-mcp (recommended)

[`add-mcp`](https://www.npmjs.com/package/add-mcp) detects which agents you
use and writes the server into each one's config:

```bash
# Every project on this machine
npx add-mcp "npx -y gameface-mcp@latest" --name gameface -g

# This project only - run it from the project folder
npx add-mcp "npx -y gameface-mcp@latest" --name gameface
```

Server flags go inside the quoted command, after the package name:

```bash
npx add-mcp "npx -y gameface-mcp@latest --port 9445" --name gameface -g
```

Flags override the config file (see [Command-line flags](#command-line-flags)),
so only pass `--browser-executable` here if you want this install pinned to
one Player. Otherwise leave the Player to [Player setup](#player-setup).

### Manually, per client

The command is the same in every client: `npx -y gameface-mcp`. Only the
config file location and its top-level key (`mcpServers` or `servers`) change.

#### Claude Code

```bash
claude mcp add -s user gameface -- npx -y gameface-mcp
```

`-s user` installs it for every project; `-s project` writes it to the
project's `.mcp.json` instead. Or write `.mcp.json` at your project root by hand:

```json
{
  "mcpServers": {
    "gameface": {
      "command": "npx",
      "args": ["-y", "gameface-mcp"]
    }
  }
}
```

#### VS Code (GitHub Copilot / MCP extension)

`.vscode/mcp.json` at your project root:

```json
{
  "servers": {
    "gameface": {
      "command": "npx",
      "args": ["-y", "gameface-mcp"]
    }
  }
}
```

Note the key is `servers`, not `mcpServers` — copying a config from another
client without changing this key is the most common mistake here.

#### Gemini CLI

`.gemini/settings.json` (project-level) or `~/.gemini/settings.json`
(user-level, applies to every project):

```json
{
  "mcpServers": {
    "gameface": {
      "command": "npx",
      "args": ["-y", "gameface-mcp"],
      "timeout": 90000,
      "trust": false
    }
  }
}
```

Keep the timeout generous: the automatic Player search can take up to a
minute, plus however long you take to answer its prompts, all inside one
tool call.

#### Claude Desktop

`claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`, Windows:
`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gameface": {
      "command": "npx",
      "args": ["-y", "gameface-mcp"]
    }
  }
}
```

### Command-line flags

Optional flags that override the [config file](#player-setup) for a single
install. Add them to the `args` in your client's MCP config, after
`gameface-mcp`:

```json
"args": ["-y", "gameface-mcp", "--port", "9445"]
```

Precedence, lowest to highest: built-in defaults → config file → flags.

| Flag | Short | Meaning | Default |
|---|---|---|---|
| `--browser-executable <path>` | `-b` | Path to Player.exe | the config file's `browserExecutable` |
| `--browser-args <args>` | `-a` | Comma-separated extra CLI args passed to Player | none |
| `--port <port>` | `-p` | CDP remote-debugging port | `9444` |
| `--cdp-host <host>` | `-h` | Host for the CDP connection | `localhost` |
| `--config <path>` | `-c` | Path to the JSON config file | `~/.gameface-mcp/config.json` |
| `--perf-budget <path>` | | Path to this project's performance budget file | `./gameface-perf-budget.json` |
| `--help` | | Print this list | |

### The Conductor skill (optional)

The [Gameface UI Conductor skill](#gameface-ui-conductor-skill) is **not**
part of the npm package; install it separately:

```bash
npx skills add CoherentLabs/Gameface-MCP --agent claude-code
```

This copies it into the project's `.claude/skills/`; add `-g` to install it
into `~/.claude/skills/` instead, for every project. Pass `--agent`
explicitly: without it, the interactive picker installs into the shared
`.agents/skills/` folder, which Claude Code doesn't read. Start a new session
afterwards.

## Player setup

The Player location is per machine, so it's stored in one file in your home
folder rather than in each project's MCP config. Set it up yourself, or let the
agent do it.

### Where it's stored

`~/.gameface-mcp/config.json` (`%USERPROFILE%\.gameface-mcp\config.json` on
Windows). Only this location is read by default.

| Field | Meaning | Default |
|---|---|---|
| `browserExecutable` | The default Player — the one every plain launch starts. | none |
| `players` | Other Players, offered when you pick one at launch. | `[]` |
| `browserArgs` | Extra args passed to Player on every launch. | `[]` |
| `port` | CDP remote-debugging port. | `9444` |
| `cdpHost` | Host for the CDP connection. | `localhost` |
| `perfBudgetFile` | Path to the performance budget file. | `./gameface-perf-budget.json` |

### Letting the agent set it up

Ask the agent to launch the Player. If none is configured yet, it asks for the
path (a `Player.exe`, its folder, or your SDK folder all work) or can search
your machine for you. The search runs as a script inside the server, so the AI
only sees the list of Players found, not your files. 

If the config file doesn't exist yet, the agent creates it with the defaults from the
[example below](#setting-it-up-yourself).

To add Players or change the default later, use the [commands](#commands)
`change-player-path`, `scan-players` and `add-player`. `add-player` also
accepts a folder and adds every Player in it.

### Setting it up yourself

Create `~/.gameface-mcp/config.json`:

```json
{
  "browserExecutable": "D:/path/to/your/sdk/Player/Player.exe",
  "players": [
    "D:/Players/Cohtml-3.2.0.52-Public-Player/Player.exe",
    "D:/Players/Cohtml-3.1.2.1-Public-Player/Player.exe"
  ],
  "browserArgs": ["--enable-gui=false"],
  "port": 9444,
  "cdpHost": "localhost"
}
```

Every field is optional. Point at a different file with `-c`/`--config <path>`
if you want more than one profile.

## Commands

Shortcuts for common tasks, so you can launch and manage Players without
spelling out the request to the agent each time. For example,
`launch-player true` lets you pick any of your Players, sorted by version, to
launch.

| Command | Arguments | Example values | What it does |
|---|---|---|---|
| `launch-player` | `[url] [pick]` | `url`: `http://localhost:3000`<br>`pick`: `true` | Launches your default Player, optionally opening `url`. With `pick` set to `true`, you choose from all your Players first. |
| `change-player-path` | `[auto]` | `auto`: `true` | Changes your default Player. Asks for the path, or with `true`, searches the machine. |
| `scan-players` | | | Searches the machine and adds every Player found. Doesn't change the default. |
| `add-player` | | | Adds Players by path, or every Player in a folder. No scan. |

Commands are MCP prompts, which your client shows as slash commands. In Claude
Code that's `/mcp__<server name>__<command>`, e.g.
`/mcp__gameface__launch-player`. Arguments are positional, and `true`, `yes`,
`y` and `1` all count as yes.

Under the hood, a command sends a fixed request to the agent, which calls the
[tools](#available-tools), so it still uses tokens like any other request.

## Available tools

| Tool | What it does |
|---|---|
| `launch_browser` | Launches Player with remote debugging enabled. Refuses and kills anything that isn't Gameface Player. Starts the default Player unless given `executablePath`; with `choosePlayer: true`, you pick from your Players first. With no default set, offers your Players list, or points to `set_player_path` when it's empty. |
| `set_player_path` | Saves the default Player to the config file, creating it if needed. With no arguments, asks you for the path (see [Player setup](#letting-the-agent-set-it-up)); `search: true` searches the machine for it. |
| `add_players` | Adds Players to the `players` list without changing the default: from `paths`, from a machine search (`search: true`), or by asking you. |
| `connect_browser` | Connects to an already-running, debuggable Player instance. Same Gameface-only guard. |
| `gameface_get_status` | Reports current connection status. |
| `gameface_restart` | Disconnects, closes, relaunches, and reconnects using the last-used launch/connect parameters. |
| `navigate` | Navigates the connected view to a different URL. |
| `get_dom_tree` | Snapshot of the DOM tree (node IDs, names, attributes, children). |
| `search_dom` | Searches the DOM for nodes matching a text or XPath query. |
| `get_computed_styles` | Computed CSS styles for a given node. |
| `interact_element` | Click, type, hover, focus, scrollIntoView, or touch on an element. |
| `take_screenshot` | Captures the viewport, or a custom clip rect inside it, as an image. Gameface can't capture outside the viewport, so `fullPage` only adds a note when part of the page is off-screen. |
| `eval_js` | Executes arbitrary JavaScript in the connected page and returns the result. |
| `get_console_logs` | Buffered console messages and Log-domain entries (errors, warnings, deprecations). |
| `assert_text_fits` | Checks whether an element's content overflows its own box (`scrollWidth`/`scrollHeight` vs `clientWidth`/`clientHeight`). |
| `assert_no_overlap` | Checks whether two elements' rendered boxes intersect. |
| `assert_within_parent` | Checks whether an element stays within its parent/an ancestor/the viewport. |
| `search_gameface_docs` | Searches the Gameface RAG documentation corpus (`prompts/rag/`) for guidance relevant to a query. |
| `get_code_instructions` | Returns the Gameface UI coding constraints - same content as the `gameface://code-instructions` resource, for agents that can't read resources (e.g. subagents with an explicit `tools` list). |
| `perf_lint` | Static, deterministic structural check for layout patterns the Gameface docs name as expensive (e.g. `align-items: stretch`, unsized flex items, `display: simple` misuse). No timing involved. |
| `perf_measure` | Injects the fixed frame-timing scenario from `tools/perf/calibrate.js` into the live connection and reports p50/p95/p99 against this machine's noise floor. Asks for `perf_calibrate` first when none is saved. |
| `perf_calibrate` | Records this machine's noise floor (separate Player, several runs) and saves it to `~/.gameface-mcp/noise-floor.json`. |
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

It's only available where it's installed — see
[The Conductor skill](#the-conductor-skill-optional) for installing it into
your own projects; inside a clone of this repo it's picked up as-is.

This one set of files is shared across clients, not duplicated per client,
but *how* it gets invoked differs:

| Client | How it's triggered |
|---|---|
| Claude Code | Automatic — matches the skill's `description` against your request, or invoke explicitly with `/gameface-conductor`. |
| GitHub Copilot (VS Code) | Automatic — Copilot's "Agent Skills" scans `.claude/skills/` by default (in addition to `.github/skills/`), so this file is picked up as-is, no extra setup. |
| Gemini CLI | **Explicit only** — Gemini CLI has no auto-triggered skill concept, only user-invoked custom commands. Run `/gameface-conductor <your request>`; `.gemini/commands/gameface-conductor.toml` embeds the same `SKILL.md` and `dimensions.md` content via `@{...}` file injection rather than duplicating it. Those paths are relative to this repo, so this only works inside a clone of it. |

Because the same file is read by more than one host, its wording avoids
naming host-specific tools (no literal `TodoWrite`/`AskUserQuestion`
references) in favor of generic instructions ("track this explicitly",
"ask as one batch") that each host can fulfill with whatever it has.

I haven't been able to verify the Gemini CLI path against a live session —
the TOML file is structurally valid and the `@{...}` file-injection syntax
matches Gemini CLI's documented custom-commands format, but I'd treat it as
unverified until someone runs `/gameface-conductor` for real.

## Performance tooling

`perf_measure` compares frame times against a **noise floor recorded on your
machine**. Idle frame times follow the display's refresh rate, so a floor from
another machine says nothing: on a 120 Hz display every reading sits far below
one recorded at 30 Hz, however slow the UI is.

- **First use.** With no floor saved, `perf_measure` measures nothing and
  returns `needsCalibration: true`. The agent then tells you, runs
  `perf_calibrate`, and measures again. Calibration starts a separate Player
  window several times (5 runs of 600 frames, about a minute or two) using the
  Player you launched, at the live viewport size. Your own Player and
  connection are left alone.
- **Where it's kept.** `~/.gameface-mcp/noise-floor.json`, next to
  `config.json` (or next to the file passed with `--config`). It holds p50,
  p95 and p99 across the runs plus the display's frame period, resolution and
  Cohtml version. Delete it to start over.
- **When it stops matching.** `perf_measure` reports
  `framePeriodMatchesBaseline`, `resolutionMatchesBaseline` and
  `cohtmlVersionMatchesBaseline`, and adds a `warning` suggesting
  `perf_calibrate` when one is off. On a faster display than the floor's, it
  also omits `withinNoiseFloor`, since readings aren't comparable.
- `tools/perf/calibrate.js` is the fixed, page-agnostic scenario both tools
  inject, so the two are measured the same way.
- From a clone, `scripts/measure-frame-noise-floor.mjs` does the same as
  `perf_calibrate` from the command line (needs `npm run build`; the Player
  comes from `--browser-executable` or `~/.gameface-mcp/config.json`):
  ```bash
  node scripts/measure-frame-noise-floor.mjs --runs 5 --frames 600 --warmup 120
  ```

Some clients cut off tool calls after a fixed time. `perf_calibrate` sends a
progress notification after each run, which keeps clients that support them
waiting. If yours doesn't, raise its tool timeout or pass fewer `runs`.

## Version awareness

This server talks to Gameface over CDP, and CDP support has changed across
Gameface/Cohtml versions — some commands this server depends on behave
differently, or aren't available, on older builds. `launch_browser`,
`connect_browser`, and `gameface_get_status` all report the connected
`cohtmlVersion` (parsed from `navigator.userAgent`), plus a `versionWarning`
when it's below `MIN_RECOMMENDED_COHTML_VERSION` (currently `3.1.2`, per a
user report that this version introduced additional CDP protocol support and
fixes). `perf_measure` similarly reports `cohtmlVersionMatchesBaseline`
against the version this machine's noise floor was recorded with, the same
way it flags a resolution mismatch.

**This is a floor, not a guarantee.** Meeting it doesn't mean every tool is
unaffected by every CDP quirk — our own dev SDK (3.2.0.2, comfortably above
the floor) still has real ones, found and worked around:
- `DOM.resolveNode` (both by `nodeId` and `backendNodeId`) returns an empty
  `{}` — no error, just nothing usable — rather than a JS object reference.
- `DOM.setAttributeValue` silently no-ops: it doesn't throw, but the
  mutation never reaches the CDP-tracked tree or the live DOM.
- `DOM.performSearch` (what `search_dom` uses) never returns a `searchId`.

`assert_text_fits`/`assert_no_overlap`/`assert_within_parent` work around the
first two by locating the `nodeId` in the `DOM.getDocument` tree and walking
the same element-child path in JS (see the comments in
`src/tools/assertions.ts`), so they work on any element in the tree —
containers, covered elements, and transformed elements included —
`search_dom` doesn't have an equivalent fix yet. None of this is likely to be an exhaustive list; treat it
as what's been verified so far, not a guarantee of what hasn't been hit.

## Troubleshooting

- **"Conflicting scopes" warning in Claude Code** — `gameface` is installed
  both globally and in the project, and only one runs. Remove one with
  `claude mcp remove gameface -s user` or `-s project`.
- **The server doesn't start on Windows** — some clients can't run `npx`
  directly. Wrap it: `"command": "cmd", "args": ["/c", "npx", "-y", "gameface-mcp"]`.
- **An update doesn't show up** — `npx` caches installs. Use
  `gameface-mcp@latest`, or delete `%LocalAppData%\npm-cache\_npx` and
  restart the client.
- **A launch result has a `notice` about `--browser-executable`** — the flag in
  your MCP client config points to a missing file and is being ignored. Fix or
  remove it.
- **The Player search gets cut off** — your client's tool timeout is shorter
  than the search (up to 60 seconds, plus your answers). Raise it, as in the
  [Gemini CLI](#gemini-cli) example.

## Development

```bash
git clone https://github.com/CoherentLabs/Gameface-MCP.git
cd Gameface-MCP
npm install
npm run build
```

`npm run build` compiles `src/` to `build/index.js`, the server's entry point.
`npm run watch` recompiles on change. The repo's `.vscode/mcp.json` runs
`node build/index.js`, so opening the repo in VS Code uses your local build.

### Testing in another project

Two ways to run your local build from a different project:

**Global link** — fast iteration, no repacking:

```bash
npm link
npx add-mcp "gameface-mcp" --name gameface -g
```

`npm link` makes `gameface-mcp` a global command pointing at your clone, so
`npm run build` is all it takes to pick up changes (restart the client).
Undo it with `npm unlink -g gameface-mcp`.

**Pack** — tests the package exactly as npm would publish it:

```bash
npm pack
npx add-mcp "npx -y C:/absolute/path/to/Gameface-MCP/gameface-mcp-<version>.tgz" --name gameface -g
```

Use an absolute path, since the client starts the server from its own working
folder. After repacking with the same version, delete
`%LocalAppData%\npm-cache\_npx`, or `npx` keeps running the old copy.

## Notes

- stdout is reserved for MCP protocol traffic — all logging goes to stderr.
- The server maintains a single browser/connection at a time — picking a
  Player at launch chooses *which* one runs, not how many. `launch_browser`
  and `connect_browser` actively verify a tracked process/connection is
  still alive before refusing to start a new one, so a manually-closed
  Player won't leave the server stuck thinking it's still connected.
