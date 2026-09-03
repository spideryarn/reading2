# Code review: settlement of ingest-quota reservations

You are reviewing a stage of work in the Spideryarn repo. Be adversarial and concrete. I want
defects, not encouragement — and I would rather have five real findings than twenty speculative
ones. **Run tests yourself where it would settle a question**; a finding you reproduced outranks one
you reasoned to.

## Context

Spideryarn is adding Stripe billing. A reader gets a quota of article **ingests** (3 lifetime on
free; 20 or 150 a month on the two paid tiers). Reading is never gated — only adding new articles.

The quota is a **reserve-then-settle ledger**, already built, reviewed and on `dev`:

- `reserveIngest(ownerId, …)` (`src/store/pg-billing.ts`) takes a per-owner row lock, counts usage
  under it, and inserts a row into `ingest_events` — the **reservation**. That row counts against
  its owner from the moment it exists, and **there is deliberately no expiry**.
- A job that eventually succeeds has its reservation **charged** (`succeeded_at` set).
- A job that ends any other way has it **released** (`released_at` set), giving the slot back.
- `jobs.ingest_event_id` is a nullable FK to that reservation — provenance living on the job, so a
  job created by CLI work or a re-run of one pipeline step carries `null` and spends no quota.

**This stage wires settlement only.** Admission is the next stage: nothing calls `reserveIngest`
yet, so today every job's `ingest_event_id` is null and the new code settles nothing. That dormancy
is intended, not an oversight.

## The finding this stage is built on

The plan said "settle in both branches of `settleIn`". A design review found that a job reaches a
terminal state at **five** sites, three of which are not "branches of `settleIn`":

1. `settleIn` `done` → **charged**.
2. `settleIn` `error`/`cancelled` ending → **released**.
3. `settleIn`'s `release` branch that *resolves to* a cancellation (`releaseStepIn`'s
   `case when cancelling` ends the job, then `discardAfterCancel`) → **released**.
4. `settleExpired` (`src/store/pg-jobs.ts`) — a fenced UPDATE over the pool, previously with no
   transaction, ending every lapsed-lease job at once → **released**.
5. `requestCancel`'s terminal branch (`src/store/pg-jobs.ts`) — a queued job, or a running job whose
   claimant is provably gone, straight to `cancelled` in one UPDATE → **released**.

Sites 4 and 5 are the **Stop button** and **closing the tab**. Because a reservation never expires,
missing them means a reader who stops two ingests has permanently destroyed a three-slot free
account, and on a paid account a leak counts against **every future month** (the `in_flight` term in
`usageSql` has no period filter).

## The design decisions, so you can attack them

- **The charge is strict; the releases are tolerant.** `settleReservation(tx, id, "succeeded")`
  throws unless exactly one row moved, and that throw rolls back the publication. `"released"` logs
  a warning and returns. Rationale: publish-without-charge is a free ingest and charge-without-
  publish is a phantom debit, whereas a throw inside `requestCancel` would turn a reader's Stop
  button into a 500 and leave the job un-ended. Tolerance is also claimed to be what makes a cancel
  racing a final publication settle exactly once.
- **The asymmetry rides on the `outcome` argument** rather than a separate flag or a sibling
  function, on the grounds that no caller wants a strict release or a tolerant charge.
- **The reservation id rides on `EnqueueTicket`, not on `Job`** — `Job` is serialised to the browser
  by `publicJob`, and the filesystem adapter and `tests/store-jobs-parity.test.ts` would otherwise
  carry a Postgres-only billing field for nothing.
- **`settleIn` re-reads the column** (`reservationOf`) inside the transaction it already has, rather
  than widening `JobTransition` (which the filesystem session shares).
- **`releaseReservation` is deliberately NOT used at sites 4 and 5.** Its
  `and not exists (select 1 from jobs where ingest_event_id = …)` guard exists to stop a slot being
  freed while a job is still spending it — which means it refuses precisely where the job row exists
  and is ending.
- Sites 4 and 5 each gained a `db.transaction` pinned to `read committed` around their existing
  UPDATE.

## What I want from you

Attack these in roughly this order:

1. **Correctness of the five-site claim.** Is it actually five? Read `src/store/pg-jobs.ts` and
   `src/store/pg-session.ts` and find a sixth path where a job reaches a terminal status, or where a
   job row is deleted while carrying an unsettled reservation (`forget`, `trimFinished`, cascade
   behaviour on the composite FK, archive/hard-delete of an article). A leak or a double-charge
   here is the finding I most want.
2. **The strict/tolerant split.** Is the charge genuinely atomic with the publication? Can you
   construct an interleaving where a publication commits without a charge, or a charge lands without
   a publication? Is tolerance at sites 2–5 hiding a real anomaly that should have been loud?
3. **The "settles exactly once" claim** for a cancel racing a final publication. Is the fencing
   argument sound, or does it depend on lock ordering that isn't guaranteed?
4. **Deadlock and lock-ordering.** `settleIn` takes an article lock, then touches `jobs`, then
   `ingest_events`. `settleExpired` and `requestCancel` now take `jobs` then `ingest_events`. Is
   there an ordering that can deadlock, and does `settleExpired`'s per-row loop over a
   possibly-large settled set create a long transaction or lock-holding problem?
5. **`read committed` pinning.** Both new transactions pin it explicitly. Is that the right level
   here, and does anything in these paths actually need more?
6. **Comments that claim more than the code does.** A previous review of this feature found eleven.
   Quote any you find, with the line, and say what the code actually does.
7. **The tests.** `tests/billing-settlement.test.ts` — do they prove what they claim? Is any of them
   green for the wrong reason? What case is missing? Note that I independently verified the suite
   runs (13 tests, not skipped) and that deleting site 5's settlement turns exactly two of them red.

## How to run things

- Tests need Postgres: `REQUIRE_POSTGRES=1 npx vitest run tests/billing-settlement.test.ts`.
  `REQUIRE_POSTGRES=1` matters — this suite's sibling silently skipped 13 tests for hours because
  the file never loaded the env, and a skip is indistinguishable from a pass.
- `npm run typecheck` is fast. `npm test` is noisy and has pre-existing failures from other agents
  working in the same tree; do not spend long on a red file unless it is one of the ones below.

## Files

The scoped diff is in `stage1.diff` beside this prompt (generated with `git diff -w`; the raw diff
is ~200 lines longer purely from re-indentation). The new test file
`tests/billing-settlement.test.ts` is untracked and so is not in that diff — read it from the tree.

- `src/store/pg-billing.ts` — `settleReservation`, `releaseReservation`, `reserveIngest`, `usageSql`
- `src/store/pg-session.ts` — `settleIn`, `reservationOf`
- `src/store/pg-jobs.ts` — `tryEnqueue`, `settleExpired`, `requestCancel`, `finishIn`,
  `releaseStepIn`
- `src/store/jobs.ts` — `EnqueueTicket`
- `src/db/schema.ts` — `ingestEvents`, `billingAccounts`, `jobs.ingestEventId` and their CHECKs
- `docs/project/billing.md`, `docs/plans/260902i-stripe-payments-and-subscription-tiers.md`

Give me a verdict — would you ship this stage? — then findings ranked by severity, each with the
file, the line, the concrete failure scenario, and what you would do instead. Say plainly which
findings you reproduced and which you reasoned to.
