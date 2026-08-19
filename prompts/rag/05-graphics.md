# Graphics
<!-- SOURCE FILES: image-assets.mdx, svg-ui-tricks.mdx, advanced-ui-shapes.mdx, animated-assets.mdx, advanced-visuals.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: graphics] [TYPE: concept] [SEVERITY: medium] [SOURCE: image-assets.mdx]
## SVG vs Raster Images: Choosing the Right Format

Use **SVG** when artwork is geometric/icon-based and needs to scale to multiple sizes without quality loss, or when you need to manipulate parts of it at runtime (e.g., changing fill color via CSS). SVG is vector-based and resolution-independent.

Use **PNG/JPEG raster** for complex photographic or painted artwork, textures, or any asset where per-pixel control is needed. PNGs support alpha transparency. JPEGs are smaller for photographic content but lossy.

The rule of thumb: game icons → SVG; environmental artwork and portraits → raster.

---

---
[TOPIC: graphics] [TYPE: constraint] [SEVERITY: high] [SOURCE: image-assets.mdx]
## SVG Support Limitations in Gameface

External SVG files loaded via `<img>` or `background-image` are rendered as static images — no CSS targeting of internal elements, no JavaScript access to SVG DOM.

**Inline SVG** (embedded in HTML) supports CSS targeting and JavaScript manipulation but increases HTML file size and forces reparsing on every use.

**Unsupported SVG features:** scripting (`<script>` inside SVG), SMIL animations (`<animate>`, `<animateTransform>`), `<foreignObject>`, SVG filters (`<feBlend>`, `<feColorMatrix>` etc.), and embedded `<image>` elements.

> ⚠️ GAMEFACE CONSTRAINT: SMIL and SVG filter effects are not rendered. Replace SMIL animations with CSS `@keyframes` applied to SVG elements. Replace SVG filters with CSS `filter` where supported.

---

---
[TOPIC: graphics] [TYPE: pattern] [SEVERITY: medium] [SOURCE: svg-ui-tricks.mdx]
## Inline SVG: Dynamic Color via CSS Custom Properties

Use CSS custom properties to drive `fill` and `stroke` values of inline SVG paths, allowing the same SVG to render in different colors based on game state without duplicating markup:

```html
<svg class="ability-icon" viewBox="0 0 24 24">
    <path d="M12 2L2 19h20L12 2z" fill="var(--ability-icon-color)"/>
</svg>
```

```css
.ability-icon { --ability-icon-color: #ffffff; }
.ability-icon--active { --ability-icon-color: #ffcc00; }
.ability-icon--unavailable { --ability-icon-color: #555555; }
```

---

---
[TOPIC: graphics] [TYPE: pattern] [SEVERITY: medium] [SOURCE: svg-ui-tricks.mdx]
## SVG stroke-dasharray and stroke-dashoffset for Progress Arcs

Circular progress indicators (skill cooldowns, ability charges) are efficiently implemented using `stroke-dasharray` to define the total arc length and `stroke-dashoffset` to control how much is "drawn":

```html
<svg viewBox="0 0 100 100">
    <circle class="progress-track" cx="50" cy="50" r="45" fill="none" stroke="#333" stroke-width="8"/>
    <circle class="progress-fill" cx="50" cy="50" r="45" fill="none"
        stroke="#ffcc00" stroke-width="8"
        stroke-dasharray="282.7" stroke-dashoffset="0"/>
</svg>
```

```css
/* stroke-dasharray = 2πr ≈ 282.7 for r=45 */
.progress-fill {
    /* Bind stroke-dashoffset to progress value via data-bind-style-stroke-dash-offset */
    transition: stroke-dashoffset 0.2s ease;
}
```

> ⚠️ GAMEFACE CONSTRAINT: `stroke-dasharray` and `stroke-dashoffset` must include explicit units (`px`) when applied to SVG elements shared with HTML contexts.

---

---
[TOPIC: graphics] [TYPE: pattern] [SEVERITY: medium] [SOURCE: svg-ui-tricks.mdx]
## SVG viewBox for Minimap Panning

The `viewBox` attribute on an SVG element controls which region of the SVG canvas is visible. Update it via JavaScript to implement minimap panning — no JavaScript transforms or absolute positioning required:

```javascript
function panMinimapTo(worldX, worldY) {
    const vpSize = 200;  // visible area size
    const mapEl = document.getElementById('minimap-svg');
    mapEl.setAttribute('viewBox', `${worldX - vpSize/2} ${worldY - vpSize/2} ${vpSize} ${vpSize}`);
}
```

---

---
[TOPIC: graphics] [TYPE: pattern] [SEVERITY: medium] [SOURCE: advanced-ui-shapes.mdx]
## Nine-Slice Scaling with border-image

Scale UI panels without distorting corners using `border-image` (nine-slice scaling). The image is divided into a 3×3 grid — corners are drawn at fixed size, edges and center are stretched. This prevents "stretched corner" artifacts on resizable dialog boxes.

```css
.panel-frame {
    border-image-source: url(assets/panel-frame.png);
    border-image-slice: 30 fill;  /* 30px inset on all sides; fill = draw center */
    border-image-width: 30px;
    border-image-outset: 0;
    border-image-repeat: stretch;
    /* Must also set border-width to activate */
    border: 30px solid transparent;
}
```

---

