Code review of the built change for docs/plans/261002f-quiz-regenerate-for-my-profile.md (read the plan, including its § Review: your plan review is docs/plans/261002f-quiz-regenerate-plan-review-sol.md).

The diff is docs/plans/261002f-quiz-regenerate-code-review.diff (everything against HEAD in this worktree). Summary: Quiz records profileHash (not in its stamp); GET /api/quiz goes through withProfileChanged; ProfileCarrying excludes "quiz" via NeverShared; useQuizRead/useQuiz expose profiled/profileChanged/refresh and a new `rewriting` hold; QuizPanel's head renders WrittenForYou with regenerate {run: write, busy, refresh, consequence}; ProfilePanel's Regenerate gains an optional `consequence` line.

House workflow: you may FIX what you find, inside this change's scope, by editing files in this worktree; add or adjust a test for each fix and make sure it would fail without the fix. Report anything wider (other modes, shared hooks) rather than changing it. Do not commit. Do not run the full suite (another run is in progress); you may run individual vitest files with `npx vitest run <file>` and `npm run typecheck`.

Look especially for: anything that could make Regenerate spend twice or loop; the old-client band bridge (withOldClientBands) still applied; the `rewriting` logic (state across slug change, write() from "Write them again" also setting it, a batch that is null); a stored quiz missing profileHash; whether jsdom tests actually exercise what they claim; and doc accuracy in docs/project/quiz.md and reader-profile.md.

Answer with: findings ranked P0/P1/P2 with file:line, what you fixed (with the test), what you left for me, and a one-line verdict.
