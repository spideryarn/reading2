# Code review, stage 2: retries and part-way deaths on the cost cube, page and report (261006b)

You are reviewing **and fixing** committed code in this worktree. Fix what is inside this stage,
narrowly, each fix with a test you saw fail first. **Report, do not fix**, anything wider. A
separate agent is driving a browser against this tree while you work; it changes no file.

## The candidate

- Commit `3950ac5a5` exactly (stage 2). `git show --stat 3950ac5a5` lists its paths.
- And one narrow check of a fix that no review has seen: in commit `a528f1a30`, the change to
  `evals/dig-deeper/budget.ts` and its test in `tests/dig-deeper-eval.test.ts`. That is my fix for
  your finding **F10**. Check that fix and only that; the rest of `a528f1a30` is your own F9 work.
- The plan: `docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md`; your
  earlier reviews beside it. Finding IDs continue from F11.
- Start with `src/store/ai-calls-spend-pg.ts` (`spendCube`, `spendDetail`), `src/cost-cube.ts`
  (the failure folds, `FailureCounts`, the shared sentences), `src/cost-analysis.ts`
  (`assertReadsAgree`, `failures`), `src/web/AdminCostsPage.tsx`, `scripts/cost-analysis.ts`,
  `scripts/cost-analysis-html.ts`, and the three docs `docs/project/ai-gateway.md`,
  `docs/project/admin-costs.md`, `docs/project/cost-tracking.md`. That does not limit scope.

## What to do

Attack independently first. Is every figure in the section what its label and its definition
sentence say it is, given how stage 1 actually fills the columns (`src/ai-call.ts`,
`src/messages-stream.ts`, `src/call-failure.ts`)? Can a figure that was not measured be drawn as
zero, or a zero as not measured, on any of the three surfaces? Do the three new grouping columns
change any existing money figure, row count, pivot, filter or URL on the page? Does the SQL count
what it says (the `FILTER`s, the inlined attempt limit, null handling)? Does the "two reads
agree" check still mean something? Does the section follow the page's scope, period and filters?
Is anything a model or a provider wrote rendered unescaped? Read the three docs **as a reviewer
of their claims against the code**: every sentence about what is recorded, counted or not counted
must be true of this tree, including after your own F9 fix. Do the tests test the thing (mutate
and see)?

You have no network and no database. Run test files that need neither, e.g.
`npx vitest run tests/cost-cube.test.ts tests/cost-analysis.test.ts tests/cost-analysis-html.test.ts tests/admin-costs-page.test.tsx tests/dig-deeper-eval.test.ts`.
The Postgres ones (`tests/admin-costs-store.test.ts`, `tests/cost-detail-store.test.ts`) I ran:
green, with `npm run typecheck` green (343 tests across eleven files).

Every design choice here is the implementing agent's, not the user's. Do not write any sentence
attributed to Greg in code, comments or docs.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable · **P1** user-visible wrong behaviour, or an authoritative contract
violated · **P2** design or maintainability risk with no wrong behaviour today · **P3** prose or
comment defect. Refuse only on an established P0 or P1. Give every finding an ID, a severity, the
file and line, and say whether you fixed it. End with a verdict and the list of files you changed.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- "Died part-way" is shown for rows with no attempt number (the PDF reader's) while retries and
  give-ups need one; whether the summary sentence makes that mixture read wrongly.
- "Gave up after the last go" counts `attempt = 3` failing before the answer; whether a call that
  failed on go 1 with a status the retry never asks again for (a 400, a 429) should be visible
  somewhere, or is rightly only in the causes table.
- The task table lists every mode or task, most of them "not measured"; whether that is noise.
- The F10 fix treats only `unreadable` and `in_band` part-way deaths as "finished with no cost";
  whether another part-way class should halt the budget too.
