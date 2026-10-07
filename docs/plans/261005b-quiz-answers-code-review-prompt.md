# Code review, and fixes: quiz answers are kept and restored (261005b)

You are reviewing built code, and you may **fix what you find inside this change**: narrowly, with a
test seen red first where the fix is to behaviour. Anything wider that you notice, report and do not
fix. Do not commit. Do not touch any remote database, and do not run `npm run deploy`.

## The candidate

Commit `523e771cf` on branch `worktree-fb-quiz-answers-kept` (this worktree), on top of the plan
commit `bed0d44c8`. The whole change:

```
git show --stat 523e771cf
git diff bed0d44c8 523e771cf
```

Every path in that stat is in scope. Start with:

- `docs/plans/261005b-quiz-answers-are-kept-and-restored.md` — the plan, your own plan review's
  eight findings as accepted (§ After GPT Sol's plan review), and § What landed
- `src/db/schema.ts` § `quizAttempts`, `drizzle/20261005032955_quiz_attempts.sql`
- `src/store/pg-quiz-attempts.ts`, `src/store/contracts.ts`, `src/store/article-rows.ts`,
  `src/store/export.ts`, `src/store/export-bundle.ts`
- `src/routes.ts` § `markOneAnswer` and the `GET /api/quiz/:slug` handler
- `src/web/useQuiz.ts`, `src/web/QuizPanel.tsx`
- `src/web/PrivacyPage.tsx`, `docs/project/privacy.md`, `docs/project/quiz.md`, `docs/project/export.md`
- `tests/quiz-attempts-route.test.ts`, `tests/quiz-kept-answers.test.tsx`

That list does not limit scope.

## What it is for

A reader's quiz answers used to vanish on a reload, on leaving Quiz for another mode, and on Next
then Previous. Now each finished mark is stored server-side and the panel restores the answer and
its mark. The right/wrong verdict is deliberately still not stored.

## Evidence I am handing you, because your sandbox has no database or network

Run by me or by the builder against the local Postgres, all green: `npm run typecheck`;
`tests/quiz-attempts-route.test.ts` (9), `tests/quiz-kept-answers.test.tsx` (19), `quiz-panel`,
`quiz-mark-route`, `quiz-mark-stream`, `api-fetch-offline`, `privacy-page`,
`store-export-covers-tables`, `public-reads`, `db-schema-drift`, `store-guarded`, `store-shelf-pg`,
`action-tables-have-created-at`, `doc-links`, `fixture-ids`; `npm run db:chain`. The builder reports
8 of 9 route tests and 17 of 19 panel tests were red before the code. Not seen red on their own: the
export case in `store-export-covers-tables` that carries a replaced batch's answers, the new
`api-fetch-offline` case, and the `public-reads` guard.

`tests/quiz-kept-answers.test.tsx` and `tests/quiz-panel.test.tsx` need nothing outside the tree —
run them yourself, and mutate the code under them to see whether they notice.

## What I want

An independent attack first: wrong behaviour a reader can reach; a way a kept answer lands in the
wrong question's box, overwrites a draft, or survives a new batch; a way a stale GET or the offline
cache un-answers a question; an answer or reply reaching a log line, the public payload or another
reader; a doc or comment sentence that is not true of this code (the docs changed here are part of
the review — check each new claim against the code, and check that no words are attributed to Greg
that are not already quoted in the plan).

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, service
broadly unusable · **P1** user-visible wrong behaviour, or an authoritative contract violated ·
**P2** design or maintainability risk with no wrong behaviour today · **P3** prose or comment defect.

For each finding: an id (C1, C2, …), severity, file and line, whether you **fixed** it (and the test
that went red then green) or **left** it and why. End with one line: approve / approve with the
fixes made / do not land.

## My own suspicions (already mine; spend most of the run elsewhere)

- Each finished mark now triggers a background `GET /api/quiz` from `useQuizRead`, which lives in
  `OwnedReader`. Does a new `quiz` object re-render the whole prose, or reset anything in the panel
  (the batch effects are keyed on `batchId`, but check)?
- The restoring effect fires only when there is no attempt at all. Is there a path where a stale
  attempt for another question blocks a restore?
- A failed background refresh after a mark shows the band's ordinary read-error banner over a quiz
  that is working.
- The client-clock floor for a failed save.
