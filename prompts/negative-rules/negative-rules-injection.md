## GAMEFACE CONSTRAINTS — DO NOT VIOLATE

Gameface is a game-UI middleware that ships a subset of web standards. Emit only what the engine actually parses and renders. Lists below come from the feature-detection scraper under `results/`; see `negative-rules-{css,html,js}.md` for per-feature evidence.

### Supported (use freely)
- CSS shorthands propagate (`border`, `background`, `flex`, `font`, `gap`, `margin`, `padding`, `animation`, `transition`, `mask`, `text-decoration`, `text-shadow`, `text-stroke`, `border-radius`, etc.).
- `var(--name, fallback)`, `calc`, `sign`/`pow`/`sqrt`/`hypot`/`log`/`exp`/`sin`/`cos`/`tan`, `rgb`/`rgba`/`color(srgb …)`, `linear-gradient`/`radial-gradient`/`conic-gradient`, `translate*`/`scale*`/`rotate*`/`matrix`/`matrix3d`/`skewX`/`skewY`, `blur`/`brightness`/`contrast`/`drop-shadow`/`grayscale`/`hue-rotate`/`invert`/`opacity`/`saturate`/`sepia`, `cubic-bezier`/`steps`, `circle`/`ellipse`/`polygon`/`inset`/`path`, `repeat`/`minmax`/`fit-content`.
- `var()` is supported in longhand properties only. Never use `var()` inside CSS 
  shorthand properties (`border`, `background`, `font`, `transition`, `animation`, 
  `padding`, `margin`, `flex`, `gap`, `mask`, etc.). The shorthand parser does not 
  resolve custom properties — the entire declaration is silently dropped.
  
  ❌ `border: 1px solid var(--color-border)`       → silently dropped
  ❌ `background: var(--color-bg) url(...) center` → silently dropped  
  ❌ `transition: opacity var(--duration-normal) var(--ease-default)` → silently dropped
  ❌ `padding: var(--space-md) var(--space-lg)`    → silently dropped
  
  ✅ `border-width: 1px`
     `border-style: solid`
     `border-color: var(--color-border)`
  
  ✅ `transition-property: opacity`
     `transition-duration: var(--duration-normal)`
     `transition-timing-function: var(--ease-default)`
- At-rules `@media`/`@supports`/`@layer`/`@container`/`@scope`/`@starting-style`/`@keyframes`; CSS nesting (`& .child`).
- Selectors: type / `.class` / `#id` / `*` / all `[attr…]` / all combinators / `:hover`/`:focus`/`:active`/`:first-child`/`:last-child`/`:is`/`:not`/`:where`/`:lang`/`:root`/`:scope`/`:link`/`:visited`/`:target`, all form-state and media-state pseudos, `::before`/`::after`/`::placeholder`/`::marker`/`::part`/`::highlight`/`::slotted`/`::view-transition*`.
- JS: `console.{log,info,warn,error,debug,assert,time,timeEnd}`, `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval`/`queueMicrotask`, `performance.now()`, `Node`/`NodeList`/`NodeFilter`/`HTMLCollection`, `DOMTokenList` (so `element.classList` works), `Storage`, `Location`.

