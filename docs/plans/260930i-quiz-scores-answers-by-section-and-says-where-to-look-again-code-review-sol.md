No P0 or P1 findings. I fixed three P2 issues; nothing remains for a product decision.

1. **P2 — section containment could invent a section.** A block before the first projected section was clamped into that section, and supplement sections were not rejected at the pure join. Fixed by distinguishing containment from viewport clamping and marking supplements in `buildSections`: [position.ts:38](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/src/web/position.ts:38), [quiz-sections.ts:48](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/src/web/quiz-sections.ts:48). Added coverage for pre-section, body, supplement, and stale evidence; it failed before the fix: [quiz-sections.test.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/tests/quiz-sections.test.ts:72).

2. **P2 — tests did not fully earn the batch-reset and prop-chain claims.** Added checks that a newer verdict-less mark removes an old wrong verdict, a replacement batch cannot retain/re-record it, and retrying a later question shows its premise. I also made the section projection required through `RememberBand` and `QuizSubBand`, so omitting `Reader → RememberBand` is now a type error, while a runtime test guards both internal forwards: [ConversationModes.tsx:90](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/src/web/modes/conversation/ConversationModes.tsx:90), [quiz-panel.test.tsx:1344](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/tests/quiz-panel.test.tsx:1344), [remember-url-rules.test.tsx:232](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/tests/learn-url-rules.test.tsx:232).

3. **P2 — documentation said verdicts die with an attempt.** They intentionally survive individual attempts so later questions and the section list can use them; they die with the visit and reset on a new batch. Corrected at [quiz.md:354](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/docs/project/quiz.md:354).

“Back to its question” is filter-aware, suppresses the current question, and calls the same `pick` used by the list, so it neither lands on hidden questions nor treats a jump as Next. Moving to another question intentionally aborts the current mark and clears its draft exactly as list navigation does: [QuizPanel.tsx:644](/home/greg/code/spideryarn2/.claude/worktrees/fb-6r-quiz-section-scores/src/web/QuizPanel.tsx:644).

I found no rendered verdict, count, fraction, score, premise-rule violation, or path reordering.

Gates:

- Requested focused Vitest command: exit **0**, 95 tests passed.
- `npm run typecheck`: exit **1** because the sandbox denied `tsx`’s `/tmp/tsx-1000/14.pipe` IPC socket before TypeScript ran.
- Same repository typecheck script via `node --import tsx scripts/typecheck.ts`: exit **0**; all four projects and all 2,447 source files checked.
- Supplement regression test: exit **0**, 55 passed.
- Documentation links: exit **0**, 14 passed.
- Biome lint on touched code/tests: exit **0**.
- `git diff --check`: exit **0**.
- Full `npm test`: exit **1** before tests because the sandbox could not connect to the local Postgres/Docker service.

No commit, push, stash, reset, or branch switch was performed.