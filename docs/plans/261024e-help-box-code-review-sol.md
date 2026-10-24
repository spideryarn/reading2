No numbered findings. I found no correctness or regression issue in the scoped diff.

Caller audit:

- `FeedbackSendBox`: clearing a tall value now correctly returns to its five-row floor.
- `AddPage` purpose/about boxes: return to their four- and three-row floors; `.is-fit` adds no conflicting height.
- `QuizPanel`: returns to its four-row floor when cleared; conditional mounting and resize observation remain correct.
- `HelpAsk`: grows and shrinks correctly, clears to its two-row floor, and cannot be manually resized or internally scrolled.
- The new test covers growth, shrinkage, empty reset, overflow, and resize behavior.

Edits made: none.

Checks:

- `npx vitest run tests/help-one-box.test.tsx tests/quiz-panel.test.tsx` — passed, 120 tests.
- `npm run typecheck` — the `tsx` launcher was blocked by sandbox IPC permissions (`listen EPERM`).
- Equivalent `node --import tsx scripts/typecheck.ts` — passed all four TypeScript projects and confirmed all 3,934 source files are covered.
- `git diff --check` — passed.