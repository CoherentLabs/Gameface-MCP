# Animations
<!-- SOURCE FILES: ui-animations.mdx, waapi.mdx, sprite-sheet-animations.mdx, svg-animations.mdx, animation-libraries.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: animations] [TYPE: concept] [SEVERITY: high] [SOURCE: ui-animations.mdx]
## CSS First: The Animation Priority Rule

In Gameface, CSS animation always outperforms JavaScript-driven style mutation. The priority order:

1. **CSS `transition`** — for simple 2-state changes (panel slides in/out, button hover)
2. **CSS `@keyframes`** — for multi-step, looping, or entry animations
3. **Web Animations API (WAAPI)** — for programmatic playback control of CSS-defined animations
4. **JS style mutation** — only as a last resort for truly dynamic calculations

Reserve JavaScript for controlling *when* and *which* CSS animations play, not for computing animation values per frame.

---

---
[TOPIC: animations] [TYPE: pattern] [SEVERITY: medium] [SOURCE: ui-animations.mdx]
## CSS transitions for State Changes

Use `transition` on discrete UI state changes — panel open/close, button hover/press, health bar fill:

```css
.inventory-panel {
    opacity: 0;
    transform: translateY(2rem);
    transition: opacity 0.25s ease, transform 0.25s ease;
}
.inventory-panel.open {
    opacity: 1;
    transform: translateY(0);
}
```

Toggle the class from JavaScript when the state changes. The animation runs entirely on the compositor thread.

---

---
[TOPIC: animations] [TYPE: pattern] [SEVERITY: medium] [SOURCE: ui-animations.mdx]
## @keyframes for Multi-Step and Looping Animations

Use `@keyframes` for effects that require more than 2 states, have precise timing, or loop:

```css
@keyframes pulse-glow {
    0%, 100% { box-shadow: 0 0 4px rgba(255, 200, 0, 0.4); }
    50%       { box-shadow: 0 0 16px rgba(255, 200, 0, 0.9); }
}
.ability-ready {
    animation: pulse-glow 1.5s ease-in-out infinite;
}

@keyframes slide-in-from-top {
    from { transform: translateY(-100%); opacity: 0; }
    to   { transform: translateY(0);     opacity: 1; }
}
.notification-toast {
    animation: slide-in-from-top 0.3s ease-out forwards;
}
```

---

---
[TOPIC: animations] [TYPE: api] [SEVERITY: high] [SOURCE: ui-animations.mdx]
## @starting-style: Entry Animations on DOM Mount

`@starting-style` defines the style an element has at the very beginning of its first transition — before any of its styles have been applied. Use it to create CSS-only enter animations triggered by `data-bind-if` mounting:

```css
.toast-notification {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.3s ease, transform 0.3s ease;
}
@starting-style {
    .toast-notification {
        opacity: 0;
        transform: translateY(-2rem);
    }
}
```

When `data-bind-if` mounts the element, it starts at the `@starting-style` values and transitions to the main rule.

---

---
[TOPIC: animations] [TYPE: concept] [SEVERITY: critical] [SOURCE: waapi.mdx]
## WAAPI: Gameface Supports a Subset, Not element.animate()

Gameface supports a specific subset of the Web Animations API for **controlling CSS-defined animations**. The most important missing method is `element.animate()` — the imperative API for creating new animations from JavaScript is **not implemented**.

WAAPI in Gameface is for controlling animations that already exist as CSS `@keyframes` or `transition`. Always define your animation in CSS; use JavaScript only to control playback.

> ⚠️ GAMEFACE CONSTRAINT: `element.animate()` is not supported. Define all animations in CSS `@keyframes` and control them via `getAnimations()`.

---

---
[TOPIC: animations] [TYPE: api] [SEVERITY: high] [SOURCE: waapi.mdx]
## Supported WAAPI Methods

The supported methods on `Animation` objects returned by `element.getAnimations()`:

| Method/Property | Description |
|---|---|
| `play()` | Starts or resumes the animation |
| `pause()` | Pauses at current time |
| `reverse()` | Plays backwards from current position |
| `finish()` | Jumps to the end state |
| `cancel()` | Stops and removes the animation effect |
| `commitStyles()` | Writes current computed style values to `element.style` |
| `playFromTo(start, end)` | Plays only the segment between two times (Gameface extension) |
| `currentTime` | Read/write: current playback position in ms |
| `playbackRate` | Read/write: speed multiplier (e.g., 2 for 2× speed) |

`persist()` is a no-op in Gameface — animations do not get garbage collected as in browsers.

---

---
[TOPIC: animations] [TYPE: pattern] [SEVERITY: high] [SOURCE: waapi.mdx]
## WAAPI Pattern: Lookup Once, Store Reference

`element.getAnimations()` traverses the element's animation list on every call. In a per-frame animation controller, call it once and cache the result:

```javascript
// Lookup once — at component mount or when animation target is known
const healthBar = document.getElementById('health-fill');
const [fillAnimation] = healthBar.getAnimations();

// Per-frame control — using cached reference, no repeated DOM traversal
function updateHealthAnimation(healthPercent) {
    if (healthPercent < 25) {
        fillAnimation.play();
    } else {
        fillAnimation.pause();
    }
}
```

