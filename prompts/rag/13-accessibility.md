# Accessibility
<!-- SOURCE FILES: accessibility.mdx, tts-architecture.mdx, aria-plugins.mdx, color-blindness.mdx, high-contrast-mode.mdx, ui-font-scaling.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: accessibility] [TYPE: concept] [SEVERITY: high] [SOURCE: tts-architecture.mdx]
## TTS Architecture: Three-Component System

Gameface's Text-to-Speech accessibility system is composed of three components that must all be initialized:

1. **SpeechAPI (C++):** The platform-level voice synthesis module — calls the OS TTS engine (e.g., SAPI on Windows, NSSpeechSynthesizer on macOS) or a custom TTS plugin.
2. **SpeechAPI (JS):** A JavaScript wrapper around the C++ API — exposes `window.speechSynthesis`-compatible methods for triggering speech from JavaScript.
3. **ARIA JS Library:** Monitors the DOM for ARIA attributes (`aria-label`, `aria-live`) and bridges them to the SpeechAPI. Does not modify the DOM — reads it.

All three must be loaded before any TTS functionality works.

---

---
[TOPIC: accessibility] [TYPE: pattern] [SEVERITY: high] [SOURCE: tts-architecture.mdx]
## Script Loading Order and CohtmlARIAManager Initialization

The ARIA JS Library must be loaded after `cohtml.js` and after the SpeechAPI JS wrapper. Initialize `CohtmlARIAManager` inside `engine.whenReady`:

```html
<!-- Required order: cohtml.js first -->
<script src="coui://uiresources/scripts/cohtml.js"></script>
<script src="coui://uiresources/scripts/speechapi.js"></script>
<script src="coui://uiresources/scripts/aria.js"></script>
<script>
engine.whenReady.then(() => {
    const ariaManager = new CohtmlARIAManager();
    ariaManager.start();
});
</script>
```

---

---
[TOPIC: accessibility] [TYPE: api] [SEVERITY: high] [SOURCE: aria-plugins.mdx]
## CohtmlARIAHoverReadPlugin: Reading Labels on Hover

The `CohtmlARIAHoverReadPlugin` reads the `aria-label` attribute of any element the mouse cursor hovers over. This provides an accessible hover tooltip for mouse users without requiring additional UI.

```javascript
const ariaManager = new CohtmlARIAManager();
ariaManager.registerPlugin(new CohtmlARIAHoverReadPlugin());
ariaManager.start();
```

```html
<button class="skill-btn" aria-label="Fireball: deals 200 fire damage. Cooldown: 8 seconds">
    <img src="icons/fireball.svg" alt="" />
</button>
```

---

---
[TOPIC: accessibility] [TYPE: api] [SEVERITY: critical] [SOURCE: aria-plugins.mdx]
## CohtmlARIAFocusChangePlugin: Reading on Focus (Critical for Gamepad)

The `CohtmlARIAFocusChangePlugin` reads `aria-label` whenever the focused element changes. This is the primary TTS mechanism for gamepad and keyboard navigation — every time the D-Pad moves focus to a new element, the label is spoken.

This plugin is **critical** for gamepad-accessible menus. Without it, a blind player using a controller has no audio feedback while navigating.

```javascript
ariaManager.registerPlugin(new CohtmlARIAFocusChangePlugin());
```

```html
<!-- Every focusable interactive element MUST have a descriptive aria-label -->
<div class="inventory-slot" tabindex="0" aria-label="Slot 1: Empty">
    <!-- slot content -->
</div>
<div class="inventory-slot filled" tabindex="0" aria-label="Slot 2: Iron Sword, damage 45, value 120 gold">
    <!-- slot content -->
</div>
```

---

---
[TOPIC: accessibility] [TYPE: api] [SEVERITY: high] [SOURCE: aria-plugins.mdx]
## CohtmlARIALiveRegionsPlugin: Dynamic Content Announcements

The `CohtmlARIALiveRegionsPlugin` monitors elements with `aria-live` for content changes and speaks the new text automatically. Use `aria-live="polite"` for non-urgent updates (quest objective changed) and `aria-live="assertive"` for urgent updates (health critical, incoming enemy).

```javascript
ariaManager.registerPlugin(new CohtmlARIALiveRegionsPlugin());
```

```html
<!-- Health bar — spoken immediately when critical threshold crossed -->
<div class="health-region" aria-live="assertive" aria-atomic="true">
    <span id="health-value">100</span>% health
</div>

<!-- Quest log — spoken when other speech finishes -->
<div class="quest-region" aria-live="polite" aria-atomic="false">
    <p id="current-objective">Reach the waypoint</p>
</div>
```

---

