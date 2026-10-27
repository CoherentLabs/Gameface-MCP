# Agents

`agents/` at the repo root holds the review agents in Claude Code's format.
`build-agents.mjs` generates each client's version from it:

| Client | Output |
|---|---|
| Claude Code | `.claude/agents/<name>.md` |
| GitHub Copilot | `.github/agents/<name>.agent.md` |
| Cursor | `.cursor/agents/<name>.md` |
| Codex | `.codex/agents/<name>.toml` |
| Gemini CLI | `.gemini/agents/<name>.md` |

It maps tool names to each client's names and expands `tools` /
`disallowedTools` into an explicit allowlist, checked against the tools
registered in `src/index.ts`. Cursor and Codex can't restrict tools per agent,
so they get the restriction written into the prompt instead.

## Running

```sh
npm run build:agents
```

It regenerates every client folder and deletes any file in them that has no
source agent. If `git diff` shows changes afterwards, the generated files were
stale.

## Workflow

The `gameface-conductor` skill builds a UI screen, then hands validation to
the agents. They get only the spec, view URL, debug port and changed files,
never the author's reasoning:

1. **`qa-runner`** drives the view in the Player and checks behaviour and
   layout against the spec's done-criteria.
2. **`gameface-reviewer`** runs after QA has finished, never alongside it,
   because both use the one Player. It reviews the code and hands its
   performance suspicions to one **`perf-verifier`**, which measures them in
   the Player.
3. The conductor fixes the findings and dispatches fresh agents with a
   `Re-check:` line, for at most 2 rounds.

Gemini subagents can't spawn other agents. There, `gameface-reviewer` returns
its performance hypotheses, and the caller passes them to `perf-verifier`.

## Adding or changing an agent

Edit only the files in `agents/`, then run `npm run build:agents` and commit
the source together with the generated files. Never edit `.claude/agents/`,
`.github/agents/`, `.cursor/agents/`, `.codex/agents/` or `.gemini/agents/`:
the next build overwrites them.

A new agent is a new `agents/<name>.md` whose `name` matches the file name.
`tools` is required. When a client needs something different:

- **Frontmatter:** a `<client>.<key>: value` line sets or overrides a key for
  one client only, e.g. `gemini.max_turns: 60` or
  `copilot.user-invocable: false`. `name`, `tools` and `disallowedTools`
  can't be set per client.
- **Body:** text between `<!-- only: gemini -->` and `<!-- end -->` goes only
  to the listed clients; `<!-- except: gemini, codex -->` keeps it from them.

Client names: `claude`, `copilot`, `cursor`, `codex`, `gemini`. If the build
stops with an error, the message names the file and line to fix.
