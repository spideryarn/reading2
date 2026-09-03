# Keep a fresh success out of the retention sweep

**Status:** revised after GPT Sol's first review, 2026-09-03. Fixes the bug written up in
[260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md](../postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md).
Read that first: it has the reproduction, the class, and the commit.

## The job in one line

`trimFinished` can delete a successful job **in the same call that marked it done**, so the row the
browser is waiting to see never exists, and no panel ever refreshes.

## What a reader sees today

Press *Start again*, *Find the terms*, *Add* — anything that starts a job. The work succeeds and the
article gains its artefact. The tab does not: it sits on the empty state for ever, and behind it
asks the server to advance a job that is gone, every eight seconds, silently.

## Why

`KEEP_FINISHED = 50` terminal jobs per owner, and the ordering prefers failures — deliberately, and
written down in three places:

> Failures are kept preferentially: they are the ones worth reading later, and the successes have an
> article on the shelf to speak for them.

The preference is **absolute**, not weighted. Once an owner holds 50 failures there is no slot a
success can occupy, so a success is past the offset the moment it is written. `noteEnded` trims
immediately after every ending, so the row is deleted before any poll can see it.

The client learns that a job finished by polling for a row with `status = "done"`
(`recordCompletions`, `src/web/jobEngine.ts`). Nothing in the retention code knows that; nothing in
the client knows retention exists. **The class: a rule whose justification is about one reader,
silently depended on by another.**

## The rule we are changing it to

> Rank each terminal job within its own kind, **most recently finished first**. Fill the `keep`
> slots by alternating: the top-ranked non-success, then the top-ranked success, then the next of
> each, and so on. Whichever side runs out, the other takes the rest.

The full sort key within a kind is `finished_at desc nulls last, created_at desc, id desc`, and the
outer order is `rank asc, is_done asc` — so a tie of rank goes to the non-success.

### Why the clock is `finished_at` and not `created_at`

This is the load-bearing part, and the first draft of this plan got it wrong.

`created_at` is when a job was **queued**. Jobs run three at a time
([`src/jobs.ts`](../../src/jobs.ts) § `DEFAULT_JOB_CONCURRENCY`) and take wildly different times —
`sketch` is minutes, a glossary re-run is seconds — so a job created before several others routinely
finishes after all of them. Ranked by `created_at` a job that has *just this second ended* can sit
well down its kind and be swept by its own ending, which is the bug this plan exists to remove.
Ranked by `finished_at` it is rank 1 of its kind by construction, because nothing has finished
since. ⟨Sol⟩, 2026-09-03.

`finished_at` is nullable in the schema, and that is not a problem: it is nullable because *active*
jobs have not got one. Every terminal transition on both adapters stamps it — `finish`,
`settleExpired`, `requestCancel`'s terminal branch and `releaseStep`'s cancelling branch, `now()` on
Postgres and `new Date()` on the filesystem. `nulls last` puts a legacy or malformed terminal row at
the back of its kind, which is the conservative answer.

### What this rule is and is not

- **A just-ended job is never the one deleted, for `keep >= 2`.** That is the guarantee, and it is
  worth stating with its edges rather than as a slogan ⟨Sol⟩:
  - At `keep = 0` everything goes; at `keep = 1` the interleave puts the non-success first, so a
    fresh success loses. Nothing passes either — production passes 50 and the parity cases pass 2 —
    but the rule should be read as holding from 2 up, not universally.
  - Postgres stamps with `now()`, which is **transaction-start** time, not commit time, so "rank 1
    by construction" is not literally true under overlapping transactions. Widening this work into
    rewriting every timestamp would buy a guarantee nothing needs; the honest claim is that the
    ordering is by when the work ended rather than when it was queued, and that the window it leaves
    is microseconds wide instead of hours.
- **No new tuning knob.** One rule, symmetric, self-balancing: 50 failures and no successes still
  keeps 50 failures; 50 of each keeps 25 and 25.
- **It does weaken `0d42a484`, and that is the trade.** A reader with both kinds in abundance keeps
  25 failures where they used to keep 50. The specific protection that commit was written for — an
  old failure outliving a newer success — survives; the *absolute* preference does not. Named here
  rather than claiming the intent is preserved unchanged. ⟨Sol⟩.
- **The partition is `status = 'done'`, so the favoured side is "not a success"** and includes
  cancellations as well as errors. That is what the code has always done; it is only being said out
  loud here.