---
[TOPIC: accessibility] [TYPE: pattern] [SEVERITY: high] [SOURCE: aria-plugins.mdx]
## Combining Multiple ARIA Plugins

All three pre-built plugins can be active simultaneously without conflict. Register all of them before calling `ariaManager.start()`:

```javascript
const ariaManager = new CohtmlARIAManager();
ariaManager.registerPlugin(new CohtmlARIAHoverReadPlugin());
ariaManager.registerPlugin(new CohtmlARIAFocusChangePlugin());
ariaManager.registerPlugin(new CohtmlARIALiveRegionsPlugin());
ariaManager.start();
```

Common pitfalls: If `aria-label` is not updated when dynamic content changes (item inserted into slot, stat value changes), TTS still reads the old label. Use JavaScript to keep `aria-label` in sync with visual content.

---

---
[TOPIC: accessibility] [TYPE: pattern] [SEVERITY: medium] [SOURCE: color-blindness.mdx]
## Colorblind-Safe Palette via Root Class Toggle

Build color accessibility into the design token architecture from the start. Define all colors as semantic CSS custom properties (`--color-status-danger`, `--color-status-safe`) rather than raw hex values. Override only the changed tokens in a `.theme-colorblind` root class:

```css
:root {
    --color-status-danger: #e74c3c;
    --color-status-safe: #2ecc71;
}
:root.theme-colorblind {
    --color-status-danger: #e67e22; /* orange — distinguishable from blue for deuteranopes */
    --color-status-safe: #2980b9;   /* blue — distinguishable from orange */
}
```

```javascript
engine.on('ColorBlindModeChanged', (enabled) => {
    document.documentElement.classList.toggle('theme-colorblind', enabled);
});
```

---

---
[TOPIC: accessibility] [TYPE: pattern] [SEVERITY: medium] [SOURCE: color-blindness.mdx]
## Never Communicate State via Color Alone

Color must never be the only signal for a state change. A health bar transitioning red→green communicates nothing to a deuteranope. Always add a secondary signal: icon, text label, shape change, or animation.

```html
<!-- Color-only state — inaccessible -->
<div class="health-bar health-bar--low"></div>

<!-- Color + icon + aria-label — accessible -->
<div class="health-bar health-bar--low" aria-label="Health critical: 12 of 100">
    <span class="health-bar__icon health-bar__icon--warning">⚠</span>
    <div class="health-bar__fill"></div>
</div>
```

---

---
[TOPIC: accessibility] [TYPE: pattern] [SEVERITY: medium] [SOURCE: high-contrast-mode.mdx]
## High Contrast Mode via Root Class

High contrast mode increases luminance contrast ratios between foreground elements and dark backgrounds. Add `.theme-high-contrast` root class to swap a pre-defined override block:

```css
:root.theme-high-contrast {
    --color-text-primary:       #ffffff;
    --color-bg-surface:         #000000;
    --color-border-focus:       #ffff00; /* high-luminance yellow for focus rings */
    --color-status-danger:      #ff4444;
    --color-status-success:     #00ff88;
}
```

```javascript
engine.on('HighContrastChanged', (enabled) => {
    document.documentElement.classList.toggle('theme-high-contrast', enabled);
});
```

High contrast and colorblind modes can be active simultaneously (both classes on `<html>`). The last-defined override block wins for any property both attempt to set.

---

---
[TOPIC: accessibility] [TYPE: pattern] [SEVERITY: medium] [SOURCE: ui-font-scaling.mdx]
## UI and Font Scaling for Low-Vision Players

Use `rem` units for all component measurements and expose a single root font-size control point. Changing it scales the entire UI:

```css
:root { font-size: 16px; }
:root.scale-large  { font-size: 20px; }
:root.scale-xlarge { font-size: 24px; }
```

```javascript
engine.on('UIScaleChanged', (level) => {
    ['scale-large', 'scale-xlarge'].forEach(c => document.documentElement.classList.remove(c));
    if (level !== 'normal') document.documentElement.classList.add(`scale-${level}`);
});
```

**Testing requirement:** Verify layout integrity at every defined scale step. Common failures include fixed-`px` values that don't scale, text overflow in fixed-height containers, and icon-text misalignment when icon size is `px` but text is `rem`.

---

## #TODO — Partial coverage
The following sub-topics from this category were not found in any MDX source:
- Spatial navigation with screen readers: how spatial nav focus events are mapped to TTS announcements
- Focus ring pattern specifications (size, offset, color) for Gameface default components
- Subtitles and captions API: how to render styled subtitle overlays with engine timing data
- Motion sickness settings: how to disable parallax, animation, and camera shake from UI settings
- Custom ARIA plugin authoring: `CohtmlARIAPlugin` base class and plugin interface
