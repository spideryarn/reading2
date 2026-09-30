1. **P1 — Replacement batches briefly rendered at the previous batch’s index.** A new question could appear over the old draft before reset effects ran. Added a synchronous batch-change guard in [QuizPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb61-what-you-have-read/src/web/QuizPanel.tsx:327) and a pre-effect regression test in [quiz-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb61-what-you-have-read/tests/quiz-panel.test.tsx:1075). Removing the guard makes the test fail with `New question 3?` exposed.

2. **P2 — Several boundary rules lacked effective coverage.** `readShareLabel` and `lastBefore` had no tests, while reading-time status did not cover non-OK responses, slug changes, or StrictMode replay. Added coverage in [read-filter.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb61-what-you-have-read/tests/read-filter.test.ts:94) and [use-reading-time.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb61-what-you-have-read/tests/use-reading-time.test.tsx:372).

Test/typecheck results:

- Requested Vitest command: exit 0 — 3 files, 85 tests passed.
- `npm run typecheck`: exit 1 before typechecking because the sandbox denied `tsx` its IPC socket (`listen EPERM`).
- Same typecheck script via non-IPC Node invocation: exit 0 — all four projects checked; all 2,405 source files covered.

Verdict: approve with the in-scope fixes applied; no wider issues found.