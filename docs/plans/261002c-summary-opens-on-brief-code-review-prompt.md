You are reviewing a small change in the Spideryarn repo (this worktree). You may fix what you find, inside this change's scope, and must report anything wider instead of fixing it.

Plan: docs/plans/261002c-summary-opens-on-brief.md (and your own plan review, docs/plans/261002c-summary-opens-on-brief-plan-review-sol.md).
Diff: docs/plans/261002c-summary-opens-on-brief-code-review.diff (uncommitted in this worktree; `git diff HEAD` shows the same).

The change: Summary mode's `?summary=` level now defaults to `brief` (src/web/params.ts summaryParam.withDefault, src/web/sub-modes.ts subModeParams), docs and tests updated, plus a feedback note.

Results so far: the five new/changed assertions in tests/simple-panel.test.tsx and tests/command-bar-sub-modes.test.tsx were red before the code change and green after; `npm run typecheck` passes.

Please check:
1. The diff is complete and correct against the plan; any remaining place that still treats `simple` as the absent/default level (code, tests, docs).
2. The new tests actually test what they claim (e.g. the Brief-end click really goes through nuqs and drops `?summary=`; the unmount/remount in the new test is sound with the file's beforeEach/afterEach).
3. Anything the docs edits now say that is false.
If you change anything, run `npx vitest run tests/simple-panel.test.tsx tests/command-bar-sub-modes.test.tsx tests/last-view.test.ts` and `npm run typecheck` afterwards. Report findings as P0/P1/P2 with file:line, what you fixed, and a one-line verdict.