Listen for `animationend` to trigger follow-up logic rather than using timeouts:

```javascript
healthBar.addEventListener('animationend', () => {
    healthBar.classList.remove('flash-critical');
});
```

---

---
[TOPIC: animations] [TYPE: constraint] [SEVERITY: critical] [SOURCE: managing-variables.mdx]
## CSS Custom Properties Do Not Interpolate Inside @keyframes

CSS custom properties (`var(--color)`, `var(--position)`) cannot be interpolated between values inside `@keyframes` in Gameface (or in standard browsers without `@property`). Animating `var(--fill-width)` from `0%` to `100%` in a keyframe produces a discrete jump, not a smooth tween.

```css
/* ❌ This does NOT interpolate — jumps at 50% mark */
@keyframes grow-bad {
    from { width: var(--start-width); }
    to   { width: var(--end-width); }
}

/* ✅ Use concrete values in keyframes */
@keyframes grow-good {
    from { width: 0%; }
    to   { width: 100%; }
}
```

Use SCSS variables for keyframe values — they resolve to concrete values at build time.

---

---
[TOPIC: animations] [TYPE: pattern] [SEVERITY: high] [SOURCE: sprite-sheet-animations.mdx]
## Sprite Sheet Animations with steps()

For complex VFX that cannot be expressed with CSS shapes or SVG (explosions, magic effects), use sprite sheets — a grid of frames in a single image. The `steps()` timing function advances to the next frame instead of interpolating:

```css
.explosion-vfx {
    width: 256px;
    height: 256px;
    background-image: url('assets/explosion_sheet.png');
    background-size: 2560px 256px; /* 10 frames × 256px */
    animation: play-explosion 0.5s steps(10) forwards;
}

@keyframes play-explosion {
    from { background-position: 0 0; }
    to   { background-position: -2560px 0; }
}
```

---

---
[TOPIC: animations] [TYPE: pattern] [SEVERITY: medium] [SOURCE: sprite-sheet-animations.mdx]
## Recolorable Sprite Sheets via mask-image

For VFX that should tint to multiple colors (elemental effects — fire red, ice blue, poison green), use the sprite sheet as a `mask-image` and set `background-color` for the tint:

```css
.elemental-vfx {
    background-color: var(--vfx-tint-color); /* #ff4400 for fire, #00aaff for ice */
    mask-image: url('assets/vfx_sheet.png');
    mask-size: 2560px 256px;
    animation: play-vfx 0.5s steps(10) forwards;
}
@keyframes play-vfx {
    from { mask-position: 0 0; }
    to   { mask-position: -2560px 0; }
}
```

---

---
[TOPIC: animations] [TYPE: constraint] [SEVERITY: high] [SOURCE: svg-animations.mdx]
## SVG Animation Gotchas in Gameface

Key constraints when applying CSS `@keyframes` to inline SVG elements:

1. **No SMIL:** SVG `<animate>` and `<animateTransform>` elements are not rendered.
2. **`transform-origin` default:** SVG elements default to `transform-origin: 0 0` (top-left corner), not center. Add `transform-origin: 50% 50%` explicitly for rotation animations.
3. **Unit requirements:** SVG shape properties (`stroke-width`, `r`, `cx`, `cy`) do not accept `px` units. Omit the unit in keyframes.
4. **Prefer `<path>` for animation:** Animating `<circle>`, `<rect>`, and other primitives via their specific attributes (like `r`, `width`) is less reliable. Convert complex shapes to `<path>` for animation targets.
5. **Do not use Anime.js for SVG:** Anime.js's SVG-specific features (morphing, path drawing) do not work in Gameface.

> ⚠️ GAMEFACE CONSTRAINT: SMIL animations (`<animate>`, `<set>`) inside SVG are silently ignored. Replace with CSS `@keyframes` applied to the SVG element or its descendant elements.

---

---
[TOPIC: animations] [TYPE: concept] [SEVERITY: medium] [SOURCE: animation-libraries.mdx]
## Animation Libraries: When to Use and Constraints

| Library | Status | Notes |
|---|---|---|
| **GSAP** | Supported | Works via JS style mutation; no `element.animate()` needed. Heavier than CSS. |
| **AnimeJS** | Partial | CSS and JS property animation works. SVG morphing and path features do not. |
| **Framer Motion** | Caution | Requires React; VDOM cost may negate animation gains. Test carefully. |
| **Lottie** | Supported (Light build) | Use `lottie-light` bundle, not full. JSON-driven vector animations. |

The recommendation is always: if the animation can be expressed in CSS, use CSS. Use a library only when CSS cannot express the required effect (e.g., physics-based springs, complex path following, procedural interpolation).

---

## #TODO — Partial coverage
The following sub-topics from this category were not found in any MDX source:
- Staggered animations: pattern for animating list items or groups with offset delays
- `animation-fill-mode`, `animation-direction`, `animation-play-state` longhands: complete behavior reference
- `transition-*` longhands: `transition-duration`, `transition-timing-function`, `transition-delay` — full value support list
- JS-driven animation via direct style mutation: frame-rate timing, `requestAnimationFrame` patterns for non-CSS-expressible motion
