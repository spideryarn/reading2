# Seventh sweep: the job queue's tier 0

Status as of 2026-10-07: being built, one commit per item. Each item below says what landed and
what it rests on; an item with no "Landed" paragraph has not.

## Goal

The seventh sweep (`261006m-seventh-codebase-sweep-depth-umbrella.md`) had two models read the
import queue line by line and then review each other. This plan builds the cluster of findings that
are live defects in [`src/jobs.ts`](../../src/jobs.ts), plus the false comments around them. Five
items, in this order, each its own commit:

1. **PQ1.** A read or a write that fails outside `runStep`'s `try` abandons a live claim: the row
   stays `running` for up to 760 s, its own next advance answers `busy`, and every other job on the
   article waits behind it.
2. **PQO1, the deadline row only.** A step that returns its product after our own deadline fired is
   ended `error` with the finished work thrown away, where a step that obeys the deadline is put
   down with its draft.
3. **PQ2.** While another claim is being decided, an advance for a job that does not exist answers
   200 with no job in it, where it answers 404 a moment later.
4. **PQO2.** A job's title is held in memory and set by `extract` alone, so a mid-step hand-back
   loses it and a `["fetch", "metadata"]` job never has one. The card shows the slug.
5. **PQ4 + PQO4.** Comments in the queue files that describe the filesystem store or the
   one-step-per-request queue, both deleted.

## References

