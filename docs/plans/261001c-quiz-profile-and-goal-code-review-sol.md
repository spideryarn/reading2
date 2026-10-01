Verdict: **do not ship as-is**. The implementation and cache layout are sound, but the evidence does not establish the central “About you adapts heavily” claim.

## Findings

1. **F1 — P1: All three predeclared About-specific bars failed.**  
   Pitch, part selection, and within-goal differentiation failed under both round-2 judges. The qualitative examples cannot override that with two runs per arm and similar within-arm variation. I corrected the conclusion so it no longer treats those examples as demonstrated effects. [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:171)

2. **F2 — P1: The balance prompt contradicts itself and still misses its bar.**  
   It allows “one or two” central steps in a short path, then says one is insufficient. Round 2 produced only one or two central questions per run; only three of six covered both conclusion and support, and one still omitted the conclusion. I documented this but did not change the prompt, because doing so would create an unmeasured third wording. [src/quiz.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/src/quiz.ts:886)

3. **F3 — P1: The original conclusion overclaimed and miscounted the experiment.**  
   There were 28 paid runs, not 38. “It no longer drops the piece’s conclusion” and “a profile moves the quiz further” were not supported. The plan and product docs now state the narrower result. [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md:146)

4. **F4 — P2, fixed: The no-profile request is correct, but its test did not protect the full claim.**  
   The actual layout is right: article/cache breakpoint at `system[0]`, unchanged pre-6Q `QUIZ_SYSTEM` at `system[1]`, and reader rules at uncached `system[2]` only with a profile. The previous tests could remain green after unrelated core-prompt byte changes. I added a pre-6Q runtime digest and exact block-order checks. [test](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/tests/quiz-step-registration.test.ts:367)

5. **F5 — P2, fixed: Provenance was captured after the paid call.**  
   An edit during generation could therefore be recorded as the prompt that wrote an already-loaded request. It is now captured before import/call and the result is rejected if `src/quiz.ts` changes during the call. Existing JSON provenance is sound: its hashes match `c64700b6`, `4e65a05c`, and `94ab1df4`. [eval harness](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/evals/quiz-reading-goal.ts:89)

6. **F6 — P2, fixed: `score` accepted duplicate IDs.**  
   A judge file could duplicate one question, omit another, retain the expected row count, and silently assign both labels to the wrong arm. Score now validates headers, uniqueness, completeness, and blank cells; a regression test proves the old failure. [score](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/evals/quiz-reading-goal.ts:212), [test](/home/greg/code/spideryarn2/.claude/worktrees/fb6q2-quiz-profile-and-goal/tests/quiz-reading-goal-eval.test.ts:46)

The second wording round was legitimate because the plan explicitly allowed one. Re-judging the old arms in the same blind sheet was also correct—it controls judge drift. The problem was only using post-hoc examples to soften failed predeclared bars.

## Files changed

- `docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md` — corrected run count, seeds, measured claims, and shipping conclusion.
- `docs/project/quiz.md` — corrected cache/request description; added measured numbers and final balance wording.
- `docs/project/reader-profile.md` — distinguishes intended About behavior from what the evaluation established.
- `evals/quiz-reading-goal.ts` — reliable pre-call provenance and strict score-sheet validation.
- `tests/quiz-reading-goal-eval.test.ts` — duplicate-label regression test.
- `tests/quiz-step-registration.test.ts` — pins pre-6Q system bytes and exact system-block layout.

No result JSON was changed; no commit or push was made.

Checks: 103 scoped tests passed, typecheck passed, changed-file lint passed, doc links passed, and all four score files plus all six bar files reproduced exactly. The full suite could not start its Postgres lanes because Docker/local database access is unavailable in this sandbox.