### CSS — forbidden property families
- Never use the legacy `box-*` flexbox model (`box-align`, `box-flex`, `box-orient`, `box-pack`, …); use the modern flexbox longhands (`align-items`, `flex-grow`, `flex-direction`, `justify-content`).
- Never use logical / writing-mode-relative properties (`*-block`, `*-inline`, `inset-*`, etc.); they are not implemented. Use the physical-axis properties (`top/right/bottom/left`, `margin-top/right/bottom/left`, etc.).
- Never use CSS Grid (`grid`, `grid-template-*`, `grid-area`, `grid-auto-*`, `grid-column*`, `grid-row*`, `grid-gap`); Gameface has no grid layout. Use Flexbox (`display: flex` with the supported subset) instead.
- Never use CSS multi-column layout (`columns`, `column-count`, `column-width`, `column-rule*`, `column-span`, `column-fill`); they are not implemented. Use multiple flex containers if you need column-like layout.
- Never use container queries (`container`, `container-name`, `container-type`); use static breakpoint logic in JS or fixed sizes.
- Never use the anchor-positioning module (`anchor-name`, `position-anchor`, `position-area`, `position-try*`); use script-driven positioning instead.
- Never use scroll-snap, scroll-margin/padding, scrollbar-* customization, scroll-timeline, or overscroll-behavior; none of them are implemented.
- Never use view transitions, view-timeline, scroll-timeline, animation-timeline, or animation-range; only the classic CSS animation longhands are implemented.
- Never use modern typography properties (`font-variant-*`, `font-feature-settings`, `hyphens`, `text-wrap`, `text-justify`, `text-indent`, `text-emphasis-*`, `tab-size`, `word-break`, `word-spacing`, `line-clamp`, `text-decoration-skip*`, etc.); use only the supported font/text properties.
- Never use page-layout / print properties (`page`, `page-break-*`, `break-after/before/inside`, `orphans`, `widows`, `color-scheme`, `print-color-adjust`); not relevant in a game UI runtime.
- Never use list / table / form-control native styling (`list-style*`, `table-layout`, `caption-side`, `border-collapse`, `border-spacing`, `appearance`, `accent-color`, `resize`, `field-sizing`, `ime-mode`, `interpolate-size`); none are implemented. Build list bullets and tables manually with flex.
- Never use these SVG presentation properties (`alignment-baseline`, `baseline-shift`, `dominant-baseline`, `color-interpolation*`, `flood-*`, `lighting-color`, `paint-order`, `marker-*`, `vector-effect`, `glyph-orientation-vertical`, `alt`, `speak*`); not implemented.
- Never use these layout/positioning helpers (`float`, `clear`, `clip`, `object-fit`, `object-position`, `overflow-anchor`, `writing-mode`, `direction`, `zoom`, `translate`/`rotate`/`scale` standalone, `transform-style`, `will-change`, `content-visibility`, `order`, `place-*`, `justify-items/self`, `outline*`, `caret-color`, `tab-size`, `touch-action`, `math-*`); not implemented.
- Never use ruby/CJK/math properties (`ruby-*`, `math-*`); not implemented.
- Never use `background-attachment`, `background-blend-mode`, `background-clip`, or `background-origin`; only `background-color`, `background-image: none|url(...)`, `background-position`, `background-repeat`, and `background-size` are honored.
- Never use `mask-border*`, `mask-composite`, or `mask-origin`; only `mask-image`, `mask-position`, `mask-size`, `mask-repeat`, `mask-clip`, `mask-mode` are honored.
- Never use the CSS motion-path module (`offset-anchor`, `offset-distance`, `offset-path`, `offset-position`, `offset-rotate`); animate position via @keyframes on `transform`/`top`/`left` instead.
- Never use CSS counters (`counter-increment`, `counter-reset`, `counter-set`); inject numbering from JS instead.
- Never use these CSS properties; the engine logs "Unsupported CSS property detected (stylesheet parser)" for each. Members listed in the index JSON.

### CSS — forbidden functions
- Never use the modern color functions (`hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color-mix`); pre-convert to `rgb()`/`rgba()`/`color(srgb …)` (all of which are honored).
- Never use `counter()` or `counters()` in `content`; the engine does not implement CSS counters. Inject the number from JS or pre-render the text.
- Never use `repeating-linear-gradient()` or `repeating-radial-gradient()`; emit a `linear-gradient()`/`radial-gradient()` with enough explicit color stops to look identical. `url(...)`, `image-set(...)`, and `cross-fade(...)` are unverified (resolving them at parse time stalls Gameface); use `url()` only with cached engine-side assets and treat `image-set`/`cross-fade` as missing.
- Treat `url()`, `image-set()`, `cross-fade()` as unverified — the scraper could not safely probe them; do not emit unless an integrator confirms support against the Gameface CSS reference.
- Never use the missing CSS math functions (`clamp`, `min`, `max`, `mod`, `rem`, `round`, `abs`, `asin`, `acos`, `atan`, `atan2`); precompute the value in JS or use `calc()` with arithmetic that resolves to a constant. `calc`, `sign`, `pow`, `sqrt`, `hypot`, `log`, `exp`, `sin`, `cos`, `tan` are honored.
- Never use `env()` (no environment variables) or `attr()` (only the most basic spec form is shipped in browsers and Gameface does not parse it); inline the literal value, or write it via element.style/JS. `var(--name, fallback)` is supported.
- Never use `rect()` or `xywh()` shape functions in `clip-path`; the engine does not parse them. Use `inset()`, `circle()`, `ellipse()`, `polygon()`, or `path()`.
- Never use the `linear(...)` easing function (the multi-stop variant); use `cubic-bezier(...)` or `steps(...)` instead — both are honored.
- Never use the missing transform functions (`skew()` combined form, `perspective()`); use `skewX()` + `skewY()` and apply 3D effects via the engine-side camera. `translate*`, `scale*`, `rotate*`, `matrix`, `matrix3d` are honored.

