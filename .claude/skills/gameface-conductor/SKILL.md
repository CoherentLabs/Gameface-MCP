---
name: gameface-conductor
description: >
  Use whenever the user asks to design, build, or modify a game UI screen,
  panel, or component (inventory, HUD element, dialog, shop, settings panel,
  roster, notification, dialogue tree, map screen, etc.) and the request
  reads as a rough idea rather than a full spec. Runs a bounded round of
  clarifying questions grounded in general game-UI design dimensions
  (interaction, animation, data/state, scale, accessibility, localization),
  gets explicit sign-off on the resulting spec, then implements and - if a
  Gameface MCP connection is available - validates the live result before
  calling it done.
  Skip when: it's a bug fix, a style/copy tweak to an existing screen, or the
  request already names specific interactions, states, and data shape (i.e.
  already reads like a spec).
---

# Game UI Conductor

Read by more than one host (Claude Code auto-triggers this via `.claude/skills/`;
GitHub Copilot auto-discovers the same file directly, since it scans
`.claude/skills/` in addition to `.github/skills/`; Gemini CLI has no
auto-triggered skill concept, so it reaches this file via an explicit
`/gameface-conductor` command that embeds it). Because of that, avoid
naming a specific host tool where a generic description works just as well
- e.g. "explicit tracked state" rather than a literal tool name - so the
instructions read correctly regardless of which agent picked this up.

Runs in two halves: **clarify** (Stages 1-2, no tool dependency at all) and
**build** (Stages 3-4, uses the Gameface MCP server if one is connected).
Never skip straight to implementation - the clarify half is the actual point
of this skill; without it you're back to guessing at unstated behavior.

**Before Stage 1, explicitly track each stage below as its own step** (Stage
1 through Stage 6) - use your host's task/todo-tracking tool if it has one;
otherwise keep a running checklist visible in your own responses. Mark each
stage done only when it's actually done - Stage 3 specifically is only done
once the user has explicitly accepted the spec, in this conversation, not
once a draft has merely been written. **Do not start Stage 4 (or write any
code) until Stage 3 is marked done.** This is a hard precondition, not a
suggestion: if you find yourself about to edit or create a file and Stage 3
is still pending, stop and go back to it first.

## Stage 1 — Reason about relevant dimensions

Read `references/dimensions.md`. It's a checklist of dimensions that apply to
*some* interactive UI features, not all of them - decide which ones actually
matter for this specific request using your own knowledge of game UI
conventions. Don't ask about a dimension just because it's listed; don't
skip one that's obviously relevant just because the user didn't mention it.

Do not bring in engine-specific implementation facts here (layout cost,
CSS support, performance characteristics). Those belong to Stage 3, grounded
by `search_gameface_docs` while code is actually being written. This stage is
about *what* the feature does, not *how* it gets built.

## Stage 2 — Clarify in rounds (max 3, stop earlier if nothing new surfaces)

Round 1: ask the dimensions you judged relevant as a single batched set of
questions - use a structured multi-choice tool if your host provides one,
otherwise ask them together as one numbered list in plain chat, but either
way, one batch, not a drip of separate messages. Every question needs a
sensible default / "use your judgment" option - never block on an answer.

Round 2: look at what the round-1 answers imply and ask about *that* - e.g.
"yes to drag-and-drop" implies "what's the gamepad/keyboard equivalent?" and
"what happens if you drop it outside the panel?". Only ask what the answers
actually opened up, not a generic second pass over the same dimensions.

Round 3: same as round 2, one level deeper, only if there's still a real
open question that would change what gets built. If round 2 didn't leave
anything substantive, skip round 3 entirely - don't manufacture a question
to fill it.

After round 3 (or earlier if nothing remains): stop asking. Anything still
unresolved becomes a stated assumption in the spec, not another question.

**Stopping the question rounds early is not the same as finishing this
skill.** It only means "skip ahead within Stage 2" - Stage 3 still always
happens, exactly once, no matter how few rounds preceded it. Mark Stage 2
done in your tracking, then move to Stage 3 as its own explicit step.

## Stage 3 — Draft the spec and get explicit sign-off

Write a short spec: Goals / Interactions / Data & state / Scale /
Accessibility / Localization / Assumptions. Then ask directly (not buried in
prose): **"Here's the draft spec - do you want me to start building this,
or is something off?"**

- **Accepted** → proceed to Stage 4.
- **Not accepted** → the user's response is the correction (either specific
  feedback, or grounds for one more targeted question if their objection is
  itself vague). Update the spec and ask again. This loop has no fixed cap -
  it's bounded by the user's own input each time, not by open-ended guessing,
  so it's fine for it to repeat until they actually accept.

## Stage 4 — Implement

Standard rules apply and don't need repeating here: follow
`gameface://code-instructions`, call `search_gameface_docs` while writing
CSS/JS (this is already in the Gameface MCP server's own `instructions`
field - just follow it, don't duplicate it in this skill).

## Stage 5 — Validate (only if a Gameface MCP connection is available)

Before reporting the feature as done:

1. `get_dom_tree` / `search_dom` for the nodeIds of: the root container,
   every text-bearing element, anything meant to stay inside a bound.
2. `assert_text_fits` on the text-bearing elements.
3. `assert_no_overlap` on anything that shouldn't overlap.
4. `assert_within_parent` on anything meant to stay inside its container
   or the viewport.
5. `perf_lint` scoped to the new component's root selector.
6. `perf_measure`, only if this is the actively-loaded/dominant view right
   now - say explicitly if it isn't, rather than reporting a number that
   doesn't mean anything.

If anything fails: fix it and re-run that specific check, not the whole
battery. **If no MCP connection is available, skip this stage and say so
plainly in the report** - don't fail, don't fabricate results, don't
silently omit that validation didn't happen.

## Stage 6 — Report

State: what was asked vs. assumed, what was accepted in the spec sign-off,
what was built, which checks passed (or that validation wasn't possible).
Don't claim "done" if Stage 3 sign-off never happened.