- It **removes** machinery on the filesystem side: that adapter currently sorts the *doomed* list
  and slices from the front, the opposite way round from Postgres, with a paragraph warning about
  the inversion. Under this rule both sort what is kept and slice from the back.

### The two options it beat

- **A floor for successes** — keep at least N `done` alongside the failures. Preserves the failure
  preference more strongly, but N is a constant somebody has to choose and defend, and a constant is
  exactly what the current bug is made of.
- **Pure recency** — keep the newest 50 by `finished_at`, full stop. Simplest of all, and it fixes
  the bug. Rejected because it re-opens the bug `0d42a484` fixed: an old failure is dropped for a
  newer success, and a reader who loses a failure loses the only account of what went wrong.

## The client half, and why most of it is not being built

The postmortem ranked *"a vanished job is a completion, not a void"* as the highest-value fix,
because it closes the whole class. On working through it, most of it is not worth building now.

To act on *"the job I started is not in the list"* the client must tell **"not yet"** from
**"gone"**, and a single list cannot. It needs a fence, and Sol's design for it is the right one, so
it is recorded here for whoever builds it: **a monotonically numbered poll-start sequence** — record
the sequence when the POST returns, and infer *gone* only from a successful list request that
*started* after that number and does not carry the returned id. It would also have to keep the
receipt after first seeing the job active, where `useStepJob.ts:408` clears it immediately. That is
new engine state and a change to a path with eight callers whose "don't announce history" invariant
has to survive it.

After the retention fix the trigger is gone rather than the hole: a just-ended job now survives its
own sweep, so the sequence that produced this bug cannot run. **The hole is still there** — enough
later completions can still evict a row, and `forget` still removes one — and if disappearance
recurs, `useStepJob` will still sit in `starting` for ever. Recorded, not fixed. ⟨Sol⟩.

**One piece of it is worth taking on its own merits**, because it is a real bug either way: `drive`
treats a 404 from `/advance` as transient and retries for ever, saying nothing. `src/routes.ts`
answers 404 *"No such job"* only when the job is gone, and there is nothing left to advance. That
loop should end.

## Stages

### Stage 1 — the retention rule

