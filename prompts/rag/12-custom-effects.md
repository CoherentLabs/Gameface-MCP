# Custom Effects
<!-- SOURCE FILES: advanced-visuals.mdx, compositor.mdx -->
<!-- SOURCE URLS: https://docs.coherent-labs.com/cpp-gameface/integration/optional_features/customeffects_native/ -->
<!-- STATUS: complete -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: custom-effects] [TYPE: concept] [SEVERITY: high] [SOURCE: customeffects_native]
## coh-custom-effect-* Properties: What They Are

Gameface (since v1.9.5) exposes four proprietary CSS properties that let the frontend pass arbitrary data to a C++ rendering backend for applying a custom GPU shader over a DOM element. This is the "texture-as-filter" pattern: the element's rendered content is passed as an input texture to your shader, which then outputs the modified pixel result.

The four properties are:

- `coh-custom-effect-name` — a string naming the effect (e.g., `"TwirlEffect"`). Setting this property **activates** the custom effect pipeline for the element and emits `renoir::DrawCustomEffectCmd` commands instead of the normal draw path.
- `coh-custom-effect-float-param-1` through `coh-custom-effect-float-param-12` — up to 12 float parameters passed to the shader. **Params 1–4 are animatable** (can be keyframed or transitioned). **Params 5–12 are not animatable**.
- `coh-custom-effect-string-param-1` and `coh-custom-effect-string-param-2` — two string parameters for the shader (e.g., texture URL, effect variant name).

> ⚠️ GAMEFACE CONSTRAINT: `coh-custom-effect-*` properties have no visual effect on their own — they only work if the C++ backend implements a `renoir::ICustomEffectRenderer` handler and the view is registered via `cohtml::View::SetSceneCustomEffectRenderer`.

---

---
[TOPIC: custom-effects] [TYPE: pattern] [SEVERITY: high] [SOURCE: customeffects_native]
## CSS Usage: Naming an Effect and Passing Parameters

Apply `coh-custom-effect-name` to any element to opt it out of standard rendering and into the custom shader pipeline. Pass float parameters for the shader to consume. Parameters 1–4 can be animated with `@keyframes`:

```css
#heatHazePanel {
    position: absolute;
    width: 40rem;
    height: 20rem;
    coh-custom-effect-name: HeatHaze;
    background-image: url('coui://uiresources/scene_capture.png');
    animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
    from {
        coh-custom-effect-float-param-1: 0.0;   /* wave amplitude */
        coh-custom-effect-float-param-2: 0.02;  /* wave frequency */
    }
    to {
        coh-custom-effect-float-param-1: 0.08;
        coh-custom-effect-float-param-2: 0.04;
    }
}
```

Note: only float params 1–4 can be targets of `@keyframes` or `transition`. Params 5–12 can only be set to static values or updated from JavaScript.

---

---
[TOPIC: custom-effects] [TYPE: api] [SEVERITY: high] [SOURCE: customeffects_native]
## JavaScript Access to Float Parameters

Custom effect float parameters can also be set and updated via JavaScript using camelCase property names on the element's `style` object. This is the correct path for updating non-animatable params (5–12) or for triggering per-frame shader updates:

```javascript
const el = document.getElementById('heatHazePanel');

// Setting float params from JS (param N → cohCustomEffectFloatParamN)
el.style.cohCustomEffectFloatParam1 = 0.05;  // animatable
el.style.cohCustomEffectFloatParam6 = 1.0;   // non-animatable, JS only

// Sliders driving shader parameters
const slider = document.getElementById('intensity-slider');
slider.addEventListener('input', (e) => {
    el.style.cohCustomEffectFloatParam2 = e.target.value / 100;
});
```

---

---
[TOPIC: custom-effects] [TYPE: constraint] [SEVERITY: critical] [SOURCE: customeffects_native]
## Forcing Redraws When Shader Inputs Change

The Gameface SDK tracks "dirty rectangles" and only repaints elements that have changed. If you update shader parameters (e.g., a global time uniform on the C++ side) without notifying the SDK, the element will appear frozen even though the C++ shader is receiving new values.

**Two solutions:**

1. **Infinite animation on a float param** — use a dummy `@keyframes` on any animatable param (1–4) to force the element to be marked dirty every frame. Consumes one float param slot:

```css
#effectElement {
    coh-custom-effect-name: MyEffect;
    animation: forceRedraw 1s infinite;
}
@keyframes forceRedraw {
    from { coh-custom-effect-float-param-4: 0; }
    to   { coh-custom-effect-float-param-4: 1; }
}
```

