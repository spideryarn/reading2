# Review, round two (narrow): S4 — the fix for C1, the import-graph helper

## The candidate

Your working directory is the cluster's git worktree. The candidate is the single commit
`306ad0f18`: `git show --stat 306ad0f18`, `git diff 306ad0f18~1 306ad0f18`. Round one's prompt and
your answer are in `docs/plans/261006j-sixth-sweep-s4-code-review-prompt.md` and `…-sol.md`.

## What changed

Your C1 said `runtimeImportsOf` in `tests/helpers/import-graph.ts` lost a comment-prefixed import
and `import (` with whitespace, so converting `tests/sanitize-client.test.ts` to it weakened that
guard. The builder rewrote `runtimeImportsOf` to parse with `tests/helpers/ts-ast.ts` and walk
import, export-from and dynamic-import nodes; added `tests/import-graph-helper.test.ts` (19 cases,
9 red before the fix); a file that cannot be parsed is now refused. It also kept your C2 fix and
added a sentence to `docs/project/testing.md` and `docs/project/setup-dev.md`.

## Scope: this fix only

This is the check of a fix made after round one; general discovery is closed.

1. Is C1 closed? Re-run your round-one reproduction (the temporary fixture tree with both
   forbidden imports behind leading comments, and the spaced dynamic import) against the actual
   `tests/sanitize-client.test.ts`.
2. `runtimeImportsOf` is shared: `grep -rl "import-graph" tests`. Did the rewrite change the
   answer for any existing caller in a way that makes that caller's test weaker (fewer edges
   reported than before for real code: `require(...)`, `import x = require()`, `export * from`,
   `import("…")` inside a type position, re-exports, `.js` specifiers resolving to `.ts`/`.tsx`
   files, files outside the old regex's reach)? Compare old and new output over the real `src/`
   and `tools/` trees if you can script it: list any file whose edge set SHRANK, and say for each
   whether the dropped edge was a false positive (type-only, text in a comment or string) or a
   real runtime import now missed.
3. "A file that cannot be parsed is refused": does a refusal fail the calling test loudly, or
   could it silently drop a file from a graph walk?
4. Run `npx vitest run tests/import-graph-helper.test.ts tests/sanitize-client.test.ts
   tests/fleet-recovery-resume-route.test.ts tests/pg-ready.test.ts` and the other callers that
   need no database.

You may fix narrowly, red-first, inside `tests/`. Do not commit.

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Findings
continue your numbering (C3, …), severity P0–P3, reproduced or reasoned, fixed or reported. Under
500 words.
