# Code review, round 2 (write-capable, narrow): the forced step's receipt

Round 1 is at `docs/plans/261007b-seventh-sweep-job-queue-tier-0-code-review-sol.md`; its verdict
was **do not ship yet**, on C1 (a completed forced step can run again and be paid for twice).
**Treat round 1's own fixes (commit `b133ed595`, C2–C5) as unreviewed code written by someone
else**, and spend most of this run on what is new: commit **`c5a2a0bdb`**, which fixes C1.

**What `c5a2a0bdb` claims.** A `keep` commit used to write nothing to the `jobs` row, so a forced
step's `done` status reached the row only through a later progress write that can fail on its own.
Now the `keep` variant of `JobTransition` (`src/store/session.ts`) carries
`{ jobId, attempt, steps }` and the Postgres session writes the steps in the product's own
transaction through a new `keepStepIn` (`src/store/pg-jobs.ts`), called from `settleIn`'s `keep`
branch (`src/store/pg-session.ts`); `transitionAfter` in `src/jobs.ts` builds it. About twenty
lines; no column, no migration, no new lock (the claim: `finishStepRun` already holds the job row
`for update` in that transaction). Tolerant continuation after a failed progress write is kept, on
the argument that it can no longer lead to a second paid run.

**Break it.**

1. Is the receipt really in the same transaction as the product, on every path that commits a
   step's product (`keep`, publish, the last step, a successor job, the stand-in tree, a step that
   needs another window)? Name any commit path where a forced step's product lands without its
   `done`.
2. `keepStepIn` writes `steps` from the coordinator's in-memory copy. Can it overwrite a newer
   stored fact: a `cancelling` status set by a remote Stop, a title, another step's progress, a
   requeue count, a newer attempt's steps? Is it fenced by `attempt` and by owner? What does it do
   when the fence fails: throw (rolling back the product, and then what happens to the job?) or
   silently skip (product committed, no receipt: the original bug)?
3. Lock order: does taking the job row inside the session's transaction invert an order used
   elsewhere (deadlock with `claim`, `noteProgress`, `pauseForDeadline`, Stop)? Verify the "already
   holds it `for update`" claim in the code.
4. With the receipt in place, re-argue tolerant continuation: after a failed `note()` is there any
   remaining route to a second paid run of ANY step, forced or not, by pause, lease lapse, Retry
   (`forceForRetry` gives a retried job its force back: is re-running a finished forced step on an
   explicit Retry intended?), or a second server?
5. The two Postgres regressions ("does not buy a committed forced step again": the two-lost-notes
   route and the lease-lapse route) cannot run in your sandbox. Could each pass against a wrong
   implementation — for example one that marks the step done in memory only, or writes the receipt
   in a second transaction?
6. Round 1's C3 test was found unable to fail (its assertions sat inside a step body) and was
   repaired. Check the repaired test and look for the same shape in the other tests round 1 wrote.

You may run tests needing nothing outside the tree (`npx vitest run tests/jobs-tier0-offline.test.ts`)
and `node --import tsx <script>`. No Postgres, no network, no `npm test`. A red in the sandbox may
be the sandbox: say so.

**Fix what is inside this change**, narrowly; write any Postgres test and mark it unrun.
**Report, do not fix, anything wider.** Do not commit. No new reader-facing sentence. No decision
is to be attributed to the product owner in docs: these choices were the orchestrator's (Claude's)
and the builders'.

**Reply format.** Findings D1, D2, …; P0 (an import lost, a broken article published, a double
spend) / P1 / P2 / P3; the input; reproduced or reasoned; fixed or not. Then files changed, what
you ran, and a verdict: ship / ship with these fixes applied / do not ship. Discovery closes after
this round: say plainly whether C1 is closed.
