# Scalability
<!-- SOURCE FILES: building-responsive-game-ui.mdx, handling-aspect-ratios-with-media-queries.mdx, ui-font-scaling.mdx -->
<!-- STATUS: complete -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: scalability] [TYPE: concept] [SEVERITY: high] [SOURCE: building-responsive-game-ui.mdx]
## Resolution-Independent UI with Viewport Units

Game UIs must run on 720p, 1080p, 4K, and ultrawide at the same time. Hardcoded pixel values lock the UI to a specific resolution. The solution is to express major layout dimensions in `vw`/`vh` (viewport width/height) — these units always scale linearly to the output resolution.

Use `vw`/`vh` for top-level container widths and heights. A panel at `20vw` occupies exactly 20% of the screen on every target resolution.

```css
.hud-health {
    position: absolute;
    bottom: 2vh;
    left: 2vw;
    width: 20vw;
    height: 5vh;
}
```

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: high] [SOURCE: building-responsive-game-ui.mdx]
## rem-Based Global Scaling with a Root Font Size

Express measurements in `rem` units (root ems — always relative to the `<html>` element's `font-size`), then change a single CSS property to scale the entire UI. This provides a single control point for player-accessible font/UI scaling.

Set the baseline root font size in CSS. Update it at runtime from JavaScript when the player changes scale preferences:

```css
:root { font-size: 16px; } /* 1rem = 16px */
.menu-button { font-size: 1rem; padding: 0.75rem 1.5rem; min-width: 12rem; }
```

```javascript
function applyUIScale(factor) {
    document.documentElement.style.setProperty('--scale', factor);
}
engine.on('UIScaleChanged', (factor) => applyUIScale(factor));
```

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: high] [SOURCE: building-responsive-game-ui.mdx]
## Viewport-Relative rem Scaling via CSS calc

Combine `vh` and `calc()` to derive a root font size directly from the viewport height, producing a fully CSS-only scaling solution with no JavaScript required:

```css
:root {
    /* 1rem = viewport-proportional size. At 1080p, font-size ≈ 16px */
    font-size: calc(1.48vh);
}
```

This is resolution-agnostic: at 2160p (4K) the root font size doubles, scaling all `rem` values accordingly. Trade-off: fractional viewport units can cause sub-pixel rounding differences; test text legibility across resolutions.

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: medium] [SOURCE: building-responsive-game-ui.mdx]
## Reference Resolution Strategy

Pick a **reference resolution** (typically 1920×1080) and design all layouts in physical pixels at that resolution. Convert every pixel value to `vw`/`vh` or `rem` using the formula:

```
vw_value = (px_value / reference_width) * 100
rem_value = px_value / base_font_size
```

An element designed to be `320px` wide at 1920px reference becomes `16.67vw`. This maintains the same proportional appearance at 2560×1440 or 3840×2160 without media queries.

---

---
[TOPIC: scalability] [TYPE: concept] [SEVERITY: high] [SOURCE: building-responsive-game-ui.mdx]
## Dynamic vs. CSS-Only Scaling: Choosing the Right Approach

| Scenario | Recommended approach |
|---|---|
| Simple single-resolution HUD | `vw`/`vh` only |
| Fully adaptive, accessibility-supporting UI | `rem` + JS scale factor |
| Legacy codebase needing fast retrofit | CSS `scale()` or `zoom` applied to root |
| Multiple distinct layout variants | CSS media queries + `vw`/`vh` per variant |

Dynamic JS scaling via `--scale` allows player-controlled UI size from a settings menu. The CSS `zoom` or `scale()` approach scales the entire DOM uniformly including non-`rem` values, making it a good retrofit option.

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: high] [SOURCE: handling-aspect-ratios-with-media-queries.mdx]
## Aspect-Ratio Media Queries for Screen Shape Adaptation

CSS media queries support `aspect-ratio`, `min-aspect-ratio`, and `max-aspect-ratio` in Gameface. Use these to serve different layout variants when the screen shape changes (ultrawide 21:9, ultrawide 32:9, standard 16:9).

