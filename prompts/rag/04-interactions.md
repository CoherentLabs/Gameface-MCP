# Interactions
<!-- SOURCE FILES: interaction-manager.mdx, spatial-navigation-and-focus.mdx, routing-input.mdx, drag-and-drop.mdx, touch-support.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: interactions] [TYPE: concept] [SEVERITY: high] [SOURCE: interaction-manager.mdx]
## coherent-gameface-interaction-manager: Unified Input Abstraction

The `coherent-gameface-interaction-manager` npm package is the recommended entry point for all input handling in Gameface. It unifies keyboard, gamepad, spatial navigation, and touch into a single "action mapping" system — you define named actions (e.g., `"Navigate"`, `"Confirm"`, `"Cancel"`) and map them to keys, buttons, or D-Pad directions. The same `"Confirm"` action fires whether the player presses Enter on a keyboard, A on an Xbox controller, or taps a touch target.

Install via npm:
```
npm install coherent-gameface-interaction-manager
```

---

---
[TOPIC: interactions] [TYPE: api] [SEVERITY: high] [SOURCE: interaction-manager.mdx]
## Interaction Manager: Mapping Actions to Inputs

Configure the Interaction Manager by registering action names and their bindings. Gamepad buttons are polled internally by the library — you do not need to implement your own polling loop.

```javascript
import { InteractionManager } from 'coherent-gameface-interaction-manager';

const im = new InteractionManager();

im.addAction('Confirm', {
    keys: ['Enter', ' '],
    gamepadButtons: [0], // A button
});
im.addAction('Cancel', {
    keys: ['Escape'],
    gamepadButtons: [1], // B button
});

im.on('Confirm', () => { /* activate focused element */ });
im.on('Cancel', () => { /* close panel */ });
im.start();
```

---

---
[TOPIC: interactions] [TYPE: concept] [SEVERITY: high] [SOURCE: spatial-navigation-and-focus.mdx]
## Spatial Navigation for Gamepad and D-Pad Input

Standard keyboard Tab-order navigation is insufficient for gamepad UI. Spatial navigation moves focus between elements based on **screen-space direction** (up/down/left/right), mapping directly to D-Pad and left-stick input. Enable it via the Interaction Manager's spatial navigation module.

Spatial navigation groups prevent focus from "leaking" between sections. Define groups (e.g., sidebar, main list) so the D-Pad stays within the currently active section. Focus does not cross group boundaries unless you explicitly transition between them.

---

---
[TOPIC: interactions] [TYPE: pattern] [SEVERITY: high] [SOURCE: spatial-navigation-and-focus.mdx]
## Focus Styling: :focus and :focus-visible

Style focused elements using `:focus-visible` — it only applies when the element is focused via keyboard or gamepad, not when clicked with a mouse (preventing unsolicited focus rings on mouse interactions):

```css
.menu-item:focus { outline: none; }
.menu-item:focus-visible {
    outline: 3px solid #ffff00;
    outline-offset: 2px;
}
```

For gamepad accessibility, the focus ring should be clearly visible from couch distance — at least 3px wide, high-contrast (yellow on dark backgrounds is near-universal).

---

---
[TOPIC: interactions] [TYPE: pattern] [SEVERITY: medium] [SOURCE: spatial-navigation-and-focus.mdx]
## tabindex for Focus Management

Use `tabindex="0"` on non-interactive elements (like `<div>` or `<span>`) that should be keyboard-navigable. Use `tabindex="-1"` to allow programmatic focus without inserting the element into Tab order.

For complex panels, give only the panel container `tabindex="0"` and manage internal navigation via JavaScript arrow-key handlers. This prevents the Tab key from cycling through every sub-element.

```html
<div class="inventory-panel" tabindex="0" role="region" aria-label="Inventory">
    <!-- JS handles internal arrow-key navigation -->
</div>
```

---

