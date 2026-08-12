# Layout
<!-- SOURCE FILES: laying-out-the-screen.mdx, writing-maintainable-css.mdx, layout-performance.mdx, gameface-css.mdx, layout-debugging.mdx -->
<!-- STATUS: complete -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: layout] [TYPE: concept] [SEVERITY: critical] [SOURCE: laying-out-the-screen.mdx]
## Flexbox-Only: Gameface Has No CSS Grid

Gameface's layout engine relies exclusively on the **Flexbox model** (powered by the Yoga layout engine). CSS Grid is entirely absent — all `grid-*` properties are silently ignored. Display values like `inline-block`, `inline-flex`, `contents`, and `inline-grid` are unsupported. Only `flex`, `none`, and `inline` work reliably for layout.

Elements that a browser would render as block-level containers are internally mapped to flex containers by the engine. Every DOM element in Gameface operates under flex rules — either as a declared flex container or as a simulated one. Rebuild any grid-based layout using nested flex containers.

> ⚠️ GAMEFACE CONSTRAINT: `display: grid`, `display: inline-block`, `display: contents` and `display: inline-grid` are rejected by the engine. Use `display: flex` exclusively.

---

---
[TOPIC: layout] [TYPE: concept] [SEVERITY: critical] [SOURCE: laying-out-the-screen.mdx]
## The Layout Pass and Frame Budget

Every time an element's size, position, or content changes, Gameface runs a **layout pass** — evaluating how the change affects siblings and parents. In a browser, a 15ms recalculation is imperceptible. In a game targeting 60 FPS, the UI has roughly 1–2ms of its frame budget. A single poorly architected layout change can blow the entire frame.

The practical rule: design layouts to minimize how frequently the engine must recompute positions. Use `position: absolute` for top-level HUD widgets so they do not affect sibling layout when their internal state changes.

---

---
[TOPIC: layout] [TYPE: pattern] [SEVERITY: critical] [SOURCE: laying-out-the-screen.mdx]
## Absolute Positioning for Top-Level HUD Anchors

Use `position: absolute` for root HUD widgets (minimap, ammo counter, health bar). Absolute positioning removes the element from the normal flow and is computed independently — changes to one widget never push siblings around.

**Crosshair example:** Apply `position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%)` so reticle bloom animations only repaint that element, not the entire screen.

**Nameplate example:** Apply `position: absolute` so per-frame `left`/`top` coordinate updates from the game only update that specific node and bypass flex recalculation.

```css
.crosshair-wrapper {
    position: absolute;
    width: 2rem;
    height: 2rem;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
}
.nameplate {
    position: absolute;
    width: 15rem;
    height: 3rem;
    left: 0; /* injected by JS every frame */
    top: 0;
}
```

---

---
[TOPIC: layout] [TYPE: pattern] [SEVERITY: high] [SOURCE: laying-out-the-screen.mdx]
## Flexbox for Widget-Internal Alignment

Use `display: flex` for laying out content *inside* a widget — icon + text rows, button content, inventory slot arrangements. Define explicit `width`/`height` boundaries on the flex container to prevent the engine from recursively measuring children.

Combine both strategies: absolutely positioned outer widget, flex-based internal layout. A notification badge added to an inventory slot should use `position: absolute; top: -0.5rem; right: -0.5rem` on the badge and `position: relative` on the slot — the badge is removed from flex flow, so showing/hiding it never forces the inventory grid to recalculate.

```css
.action-button {
    display: flex;
    width: 15rem;
    height: 4rem;
    justify-content: center;
    align-items: center;
    gap: 1rem;
}
.inventory-slot {
    display: flex;
    width: 5rem;
    height: 5rem;
    position: relative;
}
.notification-badge {
    position: absolute;
    width: 1.5rem;
    height: 1.5rem;
    top: -0.5rem;
    right: -0.5rem;
}
```

---

---
[TOPIC: layout] [TYPE: constraint] [SEVERITY: critical] [SOURCE: laying-out-the-screen.mdx]
## Avoid align-items: stretch (the CSS Default)

`align-items: stretch` is the CSS specification default — any flex container without an explicit `align-items` declaration is already using it. In Gameface/Yoga, stretch forces multiple layout passes: measure children to find the largest, then re-enter each child's subtree to grow them. In combination with auto-sized children and `flex-wrap`, this produces exponential layout complexity.

**Rule:** Always set an explicit `align-items` value (`flex-start`, `center`, `flex-end`). Never rely on the stretch default. Doing so in deeply nested UI trees can cause 100× or more layout overhead per frame compared to explicit sizes.

> ⚠️ GAMEFACE CONSTRAINT: `align-items: stretch` is the CSS default and must be explicitly overridden. The performance cost scales exponentially with DOM depth when combined with unsized children.

---

---
[TOPIC: layout] [TYPE: pattern] [SEVERITY: critical] [SOURCE: layout-performance.mdx]
## Define Explicit flex-basis on Every Flex Item

When a child has no explicit `flex-basis`, `width`, or `height`, Yoga must descend into its entire subtree to measure it (a recursive `measure` call). Defining a `flex-basis` on every flex item tells Yoga the size upfront, eliminating the measurement recursion.

Real-world impact from Gameface internal tests: a 4,400-node tree with depth 21 takes ~2,000ms to lay out when only leaf nodes have sizes. The same tree with `flex-basis` on both wrappers and leaves takes ~17ms — a 99%+ reduction.

