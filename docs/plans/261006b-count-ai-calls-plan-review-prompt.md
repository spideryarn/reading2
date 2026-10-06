# Plan review: count AI calls that die part-way, and transport retries (261006b)

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- The plan: `docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md`
  (untracked in this worktree; read it from the working tree).
- Nothing is built. The code it would change: `src/ai-call.ts` (`Meter`, `asTransportAttempts`,
  `acceptedStream`, `openRouterStream` and the four whole-call seams), `src/messages-stream.ts`
  (`streamMessage`, `record`), `src/ai-spend.ts` (`SpendRecord`, `recordSpend`, the row writer),
  `src/db/schema.ts` § `aiCalls`, a new migration under `drizzle/`,
  `src/store/ai-calls-spend-pg.ts`, `src/cost-cube.ts`, `src/cost-analysis.ts`,
  `src/web/AdminCostsPage.tsx`.
- The plan it follows: `docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md`.
- Docs: `docs/project/cost-tracking.md`, `docs/project/admin-costs.md`, `docs/project/ai-gateway.md`.

That list says where to start. It does not limit scope.

## What to do

Attack the plan independently first. Would these columns, filled as described, actually let a
query tell "retried before the answer" from "died part-way", with a cause, on **both** wires and
all seams? Is the stated phase boundary true of the code on each seam? Is there a path where a
row would be recorded with a wrong or misleading value (a `retried` that is true when no attempt
followed, an `attempt` that restarts, a phase that is wrong for a non-streamed seam)? Can
`failure_class` as specified leak prose or anything sensitive? Is the migration safe for the gap
between it and the code, and for the other writers of `ai_calls` (`src/live.ts`)? Is the
separate grouped read the right call against the cube rule in admin-costs.md, or is there a
simpler design that does the same job with fewer columns? Run any test file you like that needs
nothing outside the tree (you have no network or database).

Every design choice in the plan is the implementing agent's, not the user's. The user's only
words are the one dated blockquote; do not attribute anything else to him.

Severity, by consequence:

- **P0** data loss, exploitable security, incorrect charging, or the service broadly unusable
- **P1** user-visible wrong behaviour, or an authoritative contract violated
- **P2** design or maintainability risk with no wrong behaviour today
- **P3** non-behavioural prose or comment defect

Give every finding an ID (F1, F2, …), a severity, the file and line that shows it, and the change
you would make. End with one verdict: *build as written*, *change first*, or *do not build*.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether `retried` can be known at the moment the row is written: `Meter.finish` runs in each
  seam's `finally`, before `asTransportAttempts` decides whether to ask again.
- Whether changing an in-band error chunk's row from `aborted` to `error` breaks anything that
  reads `outcome` (billing, slot accounting, the cost page's failed-call figures).
- Whether recording phase and class on `aborted` rows is worth its complexity, and whether the
  stall clock can really be told from a reader's Stop at the point the row is written.
- Whether five columns is too many: could `attempt` + `retried` collapse into one?
