# Performance
<!-- SOURCE FILES: layout-performance.mdx, dom-management.mdx, asset-preloading.mdx, text-rendering.mdx, gameface-css.mdx, dynamic-styling-in-javascript.mdx, managing-variables.mdx, writing-maintainable-css.mdx, local-vs-game-state.mdx -->
<!-- STATUS: complete -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: performance] [TYPE: concept] [SEVERITY: critical] [SOURCE: layout-performance.mdx]
## Yoga Layout Complexity: The O(4^Depth) Cliff

Gameface's Yoga layout engine is not linear in node count — its complexity is **exponential with tree depth** when CSS triggers certain patterns. Two patterns cause worst-case behavior:

1. **Auto-sized flex children** (no explicit `width`, `height`, or `flex-basis`): Yoga must recursively measure each child from its subtree.
2. **`align-items: stretch` on flex containers** (the CSS default): Triggers additional recursive passes after cross-axis size is known.

Combined, these patterns produce approximately O(4^depth) layout calls per frame. A 4-level deep auto-sized+stretch tree runs ~256 layout calls per frame instead of 4. The fix: set explicit dimensions on every flex item and always declare `align-items: flex-start` (or `center`, `flex-end`).

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: critical] [SOURCE: layout-performance.mdx]
## Transform vs. Layout: Animate Only What's Cheap

Every CSS property change triggers either:
- **Full Layout Solve (`SolveFlexLayout`):** Any box-model change (`width`, `height`, `margin`, `padding`, `left`, `top`, `flex-*`). Expensive — runs Yoga.
- **Transform Update (`UpdateNodeTransforms`):** Only `transform` or CSS `opacity` changes. Cheap — skips Yoga.

Animating floating damage numbers via `top: 0 → -5rem` triggers a full Yoga solve every frame. Animating `transform: translateY(0) → translateY(-5rem)` does not. Always prefer `transform` for continuous animations.

---

---
[TOPIC: performance] [TYPE: concept] [SEVERITY: high] [SOURCE: dom-management.mdx]
## DOM Hiding Techniques Compared

How you hide an element controls both its **resting overhead** (CPU cost while hidden) and its **toggle cost** (time to show/hide).

| Method | Resting overhead | Toggle cost | Layout contribution |
|---|---|---|---|
| `opacity: 0` | None | Zero | Yes — still in flow |
| `visibility: hidden` | None | Zero | Yes — still in flow |
| `display: none` | None | Layout solve | No — removed from flow |
| `data-bind-if` (removes from DOM) | None | Layout + DOM parse | No |

Use `opacity: 0` or `visibility: hidden` for elements that toggle frequently (every few seconds). Use `display: none` or `data-bind-if` for elements rarely seen (loading screens, tutorial popups). The cost of `data-bind-if` is the full DOM insertion penalty — prefer it only for major screen sections.

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: high] [SOURCE: dom-management.mdx]
## Lazy Component Loading with <template>

The `<template>` HTML element stores dormant DOM — its content is parsed but not rendered, has no layout cost, and consumes no GPU resources. Use it for infrequently visited UI panels:

```html
<!-- Loaded in HTML, but zero runtime cost until cloned -->
<template id="settings-panel-tmpl">
    <div class="settings-panel">...</div>
</template>
```

```javascript
function openSettings() {
    if (!document.querySelector('.settings-panel')) {
        const tmpl = document.getElementById('settings-panel-tmpl');
        document.body.appendChild(tmpl.content.cloneNode(true));
    }
}
```

The panel is only inserted into the live DOM the first time it's needed. On subsequent opens, check if it exists first to avoid redundant clones.

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: high] [SOURCE: dom-management.mdx]
## Node Pooling for High-Frequency Elements

Creating and destroying DOM nodes rapidly (particle-style notifications, damage numbers, loot pop-ups) forces repeated parsing, style resolution, and layout. Use **node pooling**: allocate a fixed set of elements, mark them as available, and reuse them:

```javascript
const POOL_SIZE = 10;
const pool = Array.from({ length: POOL_SIZE }, () => {
    const el = document.createElement('div');
    el.className = 'damage-number';
    el.style.display = 'none';
    document.getElementById('hud').appendChild(el);
    return el;
});

function spawnDamageNumber(value, x, y) {
    const el = pool.find(n => n.style.display === 'none');
    if (!el) return; // pool exhausted
    el.textContent = value;
    el.style.display = 'block';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    setTimeout(() => { el.style.display = 'none'; }, 1000);
}
```

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: high] [SOURCE: dom-management.mdx]
## Throttling DOM Mutations

The DOM runs on the JavaScript thread. Applying 50 style mutations inside a tight loop blocks the thread and triggers a single large layout solve. Throttle heavy DOM operations:

1. **Batch mutations** — accumulate all style changes before any layout reads. Apply all `el.style.left = ...` calls before any `el.getBoundingClientRect()`.
2. **Use `requestAnimationFrame`** — spread updates across frames. Apply at most one visible change per rAF callback for elements the user won't notice updating over 2–3 frames.
3. **Cap per-frame updates** — for systems that update multiple elements (inventory grid, scoreboard), cap the number of DOM mutations per frame (e.g., 10 per frame, continue next frame).

---

---
[TOPIC: performance] [TYPE: concept] [SEVERITY: high] [SOURCE: asset-preloading.mdx]
## Instaload: Single-Frame Asset Loading