### CSS — partial-value restrictions (only the listed tokens are rejected)
- `align-content`: never assign `space-between`, `space-around`, `space-evenly`, `start`, `end`, `normal`.
- `align-items`: never assign `baseline`, `start`, `end`, `normal`.
- `align-self`: never assign `baseline`, `start`, `end`.
- `animation-duration`: never assign `auto`.
- `animation-timing-function`: never assign `jump`.
- `background-image`: never assign `element`, `gradients`, `image-rect`.
- `background-repeat`: never assign `space`.
- `border-bottom-left-radius`: never assign `percentages`.
- `border-bottom-right-radius`: never assign `percentages`.
- `border-bottom-style`: never assign `dashed`, `dotted`, `double`, `groove`, `ridge`, `inset`, `outset`.
- `border-image-repeat`: never assign `space`.
- `border-left-style`: never assign `dashed`, `dotted`, `double`, `groove`, `ridge`, `inset`, `outset`.
- `border-right-style`: never assign `dashed`, `dotted`, `double`, `groove`, `ridge`, `inset`, `outset`.
- `border-style`: never assign `dashed`, `dotted`.
- `border-top-left-radius`: never assign `percentages`.
- `border-top-right-radius`: never assign `percentages`.
- `border-top-style`: never assign `dashed`, `dotted`, `double`, `groove`, `ridge`, `inset`, `outset`.
- `box-shadow`: never assign `inset`.
- `clip-path`: never assign `fill-box`, `path`, `stroke-box`, `view-box`.
- `contain`: never assign `inline-size`.
- `content`: never assign `gradient`, `url`.
- `display`: never assign `contents`, `flow-root`, `grid`, `inline-block`, `inline-flex`, `inline-grid`, `inline-table`, `list-item`, `math`, `ruby`, `ruby-base`, `ruby-base-container`, `ruby-text`, `ruby-text-container`, `table`, `table-caption`, `table-cell`, `table-column`, `table-column-group`, `table-footer-group`, `table-header-group`, `table-row`, `table-row-group`.
- `flex-basis`: never assign `content`, `fit-content`, `max-content`, `min-content`.
- `font-size`: never assign `math`.
- `font-style`: never assign `oblique-angle`.
- `font-weight`: never assign `number`.
- `height`: never assign `fit-content`, `max-content`, `min-content`, `stretch`.
- `image-rendering`: never assign `smooth`, `optimizequality`, `optimizespeed`.
- `justify-content`: never assign `space-evenly`, `start`, `end`, `stretch`, `normal`.
- `mask-clip`: never assign `border`, `content`, `padding`, `text`.
- `mask-mode`: never assign `luminance`, `match-source`.
- `mask-repeat`: never assign `space`.
- `max-height`: never assign `fit-content`, `max-content`, `min-content`, `none`, `stretch`.
- `max-width`: never assign `fit-content`, `max-content`, `min-content`, `none`, `stretch`.
- `min-height`: never assign `fit-content`, `max-content`, `min-content`, `stretch`.
- `min-width`: never assign `fit-content`, `max-content`, `min-content`, `stretch`.
- `mix-blend-mode`: never assign `plus-darker`, `plus-lighter`.
- `opacity`: never assign `percentages`.
- `overflow-x`: never assign `clip`.
- `overflow-y`: never assign `clip`.
- `pointer-events`: never assign `all`, `visible`, `painted`, `fill`, `stroke`, `visiblepainted`, `visiblestroke`, `visiblefill`.
- `position`: never assign `sticky`.
- `stroke-dasharray`: never assign `none`.
- `text-align`: never assign `end`, `match-parent`, `start`.
- `text-decoration-line`: never assign `blink`, `grammar-error`, `spelling-error`.
- `text-decoration-style`: never assign `wavy`, `double`, `dotted`, `dashed`.
- `text-decoration-thickness`: never assign `from-font`, `percentage`.
- `text-overflow`: never assign `string`.
- `text-transform`: never assign `full-size-kana`, `full-width`, `math-auto`.
- `text-underline-offset`: never assign `percentage`.
- `text-underline-position`: never assign `from-font`, `left`, `right`.
- `transition-timing-function`: never assign `jump`.
- `user-select`: never assign `all`, `contain`.
- `vertical-align`: never assign `bottom`, `sub`, `super`, `top`.
- `visibility`: never assign `collapse`.
- `white-space`: never assign `break-spaces`, `pre-line`.
- `width`: never assign `fit-content`, `max-content`, `min-content`, `stretch`.

