# Engine Bridge
<!-- SOURCE FILES: core-concepts-and-information-flow.mdx, engine-communication.mdx, mocking-data.mdx, data-binding-basics.mdx, structural-data-binding.mdx, custom-data-bind-attribute.mdx, observable-models-and-virtual-lists.mdx, local-vs-game-state.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: engine-bridge] [TYPE: concept] [SEVERITY: critical] [SOURCE: core-concepts-and-information-flow.mdx]
## The Push Model: How Data Flows from Engine to UI

Gameface operates on a **push model** rather than the fetch/request-response cycle of web apps. The C++ game engine runs at 60+ FPS and continuously pushes state updates to the UI via data-binding. The frontend should act as a passive renderer of that state — it never calculates damage, sorts arrays, or requests data. When engine data changes, bound DOM elements update automatically.

The practical rule: keep your UI "dumb." All heavy logic, math, and data transformation happen on the engine side. JavaScript in the UI is reserved for managing pure UI interactions like opening dropdowns or triggering CSS animations.

---

---
[TOPIC: engine-bridge] [TYPE: concept] [SEVERITY: critical] [SOURCE: core-concepts-and-information-flow.mdx]
## Views: Structuring Your HTML Documents

In Gameface terminology, each loaded HTML page is a **View**. Common view types: **Menu** (main nav hubs like Start, Settings, Inventory), **HUD** (persistent on-screen elements like health bars and crosshairs), **Spatial/Diegetic** (UI inside the 3D world like terminal screens), and **Meta** (2D overlays like subtitles).

Minimize the number of views — loading a new view from scratch is much heavier than updating an existing one. Build complex screens as Single Page Applications with a router, swapping panels without spinning up a new HTML document. Keep your HUD as a single, highly optimized file; show/hide widgets via data-binding rather than separate views.

> ⚠️ GAMEFACE CONSTRAINT: `data-bind-if` physically mounts/unmounts nodes — use it for infrequently visited screens; for rapidly-toggled HUD elements prefer `opacity`/`display` toggling to avoid repeated DOM mutations.

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: critical] [SOURCE: engine-communication.mdx]
## The cohtml.js Bridge and engine.whenReady

`cohtml.js` is the mandatory JavaScript library that exposes the global `engine` object bridging HTML/JS and the C++ backend. Always wrap initialization inside `engine.whenReady.then(() => { ... })` — this is a Promise and the officially recommended approach over `engine.on('Ready')`. Attempting to communicate with the engine before the view is ready is a common source of silent bugs where bindings or events never fire.

```javascript
engine.whenReady.then(() => {
    // Safe to use engine APIs here
    engine.on('PlayerDataUpdated', (data) => {
        console.log(data.health);
    });
});
```

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: high] [SOURCE: engine-communication.mdx]
## engine.on / engine.off — Listening for Engine Events

Use `engine.on('EventName', callback)` to subscribe to events pushed by the C++ engine. Always clean up with `engine.off('EventName', callback)` when the listener is no longer needed to prevent memory leaks in long-lived views.

```javascript
function onHealthChanged(health) {
    updateHealthBar(health);
}

engine.on('HealthChanged', onHealthChanged);

// Later, when the view component is destroyed:
engine.off('HealthChanged', onHealthChanged);
```

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: high] [SOURCE: engine-communication.mdx]
## engine.trigger vs engine.call — Sending Data to the Engine

`engine.trigger('EventName', data)` is fire-and-forget: send data to the game (e.g., "Quit Button Clicked") without expecting a response.

`engine.call('EventName', data).then(callback)` is for querying the engine and waiting for a C++ promise to resolve (e.g., requesting a player's saved name or checking if running in-game).

```javascript
// Fire-and-forget: tell the engine a button was pressed
engine.trigger('QuitButtonClicked');

// Request-response: ask the engine for the player name
engine.call('GetPlayerName').then((name) => {
    document.getElementById('player-name').textContent = name;
});
```

---

---
[TOPIC: engine-bridge] [TYPE: pattern] [SEVERITY: high] [SOURCE: mocking-data.mdx]
## Mocking Data Models During Development

Frontend developers can iterate without a running game engine by creating mock models in JavaScript. Use `engine.createJSModel("ModelName", initialData)` to register a model. Then call `engine.updateWholeModel("ModelName")` followed by `engine.synchronizeModels()` to force the DOM to reflect changes.

Use `engine.call("runningInGame")` inside `engine.whenReady` to auto-detect whether you are running in a browser/Player or in the actual game, and enable mocks only when outside the game.

```javascript
engine.whenReady.then(() => {
    engine.call("runningInGame").then((inGame) => {
        if (!inGame) {
            engine.createJSModel("PlayerModel", { health: 100, ammo: 24 });
            engine.updateWholeModel("PlayerModel");
            engine.synchronizeModels();
        }
    });
});
```

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: high] [SOURCE: mocking-data.mdx]
## engine.updateWholeModel and engine.synchronizeModels

In a real game, C++ pushes binding updates automatically each frame. When mocking in JavaScript, you must manually trigger two calls after changing model data:

1. `engine.updateWholeModel("ModelName")` — marks the model as dirty and queues it for DOM synchronization.
2. `engine.synchronizeModels()` — executes the synchronization pass, updating all bound DOM elements.

Calling only one of these will leave the UI out of sync with the model data.

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: medium] [SOURCE: data-binding-basics.mdx]
## data-bind-* Attribute Syntax

Gameface's declarative binding uses double-curly-brace syntax `{{model.property}}` inside `data-bind-*` HTML attributes. Key attribute families:

