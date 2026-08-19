# Fonts and Text
<!-- SOURCE FILES: importing-fonts-and-styling-text.mdx, building-rich-text.mdx, auto-scaling-text.mdx, text-rendering.mdx -->
<!-- STATUS: complete -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: fonts-and-text] [TYPE: api] [SEVERITY: high] [SOURCE: importing-fonts-and-styling-text.mdx]
## Loading Custom Fonts with @font-face

Custom fonts are loaded via standard CSS `@font-face` declarations. Gameface persists fonts **globally** across all views for the session and never overwrites a previously loaded face — if the same font family name is declared twice with different files, the second declaration is silently ignored.

Best practice: declare all fonts at application startup before any views load, or in a shared stylesheet that is guaranteed to load first.

```css
@font-face {
    font-family: 'GameUI';
    src: url('coui://uiresources/fonts/GameUI-Regular.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
}
@font-face {
    font-family: 'GameUI';
    src: url('coui://uiresources/fonts/GameUI-Bold.woff2') format('woff2');
    font-weight: 700;
    font-style: normal;
}
```

---

---
[TOPIC: fonts-and-text] [TYPE: pattern] [SEVERITY: high] [SOURCE: importing-fonts-and-styling-text.mdx]
## Font Fallbacks: CSS and C++ Chains

Gameface resolves font fallbacks in two steps: first through the CSS `font-family` comma-separated list (standard), then through a C++ API for system-level fallbacks.

For game UIs targeting multiple languages, register a fallback chain at the C++ level using `cohtml::View::SetAdditionalFontFallbacks` to ensure glyphs missing in the primary font (e.g., CJK, Arabic) are found in a second font without modifying CSS.

```css
/* CSS fallback chain */
.game-text {
    font-family: 'GameUI', 'NotoSansJP', 'NotoSansCJK', monospace;
}
```

---

---
[TOPIC: fonts-and-text] [TYPE: pattern] [SEVERITY: medium] [SOURCE: importing-fonts-and-styling-text.mdx]
## text-shadow for HUD Text Legibility

High-contrast `text-shadow` is the primary technique for making HUD text readable against dynamic game backgrounds. Three patterns:

**Heavy drop shadow** — a dark offset shadow to separate text from bright backgrounds:
```css
.hud-text { text-shadow: 2px 2px 4px rgba(0,0,0,0.9); }
```

**Crisp outline** — four offset shadows for a solid outline:
```css
.hud-text { text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000; }
```

**Neon glow** — large blurred shadow in a color matching the text:
```css
.hud-text { text-shadow: 0 0 8px #00ccff, 0 0 16px #00ccff; }
```

---

---
[TOPIC: fonts-and-text] [TYPE: concept] [SEVERITY: high] [SOURCE: building-rich-text.mdx]
## cohinline: Mixing Images and Text Inline

Gameface's inline layout behaves differently from browsers for mixed text + image content. By default, `<img>` and `<span>` inside a paragraph are treated as block-level flex items, not inline elements. To restore natural word-wrap behavior (where an image or icon is treated as a character and text wraps around it), add the `cohinline` attribute to the container:

```html
<!-- Without cohinline: image and text stack vertically -->
<p class="item-desc">
    <img src="icons/fire.svg" width="16" height="16"/>
    Deals 100 fire damage on contact.
</p>

<!-- With cohinline: image and text wrap naturally together -->
<p class="item-desc" cohinline>
    <img src="icons/fire.svg" width="16" height="16"/>
    Deals 100 fire damage on contact.
</p>
```

---

---
[TOPIC: fonts-and-text] [TYPE: concept] [SEVERITY: medium] [SOURCE: building-rich-text.mdx]
## Vertical Alignment Quirks in Gameface

`vertical-align` on inline elements behaves identically to Chrome but the **default baseline alignment** interacts with `line-height` differently from what developers often expect. The safest pattern for icon-text pairs:

- Set `line-height` explicitly on the container so the line box height is deterministic.
- Use `vertical-align: middle` on both the icon and the text span.
- Avoid mixing `vertical-align` values (`top`, `bottom`, `baseline`) on sibling elements within the same `cohinline` container.

---