### CSS — selector restrictions
- Never use (parses, never matches): `::backdrop`, `::checkmark`, `::cue`, `::details-content`, `::file-selector-button`, `::first-letter`, `::first-line`, `::grammar-error`, `:active-view-transition`, `:active-view-transition-type(fade)`, `:any-link`, `:autofill`, `:buffering`, `:checked`, `:closed`, `:default`, `:defined`, `:dir(ltr)`, `:disabled`, `:empty`, `:enabled`, `:first`, `:first-of-type`, `:focus-visible`, `:focus-within`, `:fullscreen`, `:future`, `:has(.child)`, `:has(> .child)`, `:has-slotted`.
- Partial — only the simplest forms work, avoid the `An+B` / `of S` variants: `::selection`, `:nth-child(2 of .class)`, `:nth-child(2)`, `:nth-child(2n+1)`, `:nth-child(even)`, `:nth-child(odd)`, `:nth-last-child(2)`, `:nth-last-of-type(2)`, `:nth-of-type(2)`.

### HTML — forbidden tags and attributes
- `<input type="checkbox|color|date|datetime-local|email|file|hidden|image|month|number|radio|range|reset|search|submit|tel|time|url|week">` is silently coerced to `type="text"` — only `type="text"`, `type="password"`, `type="button"` are honored. Implement other behavior in JS or with custom widgets.
- `<a href>` has no navigation — replace with `<div role="link">` + JS click handler that calls into the engine.
- `<datalist>`/`<optgroup>`/`<option>`/`<select>` — no widget behavior. Build custom dropdowns / autocomplete from `<div>` + class toggles.
- `<fieldset>`/`<form>`/`<label>`/`<legend>`/`<meter>`/`<output>`/`<progress>` — no form lifecycle / validation / labeling. Read input values from JS and POST via the engine bridge.
- `<area>`/`<audio>`/`<embed>`/`<iframe>`/`<map>`/`<object>`/`<track>` — no media / framing pipeline. Route through the host engine.
- `<caption>`/`<col>`/`<colgroup>`/`<table>`/`<tbody>`/`<td>`/`<tfoot>`/`<th>`/`<thead>`/`<tr>` — no table layout. Use `display: flex` rows/cells.
- `<dd>`/`<dl>`/`<dt>`/`<li>`/`<menu>`/`<ol>`/`<ul>` — no list markers/numbering. Render bullets manually with styled `<div>`.
- Headings + inline-text tags (`<h1..h6>`, `<b>`/`<strong>`/`<i>`/`<em>`/`<u>`/`<s>`/`<mark>`/`<sub>`/`<sup>`/`<abbr>`/`<cite>`/`<code>`/`<kbd>`/`<samp>`/`<var>`/`<time>`/`<data>`/`<q>`/`<dfn>`/`<address>`/`<blockquote>`/`<figure>`/`<figcaption>`/`<pre>`/`<br>`/`<hr>`/`<wbr>`/`<ruby>`/`<bdi>`/`<bdo>`/`<ins>`/`<del>`/legacy presentational) parse but have no default styling — wrap with `<span>`/`<div>` + explicit CSS classes.
- `<details>`/`<summary>` — no disclosure/modal behavior. Build with class toggling + a `<div class="modal">` overlay.
- Other tags parsed as generic `HTMLElement` (no specialised behavior): `<acronym>`/`<article>`/`<aside>`/`<base>`/`<dir>`/`<footer>`/`<frame>`/`<frameset>`/`<header>`/`<hgroup>`/`<main>`/`<marquee>`/`<meta>`/`<nav>`/`<nobr>`/`<param>`/`<plaintext>`/`<rb>`/`<rtc>`/`<section>`/`<strike>`/`<xmp>`.
- `<dialog>`/`<fencedframe>`/`<picture>`/`<search>`/`<selectedcontent>` resolve to `HTMLUnknownElement` — the engine doesn't recognize the tag at all.
- Partial tags — `<canvas>` is 2D-only, no `toDataURL`/`toBlob`; `<img>` exposes only `src` (no `alt`/`complete`/`naturalWidth/Height`); `<input>` lacks `checked`/`validity`/`files`/`required`/`min`/`max`/`pattern`/`list`/`labels`; `<link>` has no `.sheet`. Full per-tag list in `negative-rules-html.md`.

