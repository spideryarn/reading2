- **D1 — P1 — [src/quiz.ts:908](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/quiz.ts:908), wider dependency [src/jobs.ts:688](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/jobs.ts:688)**  
  The 78k token allowance cannot reliably run to completion in production. `deadlineFor(78_000)` is **1,027s**, but the job claimant aborts after **740s**. The quiz step’s stale 150s reservation can also admit it after earlier work with nowhere near enough time remaining. Because quiz generation is not checkpointed, an abort discards the paid call and a retry starts again.  
  **Changed:** nothing; repairing the job lease/platform deadline and `STEP_BUDGET_MS.quiz` is outside this diff.  
  **Proof:** an executable arithmetic check failed with `deadlineForMs: 1027000`, `claimDeadlineMs: 740000`, and `quizStepBudgetMs: 150000`. Require a relationship test binding the quiz’s actual budget to its production lifetime before shipping.

- **D2 — P2 — [src/quiz.ts:969](/home/greg/code/spideryarn2/.claude/worktrees/quiz-build-up/src/quiz.ts:969)**  
  A truncated 78k quiz reported that it had been sized with only 40k reasoning room because `truncationFailure` still used its shared default. That would send the next investigation toward the wrong numbers.  
  **Changed:** passed `THINKING_ROOM` into `truncationFailure`.  
  **Proof:** the regression command initially reported “14,000 tokens plus 40,000 for reasoning”; after the fix it reports “14,000 tokens plus 64,000”.

The round-one fixes are correct and minimal:

- `verdictBatch` makes the first effect pass after a batch replacement reset-only, preventing the old attempt from restoring its verdict.
- `RETIRED_CODE_KINDS` preserves historical authorship/classification without putting a retired factory back into the live-code table.
- New eval arms now require `elapsedMs`, and only `before*` comparisons enforce identical prompt hashes. The generated budget record now correctly uses 78k.

I consider the prompt residual acceptable to ship once D1 is fixed. The measured reduction from roughly 15/19 to 5/14 is substantial; the remaining examples I inspected are mostly off-path context rather than answer giveaways, and their question stems remain understandable alone. Keeping this explicitly named for real-paper follow-up is proportionate.

Verification: 5 focused suites passed, 157 tests; all TypeScript projects passed; focused Biome check and `git diff --check` passed. Full `npm test` was unavailable because the local Postgres service is not running. No commit made.

**Verdict: do not ship.**