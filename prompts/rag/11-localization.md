# Localization
<!-- SOURCE FILES: localization.mdx -->
<!-- STATUS: partial -->
<!-- LAST EXTRACTED: -->

---

---
[TOPIC: localization] [TYPE: concept] [SEVERITY: high] [SOURCE: localization.mdx]
## Gameface's Localization Architecture: Engine Owns String Tables

Gameface localization is driven by the C++ game engine, not by JavaScript. The engine owns the string tables (one per language), handles the active locale, and resolves string IDs to translated text before the UI receives them. The frontend has three primary interaction points: `data-l10n-id` for declarative HTML strings, `engine.translate()` for JavaScript strings, and `engine.reloadLocalization()` for runtime language switching.

Do not embed raw localized strings in HTML. Always use IDs that the engine resolves.

---

---
[TOPIC: localization] [TYPE: api] [SEVERITY: high] [SOURCE: localization.mdx]
## data-l10n-id: Declarative String Binding

Apply `data-l10n-id="STRING_KEY"` to any element to automatically fill its text content with the translated string when the view loads. The engine resolves the key against the active locale's string table:

```html
<!-- Engine fills this with "Resume" / "Fortsetzen" / "Продолжить" etc. -->
<button data-l10n-id="MENU_RESUME_BUTTON"></button>

<!-- With a fallback for debugging in browser without engine -->
<button data-l10n-id="MENU_RESUME_BUTTON">Resume</button>
```

The fallback text between the tags is shown when the view is loaded in a browser or Player without active localization. It does not affect the in-game resolved string.

---

---
[TOPIC: localization] [TYPE: api] [SEVERITY: high] [SOURCE: localization.mdx]
## engine.translate(): Translating Strings in JavaScript

For dynamically constructed strings or places where HTML attributes cannot be used, call `engine.translate("STRING_KEY")` to retrieve the translated string at runtime:

```javascript
const weaponName = engine.translate('WEAPON_ASSAULT_RIFLE_NAME');
const tooltip = document.getElementById('weapon-tooltip');
tooltip.textContent = weaponName;

// With interpolation (requires the engine to support token substitution)
const killMessage = engine.translate('KILL_NOTIFICATION', {
    killer: killerName,
    victim: victimName
});
```

---

---
[TOPIC: localization] [TYPE: api] [SEVERITY: high] [SOURCE: localization.mdx]
## engine.reloadLocalization(): Runtime Language Switching

Call `engine.reloadLocalization()` after the engine changes the active locale to force all `data-l10n-id` bindings to re-resolve against the new string table. The call triggers a traversal of the entire DOM, re-querying the engine for every bound string.

```javascript
engine.on('LocaleChanged', (newLocale) => {
    // The engine has already loaded the new string table
    engine.reloadLocalization(); // Re-resolves all data-l10n-id attributes
});
```

---

---
[TOPIC: localization] [TYPE: pattern] [SEVERITY: medium] [SOURCE: localization.mdx]
## Handling Text Expansion in Localized Layouts

Translated strings vary significantly in length. German compound words and Russian inflected phrases routinely run 30–50% longer than English. Design layouts with expansion budget:

1. **Use `coh-font-fit-mode: shrink`** on text elements with fixed containers — font scales down if the string overflows, no layout disruption.
2. **Allow wrapping** where visual design permits — `white-space: normal` on multi-line labels.
3. **Avoid fixed `width` on text containers** — use `min-width` + `max-width` with a flex container to allow graceful expansion.

```css
.ability-name-label {
    min-width: 8rem;
    max-width: 20rem;
    coh-font-fit-mode: shrink;
    coh-font-fit-min-size: 10px;
    font-size: 16px;
}
```

---

---
[TOPIC: localization] [TYPE: pattern] [SEVERITY: medium] [SOURCE: localization.mdx]
## Language-Specific CSS via Custom Media Queries

Apply language-specific CSS overrides via `@media (language: XX)` custom media features (registered from C++):

```css
/* Increase line height for Arabic which has more ascenders/descenders */
@media (language: ar) {
    .menu-item { line-height: 1.8; direction: rtl; text-align: right; }
}

/* Compress spacing for German compound words */
@media (language: de) {
    .tooltip-text { letter-spacing: -0.02em; font-size: 0.875em; }
}
```

---

## #TODO — Unverified capabilities (do not author until confirmed)

The following sub-topics were not found in any MDX source AND it is unknown whether
Gameface implements them at all. Do not write RAG content for these until confirmed
against Gameface internals or official docs — invented content here is worse than
a gap.

- **Pluralization / count-based strings**: unknown if the l10n API supports ICU-style
  plural variants. Verify against the string table runtime.
- **String table file format**: key naming conventions, escaping, and file structure
  are not documented in any MDX source. Check internal docs or source.
- **RTL layout (Arabic/Hebrew)**: `writing-mode` and `direction` are both listed as
  unsupported in negative-rules-css.md. RTL may require full manual mirroring via
  transform or absolute positioning. Needs a dedicated spike before documenting.
- **data-bind-for + l10n composition**: whether list binding and localization binding
  compose is untested/undocumented. Verify with a real example in the Player.
- **CJK/Arabic/Cyrillic font fallback**: if RTL is not natively supported, font
  fallback for those scripts is moot. Revisit after RTL status is confirmed.

> These are not authoring TODOs — they are research TODOs. The answer may be
> "Gameface doesn't support this" which is itself valid RAG content.