Gameface supports **Instaload** — a mechanism where all external assets referenced in the HTML/CSS are loaded in a single frame before any rendering occurs, eliminating mid-session texture pops. Instaload works only with **external files** referenced by URL. Inline assets (base64, inline SVG, inline styles) are excluded.

Instaload is enabled per-view from the C++ side. The UI front-end requirement is to configure the bundler so that all assets are external (not inlined).

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: high] [SOURCE: asset-preloading.mdx]
## Vite Config for Instaload Compatibility

Vite's default behavior inlines small assets as base64 and splits CSS. Both behaviors break Instaload. Override them:

```javascript
// vite.config.js
export default {
    build: {
        assetsInlineLimit: 0,      // Never inline assets as base64
        cssCodeSplit: false,        // Single CSS bundle — Instaload needs all in one file
        rollupOptions: {
            output: {
                // Stable filenames — Instaload list is built at build time
                entryFileNames: 'assets/main.js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name][extname]',
            }
        }
    }
}
```

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: high] [SOURCE: dynamic-styling-in-javascript.mdx]
## CSS Typed Object Model (CSSTOM) for JS Style Updates

Setting styles via string concatenation (`el.style.transform = 'translateX(' + x + 'px)'`) forces the engine to parse the string on every call. For properties that update every frame (like transform coordinates), use the **CSS Typed Object Model** instead:

```javascript
const el = document.querySelector('.player-marker');

// One-time construction — outside the update loop
const transform = new CSSTransformValue([
    new CSSTranslate(new CSSUnitValue(0, 'px'), new CSSUnitValue(0, 'px'))
]);

function updateMarker(x, y) {
    // Mutate in-place — no string parsing
    transform[0].x = new CSSUnitValue(x, 'px');
    transform[0].y = new CSSUnitValue(y, 'px');
    el.attributeStyleMap.set('transform', transform);
}
```

---

---
[TOPIC: performance] [TYPE: pattern] [SEVERITY: high] [SOURCE: dynamic-styling-in-javascript.mdx]
## Gameface DOM Extensions for Fast Numeric Style Updates

Gameface exposes direct numeric setters on DOM elements for common layout properties, bypassing string parsing entirely. These are the fastest possible per-frame style updates:

```javascript
const el = document.querySelector('.health-bar-fill');

// Standard string method — requires parsing
el.style.width = progressPercent + '%';  // ← slower

// Gameface DOM extension — direct numeric assignment
el.widthPercent = progressPercent;       // ← faster
el.leftPX = x;
el.topPX = y;
el.opacityFloat = 0.5;
```

Available extensions: `leftPX`, `topPX`, `rightPX`, `bottomPX`, `widthPX`, `heightPX`, `widthVW`, `heightVH`, `opacityFloat`, and others.

---

---
[TOPIC: performance] [TYPE: concept] [SEVERITY: medium] [SOURCE: managing-variables.mdx]
## SCSS Variables vs. CSS Custom Properties: Build-Time vs. Runtime

Use **SCSS variables** (`$primary-color: #ffcc00`) for static design tokens that never change at runtime. They are resolved at build time — the compiled CSS contains the final hex value. Zero runtime cost.

Use **CSS custom properties** (`--primary-color: #ffcc00`) only when you need runtime theming (color blindness palettes, high contrast modes). They are evaluated every frame by the style solver.

**Critical caveat:** CSS custom properties do not interpolate inside `@keyframes`. An animation that tries to tween `var(--fill-width)` from one value to another will jump discretely rather than animate smoothly. Use SCSS variables for keyframe values.

> ⚠️ GAMEFACE CONSTRAINT: CSS custom properties in `:root` trigger a **global style recalculation** on every change, affecting all elements. Scope custom property declarations to the narrowest containing element possible.

---

---
[TOPIC: performance] [TYPE: concept] [SEVERITY: high] [SOURCE: writing-maintainable-css.mdx]
## Runtime CSS-in-JS is Prohibited

Libraries like styled-components, Emotion, or any runtime CSS-in-JS that injects `<style>` tags or uses `CSSStyleSheet.insertRule()` dynamically at runtime cause per-frame style recalculations and are not supported in Gameface. The engine is not a browser — there is no JIT for style injection.

Zero-runtime alternatives (CSS Modules, Linaria, vanilla-extract) that generate static CSS at build time are safe. SCSS modules processed by Vite are safe.

> ⚠️ GAMEFACE CONSTRAINT: Runtime `CSSStyleSheet.insertRule()` and dynamic `<style>` tag injection are not supported. Compile all styles at build time.

---

---
[TOPIC: performance] [TYPE: concept] [SEVERITY: high] [SOURCE: gameface-css.mdx]
## coh-simple-opacity: Opacity Without GPU Layer Promotion

Standard CSS `opacity` on an element with children creates an intermediate compositing layer (a new GPU texture) — the element and all its descendants are rendered into a temporary off-screen buffer, then the buffer is composited with alpha. For large panels with many children, this is expensive.

`coh-simple-opacity` sets the alpha channel on the final composited output without creating an intermediate layer, but it only works when the element and its children are already opaque (no transparency within the subtree).

```css
.hud-panel {
    coh-simple-opacity: 0.85;
    /* vs. opacity: 0.85 — which creates a costly intermediate GPU texture */
}
```

> ⚠️ GAMEFACE CONSTRAINT: `coh-simple-opacity` produces incorrect results if any child element also has non-trivial compositing (gradients with alpha, `backdrop-filter`). Use only on fully opaque subtrees.

---
