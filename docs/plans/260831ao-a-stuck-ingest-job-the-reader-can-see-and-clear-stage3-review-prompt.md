# Review the built code for Stage 3

You reviewed the plan and both earlier stages of this work; your findings shaped all of them. Stage
2b fixed the HIGH you found — expiry now genuinely revokes write authority, via a shared
`liveAttempt` in `src/store/job-fence.ts` — which is what unblocked this stage. **Stage 3 is now
built and committed** (`4106beb`). Read the code at HEAD.

## What Stage 3 was for

`settleExpired` had exactly one caller, at the top of `POST /api/jobs/:id/advance`. On Vercel that
endpoint only fires when somebody is *already* driving a job, so the sweep could not reach the case
that most needs it: a reader returning to a claimant that died while they were away.

## What was built

- **`settleExpired(now?: Date, owner?: OwnerId)`** — one method with an owner filter, not a sibling,
  so `tests/store-jobs-parity.test.ts` keeps exercising one contract. Postgres adds one conjunct to
  the existing `where`, so the wrong row is never even locked. The filesystem adapter filters its
  `attempts` loop.
- **`listJobs()` in `src/jobs.ts`** lists, gates on `listed.some(job => job.status === "running")`,
  calls `settleExpired(undefined, owner)`, logs, and re-lists. Early returns on both *nothing
  running* and *nothing settled*, so the second list only happens when the answer changed.
- **Both log lines carry `where: "list"` / `where: "advance"`.** Beyond the plan; the two doors now
  share one sentence and which door found a settlement is the interesting part.
- The global call at the top of the advance path is untouched.

## The measured cost, as you asked for rather than the phrase I had used

Counted at the driver by patching `Pool.prototype.query`, 300 iterations after a 30-iteration
warm-up, against a three-job shelf with one job `running` on a live lease:

| | statements | median |
|---|---|---|
| list alone, as it was | 1 | 1.32–1.68 ms |
| list + sweep, a job running | 2 | 2.88–3.14 ms |
| idle shelf, gate closed | 1 | ~0.92 ms |

Accounting for both pollers as you asked: after Stage 1 there is one engine and one timer, so the
session poll is the cadence and a band opening adds one poke-poll, one-off, not a second cadence.

## Questions

1. **Is the owner filter correct and complete?** Postgres puts it in the `where`; the filesystem
   adapter filters the `attempts` loop **before** `attempts.delete(id)`, not after — the reasoning
   being that a scoped call dropping another owner's token would revoke a live claimant's write
   authority via `liveAttempt` without settling its job, which is strictly worse than not sweeping.
   Is that right? Is there a path where a scoped sweep leaves the store in a state the table-wide
   sweep cannot fix?
2. **Is the gate right?** "Any running job" rather than "any expired lease", on the grounds that
   `Job` on the wire carries no lease and exporting one would move an ownership decision into the
   browser. Does the gate ever close when it should be open — a state where a reader has an expired
   claim that `listJobs` will never settle?
3. **The re-list.** Is reading twice correct, or does the second read introduce a window? What does
   a concurrent `advance`-door sweep do to it?
4. **Do the tests pin what they claim?** Particularly the owner-isolation case: it uses a second
   seeded owner with its own expired claim, rather than a stranger with no jobs, because an owner
   with no jobs only proves nothing was settled — which an ignored argument also satisfies. Is that
   sufficient? Name any test that would pass against a broken implementation.
5. **Logging.** The list door is now the *common* path to settling a dead claimant. Does the log
   carry what an operator would need, and does it say anything it should not
   (`docs/project/logging.md` — never article prose, never anything sensitive)?
6. **The asymmetry recorded but not changed**: the filesystem `settleExpired` iterates the
   `attempts` map, so a `running` record with no in-memory entry is invisible to it, where Postgres
   finds any running row with a lapsed lease. The claim is that this is safe within the adapter's
   single-process model because `loadFromDisk` runs `sweepStopped` at start-up. Agreed?
7. **Is the measurement sound**, and is the conclusion drawn from it the right one? Say if the
   method has a hole.
8. **What did this break or make harder for Stages 4–6**, and anything else a code review can see.

Stage 4 is `src/job-state.ts`, a pure `displayJob(job, now)`; Stage 5 is elapsed time and copy;
Stage 6 is the structured 409 you said was underdesigned.

Several agents share this tree, so ignore hunks belonging to other work. The plan is
`docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md`; the files are
`src/jobs.ts`, `src/store/jobs.ts`, `src/store/pg-jobs.ts`, `src/store/jobs-fs.ts`,
`tests/list-reconciles-expired.test.ts` and `tests/store-jobs-parity.test.ts`.
