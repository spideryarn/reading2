# Review: dev tooling names model families, not versions — plan AND code, one pass

Repo: /home/greg/code/spideryarn2/.claude/worktrees/latest-model-aliases-0924, branch
worktree-latest-model-aliases-0924. TypeScript/ESM, vitest. You may edit files in this worktree.

## The candidate

Uncommitted on top of HEAD: `git diff HEAD` plus the untracked plan
docs/plans/260924e-dev-tooling-names-model-families-not-versions.md. Read the plan first — it has
Greg's words, the measurements, and what was left alone and why. Then scripts/run-codex.ts
(`MODEL_FAMILIES`, `DEFAULT_MODEL`, `pickNewestInFamily`, `compareVersions`, `resolveModelFamily`,
and the resolution block in `main()` before the dry run) and tests/run-codex.test.ts (the
`MODEL_LIST_STAND_IN` preamble every stand-in now carries, the `pickNewestInFamily` describe, and
the three new tests at the top of "the CLI, end to end").

This review is itself running through the change: it was launched with `--model sol`. Tell me in
your answer which model id you are (if you can tell).

## The conclusion I am asking you to check

"After this change the only file in dev tooling that turns a model family into a concrete id is
scripts/run-codex.ts, every dev-tooling caller names a family, and `--model sol` runs the newest Sol
the account can actually run — never Astra, never a hardcoded fallback."

## The finding I would least like to be wrong about

That `resolveModelFamily` can report success while resolving the wrong thing, or hang, or leave a
`codex app-server` process behind. Specifically: the JSON-RPC exchange (initialize → initialized →
model/list), what happens if model/list is paginated (`nextCursor`) and the newest Sol is on a later
page, whether `child.kill` after `settle` reliably reaps it, the `exit` handler racing a reply that
arrived in the same chunk, and whether resolving under `plan[0]`'s environment is right when the
second attempt spends `CODEX_API_KEY` (whose list may differ).

## Also check

- The mechanical doc/command edits (AGENTS.md line ~326, git-resolve-merge-conflicts.md,
  changelog.md, tools/fleet/actions.ts, scripts/changelog/changelog.ts incl. `GENERATED_BY`) —
  anything that parses or asserts those strings?
- The things the plan says were left alone: is any of them actually dev tooling that should have
  moved? `grep -rniE "gpt-[0-9]|claude-(opus|sonnet|haiku|fable)-[0-9]" scripts tools .claude infra
  docs/reusable AGENTS.md`.

## How to answer

Fix what is inside this change, narrowly, each fix with a test that was red first. Report anything
wider for me to decide rather than doing it. You have no network: `npx vitest run
tests/run-codex.test.ts` works offline (the stand-ins are fake codex scripts). End with a list of
findings, each: severity, file:line, what, and whether you fixed it.
