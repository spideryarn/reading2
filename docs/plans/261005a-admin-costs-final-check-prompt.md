# A narrow check of one commit: 261005a, the report refinements after your stage review

Read-only: change no file. This is not a new review of the whole job; discovery is closed. It is a
check of the one commit made **after** your stage 3–5 review, so that nothing unreviewed lands.

## The candidate

Commit `dd291508f` (`git show dd291508f`). Paths: `src/cost-analysis.ts`, `scripts/cost-analysis.ts`,
`scripts/cost-analysis-html.ts`, their three test files, `docs/project/admin-costs.md`, the plan,
and one paragraph in the audit.

What it claims to do:

1. The cache lead flags a task-wire pair only when its median calls per job is at least 2 (calls
   grouped by job id, else run id, else each call alone), and the table lists every pair.
2. The step-in-several-jobs table carries each row's opaque article key and its first and last job
   day (UTC).
3. The model-by-task lead says "the model carrying the largest share of the task's recorded
   amount" rather than "its most expensive model".
4. A p95 resting on fewer than 20 priced calls is shown as a dash (the JSON keeps the number and
   the count).

Evidence from the real production run after the change (read-only): totals unchanged at 2,245
calls and $90.80; the cache lead now flags one pair (`labels` on the Messages wire: 87 calls,
median 2 calls per job, $3.07, 5.8% read from cache) where it flagged eight before; on the local
database it flags none.

## What I want

- Is each of the four changes correct, and is each sentence the report now prints true of what the
  code measures? In particular: the calls-per-job grouping (can a request-scope task with no job id
  be grouped wrongly by run id — one run id spans every call one collector saw; is that the right
  unit?), the median with an even number of jobs, and whether listing every pair changed any total.
- Can the article key or the dates in the new table columns carry another owner's slug or anything
  title-derived?
- Run `npx vitest run tests/cost-analysis.test.ts tests/cost-analysis-html.test.ts tests/cost-analysis-cli.test.ts`.
- Are the two new questions in the plan ([Q-5], [Q-6]) and the audit's added paragraph accurate
  against the tree?

Severity: P0 data loss, exploitable security, incorrect charging · P1 user-visible wrong behaviour
or an authoritative contract violated · P2 design risk · P3 prose. An ID on every finding,
**established** or **reasoned**. End with `VERDICT: approve` or `VERDICT: revise` (revise only on
an established P0 or P1).
