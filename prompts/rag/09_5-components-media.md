# GamefaceUI Media Components
<!-- SOURCE: https://gameface-ui.coherent-labs.com/components/ -->
<!-- EXTRACTED: 2026-06-05; Image, BackgroundImage, Icon, MaskImage and atlases updated 2026-10-21 from the Gameface-UI repo docs (5.0.0) -->
<!-- METHOD: live-fetch — content sourced directly from docs site; updated chunks from docs/src/content/docs/ in the Gameface-UI repo -->
<!-- STATUS: partial -->
<!-- PAGES FETCHED: https://gameface-ui.coherent-labs.com/components/media/background-image/, https://gameface-ui.coherent-labs.com/components/media/icon/, https://gameface-ui.coherent-labs.com/components/media/image/, https://gameface-ui.coherent-labs.com/components/media/live-view/, https://gameface-ui.coherent-labs.com/components/media/mask-image/ -->
<!-- REPO FILES: components/Media/image.mdx, components/Media/mask-image.mdx, components/Media/icon.mdx, components/Media/background-image.mdx, docs/concepts/images-and-atlases.mdx -->
<!-- PAGES FAILED: none -->

---
[TOPIC: gameface-ui-components]
[TYPE: api]
[SEVERITY: critical]
[STATUS: verified]
[VERIFIED-BY: repo-docs]
[SOURCE: components/Media/image.mdx]

## Image Component: Dot Paths, Props and Atlas Usage

`Image` renders an image asset as the **background of a `div`** — not an `<img>`. Every raster image (`.png`, `.jpg`, `.jpeg`, `.webp`) under `src/assets` is exposed as a property of `Image`, matching the folder structure. Dot paths need no import, are typed and autocompleted, a mistyped path is a build error, and they are the **only** form that can be packed into a texture atlas.

```jsx
import Image from '@components/Media/Image/Image';

<Image.icons.hud.grenade />
<Image.icons.gamepad.xbox.a style={{ width: '2rem', height: '2rem' }} />
```

Use `src` only for assets outside `src/assets`, runtime paths, and SVGs. SVGs have no dot path and are never atlassed. Don't use `?url` imports for icons — use the dot path.

```jsx
import MySvg from '@assets/my-svg.svg';

<Image src={MySvg} />
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `style` | `JSX.CSSProperties` | `{}` | Inline styles applied to the root element. |
| `class` | `string` | `""` | CSS class names. |
| `ref` | `HTMLDivElement` | `undefined` | DOM element reference. |
| `src` | `string` | `undefined` | Asset source. Not needed for dot-path images. |
| `fill` | `boolean` | `false` | Sets width and height to 100% of the parent. |
| `options` | `{ repeat?: 'both' \| 'x' \| 'y', size?, position? }` | `undefined` | Background-mode drawing: `size` takes `contain`/`cover` or any `background-size`; `position` takes any `background-position`. |

**Behavior:**
- **Default size:** with no `options` and no dimensions, `Image` is a 3.5rem square drawn with `contain`, centered. Set `width`/`height` via `style`/`class`, or use `fill`.
- **Background mode:** passing `options` makes `Image` behave like a background image — it drops the default size, fills only the dimensions you give it, and can wrap children. An image rendered with `options` is **never packed into an atlas**.
- **Computed keys** (`<Dynamic component={Image.icons.gamepad.ps5[key()]} />`) pull the whole folder into the view and onto its atlas sheet. Prefer an explicit map:

```jsx
const glyphs = {
    a: Image.icons.gamepad.xbox.a,
    b: Image.icons.gamepad.xbox.b,
};

