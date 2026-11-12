# Tooling
<!-- SOURCE FILES: working-separately-from-the-game.mdx, debugging-tools.mdx, ui-testing.mdx, custom-tools.mdx, performance-and-memory-profiling.mdx, setting-up-the-gameface-stack.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: high] [SOURCE: working-separately-from-the-game.mdx]
## Standalone Workflow: Player + DevTools Inspector

Gameface development does not require running a full game engine during UI development. Use two standalone tools:

- **Gameface Player (`GamefacePlayer.exe`)** — renders HTML, CSS, and JavaScript exactly as the game engine would, with HMR support for live iteration.
- **DevTools Inspector (F12 or right-click → "Inspect")** — a Chrome DevTools-compatible debugger opened as a separate window. Supports live CSS editing, DOM inspection, JavaScript console, Sources breakpoints, and Network monitoring.

This separation means UI developers can polish, debug, and iterate without involving a gameplay programmer or waiting for a full engine compile.

---

---
[TOPIC: tooling] [TYPE: api] [SEVERITY: high] [SOURCE: debugging-tools.mdx]
## DevTools Panels and What to Use Them For

| Panel | Use |
|---|---|
| **Elements** | Live DOM tree, active CSS rules, inline edit. Fastest way to test CSS changes. |
| **Console** | JavaScript errors and logs. Type commands to trigger UI events manually. |
| **Sources** | Set breakpoints, step through JS logic. |
| **Network** | See all loaded assets (fonts, images, JS, CSS). Identify missing files (404s). |
| **Performance** | Record traces, view frame phases (`SolveFlexLayout`, `UpdateNodeTransforms`, `RecalcVisualStyle`), identify layout/paint hotspots. |

---

---
[TOPIC: tooling] [TYPE: pattern] [SEVERITY: high] [SOURCE: debugging-tools.mdx]
## VS Code Integration: launch.json for Debugging

Attach VS Code's debugger to Gameface for breakpoint debugging with TypeScript source maps. The `coui://` protocol requires an inline source map workaround — use `sourceRoot` in your bundler config to map `coui://` URLs back to local file paths.

```json
// .vscode/launch.json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "chrome",
            "request": "attach",
            "name": "Attach to Gameface",
            "port": 9222,
            "webRoot": "${workspaceFolder}/src",
            "sourceMapPathOverrides": {
                "coui://uiresources/*": "${workspaceFolder}/src/*"
            }
        }
    ]
}
```

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: high] [SOURCE: custom-tools.mdx]
## Cohtml Panel: Paint Flashing and Redraw Flashing

The **Cohtml panel** (a Gameface-specific DevTools tab) provides two GPU debugging overlays:

- **Paint Flashing:** Highlights elements that are being repainted on the current frame in red. Every frame in which a repainting element flashes red is a frame where that element's texture is being reconstructed on the GPU. Constant flashing = unintended repaint trigger.
- **Redraw Flashing:** Highlights the complete screen regions being redrawn. Shows the cost of `backdrop-filter`, compositing, and damage regions.

Use these before profiling — a constant flash on a supposedly static UI element reveals a CSS property causing unintended layout or repaint.

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: high] [SOURCE: custom-tools.mdx]
## Data Binding Inspector: Debugging Bound Attributes

When an element is selected in the Elements panel, the **Data Bind tab** shows:

- All active `data-bind-*` attributes on the element.
- The evaluated expression (current value) for each binding.
- Any binding errors (undefined model, type mismatch, parse failure).
- The full evaluation trace (helpful for nested model paths).

This is the primary tool for diagnosing why a bound value is not updating — distinguishing between engine-side model issues (the C++ hasn't pushed the value) and binding expression issues (the path is misspelled or the model is not registered).

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: medium] [SOURCE: custom-tools.mdx]
## Data Binding Models Panel: Inspecting and Editing Models

The **Data Binding Models panel** (a standalone panel, separate from Elements) shows all currently registered binding models by name. From this panel:

- View the full JSON structure of any model.
- **Edit values directly** in the panel UI — changes push into the live binding system immediately, updating the DOM without touching code.
- **Export** the current model state to a JSON file for use as mock data.
- **Load** a previously exported JSON back in to restore a specific model state.

Use this panel to reproduce binding bugs without having to reproduce the exact game state that caused them.

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: medium] [SOURCE: performance-and-memory-profiling.mdx]
## Performance Tab: Reading Gameface Timeline Markers

Start a recording in the Performance panel, interact with the UI, then stop. The trace shows three Gameface-specific phases per frame:

- **Advance:** JavaScript execution, CSS animation ticking, style recalculations.
- **Layout:** `SolveFlexLayout` (full Yoga pass) and `UpdateNodeTransforms` (transform-only update).
- **Displaying/Painting:** `Record Rendering`, `Draw Stacking Context`, `Batch Commands`, `Process Layer`.

A frame with a tall `SolveFlexLayout` bar indicates layout thrash — review the CSS patterns from the layout performance chunk. A frame with tall `RecalcVisualStyle` indicates excessive style invalidation.

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: medium] [SOURCE: performance-and-memory-profiling.mdx]
## Tracking Texture Thrashing with Memory Counters