2. **JS style write** — set any float param to a new value from JavaScript on each frame tick. The SDK treats style writes as dirty:

```javascript
let tick = 0;
function onFrame() {
    el.style.cohCustomEffectFloatParam4 = (++tick % 2) * 0.001; // tiny oscillation
    requestAnimationFrame(onFrame);
}
requestAnimationFrame(onFrame);
```

> ⚠️ GAMEFACE CONSTRAINT: Option 1 forces the element to be fully redrawn every frame regardless of whether the actual visual output changes. Use it only when the effect genuinely changes every frame (e.g., animated shader).

---

---
[TOPIC: custom-effects] [TYPE: concept] [SEVERITY: high] [SOURCE: customeffects_native]
## C++ Contract: renoir::ICustomEffectRenderer

On the C++ side, implement `renoir::ICustomEffectRenderer` and register it on the View. The SDK calls `OnRenderCustomEffect` when drawing a custom-effect element, passing a `DrawCustomEffectCmd` that contains everything needed to run the shader:

| Field | Type | Description |
|---|---|---|
| `Texture` | `Texture2DObject` | Input texture (the element's rendered content) |
| `UVScaleBias` | `float4` | UV scale (.xy) and offset (.zw) for atlas-packed textures |
| `TargetGeometryPositionSize` | `float4` | Position (.xy) and size (.zw) in the render target, in pixels |
| `Viewport` | `float4` | Current viewport for the render target |
| `RenderTargetSize` | `float2` | Full render target dimensions |
| `TransformMatrix` | `float4x4` | CSS transform matrix of the element quad |
| `UserData` | `void*` | Arbitrary pointer set via `SetSceneCustomEffectRenderer` |
| `Effect.Name` | `const char*` | Value of `coh-custom-effect-name` CSS property |
| `Effect.Params[0..3]` | `float` | Values of `coh-custom-effect-float-param-1` through `4` |
| `Effect.StringParams[0..1]` | `const char*` | Values of `coh-custom-effect-string-param-1` and `2` |

Register the renderer after creating the View:
```cpp
m_View->SetSceneCustomEffectRenderer(
    &myCustomRenderer,   // implements ICustomEffectRenderer; nullptr if handling in backend directly
    m_CustomHandler.get() // arbitrary user data — accessible as DrawCustomEffectCmd::UserData
);
```

---

---
[TOPIC: custom-effects] [TYPE: api] [SEVERITY: high] [SOURCE: customeffects_native]
## Vertex Format and Shader Setup

The SDK pre-binds a quad vertex buffer for the element's geometry. The vertex format passed to your vertex shader is:

```hlsl
struct VS_INPUT
{
    float4 Position  : POSITION;
    float4 Color     : TEXCOORD0;
    float4 Additional : TEXCOORD1; // .xy = texture coordinates
};
```

For the pixel shader, sample the input texture at `input.Additional.xy` (when using the pre-bound SDK vertex buffer). If you provide your own quad geometry with UVs [0..1], correct the UV using `UVScaleBias`:

```hlsl
// When using the SDK pre-bound vertex buffer:
float4 color = SAMPLE2D(txBuffer, input.Additional.xy);

// When using custom quad with UVs [0..1]:
float2 uv = input.Additional.xy * UVScaleBias.xy + UVScaleBias.zw;
float4 color = SAMPLE2D(txBuffer, uv);
```

A complete minimal pixel shader using the pre-bound buffer with float parameters:
```hlsl
float4 CustomEffect(PS_INPUT input) : SV_Target
{
    float4 outColor = SAMPLE2D(txBuffer, input.Additional.xy);
    // PrimProps0.rgb ← coh-custom-effect-float-param-1/2/3
    outColor.rgb = saturate(outColor.rgb * PrimProps0.rgb);
    return outColor * input.Color.a;
}
```

---

---
[TOPIC: custom-effects] [TYPE: pattern] [SEVERITY: high] [SOURCE: customeffects_native]
## Full Example: Animated Color Multiplication Effect

This end-to-end example animates an RGB color multiplication over a background image using three float params:

**HTML/CSS:**
```html
<div id="customEffect"></div>
```
```css
#customEffect {
    position: absolute;
    left: 100px; top: 100px;
    width: 100px; height: 100px;
    coh-custom-effect-name: TheOnlyEffectThatShouldBeRendered;
    background-image: url('icon.png');
    animation: pulse 2s infinite;
}
@keyframes pulse {
    from {
        coh-custom-effect-float-param-1: 0;
        coh-custom-effect-float-param-2: 1;
        coh-custom-effect-float-param-3: 0.4;
    }
    to {
        coh-custom-effect-float-param-1: 1;
        coh-custom-effect-float-param-2: 0;
        coh-custom-effect-float-param-3: 0.9;
    }
}
```

**C++ handler (minimal skeleton):**
```cpp
class CustomEffectHandler : public renoir::ICustomEffectRenderer {
public:
    virtual void OnRenderCustomEffect(
        const DrawCustomEffectCmd& command,
        const RenderState& targetState) override
    {
        // In the simple render-thread case, nothing is needed here.
        // Handle the BC_DrawCustomEffect command directly in the backend.
    }
};
// After View creation:
m_View->SetSceneCustomEffectRenderer(nullptr, m_CustomEffectHandler.get());
```

The float params arrive at the backend as `command.Effect.Params[0]`, `[1]`, `[2]` (params are zero-indexed internally; `coh-custom-effect-float-param-1` → `Params[0]`).

---

---
[TOPIC: custom-effects] [TYPE: concept] [SEVERITY: medium] [SOURCE: customeffects_native]
## Multi-Pass Effects and Render State Restoration

For effects requiring multiple render passes (e.g., two-pass Gaussian blur), you must change the render target between passes. After your intermediate passes, **restore the graphics state** before the final pass using the `ICustomEffectRenderer::RenderState` parameter provided to `OnRenderCustomEffect` — it contains the complete backend command stream the SDK expects to be re-applied.

Since Gameface v1.15, state restoration is handled automatically: the SDK **invalidates its entire internal state** after any `DrawCustomEffectCmd`, so manual restoration is no longer required if you are on v1.15+.

---

---
[TOPIC: custom-effects] [TYPE: concept] [SEVERITY: medium] [SOURCE: customeffects_native]
## Threading: Layout Thread vs Render Thread

By default, `OnRenderCustomEffect` is called on the **Render Thread**. To move it to the Layout thread (to free Render thread capacity), set:

```cpp
cohtml::ViewSettings settings;
settings.ExecuteCommandProcessingWithLayout = true;
// Create view with these settings
```

When `ExecuteCommandProcessingWithLayout = true`, the `OnRenderCustomEffect` callback for that view fires on the Layout thread instead. This is useful when custom effect processing is CPU-bound and you want to parallelize it with rendering.

---

---
[TOPIC: custom-effects] [TYPE: concept] [SEVERITY: high] [SOURCE: compositor.mdx]
## coh-composition-id: Detaching UI Elements for 3D Placement

`coh-composition-id` is a Gameface-proprietary CSS property that detaches an HTML element from the 2D screen plane and allows the game engine to composite it in 3D world space (diegetic UI). The element renders into its own compositing layer; the C++ engine reads the output and places it at an arbitrary 3D transform.

Enable it by setting `transform-style: preserve-3d` on the parent container and `coh-composition-id: <name>` on the element to detach:

```css
.world-ui-anchor {
    transform-style: preserve-3d;
}
.npc-nameplate {
    coh-composition-id: npc-nameplate-01;
    width: 20rem;
    height: 3rem;
    opacity: 0;
    transition: opacity 0.2s ease;
}
.npc-nameplate.visible { opacity: 1; }
```

Standard pointer events do not work on composited elements — the HTML layout position no longer matches the visible screen position. Input routing must be handled from C++.

---

---
[TOPIC: custom-effects] [TYPE: concept] [SEVERITY: medium] [SOURCE: advanced-visuals.mdx]
## UI Surface Partitioning (coh-partitioned)

`coh-partitioned: on` requests that the compositor render a top-level element into a dedicated GPU texture, composited independently from the rest of the UI. Use this to update a frequently changing HUD region (ammo counter, radar) at its own rate without redrawing static regions.

```css
.ammo-counter-group {
    coh-partitioned: on;
    coh-composition-id: ammo-surface;
    position: absolute;
    bottom: 2rem;
    right: 2rem;
}
```

**Constraints:**
- Only direct children of the root view can be partitioned.
- All-or-nothing — you cannot partially partition a subtree.
- No CSS `z-index` management between partitioned surfaces and the main surface.

---