Apply at every level of the tree, not only on leaf nodes:

```css
.inventory-grid { display: flex; flex-wrap: wrap; align-items: flex-start; }
.item-slot { display: flex; flex-direction: column; align-items: flex-start; flex-basis: 8rem; height: 10rem; }
.item-slot__icon { width: 6rem; height: 6rem; }
.item-slot__label { flex-basis: 8rem; }
```

---

---
[TOPIC: layout] [TYPE: concept] [SEVERITY: high] [SOURCE: layout-performance.mdx]
## Full Layout Solve vs. Transform Update

The engine classifies every CSS change as either:
- **Full Layout Solve (`SolveFlexLayout`):** Triggered by `width`, `height`, `margin`, `padding`, `top`, `bottom`, `left`, `right`, `flex-*`. Runs the entire Yoga solver over the affected subtree.
- **Transform Update (`UpdateNodeTransforms`):** Triggered when only `transform` or `opacity` changes. Skips Yoga entirely — just recalculates bounding boxes.

Animate position with `transform: translateX()` instead of `left`/`margin-left` to stay on the cheap transform path. Floating damage numbers that animate `top` trigger a full Yoga traversal every frame; switching to `transform: translateY` eliminates that cost.

```css
/* ❌ Full layout solve every frame */
@keyframes float-bad { from { top: 0; } to { top: -5rem; } }

/* ✅ Cheap transform update only */
@keyframes float-good { from { transform: translateY(0); } to { transform: translateY(-5rem); } }
```

---

---
[TOPIC: layout] [TYPE: concept] [SEVERITY: high] [SOURCE: laying-out-the-screen.mdx]
## Positioning: absolute, relative, fixed

- `position: absolute`: Removes from flow; positioned relative to nearest `position: relative` or `position: absolute` ancestor. Ideal for HUD anchors. Updating `left`/`top` only affects that node.
- `position: relative`: Creates a local coordinate system for absolute children without removing itself from flow.
- `position: fixed`: Positioned relative to the viewport. Useful for persistent overlays.

> ⚠️ GAMEFACE CONSTRAINT: `position: sticky` is not supported. Use JavaScript-driven absolute positioning with scroll event listeners instead.

---

---
[TOPIC: layout] [TYPE: api] [SEVERITY: high] [SOURCE: gameface-css.mdx]
## display: simple — Bypass Yoga for Pure Absolute Layouts

`display: simple` is a Gameface-proprietary `display` value that entirely disables Yoga's layout solve for that container. Use it on `<body>` for HUD-only views where every direct child uses `position: absolute`. This eliminates all flex distribution, cross-axis alignment, and wrapping calculations.

Direct children of a `display: simple` container **must** use `position: absolute` or `position: fixed`. Elements below them (grandchildren, deeper) can use `display: flex` freely.

```css
body { display: simple; width: 100vw; height: 100vh; }
.health-bar { position: absolute; bottom: 2rem; left: 2rem; width: 20rem; height: 1.5rem; }
/* Inside .health-bar, normal flex is fine: */
.health-bar { display: flex; align-items: center; }
```

> ⚠️ GAMEFACE CONSTRAINT: `display: simple` only applies to direct children. Any direct child without `position: absolute` will render at the origin (0, 0) with no layout algorithm placing it.

---

---
[TOPIC: layout] [TYPE: concept] [SEVERITY: high] [SOURCE: layout-debugging.mdx]
## getComputedStyle Timing: The Dual-Tree Delay

Gameface runs layout on a separate thread. Computed geometry is synchronized back to JavaScript **one frame after layout runs**. Calling `window.getComputedStyle(element)` immediately after page load returns empty strings for layout-dependent properties.

Use nested `requestAnimationFrame` callbacks to defer reads: 3 frames after `window.onload`, 2 frames after subsequent layout changes. Or use `engine.executeImmediateLayoutSync()` to force a synchronous layout pass before reading — but only do this once per batch of mutations, not per getter call.

```javascript
requestAnimationFrame(() => {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const width = getComputedStyle(document.querySelector('.panel')).width;
        });
    });
});
```

---

---
[TOPIC: layout] [TYPE: concept] [SEVERITY: medium] [SOURCE: writing-maintainable-css.mdx]
## BEM and Flat Selectors for Performance

CSS selectors are evaluated right-to-left in the engine. A deeply nested selector like `.social-menu .player-card .info .status.offline` requires the engine to traverse multiple DOM ancestor levels per element during style recalculation. In a game engine where style recalculations happen every frame, deep selectors inflate the "Style Solve" cost.

Keep selectors as flat as possible — ideally a single class. Use **BEM (Block Element Modifier)** naming: `.player-card`, `.player-card__name`, `.player-card__status--offline`. This guarantees one exact class match per lookup, no traversal needed.

---

---
[TOPIC: layout] [TYPE: pattern] [SEVERITY: medium] [SOURCE: writing-maintainable-css.mdx]
## Overflow and z-index in Gameface

Standard `overflow: hidden` and `overflow: visible` work. `overflow: scroll` and `overflow: auto` work for scrollable containers. `z-index` and stacking contexts function as in browsers.

> ⚠️ GAMEFACE CONSTRAINT: `overflow-x: clip` and `overflow-y: clip` are not supported. Use `overflow: hidden` instead.

---