---
[TOPIC: graphics] [TYPE: pattern] [SEVERITY: medium] [SOURCE: advanced-ui-shapes.mdx]
## clip-path for Geometric UI Shapes

`clip-path: polygon()` creates hard-edged geometric shapes: hexagonal frames, angled health bars, triangular banners:

```css
/* Hexagonal avatar frame */
.avatar {
    clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}

/* Angled status bar */
.status-bar {
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 100%, 10px 100%);
}
```

> ⚠️ GAMEFACE CONSTRAINT: `clip-path: path()` using SVG path data is not supported. Use `polygon()` or `circle()` variants only.

---

---
[TOPIC: graphics] [TYPE: pattern] [SEVERITY: medium] [SOURCE: advanced-ui-shapes.mdx]
## mask-image for Soft Edge Blending and Silhouettes

`mask-image` cuts out shapes using alpha channel of another image or a gradient. Unlike `clip-path`, edges can be soft/feathered:

```css
/* Feathered minimap circle with gradient mask */
.minimap {
    mask-image: radial-gradient(circle, black 60%, transparent 100%);
}

/* Faction emblem shape using a PNG mask */
.emblem {
    mask-image: url(assets/emblem-mask.png);
    mask-size: 100% 100%;
}
```

---

---
[TOPIC: graphics] [TYPE: concept] [SEVERITY: high] [SOURCE: advanced-visuals.mdx]
## backdrop-filter for Live Scene Blur

`backdrop-filter: blur(12px)` blurs whatever is rendered behind the UI element — including the live 3D game scene. This creates the "frosted glass" effect popular in modern game UIs.

The C++ engine processes the live frame as a **Backdrop Root Image** before compositing the UI. Important: an ancestor with `opacity < 1` blocks the game scene from reaching `backdrop-filter`. The element applying the filter must have a transparent background.

```css
.pause-menu-panel {
    background-color: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(12px);
    /* parent must NOT have opacity < 1 */
}
```

---

---
[TOPIC: graphics] [TYPE: concept] [SEVERITY: medium] [SOURCE: advanced-visuals.mdx]
## UI Surface Partitioning: coh-partitioned

`coh-partitioned: on` instructs the compositor to render that UI region into a dedicated GPU texture, allowing it to be composited at a different frequency than the rest of the UI. Apply it to top-level elements only; all children inside a partitioned surface are included.

```css
.always-updating-ammo-counter {
    coh-partitioned: on;
    coh-composition-id: ammo-surface;
}
```

**Constraints:** Only top-level elements can be partitioned. All or nothing — partial partitioning of a subtree is not supported. There is no `z-index` management between partitioned surfaces and the main surface; lay them out carefully.

---

---
[TOPIC: graphics] [TYPE: concept] [SEVERITY: high] [SOURCE: animated-assets.mdx]
## GIF Support: Limited Use Only

GIFs are supported in Gameface via `<img>` tags but are strongly discouraged for most use cases. They have poor compression (palettes are limited to 256 colors), no audio, and high memory overhead — a 512×512 GIF at 60fps can exceed 100MB in RAM. Additionally, GIF frame timing is not guaranteed to match the game's frame rate.

Safe use: small emoji-style animations in `<img>` tags where quality and memory are not critical. For everything else, prefer CSS animations, sprite sheets, or WebM video.

> ⚠️ GAMEFACE CONSTRAINT: GIFs must be loaded via `<img>` only. `background-image: url(*.gif)` does not animate — only the first frame is displayed.

---

---
[TOPIC: graphics] [TYPE: api] [SEVERITY: medium] [SOURCE: animated-assets.mdx]
## WebM Video with Transparent Channel

Gameface supports `<video>` elements for full-motion video via WebM containers with VP8 or VP9 codec, Vorbis audio. Transparent video (alpha channel) is available with VP8 using a specific `ffmpeg` encode command.

```html
<video id="cutscene" autoplay muted loop>
    <source src="coui://uiresources/video/ability_vfx.webm" type="video/webm"/>
</video>
```

For transparent video: encode with `ffmpeg -i input.mov -c:v vp8 -auto-alt-ref 0 output.webm`.

---

---
[TOPIC: graphics] [TYPE: api] [SEVERITY: medium] [SOURCE: animated-assets.mdx]
## Video Seek Performance: cohfastseek and Prebuffering

Random-seek WebM playback (jumping to an arbitrary timestamp) is slow by default. Use Gameface's custom seek utilities for accurate fast seeks:

- `cohfastseek(videoElement, timeSeconds)` — seeks to a target time accurately and quickly.
- `cohGetKeyframeTimestamps(videoElement, callback)` — retrieves all keyframe timestamps in the video, allowing you to prebuffer frames.
- `cohPrebufferKeyframe(videoElement, timeSeconds)` — warms the decoder at a specific keyframe so the subsequent seek is nearly instantaneous.

Custom events `cohplaybackstalled` and `cohplaybackresumed` fire when decoding hiccups — use them to show/hide a loading indicator.

---

## #TODO — Partial coverage
The following sub-topics from this category were not found in any MDX source:
- CSS `blend-mode` / `mix-blend-mode` support status in Gameface
- `linear-gradient` and `radial-gradient` full syntax and known caveats
- `background-size`, `background-position`, `background-repeat` behavior with Gameface
- Image format support matrix (AVIF, WebP, BMP, DDS, etc.)
