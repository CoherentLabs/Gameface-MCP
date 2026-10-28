---
name: gameface-conductor
description: >
  Use whenever the user asks to design, build, or modify a game UI screen,
  panel, or component (inventory, HUD element, dialog, shop, settings panel,
  roster, notification, dialogue tree, map screen, etc.) and the request
  reads as a rough idea, or the user hands over a written spec/plan file to
  build. For a rough idea it runs a bounded round of clarifying questions
  grounded in general game-UI design dimensions (interaction, animation,
  data/state, scale, accessibility, localization) and gets explicit sign-off
  on the resulting spec; a provided spec skips the questions. Then it
  implements and - if a Gameface MCP connection is available - validates the
  live result before calling it done.
  Skip when: it's a bug fix or a style/copy tweak to an existing screen.
---

# Game UI Conductor

Runs in two halves: **clarify** (Stages 1-2, no tool dependency at all) and
**build** (Stages 3-4, uses the Gameface MCP server if one is connected).
For a rough idea, never skip straight to implementation - the clarify half is the actual point
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

## If the user provided a spec

When the user points to a spec or plan file (or pastes a full spec) and asks
you to build it, the spec already exists and asking for it is the go-ahead:

- Mark Stages 1-2 done as skipped. Don't ask clarifying questions.
- Stage 3: read the spec. If it has numbered done-criteria, mark Stage 3
  done. If it doesn't, draft done-criteria from it, append them to the
  file, and get sign-off on just those before Stage 4.
- Anything in the spec that's ambiguous or contradictory while you build:
  ask, don't guess.

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
Accessibility / Localization / Assumptions / Done-criteria. Done-criteria
are a numbered list of checks a tester can run against the live view
(behaviour, layout, states to screenshot); Stage 5 tests against them.
Save the spec to a file in the project so Stage 5 can hand over its path.
Then ask directly (not buried in
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
`get_code_instructions`, call `search_gameface_docs` while writing
CSS/JS (this is already in the Gameface MCP server's own `instructions`
field - just follow it, don't duplicate it in this skill).

## Stage 5 — Validate (only if a Gameface MCP connection is available)

Before reporting the feature as done, start the dev server and make sure
the view is loaded in the Player.

### With review agents (preferred)

If your host can delegate to subagents, hand validation to the `qa-runner`
and `gameface-reviewer` agents instead of checking your own work. They start
with no context and judge the result against the spec, not against your
reasoning.

Use whichever of them is available. If one is missing, or replies
"Blocked" (e.g. it has no gameface MCP tools), do its part yourself with the
checks under **Without review agents**: steps 1-4 replace `qa-runner`; steps
5-6, plus re-reading your changed files against `get_code_instructions`,
replace `gameface-reviewer`. If neither is available, skip to that section.

1. **QA first.** Dispatch `qa-runner` with: the spec file path, the view URL,
   the Player's debug port, and the list of files you changed. Nothing else -
   don't explain your implementation choices.
2. **Then review.** Once QA has finished, dispatch `gameface-reviewer` with
   the same four items. It reads the code and spawns its own `perf-verifier`
   to measure suspected perf issues in the Player. On hosts where subagents
   can't spawn agents it returns a `## Perf hypotheses` section instead:
   dispatch `perf-verifier` with those hypotheses, the view URL and the debug
   port, or, if `perf-verifier` isn't available, measure them yourself with
   `perf_measure` / `perf_profile`. Never run two agents at the same time:
   they all use the one Player.
3. **Fix.** Treat their findings as the to-do list. Fix what's in scope; for
   anything that is really a spec question, ask the user rather than
   guessing. Don't dismiss a finding because you disagree with it - fix it,
   or report it as open with your reason.
4. **Re-check.** Dispatch fresh agents again with a `Re-check:` line naming
   only the failed done-criteria (QA) or finding ids (reviewer), plus the
   files the fixes touched. At most 2 fix rounds; after that, stop and
   report what's still open.

### Without review agents

Run the checks yourself:

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
If the review agents ran: done-criteria passed / failed / unchecked from QA,
reviewer findings fixed vs. still open, and how many fix rounds it took.
Name any agent that was missing or blocked and whose checks you ran
yourself instead.
Don't claim "done" if Stage 3 sign-off never happened.