---
[TOPIC: fonts-and-text] [TYPE: concept] [SEVERITY: info] [SOURCE: building-rich-text.mdx]
## Emoji Support via COLRv0 and COLRv1 Fonts

Gameface natively supports color emoji glyphs through `COLRv0` and `COLRv1` font formats (the layered color glyph specifications used by modern OS emoji fonts). No special configuration is needed — load an emoji font via `@font-face` and reference it in the fallback chain.

```css
@font-face {
    font-family: 'NotoEmoji';
    src: url('coui://uiresources/fonts/NotoColorEmoji.ttf') format('truetype');
}
body { font-family: 'GameUI', 'NotoEmoji', sans-serif; }
```

---

---
[TOPIC: fonts-and-text] [TYPE: api] [SEVERITY: high] [SOURCE: auto-scaling-text.mdx]
## coh-font-fit-mode: Auto-Scaling Text to Fit Containers

The `coh-font-fit-mode` CSS property scales text to fit within its container. Accepted values:

- `none` (default) — no scaling, text may overflow
- `shrink` — only shrinks the font if text exceeds the container, never grows
- `fit` — scales up or down to fill the container

Use `coh-font-fit-min-size` and `coh-font-fit-max-size` to clamp the range:

```css
.objective-text {
    coh-font-fit-mode: shrink;
    coh-font-fit-min-size: 10px;
    font-size: 18px; /* set near expected fit size for performance */
    width: 20rem;
    height: 2rem;
}
```

---

---
[TOPIC: fonts-and-text] [TYPE: constraint] [SEVERITY: high] [SOURCE: auto-scaling-text.mdx]
## coh-font-fit-mode Performance Cost

`coh-font-fit-mode` uses a **linear search** to find the correct font size — starting from the declared `font-size`, it increments or decrements by one point until the text fits the container. Setting `font-size` close to the expected final rendered size dramatically reduces the number of iterations.

Setting `font-size: 8px` on a label that typically needs `22px` means the engine tests 14 intermediate sizes before landing on the right one. Each test requires a full text layout pass. Declare `font-size` as close to the expected fit as possible.

Interactive elements (inputs, editable fields) do not support `coh-font-fit-mode`.

---

---
[TOPIC: fonts-and-text] [TYPE: constraint] [SEVERITY: high] [SOURCE: text-rendering.mdx]
## Expensive Text CSS Properties

Three CSS text properties are significantly more expensive to compute than others in Gameface and should be used sparingly or on limited elements:

- **`overflow-wrap: anywhere`** — breaks words at arbitrary character boundaries, requires O(n²) text breaking analysis.
- **`text-overflow: ellipsis`** — triggers an extra layout pass to calculate truncation point.
- **`text-align: justify`** — requires measuring inter-word spacing after initial layout.

For performance-critical HUD labels (health, ammo, timers), use `text-overflow: clip` or no overflow handling rather than `ellipsis`.

---

---
[TOPIC: fonts-and-text] [TYPE: concept] [SEVERITY: medium] [SOURCE: auto-scaling-text.mdx]
## RTL Text and Manual Layout Reversal

Gameface does not automatically flip physical-axis layout properties for RTL languages. When a localized string is RTL (Arabic, Hebrew), you must manually mirror the CSS:

- Change `text-align: left` to `text-align: right`
- Swap `padding-left`/`padding-right` and `margin-left`/`margin-right`
- Use `direction: rtl` on the container to reverse flex item order

Detect RTL requirement from the active language via `engine.translate()` or a custom media query `@media (language: ar)` and apply it via CSS class.

```css
:root.lang-ar .chat-message { text-align: right; direction: rtl; }
```

---

---
[TOPIC: fonts-and-text] [TYPE: concept] [SEVERITY: medium] [SOURCE: text-rendering.mdx]
## Simple vs. Complex Text Rendering Paths

Gameface uses two internal text rendering paths:

- **Simple text:** Latin characters, basic Unicode, no bidirectional (BiDi) complexity. Fast cache path.
- **Complex text:** RTL scripts, combining characters, diacritics, ligatures (Arabic, Hebrew, Devanagari). Each glyph requires the complex shaping engine — significantly slower to compute.

Keep HUD labels (health, ammo, timer) in Latin characters where possible. Route complex script rendering to dedicated text elements so the majority of the UI stays on the fast simple path.

---
