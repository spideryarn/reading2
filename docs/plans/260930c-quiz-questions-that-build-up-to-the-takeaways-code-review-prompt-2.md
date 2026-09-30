# Code review prompt, round 2 (narrow): quiz questions that build up (260930c)

Narrow round. Review ONLY the diff `git diff 443dbac9 e10e0674 -- src tests evals/quiz-build-up.ts`
in this worktree. Your round-1 review is
docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways-code-review-sol.md.

What is in it:
1. Your own round-1 fixes (C1 QuizPanel verdictBatch ref; C2 RETIRED_CODE_KINDS), committed by me —
   treat them as unreviewed code: are they correct and minimal?
2. My response to your W1 (P1): a new QUIZ_SYSTEM rule "CONTEXT IS NOT A PREMISE". Its measured
   effect is in the plan § What the measurements said. Do NOT edit the prompt; say whether the
   residual (improved, not solved, named to Greg) is acceptable to ship, or what you would require.
3. `THINKING_ROOM` = 64k for the quiz call (src/quiz.ts), after a long paper used 48.9k of a 54k
   ceiling. Check budgetFor/deadlineFor interplay and anything that pins the old ceiling.
4. Your W3 (elapsedMs required on new eval arms) and the before*-only control check.

Rules: fix only inside this diff, red-first; report anything wider. Do not commit. Findings with
IDs (D1, D2 …), severity P0–P3, file:line, what you changed and the proving test. End with a
one-line verdict: ship / ship after the listed fixes / do not ship.