The Cohtml panel's memory counters track GPU texture allocations over time. A chart that continuously rises and drops (a "sawtooth" pattern) indicates **texture thrashing** — textures being created and destroyed repeatedly.

Common causes: sprite sheet frames being loaded as separate images instead of a single sheet; DOM nodes being `remove()`d and recreated rather than pooled; `background-image` URLs with dynamic query strings generating a new cache key each frame.

Use the **object creation markers** in the Performance tab alongside the memory counters to find which line of JavaScript correlates with texture allocation spikes.

---

---
[TOPIC: tooling] [TYPE: concept] [SEVERITY: high] [SOURCE: ui-testing.mdx]
## gameface-e2e: Why Standard Test Frameworks Don't Work

Cypress and Playwright cannot connect to Gameface because they require a Chrome/Electron browser process. Gameface is an embedded C++ renderer — it has no standard DevTools Protocol endpoint that Playwright/Cypress can target in the standard way.

The `gameface-e2e` framework solves this with a custom test runner that connects to the Gameface DevTools endpoint and drives the UI programmatically.

Install, then run the `.spec` files (mocha `describe`/`it`) against the Player:
```bash
npm install gameface-e2e --save-dev
npx gameface-e2e --gamefacePath=path/to/Player.exe --tests=tests/**/*.spec.js
```

---

---
[TOPIC: tooling] [TYPE: api] [SEVERITY: high] [SOURCE: ui-testing.mdx]
## gameface-e2e: Writing Tests with the gf Object

Tests use the `gf` global. `gf.get(selector)` returns a `DOMElement` for clicking, focusing and assertions; `gf.click(selector)`, `gf.keyPress(key)` and `gf.navigate(url)` act on the page directly. The `element.waitFor*` methods (`waitForText`, `waitForClasses`, `waitForAttributes`, `waitForStyles`, `waitForVisibility`, ...) retry until the state matches, resolve to `true`, and throw on timeout:

```javascript
describe('Inventory Panel', function () {
    it('equips item on confirm press', async () => {
        const slot = await gf.get('.inventory-slot:first-child');
        await slot.focus();
        await gf.keyPress(13); // Enter: a key code, or a gf.KEYS entry

        const status = await gf.get('.equip-status');
        assert(await status.waitForText('Equipped'));
        assert(await slot.waitForClasses(['equipped']));
    });
});
```

Clicking on text elements isn't supported: click the element that contains the text.

---

---
[TOPIC: tooling] [TYPE: api] [SEVERITY: high] [SOURCE: ui-testing.mdx]
## gameface-e2e: Mocking Engine Data and Events

The test framework provides helpers to create and update data-binding models and simulate engine events without a running game:

```javascript
describe('HUD', function () {
    const PlayerModel = { health: 15, ammo: 0 };

    this.beforeAll(async () => {
        await gf.navigate('./hud.html');
        await gf.createModel('PlayerModel', PlayerModel);
    });

    it('shows the death screen', async () => {
        // Changes go inside the function; it calls updateWholeModel + synchronizeModels for you
        await gf.updateModel('PlayerModel', (health) => { PlayerModel.health = health; }, 0);

        // Simulate an engine event the UI listens for (engine.on)
        await gf.triggerEngineEvent('PlayerDied', { cause: 'fall' });

        assert(await gf.isVisible('.death-screen'));
    });
});
```

---

---
[TOPIC: tooling] [TYPE: api] [SEVERITY: medium] [SOURCE: ui-testing.mdx]
## gameface-e2e: Gamepad Input Simulation

Connect a virtual gamepad with `gf.connectGamepad(id)` (it returns a `GamefaceGamepad`), then press, hold or release buttons and move the sticks. Button ids are in `gf.GAMEPAD_BUTTONS`:

```javascript
const GAMEPAD_ID = 'test-pad';

describe('Menu navigation', function () {
    before(async () => { await gf.connectGamepad(GAMEPAD_ID); });
    after(async () => { await gf.disconnectGamepad(GAMEPAD_ID); });

    it('moves focus down and confirms', async () => {
        const gamepad = gf.getGamepad(GAMEPAD_ID);
        await gamepad.press(gf.GAMEPAD_BUTTONS.PAD_DOWN);          // press and release
        await gamepad.press(gf.GAMEPAD_BUTTONS.FACE_BUTTON_DOWN);  // A / Cross

        const next = await gf.get('.next-menu-item');
        assert.equal(await next.isFocused(), true);
    });
});
```

`gamepad.press([a, b])` presses several buttons together; `hold`, `release`, `sequence`, `moveLeftStick` and `moveRightStick` cover the rest.

---

## #TODO — Partial coverage
The following sub-topics from this category were not found in any MDX source:
- ESLint rules specific to Gameface (custom ruleset package name, installation, rule list)
- Static linter for Gameface: whether there is a CSS linter that validates against Gameface CSS support matrix
- Gameface Player CLI flags: full flag reference beyond `--url`
- gameface-e2e configuration file format: how to set up the test runner, connect to the Player, configure timeouts (the official frontend-tools docs cover it)
