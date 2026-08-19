# Game UI design dimensions

A checklist for Stage 1 of the conductor. Not every feature touches every
dimension - decide relevance per-request, then generate specific questions
for the ones that apply using your own knowledge of game UI conventions.
This file intentionally holds no engine-specific facts (no layout cost, CSS
support, or performance notes) - that knowledge belongs to implementation
time, via `search_gameface_docs`, not to the clarify stage.

## Interaction
Input methods (mouse, gamepad, touch) and whether they need to be
equivalent. Primary actions: select, multi-select, drag/reorder, context
menu, drag-to-elsewhere. What happens on activate/open. Any mouse-only
interaction (drag-and-drop, hover reveal) needs a stated gamepad/keyboard
equivalent, not an assumption that one exists.

## Animation & feedback
Entry/exit transitions. Hover/focus/press feedback. Feedback for a state
change (item added, value changed, error). Whether motion should be
skippable or reducible (accessibility overlap).

## Data & state
Is the data pushed from the game engine or owned by the UI. What loading,
empty, and error states look like. Whether state persists across
sessions/screens. Whether more than one instance of this view can exist at
once (e.g. two inventory panels open, splitscreen).

## Scale
Expected count of items/rows/entries, typical and worst-case. Whether it
needs virtualization or pagination. Minimum and maximum expected sizes -
what does it look like with zero items, and with far more than expected.

## Accessibility
Gamepad-first navigation and focus order. Whether anything relies on color
or motion alone to convey meaning (colorblind-safe alternatives). Text
legibility at different scales. Any text-to-speech / screen-reader
expectations.

## Localization
Text expansion room (many languages run 30-40% longer than English).
Right-to-left layout mirroring. Whether any element's size is meant to
adapt to translated content length rather than clip or overflow it.

## Sort / filter / search
Whether the content needs sorting, filtering, or search, and what the
default order is. Whether sort/filter state persists or resets on reopen.

## Lifecycle
How the feature opens and closes. Whether it's modal (blocks other input)
or can coexist with other UI. Whether opening it pauses gameplay elsewhere.