```css
/* Default: 16:9 */
.hud-layout { padding: 2vw; }

/* Ultrawide: shrink horizontal padding and expand map element */
@media (min-aspect-ratio: 21/9) {
    .hud-layout { padding: 1vw 6vw; }
    .minimap { width: 18vw; }
}
```

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: medium] [SOURCE: handling-aspect-ratios-with-media-queries.mdx]
## Safe Zone Wrapper Approach for Ultrawide HUDs

For HUDs where the game world widens but the UI should remain visually centered, use a **safe zone wrapper** — a fixed 16:9 container centered in the viewport:

```css
.hud-safe-zone {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: min(100vw, calc(100vh * 16 / 9));
    height: 100vh;
}

@media (min-aspect-ratio: 21/9) {
    .hud-safe-zone { width: calc(100vh * 16 / 9); }
}
```

HUD elements positioned inside `.hud-safe-zone` maintain 16:9 positions on all aspect ratios. Elements that intentionally span the full ultrawide (like a minimap strip) can be moved outside the safe zone.

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: medium] [SOURCE: handling-aspect-ratios-with-media-queries.mdx]
## Custom Media Features for Game-State-Driven Layout

Gameface supports injecting custom CSS media features from C++. These behave identically to standard media queries but are driven by game state variables (e.g., current language, equipped weapon class, active UI mode).

```css
/* Adapts layout when the active language is known to have long text strings */
@media (language: de) {
    .ability-name { font-size: 0.75rem; letter-spacing: -0.02em; }
}
@media (language: ru) {
    .subtitle-line { min-height: 2.5rem; }
}
```

Custom media features require C++ registration. They allow CSS to respond to game state without involving JavaScript or data-binding.

---

---
[TOPIC: scalability] [TYPE: concept] [SEVERITY: medium] [SOURCE: handling-aspect-ratios-with-media-queries.mdx]
## CSS Nesting Gotchas with Media Queries

Gameface supports CSS nesting and `@media` inside selector blocks, but there is a known issue: when using nested `@media` inside a selector, the selector must be re-stated inside the media block (the outer context is not automatically carried in):

```css
/* ❌ Nested media query without explicit selector — may not work */
.inventory-panel {
    width: 30vw;
    @media (min-aspect-ratio: 21/9) { width: 25vw; }
}

/* ✅ Explicit selector inside the media block */
@media (min-aspect-ratio: 21/9) {
    .inventory-panel { width: 25vw; }
}
```

Prefer flat `@media` blocks at the top level over deeply nested selector+media combinations.

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: medium] [SOURCE: ui-font-scaling.mdx]
## Named Scale Steps for Player-Controlled UI Size

Instead of arbitrary float slider values, define named CSS classes for each tested scale step:

```css
:root          { font-size: 14px; } /* small */
:root.scale-normal  { font-size: 16px; }
:root.scale-large   { font-size: 20px; }
:root.scale-xlarge  { font-size: 24px; }
```

```javascript
const SCALE_CLASSES = ['scale-small', 'scale-normal', 'scale-large', 'scale-xlarge'];
function applyUIScaleClass(level) {
    SCALE_CLASSES.forEach(cls => document.documentElement.classList.remove(cls));
    document.documentElement.classList.add(`scale-${level}`);
}
engine.on('UIScaleChanged', (level) => applyUIScaleClass(level));
```

Named steps reduce the risk of untested layout breakage compared to continuous scaling. QA each step explicitly.

---

---
[TOPIC: scalability] [TYPE: pattern] [SEVERITY: low] [SOURCE: ui-font-scaling.mdx]
## vmin and vmax for Intrinsic Proportions

Use `vmin` (smaller of vw/vh) and `vmax` (larger of vw/vh) for elements that must maintain proportionality regardless of orientation or aspect ratio changes. Sprite sheets and square icon containers are good candidates:

```css
.currency-icon {
    width: 4vmin;
    height: 4vmin;
    /* Always a perfect square, never distorted by aspect ratio */
}
```

---
