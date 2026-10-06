# Code review, stage 1: AI call attempts and failure fields on `ai_calls` (261006b)

You are reviewing **and fixing** committed code in this worktree. Fix what is inside this stage,
narrowly, each fix with a test you saw fail first. **Report, do not fix**, anything wider.

## The candidate

- Commit `e5a9c07a7` exactly. `git show --stat e5a9c07a7` lists its paths; `git show e5a9c07a7 -- <path>` is the diff.
- The plan: `docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md`, and your
  own plan review beside it (`261006b-count-ai-calls-plan-review-sol.md`, F1–F8). Finding IDs
  continue from F9.
- Start with `src/call-failure.ts`, `src/ai-call.ts` (`Meter`, `asTransportAttempts`,
  `acceptedStream`, `openRouterStream`, the four whole-call seams), `src/messages-stream.ts`,
  `src/ai-spend.ts`, `src/store/ai-calls-pg.ts`, `src/db/schema.ts`, the migration
  `drizzle/20261006014116_ai_calls_attempt_and_failure.sql`. That does not limit scope.

**Stay out of these files, which another agent is editing right now for stage 2:**
`src/cost-cube.ts`, `src/cost-analysis.ts`, `src/cost-report.ts`, `src/store/ai-calls-spend-pg.ts`,
anything under `src/web/`, `scripts/`, `docs/project/`, and their tests. Uncommitted changes you
see in those are that agent's, not the candidate. If a finding lives there, report it.

## What to do

Attack independently first. For every seam on both wires: is each row's `attempt`,
`failure_phase`, `failure_class` and `failure_status` what the plan says it is, on every way out
(answer, refusal, network failure, body that breaks, in-band error, abort before/during/after the
backoff, consumer `break` or throw, `retryTransport: false`)? Did any seam's return value, thrown
error, retry decision or spend figure change? Can anything other than a literal from
`src/call-failure.ts` reach the `failure_class` column or a log field? Are the three
mis-recording fixes right, and does moving those rows from `ok`/`aborted` to `error` break any
reader of `outcome`? Is the migration safe for old code inserting during the gap, and for
`src/live.ts`? Do the tests test the thing (mutate the code and see)?

You have no network and no database. Run test files that need neither, e.g.
`npx vitest run tests/call-failure.test.ts tests/ai-call-transport-retry.test.ts tests/messages-stream.test.ts tests/ai-call-failure-log.test.ts`.
`tests/store-ai-calls.test.ts` needs Postgres; I ran it and it passes (349 tests green across
those five plus `ai-spend` and `migration-journal`; `npm run typecheck` green).

Every design choice here is the implementing agent's, not the user's. Do not write any sentence
attributed to Greg in code, comments or docs.

Severity, by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable · **P1** user-visible wrong behaviour, or an authoritative contract
violated · **P2** design or maintainability risk with no wrong behaviour today · **P3** prose or
comment defect. Refuse only on an established P0 or P1. Give every finding an ID, a severity, the
file and line, and say whether you fixed it. End with a verdict and the list of files you changed.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `failure_status` is `200` on a `mid_answer` row and on a Messages in-band error before
  `message_start`; whether that reads as misleading.
- The error-envelope test is "top-level `error`, no `choices`, no `data`"; whether a legitimate
  answer on any seam can match it and be recorded as failed.
- Whether an error chunk should outrank an aborted signal when the stream's end is classified.
- `SpendRecord.attempt` and `.failure` are optional rather than required, so a new recorder can
  forget them silently.