- `data-bind-value="{{Player.health}}"` — sets the element's text content
- `data-bind-html="{{Player.tooltip}}"` — sets innerHTML (for rich formatted strings)
- `data-bind-style-width="{{Player.health}}"` — sets an inline CSS property (numeric values default to `px`)
- `data-bind-class-toggle="is-danger: {{Player.hasLowHealth}}"` — conditionally adds/removes a CSS class based on a boolean

```html
<div data-bind-value="{{Player.health}}"></div>
<div class="health-bar__fill" data-bind-style-width="{{Player.health}}"></div>
<div data-bind-class-toggle="low-health: {{Player.hasLowHealth}}"></div>
```

> ⚠️ GAMEFACE CONSTRAINT: Standard CSS `display: inline-block` and `display: grid` are not supported; bind-driven element visibility must use `display: none`/`flex` or `opacity`.

---

---
[TOPIC: engine-bridge] [TYPE: pattern] [SEVERITY: high] [SOURCE: structural-data-binding.mdx]
## Structural Binding: data-bind-if and data-bind-for

`data-bind-if="{{model.isVisible}}"` conditionally mounts or unmounts the element from the DOM based on the boolean value. This eliminates the element's layout cost when hidden.

`data-bind-for="item in {{model.items}}"` iterates over an array to generate repeated elements. The loop variable is available inside the element's scope.

**Critical gotcha:** Do not modify DOM elements generated by `data-bind-for` via JavaScript after they are rendered. If the underlying collection's size changes, the binding system reconciles the DOM from scratch and any manual JS changes are lost, potentially causing undefined behavior.

```html
<div data-bind-if="{{model.isInventoryOpen}}">
    <!-- Only mounted when model.isInventoryOpen is true -->
</div>
<div data-bind-for="item in {{model.items}}">
    <span data-bind-value="{{item.name}}"></span>
</div>
```

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: medium] [SOURCE: structural-data-binding.mdx]
## Data-Binding Events: data-bind-[eventName]

Gameface supports attaching event handlers directly via binding attributes, without writing manual `addEventListener` calls. The syntax is `data-bind-[eventName]="handler(event, this)"` where `event` is the DOM event and `this` is the element's model context.

```html
<button data-bind-click="model.onEquipClicked(event, this)">Equip</button>
<div data-bind-mouseenter="model.onItemHovered(event, this)"></div>
```

This keeps interaction handlers co-located with binding logic and avoids polluting JavaScript with DOM query selectors.

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: medium] [SOURCE: custom-data-bind-attribute.mdx]
## Custom Data-Bind Attributes

When built-in binding attributes are insufficient, register custom handlers via `engine.registerBindingAttribute`. A handler class requires three methods: `init` (called once when the element is first bound), `update` (called when the bound value changes), and `deinit` (called on cleanup).

**Performance warning:** Standard data-binding attributes are evaluated in C++. Custom attributes force JavaScript evaluation on every update — which is significantly more expensive. Only use custom binders for genuinely complex transformations (like localization formatting) that cannot be expressed with native style, value, or class bindings.

```javascript
class CapitalizeAttribute {
    update(element, value) {
        element.textContent = String(value).toUpperCase();
    }
}
engine.registerBindingAttribute('coh-capitalize', CapitalizeAttribute);
```

---

---
[TOPIC: engine-bridge] [TYPE: concept] [SEVERITY: high] [SOURCE: observable-models-and-virtual-lists.mdx]
## Observable Models and engine.createObservableModel

Observable models are smart objects that track their own properties and automatically push UI updates when values change — without requiring manual calls to `updateWholeModel`. Create one with `engine.createObservableModel(modelData)`. Link it to the main game model using `engine.addSynchronizationDependency` so both stay in sync.

Use observable models for UI-driven state like a character selection screen, where selecting a player should automatically refresh dependent UI elements without explicit synchronization calls.

---

---
[TOPIC: engine-bridge] [TYPE: api] [SEVERITY: high] [SOURCE: observable-models-and-virtual-lists.mdx]
## Virtual Lists for Large Collections

Rendering 1000+ DOM nodes for a scoreboard or inventory will tank memory and layout performance. Use `engine.createVirtualList()` paired with `data-bind-for` to render only the visible slice of a large array. The full collection lives as a JavaScript data array; only the items visible in the scroll viewport exist as DOM nodes.

The rule: never create a DOM node per item for lists exceeding 50–100 entries. Virtual rendering is the correct solution at that threshold.

---

---
[TOPIC: engine-bridge] [TYPE: concept] [SEVERITY: high] [SOURCE: local-vs-game-state.mdx]
## Local vs. Game State: When NOT to Call the Engine

Spamming engine events for pure UI visuals wastes C++ resources. Three rules:

1. **Modals/Dropdowns:** Manage `isOpen` state entirely in local JavaScript — never involve the engine in toggling a panel.
2. **Sliders:** Update the visual fill locally as the user drags. Only trigger `engine.call('SetVolume', finalValue)` on `mouseup`/`touchend`.
3. **Toasts/Notifications:** The engine triggers `engine.trigger('ShowToast', 'Item Equipped')`. JS catches it, handles the 3-second delay and fade-out locally. The engine never manages UI timers.

---

## #TODO — Partial coverage
The following sub-topics from this category were not found in any MDX source:
- Full `engine.synchronizeModels` signature and all overload variants
- `data-bind-value` numeric vs. string formatting options
- `data-bind-html` XSS considerations
- Binding to nested model paths (e.g., `{{model.inventory[0].name}}`)