`src/store/pg-jobs.ts`, `src/store/jobs-fs.ts`, `src/store/jobs.ts` (the contract's wording),
`src/jobs.ts` § `KEEP_FINISHED`, `tests/store-jobs-parity.test.ts`.

- **Two red cases first**, and both must be watched red against the current code:
  1. *A success survives when the owner's history is already full of failures* — 50 `error` and one
     `done`, `keep` 50; the success is still there, the oldest failure is not. Necessarily red now
     and green after.
  2. *A job that finishes last survives, however early it was queued* — the case `created_at` gets
     wrong. **Written to Sol's spelling, because a vaguer version of it passes either way**: three
     successes, `keep` 2. Create A, then B, then C; stamp their finishes B, then C, then A, at
     distinct fixed instants. The current code ranks by creation and keeps B and C, deleting A;
     the new rule ranks by finish and keeps A and C, deleting B. Assert **A and C survive**.
     Use `stampFinished` here too rather than real clock time — a millisecond tie would make the
     green result flaky rather than wrong, which is worse.
- Postgres: `row_number() over (partition by (status = 'done') order by finished_at desc nulls
  last, created_at desc, id desc)` in a subquery that also projects an `is_done` alias, then
  `order by rank, is_done offset :keep`, feeding the existing `delete ... where id in (...)`.
  No lock: two endings trimming one owner each see a consistent snapshot, and overlapping deletes
  only make one returned count smaller — which nothing in production reads (`noteEnded` discards
  it; only tests assert it). ⟨Sol⟩.
- Filesystem: the same in JS — two arrays, ranked, interleaved, sliced from the back.
- The rule is written out **once** and cited from the other side, rather than twice in prose.

**The existing tie-break case has to change, and that is expected.** *"breaks a tie in the
timestamps by id rather than by luck"* deliberately finishes its three jobs in reverse id order, so
under a `finished_at` key they are no longer tied at all and it would pass without exercising
anything — a green tick for a rule nobody had implemented, which is the exact hazard its own comment
warns about. It needs its fixture to tie `finished_at`, which the contract cannot do because the
store stamps the clock itself. So: **a `stampFinished(id, iso)` helper on the `Adapter` seam table**
(`tests/store-jobs-parity.test.ts` § `interface Adapter`), which is what that table is for — its
header says two of the states worth testing cannot be reached through the contract at all. No
`JobStore` operation can tie or choose a `finishedAt`, so there is no way to avoid the seam ⟨Sol⟩.
Postgres does it with a direct `update`; the filesystem side needs a `stampFinishedForTests` export
beside the three `*ForTests` it already has — **async, and persisting the mutation**, or its index
and its durable record on disk disagree and the next `ready()` puts the old value back.

The first case, *"keeps the newest finished jobs and drops successes before failures"*, passes
unedited under both clocks. If **it** needs changing, stop: the rule is wrong.

**The stale wording is part of this stage, not stage 3** ⟨Sol⟩ — the sentences stop being true the
moment the rule changes, and a doc that stopped matching the code is worse than no doc. The five
places: the contract in `src/store/jobs.ts` § `trimFinished`, `KEEP_FINISHED`'s comment in
`src/jobs.ts`, `src/web/AddArticle.tsx:87` and `tests/add-article-history.test.ts:7` — both say
*"preferring failures when it prunes"*, checked — and `docs/project/ingest-queue.md:1436`.

**Done:** `tests/store-jobs-parity.test.ts` green on both adapters, both new cases watched red first,
`npm run typecheck` clean.

### Stage 2 — the silent retry, and the seam said out loud

`src/web/jobEngine.ts`, `tests/job-engine-*.test.ts*`.

- `step`'s catch: a 404 from `advance` ends the drive loop instead of counting a failure and
  waiting. Red first, in the engine's own tests, asserting all four halves ⟨Sol⟩: **one** attempt,
  **no** increment of `driverFailures`, **no** wait, and the loop **ends**. Three of those pass
  today by accident of a single-shot test; only the four together say what changed.
- Name the seam at both ends: `recordCompletions` says it requires a terminal row to stay pollable;
  `trimFinished` and `KEEP_FINISHED` say something depends on the newest-finished job of each kind
  surviving. A stated seam is one a reviewer can check — fix #2 from the postmortem.
- `stalled = job !== null && driverStalled(...)` in `useStepJob.ts` is **left alone**: the count it
  reads only accrues while a job is queued or running. Recorded here so the next reader knows it was
  looked at rather than missed.

**Done:** engine tests green, the new case red before.

### Stage 3 — verify

- `npm run typecheck`, **the whole `npm test`**, `npm run check`, and `npm run lint` on the files
  touched ⟨Sol⟩. The full suite rather than the touched ones: retention is owner-wide and this
  changes what survives it, so the blast radius is not the files edited.
- A real browser, in a subagent — **and it only proves anything if the owner's history is saturated
  with non-successes first** ⟨Sol⟩, which is the precondition the bug needs. Establish it (the dev
  owner on this box held exactly 50 `error` and zero `done` this morning; check before trusting it),
  then press *Start again* and watch the panel come back without a reload. If the precondition
  cannot be established, say so and do not report the check as evidence for this fix.
- Update the postmortem — which fix was taken, which was not, and why the ranking changed.

## Not doing

- **The test suite poisoning the shared local database.** 42 of the 50 failures on this box were
  `test-*` slugs written by `npm test` against the shared local Supabase that morning, so this bug
  is the normal state here and a rarity in production. That is a real problem and it is a different
  one — it belongs with the shared-database findings in `docs/project/worktrees.md` and
  `docs/project/testing.md`.
- **The full client-side "a vanished job is a completion"**, for the reasons above, with Sol's fence
  design recorded for whoever takes it.

## Progress

- 2026-09-03: plan written, reviewed by GPT Sol — **not ready**, on the `created_at` clock. Revised
  to `finished_at`, the tie-break test's rewrite planned rather than forbidden, the trade against
  `0d42a484` stated, and the client-half reasoning corrected where it overclaimed.
- 2026-09-03: second review — **not ready** again, but every finding arrived with its own fix and
  none of them changed the design. All seven applied: the guarantee qualified to `keep >= 2` with
  the `now()` caveat, case 2 written to Sol's exact spelling because a vaguer one passes either way,
  the filesystem seam made async and persisting, the stale wording moved into stage 1, the four
  assertions named for stage 2, and stage 3 given the full suite plus the precondition the browser
  check needs to mean anything. **Building on that rather than going round a third time** — the
  method weights the review of the *built* code higher than the plan, and a plan-stage round that
  can only say "yes, you applied my seven fixes" is not where the remaining risk is.