<Dynamic component={glyphs[key()]} />
```

**Limitations:**
- Can't be rendered inside a `cohinline` paragraph or `InlineTextBlock` — use a plain `<img>` there (it is not packed).
- No load-error fallback (it's a `div` with a background).
- Only available in the full Gameface UI template: it depends on the generated `ImageTypes.ts` and the images plugin in `vite.config.mts`.

> ⚠️ GAMEFACE UI CONSTRAINT: Project images go through `Image.<path>` dot paths so the atlas plugin can pack them. Don't use `?url` imports or the deprecated `BackgroundImage`/`Icon` components.

---
[TOPIC: gameface-ui-components]
[TYPE: concept]
[SEVERITY: high]
[STATUS: verified]
[VERIFIED-BY: repo-docs]
[SOURCE: docs/concepts/images-and-atlases.mdx]

## Image Atlas Plugin: Texture Atlases for Image Dot Paths

The template's images plugin (`gamefaceImages` in `vite.config.mts`) does two things:

1. Exposes files from `src/assets` as `Image.folder.name` and writes the generated types file (`src/components/Media/Image/ImageTypes.ts`) on every build and during dev.
2. Optionally packs the images each view actually uses into PNG texture atlases at build time, and writes a `window.__GF_ATLAS__` lookup into the view entry. `Image` looks up its file there and renders the sprite, or falls back to the normal file.

**Atlases exist only in builds, not in dev.** In development every image is a regular asset.

**Atlassing is opt-in** through `atlas` groups. Without `atlas`, the `Image.*` syntax and types still work but every image ships as its own file.

```ts
gamefaceImages({
  assets: resolve(__dirname, 'src/assets'),
  types: resolve(__dirname, 'src/components/Media/Image/ImageTypes.ts'),
  atlas: [
    'icons/hud',                       // shorthand for { include: 'icons/hud/**' }
    { include: 'icons/gamepad/**', exclude: 'icons/gamepad/ps5/**', name: 'glyphs', padding: 4 },
    '**',                              // catch-all last
  ],
  atlasDefaults: { squareCells: true },
});
```

Patterns are relative to `assets`; the first matching group wins, so put specific groups first and catch-alls last. Key settings: `maxWidth`/`maxHeight` (2048), `padding` (2 — raise it if sprites bleed at fractional scales), `pot` (true), `squareCells` (false), `maxSpriteSize` (2048), `keepOriginals` (false).

**Why atlas:** not smaller files or faster drawing — a sprite costs about the same to draw. The win is texture creation: thirty icons become one texture, and a handful of sheets can be **preloaded** by the integration before a view opens, so opening it costs no texture allocation. Sheets are written to `dist/assets/atlas-{view}-{group}.png` with no content hash, so registered preload paths stay valid. The tradeoff is GPU memory: a 1024x1024 sheet is ~4 MB RGBA8 even if mostly empty.

**An image is packed only if** it's written as `Image.folder.name`, has no `options` prop, matches a group and isn't excluded, and isn't larger than `maxSpriteSize`. Otherwise it stays a normal file and the build report (terminal + `dist/atlas-report.txt`) lists it under `skipped` with the reason. Images used only in a `lazy()` component go on the sheet of the view that loads it.

**Pitfalls:**
- `options` passed through spread props or dynamic access (`{...rest}`, `glyphs[key()]`) can't be detected: the image is packed, its original removed, and it renders blank. Set `keepOriginals: true` on that group.
- A packed image also referenced from CSS (`background-image: url('@assets/...')`) breaks once its original is removed — set `keepOriginals: true` on the group.
- Images with identical bytes ship as one file and which copy is kept is undefined — keep one copy.

---
[TOPIC: gameface-ui-components]
[TYPE: api]
[SEVERITY: high]
[STATUS: deprecated]
[VERIFIED-BY: repo-docs]
[SOURCE: components/Media/background-image.mdx]

## BackgroundImage (Deprecated since 5.0.0): Migrate to Image

`BackgroundImage` is deprecated since Gameface UI 5.0.0 and removed from the boilerplate. Use `Image` with `options` — it accepts the same `src`, `fill` and `options` props and renders identically, and dot-path images can be packed into an atlas.

```diff
- <BackgroundImage src={bg} options={{ size: 'contain' }} />
+ <Image src={bg} options={{ size: 'contain' }} />
```

Check call sites that passed **no** `options`: `Image` defaults to a 3.5rem square, where `BackgroundImage` had no size of its own. Give those an explicit size or `fill`.

---
[TOPIC: gameface-ui-components]
[TYPE: api]
[SEVERITY: high]
[STATUS: deprecated]
[VERIFIED-BY: repo-docs]
[SOURCE: components/Media/icon.mdx]

## Icon (Deprecated since 5.0.0): Migrate to Image Dot Paths

`Icon` is deprecated since Gameface UI 5.0.0 and removed from the boilerplate. `Image` offers the same dot-path syntax over the whole `src/assets` folder. `Icon` keys started at `src/assets/icons`, so an `icons.` segment appears at the front:

```diff
- <Icon.gamepad.xbox.a />
+ <Image.icons.gamepad.xbox.a />
```

`Image` renders a `div` with a background rather than an `<img>`, so there is no load-error fallback — but a mistyped path is now a build error instead of a missing image at runtime.

---
[TOPIC: gameface-ui-components]
[TYPE: api]
[SEVERITY: high]
[STATUS: NEEDS-VERIFICATION]
[MISSING: props table]
[VERIFIED-BY: live-fetch]
[SOURCE: https://gameface-ui.coherent-labs.com/components/media/live-view/]

## LiveView: Props and Usage

The `LiveView` component renders an engine-provided texture (a live view) in the UI using the `<live-view>` custom element.

**Import:**
```typescript
import LiveView from '@components/Media/LiveView/LiveView';
```

> 🚫 PARTIAL — The following were not found on the docs page and have been omitted:
> - Formal Props table (no API table was rendered on the fetched page)
> Do NOT fill these from training data. Leave for human verification.

**Minimal example:**
```typescript
import LiveView from '@components/Media/LiveView/LiveView';const App = () => {    return (        <LiveView src="engine://my-view" style={{ width: '400px', height: '300px' }} />    );};export default App;
```

---
[TOPIC: gameface-ui-components]
[TYPE: api]
[SEVERITY: high]
[STATUS: verified]
[VERIFIED-BY: repo-docs]
[SOURCE: components/Media/mask-image.mdx]

## MaskImage: Props and Usage

The `MaskImage` component renders a `div` with a CSS mask-image over its children; content is visible through the colored areas of the mask. It takes `.png`, `.jpg` or `.svg` imported from your assets folder through `src` (it has no dot-path form). The mask size is separate from the container size: size the container with `style`/`class`, and the mask with `options.size`. With no `options`, the mask is drawn at its original size, unrepeated, at the top left.

**Import:**
```typescript
import MaskImage from '@components/Media/MaskImage/MaskImage';
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `style` | `JSX.CSSProperties` | `{}` | Inline styles to apply directly to the component's root element. |
| `class` | `string` | `""` | Additional CSS classes to apply to the component. |
| `ref` | `HTMLDivElement` | `undefined` | Retrieves the component's DOM element. |
| `src` | `string` | `undefined` | The URL source of the mask image. |
| `fill` | `boolean` | `false` | Sets the component's `width` and `height` to 100% of its container. |
| `options` | `{ repeat?: 'both' \| 'x' \| 'y'; size?; position? }` | `undefined` | Mask drawing: `size` takes `contain`/`cover` or any `mask-size`; `position` takes any `mask-position` (default `top left`); no repeat by default. |

Type shared options with `ImageOptions` from `@components/Media/shared/types` (formerly `ImageBaseOptions` from `ImageBase`).

**Minimal example:**
```jsx
import MaskImage from '@components/Media/MaskImage/MaskImage';
import Mask from '@assets/mask.png';

const App = () => (
    <MaskImage src={Mask} options={{ size: 'contain' }} style={{ width: '150px', height: '150px' }}>
        <div>Masked content</div>
    </MaskImage>
);
```

---
