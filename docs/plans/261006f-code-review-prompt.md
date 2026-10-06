# Review: the job deadline is recorded as `deadline`, and live conversation's stops as `abort`, in `ai_calls`

Repo: this worktree, branch `worktree-job-deadline-class`. TypeScript + ESM, vitest.

## The candidate

Committed: commit `996ec16a0`.

    git diff 996ec16a0^..996ec16a0
    git show --stat 996ec16a0     # the complete list of changed paths

Start with `src/jobs.ts` (`DeadlineReached`), `src/live.ts` (`acceptRealtimeUsage`, `ledgerBase`),
`src/cost-cube.ts` (`FAILURE_NOTES`, `FAILURE_DEFINITIONS`) and the tests
`tests/claim-session-postgres.test.ts` (the new `describe` at the end),
`tests/realtime-usage.test.ts`, `tests/cost-cube.test.ts`, `tests/cost-failure-docs.test.ts`.
That is where to begin, not the limit of scope.

## What it is meant to do

The plan is `docs/plans/261006f-count-the-pipeline-job-deadline-as-a-deadline-and-class-live-conversation-stops.md`
and your own plan review is `docs/plans/261006f-plan-review-sol.md` (findings F29 to F32).

- A model call stopped by the pipeline's whole-job deadline is recorded `aborted` with class
  `deadline`. A reader's Stop on a job stays `abort`. `DeadlineReached` keeps `name: "Error"`
  and its message, and the two `instanceof DeadlineReached` decisions in `src/jobs.ts` are unmoved.
- An `aborted` Realtime response row carries class `abort`, phase and status null. Every other
  live row keeps a null class.
- The words on `/admin/costs`, in `npm run cost:analyse` and in the docs say what is and is not
  counted, and say nothing false.

Out of scope, on purpose: F30 (GPT-Live records a failed backend response as `ok`), a new label,
a migration, rewriting old rows.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red first with the test
that reproduces it, and leave anything wider as a finding for me to decide. Do not commit. List
every file you changed at the end. Do not invent or attribute any quotation to a person.

You have no network, not even loopback, so `tests/claim-session-postgres.test.ts` will skip or
fail to connect for you. I ran it: 13 passed, with `realtime-usage`, `cost-cube`,
`cost-failure-docs`, `admin-costs-page` and `doc-links` (6 files, 205 tests passed), and
`npm run typecheck` is clean. The builder reported the job-deadline test red before the change
as `- "failureClass": "deadline"` / `+ "failureClass": "abort"`, and three mutations
(`extends Error`, `failureClass: null`, dropping `this.name = "Error"`) each turning a test red.
You can run the tests that need no database (`npx vitest run tests/cost-cube.test.ts`, and so on).

## Attack it

Independently, before reading my suspicions.

- Is every sentence the change wrote (source comments, `FAILURE_NOTES`, `FAILURE_DEFINITIONS`,
  the column hint, `admin-costs.md`, `ai-gateway.md`) accurate against the code? Does any
  sentence left untouched anywhere in `src/` or `docs/project/` now say something false about the
  job deadline or about live conversation's stops?
- Do the new tests prove what they claim? Would the job-deadline test still pass if the deadline
  never fired and something else stopped the call? Can it flake on a loaded box (its lease is
  `DEADLINE_MARGIN_MS + 1_500`)? Does it leave rows or handles behind?
- Does a job-deadline row now reach a place that treats `deadline` in a way that is wrong for a
  whole-job budget (the causes table, the `ai call stopped by our clock` log line, the eval
  budget, anything keyed on `failure_class`)?
- Does `failure_class = 'abort'` with a null phase mislead any reader of those columns?

For each finding: an ID from **F33 upward**, a severity (P0 data loss, security, wrong charging,
service unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2
design or maintainability risk; P3 prose), established or reasoned, (a) what shows it, (b) the
smallest change that closes it, and whether you fixed it. End with a verdict line:
`VERDICT: land it` or `VERDICT: change first`. Refuse only on an established P0 or P1.

## My own suspicions, worth less than yours

- The seventh note may be too long for a page that already has six.
- The end-to-end test's timing margin.
- "usually leaves no row" is hedged; I do not know a case where it does leave one.