### JS — missing or stubbed APIs
- Never use network/IPC APIs (`fetch`, `Request`, `Response`, `Headers`, `FormData`, `EventSource`, `WebSocket` (constructor), `BroadcastChannel`, `MessageChannel`, `Worker`, `SharedWorker`); communicate with the host engine via the Gameface bridge.
- Never use browser storage APIs (`localStorage`, `sessionStorage`, `indexedDB`, `IDB*`, `FileReader`, `File`, `FileList`, `FileSystem*`, `caches`, `cookieStore`); none are available. Persist via the engine bridge.
- Never use `crypto`, `SubtleCrypto`, `TextEncoder`/`TextDecoder`/`TextEncoderStream`/`TextDecoderStream`, `atob`/`btoa`, or `structuredClone`; missing. Implement what you need by hand or pull the data through the engine bridge.
- Never use WebGL / WebGPU directly; rendering happens through the host engine. Don't call `canvas.getContext("webgl"|"webgl2"|"webgpu")`.
- Never use Web Audio (`AudioContext`, `*Node`, `AudioParam`), Media Streams (`MediaStream*`), Media Recording (`MediaRecorder`), Media Source Extensions, Media Capabilities, WebRTC (`RTC*`), Picture-in-Picture, or Speech APIs; missing. Use host-engine audio/video.
- Never use `IntersectionObserver`, `PerformanceObserver`, `ReportingObserver`, `VisualViewport`, `FontFace`/`FontFaceSet`; missing. Poll on `requestAnimationFrame` (a Window stub) or compute manually.
- Never use `Range`, `StaticRange`, `TreeWalker`, `AbortController`/`AbortSignal`, `DOMParser`, `XPath*`, `Highlight*`; missing.
- Never use the modern Navigation API (`navigation`, `NavigationHistoryEntry`, `NavigateEvent`); missing.
- Never use Web Authentication / Credential Management / Payment Request APIs; missing.
- Never use device sensors, geolocation, Bluetooth, USB, HID, Serial, WakeLock, or WebXR; missing.
- Never use `Permissions`, `Clipboard`, `ClipboardItem`, `StorageAccess` APIs; missing.
- Never use the Streams API (`ReadableStream`, `WritableStream`, `TransformStream`, `CompressionStream`, etc.); missing.
- Never use Workers, Worklets, the Prioritized Task Scheduler, `requestIdleCallback`, or `setImmediate`; missing.
- Never use these geometry / typed-CSSOM rule wrappers (`DOMPoint*`, `DOMQuad`, `DOMMatrixReadOnly`, `CSS*Rule`, `CSSPositionValue`, `CSSImageValue`); missing.
- Never use modern editing / form-event APIs (`EditContext`, `InputEvent`, `CompositionEvent`, `FormDataEvent`, `SubmitEvent`, `InvalidEvent`, `HashChangeEvent`, etc.); missing or partial.
- Never use `SharedArrayBuffer`, `Atomics`, `WeakRef`, `FinalizationRegistry`; missing in this Gameface JS host.
- Never use WebCodecs, OffscreenCanvas, or `createImageBitmap`; missing.
- Never use vendor-prefixed (`moz*`, `webkit*`, `Chrome*`, `chrome`), Trusted Types (`trustedTypes`, `TrustedHTML`, …), Topics, Fenced Frames, Interest Groups, Sanitizer, or `launchQueue`; missing.
- 889 other window-scoped globals are absent (vendor-prefixed, experimental, trial APIs). Assume any standard symbol not listed under "Supported" is unavailable.
- Constructor-only-missing (receive instances from listeners / DOM APIs only, never `new` them): `AnimationEvent`, `CSSKeywordValue`, `CSSMatrixComponent`, `CSSRotate`, `CSSScale`, `CSSSkewX`, `CSSSkewY`, `CSSTransformValue`, `CSSTranslate`, `CSSUnitValue`, `Comment`, `CustomEvent`, `DOMRect`, `ErrorEvent`, `EventTarget`, `FocusEvent`, `GamepadEvent`, `MutationObserver`, `ProgressEvent`, `PromiseRejectionEvent`, `ResizeObserver`, `TransitionEvent`, `WebSocket`.
- All `HTML*Element` interfaces (22 classes) ship only a small subset of their standard surface — assume `id`/`className`/`classList`/`getAttribute`/`setAttribute`/`addEventListener`/`removeEventListener`/`getBoundingClientRect`/`querySelector`/parent-traversal exist; consult `negative-rules-js.md` before touching tag-specific properties.
- SVG DOM (9 `SVG*` interfaces) is partial — keep SVG configuration in markup; avoid `getBBox`/`animVal`/`createSVG*`/transform-list mutation.
- Typed CSSOM (5 `CSS*Value`/`CSS*Component` classes) is not constructible — assemble plain CSS strings instead.
- `Document` — `new Document()` missing; instances also lack `alinkColor`, `all`, `anchors`, `applets`, `bgColor`, `cookie`, …+94 more (full list in `negative-rules-js.md`).
- `Element` instances lack `currentCSSZoom`, `onfullscreenchange`, `onfullscreenerror`, `checkVisibility`, `computedStyleMap`, `getHTML`, …+75 more (full list in `negative-rules-js.md`).
- `Window` instances lack `console`, `chrome`, `clientInformation`, `closed`, `cookieStore`, `event`, …+78 more (full list in `negative-rules-js.md`).
- `Navigator` instances lack `clipboard`, `credentials`, `doNotTrack`, `geolocation`, `login`, `maxTouchPoints`, …+81 more (full list in `negative-rules-js.md`).
- `CSSStyleDeclaration` instances lack `boxSizing`, `fontVariantEastAsian`, `accentColor`, `alignmentBaseline`, `animationComposition`, `appearance`, …+344 more (full list in `negative-rules-js.md`).
- `CSSStyleSheet` — `new CSSStyleSheet()` missing; instances also lack `ownerRule`, `rules`, `addRule`, `removeRule`, `replace`, `replaceSync` (full list in `negative-rules-js.md`).
- `Console` instances lack `clear`, `count`, `countReset`, `dir`, `dirxml`, `group`, …+6 more (full list in `negative-rules-js.md`).
- `Performance` instances lack `eventCounts`, `navigation`, `onresourcetimingbufferfull`, `timeOrigin`, `timing`, `clearMarks`, …+11 more (full list in `negative-rules-js.md`).
- `Selection` instances lack `direction`, `isCollapsed`, `rangeCount`, `type`, `addRange`, `collapse`, …+11 more (full list in `negative-rules-js.md`).
- `History` instances lack `scrollRestoration` (full list in `negative-rules-js.md`).
- `CanvasRenderingContext2D` instances lack `createImageData`, `direction`, `ellipse`, `filter`, `fontKerning`, `fontStretch`, …+20 more (full list in `negative-rules-js.md`).
- `Animation` — `new Animation()` missing; instances also lack `effect`, `finished`, `id`, `oncancel`, `onremove`, `pending`, …+9 more (full list in `negative-rules-js.md`).
- `CustomElementRegistry` instances lack `get`, `getName`, `upgrade`, `whenDefined` (full list in `negative-rules-js.md`).
- Other partial classes (34 more — see `negative-rules-js.md`): `Attr`, `Blob`, `CharacterData`, `DocumentFragment`, `DocumentType`, `DOMMatrix`/`DOMRect*`, `Event`/`KeyboardEvent`/`MouseEvent`/`UIEvent`/`MessageEvent`/`PopStateEvent`/`TouchEvent`/`Touch`, `Gamepad`, `NamedNodeMap`, `NodeIterator`, `Screen`, `ShadowRoot`, `StylePropertyMap*`, `StyleSheet`, `Text`, `TextMetrics`, `XMLHttpRequestEventTarget`, etc. — constructors typically missing, only a few properties exposed.