- [ingest-queue.md](../project/ingest-queue.md): the queue's own doc.
  [§ A claimant that runs out of time](../project/ingest-queue.md#a-claimant-that-runs-out-of-time-puts-the-job-down-and-keeps-its-draft)
  is the pause items 1 and 2 reuse.
- [`src/jobs.ts`](../../src/jobs.ts) § `runStep`, `walkClaim`, `transitionAfter`, `advanceJobWith`.
- [`src/store/jobs.ts`](../../src/store/jobs.ts) and [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts):
  the store contract and its one implementation.
- [`tests/jobs-walk.test.ts`](../../tests/jobs-walk.test.ts) § *the exits of a claim*: every case
  this plan adds. It is already in the private-Postgres lane, so the cases get a real database
  without an edit to the lane manifest.
- The evidence, not on `dev` when this was written: the four investigation docs
  `261006d-seventh-sweep-depth-pipeline-and-import-queue-{sol,opus}.md` and
  `261006d-seventh-sweep-depth-pipeline-review-{opus-on-sol,sol-on-opus}.md`.
- [silent-success.md](../reusable/silent-success.md): why each test here was watched red first and
  each fix mutated back afterwards.

## Decisions

- **The orchestrating agent set the scope, not Greg.** In scope: the five items. Out: what Stop
  does when the last step finishes anyway (below), PQ3, PQO3, PQO5, any schema change, any
  reader-facing wording.
- **Where a review corrected a finding, the review wins**, and where the two reviews disagreed the
  narrower fix was taken.
- **Retreat rule.** A fix that adds a refusal on a path an ordinary request can reach has to test
  the mechanism its "this cannot happen to a live job" argument rests on. Item 3 is the one that
  adds a refusal, and its test asserts a live job is still told to wait.

### The simpler options passed over

- **Item 1: fix only the freshness read**, which is what the first investigation proposed. Passed
  over because the Opus review counted four exits of the same shape and one fix closes one.
- **Item 1: end the job when a progress write fails**, through a fourth storage-failure door. That
  is what the Opus review sketched as a follow-up. Passed over twice: it needs a new sentence on
  the reader's card, which is out of scope, and it throws away paid work because a progress bar
  could not be written. The write is made tolerant in one place instead.
- **Item 2: keep the product and release the claim.** Passed over because `assets` returns a
  manifest in which every image it did not fetch is stamped `failed: "network"` and current; today
  that product is always discarded, and keeping it would publish it.
- **Item 4: read the title from the article at the start of each claim.** Passed over because it is
  a new awaited read on every claim, which is one more exit of item 1's shape, where the `jobs`
  row already has a `title` column that the progress write can fill.

## Left open, for Greg

**Stop pressed during the last step of an import, when the step finishes anyway.** Today the reader
gets the article if their Stop was answered by a different server from the one doing the work
(job `done`, published), and loses it if it was the same one (job `cancelled`, draft failed). Both
are one rule too many. Nothing here changes either: two characterisation tests pin today's
behaviour, labelled as an open question, so that it cannot change by accident.

## Stages

### PQ1: a failed read or progress write abandons the claim

- [x] Red, against real Postgres, in `tests/jobs-walk.test.ts`.
- [x] Fix, in `src/jobs.ts`.
- [x] `ingest-queue.md` says what happens.

**Evidence:** R against Postgres for all four exits (the reviews had the freshness read as R and
the three progress writes as C, proved from the code only; each now has a case that was red).
**Files:** `src/jobs.ts` (`runStep`, `walkClaim`), `tests/jobs-walk.test.ts`,
`docs/project/ingest-queue.md`.

**Done when** a freshness read that fails once ends the job `error` with its draft failed and its
pointer cleared, and a progress write that fails for any reason but a moved claim does not stop
the walk.

**Red.** Five cases, each leaving the request as a throw:

```
× ends the job, rather than abandoning the claim, when the freshness read fails
    Error: transient freshness read   ❯ stepIsDone ❯ runStep src/jobs.ts:1203 ❯ walkClaim
× carries on when progress write 1 fails, as the first step starts
× carries on when progress write 3 fails, as the second step starts
    Error: the database blinked   ❯ note ❯ runStep src/jobs.ts:1240 ❯ walkClaim
× carries on when progress write 2 fails, after a kept step
    Error: the database blinked   ❯ note ❯ walkClaim src/jobs.ts:3026
× carries on when the progress write for a skipped step fails
    Error: the database blinked   ❯ note ❯ runStep src/jobs.ts:1224 ❯ walkClaim
```

The abandoned rows showed themselves a second way. Each held one of the machine's six slots, so
the cases after them in the file were told `busy` and failed on `queued`, with nothing in the
failure naming the cause.

**The count.** `grep -n "await note()" src/jobs.ts` gives three (a skip, a step starting, a kept
step), and `await stepIsDone(` in `runStep`'s `if` is the fourth. Four found, four closed:

- The freshness read is caught where it is made and rethrown inside the `try`, as the power read
  and the structure read beside it already were. The job ends `error`, retryable, through the
  ordinary step failure.
- `walkClaim`'s `note` catches its own failure, logs the error's class at `warn`, and answers
  `undefined`. `StaleAttemptError` still propagates. One edit closes all three calls and any added
  later.

**How each exit settles now.**

| Exit | Before | Now |
|---|---|---|
| freshness read (`stepIsDone`) fails | throw; row `running`, lease live | job `error`, retryable; draft failed, pointer cleared; no step runs |
| progress write for a skipped step fails | the same | `warn` logged; the walk goes on to the next step |
| progress write as a step starts fails | the same | `warn` logged; the step runs, and its `beginStep` is the next write |
| progress write after a kept step fails | the same | `warn` logged; the walk goes on; a Stop from another server is read one step later |
| any of the three says the claim moved | `busy`, nothing run | unchanged, and pinned by a case |

**Left, and why.** Four more awaits in the walk can throw past the outer `catch`:
`store.pauseForDeadline`, and the three `endJob` calls that record a cancel or a failure. They are a
different class: each *is* the write that settles the job, so when it fails there is no further
write to fall back on. `walkClaim` already says so about its recovery ("a job we could not record
the ending for is not a job to report as ended"), and the lease is what covers it.

**What the investigation got wrong.** The first investigation named one exit; there were four. The
Opus review's fix for the other three was a new door and a new sentence; a tolerant write needed
neither.