---
[TOPIC: interactions] [TYPE: concept] [SEVERITY: high] [SOURCE: routing-input.mdx]
## Input Routing: The Gatekeeper Concept

In Gameface, the C++ game engine owns all raw input events. The engine's `OnNodeMouseEvent` callback decides whether to forward a click/hover/drag event to the UI HTML or let it "fall through" to the 3D game world. This is the **Gatekeeper model**.

The consequence: Gameface does not receive input events on transparent regions of the UI unless C++ routes them. If a UI element should interact (hover, click) it must have a visible hit region or a CSS `pointer-events` area. Setting `pointer-events: none` on elements that should pass input to the 3D world is the correct pattern.

```css
.hud-overlay { pointer-events: none; } /* Full UI passthrough */
.hud-overlay .interactive-widget { pointer-events: auto; } /* Specific widget re-enables */
```

---

---
[TOPIC: interactions] [TYPE: concept] [SEVERITY: high] [SOURCE: drag-and-drop.mdx]
## Drag-and-Drop: Native HTML5 DnD is Unsupported

Native HTML5 Drag and Drop API (`draggable="true"`, `ondragstart`, `ondrop`) is not implemented in Gameface. Implement drag-and-drop manually using mouse/touch events plus the Interaction Manager's `Draggable` and `Dropzone` components.

For **mouse DnD**: Use the `Draggable` class to track `mousedown` → `mousemove` → `mouseup` lifecycle and `Dropzone` to detect when a dragged element enters/leaves valid drop targets.

For **gamepad DnD**: Use a 2-step **Pick → Place** interaction: pressing the action button on an item marks it as "held" (a CSS state change), and navigating to a drop target then pressing the action button again triggers the drop.

> ⚠️ GAMEFACE CONSTRAINT: The native `HTMLDraggable` API is not implemented. All drag-and-drop must be custom JavaScript.

---

---
[TOPIC: interactions] [TYPE: api] [SEVERITY: medium] [SOURCE: drag-and-drop.mdx]
## Draggable and Dropzone from Interaction Manager

```javascript
import { Draggable, Dropzone } from 'coherent-gameface-interaction-manager';

const itemEl = document.querySelector('.inventory-item');
const draggable = new Draggable(itemEl);

draggable.on('dragstart', (e) => itemEl.classList.add('is-dragging'));
draggable.on('dragend', (e) => itemEl.classList.remove('is-dragging'));

const slotEl = document.querySelector('.inventory-slot');
const dropzone = new Dropzone(slotEl);

dropzone.on('drop', (draggableItem) => {
    engine.trigger('ItemEquipped', draggableItem.element.dataset.itemId);
});
```

---

---
[TOPIC: interactions] [TYPE: concept] [SEVERITY: medium] [SOURCE: touch-support.mdx]
## Touch Events

Gameface fully supports native JavaScript touch events: `touchstart`, `touchmove`, `touchend`, `touchcancel`. The Interaction Manager normalizes touch gestures (tap, swipe, pinch) into the same unified action system as keyboard/gamepad input, so a "Confirm" tap fires the same event as a keyboard Enter or gamepad A.

No special touch-specific configuration is required if you use the Interaction Manager. For custom gesture handling, use the native touch event API directly.

---

---
[TOPIC: interactions] [TYPE: pattern] [SEVERITY: medium] [SOURCE: routing-input.mdx]
## Hybrid Input: CSS Classes for Toggle Modes

When a player character can switch between "UI mode" (cursor active) and "game mode" (cursor hidden), use a CSS class on the root to toggle pointer regions:

```javascript
// Called by C++ when cursor mode changes
engine.on('CursorModeChanged', (isUIMode) => {
    document.documentElement.classList.toggle('ui-mode', isUIMode);
});
```

```css
/* Default: pass-through */
.interactive-panel { pointer-events: none; }
/* UI mode: all panels receive pointer events */
.ui-mode .interactive-panel { pointer-events: auto; }
```

---
