# Live Views
<!-- SOURCE FILES: live-views.mdx -->
<!-- STATUS: complete -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: live-views] [TYPE: concept] [SEVERITY: high] [SOURCE: live-views.mdx]
## What Are Live Views

A **Live View** in Gameface is a named GPU texture that the game engine renders directly into, and which the UI can display as an image. Unlike a static texture file, a Live View is a **streaming render target** — the engine updates it every frame with fresh 3D content (a minimap, an in-world camera feed, a weapon preview).

The UI side treats it as a regular image source — `<img src="coui://LiveView/MinimapCamera">` or `background-image: url(coui://LiveView/MinimapCamera)`. Naming, resolution, and update frequency are configured from the C++ side.

---

---
[TOPIC: live-views] [TYPE: api] [SEVERITY: high] [SOURCE: live-views.mdx]
## Displaying a Live View in HTML

Reference a Live View by its `coui://LiveView/<name>` URL. Use in `<img>` or `background-image`:

```html
<!-- As an img element -->
<img
    id="minimap"
    src="coui://LiveView/MinimapCamera"
    width="200"
    height="200"
    alt=""
/>
```

```css
/* As a background */
.weapon-preview {
    background-image: url('coui://LiveView/WeaponCamera');
    background-size: cover;
    width: 15rem;
    height: 10rem;
}
```

The live view begins streaming as soon as the element is added to the DOM. There is no explicit "connect" call from JavaScript.

---

---
[TOPIC: live-views] [TYPE: pattern] [SEVERITY: medium] [SOURCE: live-views.mdx]
## Handling Loading State and Fallbacks

A Live View may not be available immediately when the HTML loads — the 3D camera may not yet be initialized. The `<img>` will be blank until the engine provides the first frame.

Provide a fallback background and add a CSS transition to fade the live view in once the image loads:

```css
.minimap-img {
    background-color: #1a1a1a; /* visible while live view is unavailable */
    opacity: 0;
    transition: opacity 0.3s ease;
}
.minimap-img.loaded { opacity: 1; }
```

```javascript
document.getElementById('minimap').addEventListener('load', (e) => {
    e.target.classList.add('loaded');
});
```

---

---
[TOPIC: live-views] [TYPE: concept] [SEVERITY: medium] [SOURCE: live-views.mdx]
## Sizing and Resolution Considerations

The Live View texture resolution is set from C++ and is independent of the CSS size of the HTML element displaying it. A `200×200` CSS element displaying a `1920×1080` render target will downscale in real time — expensive and rarely intended.

Best practice: tell the C++ team the exact CSS pixel dimensions of the Live View element (in reference-resolution pixels). They should create the render target at that size. For a `200px × 200px` minimap on a 1080p reference, request a `200×200` render target.

```css
/* CSS element size: matches the render target resolution requested from C++ */
.minimap-live-view {
    width: 200px;
    height: 200px;
}
```

---

---
[TOPIC: live-views] [TYPE: concept] [SEVERITY: medium] [SOURCE: live-views.mdx]
## Performance: Activating, Multiple Views, and Resolution

Three Live View performance rules from the source documentation:

1. **Activation cost:** Each time a Live View element enters the DOM or transitions from `display: none`, the engine activates the render target. Minimize toggling.
2. **Resolution scales quadratically:** A 512×512 Live View uses 4× the GPU memory of a 256×256 one at the same element size. Request the smallest render target that looks acceptable.
3. **Multiple concurrent Live Views:** Each active Live View is an additional render pass. The cost is additive — two Live Views at 256×256 are cheaper than one at 512×512. Keep active count low, especially on lower-end hardware.

---

---
[TOPIC: live-views] [TYPE: pattern] [SEVERITY: medium] [SOURCE: live-views.mdx]
## Integration Pattern: Data Binding with a Live View

Live Views are often paired with engine data to show contextual information alongside the 3D feed. A typical minimap panel combines a live view image with overlaid data-bound HTML elements (player position marker, quest markers):

```html
<div class="minimap-panel" style="position: relative; width: 200px; height: 200px;">
    <img id="minimap-feed" src="coui://LiveView/MinimapCamera" style="width: 100%; height: 100%;"/>
    <!-- Overlay elements positioned via JS from engine data -->
    <div class="player-dot"
         data-bind-style-left="{{minimap.playerX}}"
         data-bind-style-top="{{minimap.playerY}}">
    </div>
</div>
```

---
