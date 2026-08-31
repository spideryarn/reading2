NO-SHIP.

## Findings

1. **Critical — `openOrBeginJobDraft` is not atomic under concurrent calls.**  
   `src/store/pg-revisions.ts:664`

   The initial job read is not locked. Two calls carrying the same live attempt can both read `draftRevisionId = null`; the article lock serialises them, but the second retains its stale null and mints R2 after R1 commits. The job ends pointing at R2, with R1 orphaned.

   Ordinary `/advance` requests are protected because only one can claim the job. The primitive itself nevertheless does not provide the atomic guarantee its contract claims. The test calls it sequentially and misses this race.

   The reopen branch has another fence race: after line 668 reads a live attempt, `failExpired` can mark it failed while this transaction waits for the article lock; lines 689–702 then return the draft without rechecking the fence.

   Confidence: 100%.

2. **High — original finding 7 remains open: an alive claimant can be swept after writing artefacts.**  
   `src/jobs.ts:338`, `src/jobs.ts:689`, `src/store/pg-jobs.ts:303`

   Reproduction:

   1. A stage ignores or is slow to unwind from the 220-second abort.
   2. At 240 seconds another `/advance` calls `failExpired`, marking it `error`.
   3. The original claimant remains alive and completes its filesystem writes and `finishStep`.
   4. Its job transition is fenced out, but its artefacts have already landed.

   `interruptedEnding` fixes the attribution, but not the cooperative deadline or unfenced artefact write that constituted the larger finding.

   Confidence: 100% behavior; 90% practical likelihood.

3. **Major — cross-instance Stop can still lose at the final-step boundary.**  
   `src/store/pg-jobs.ts:279`

   `releaseStep` inspects `cancelling`; `finish` does not. If B sets `cancelling=true` while A runs the last step, A can call `finish(...done)` and clear the cancellation. This does not recreate the permanent stuck state, but it means a committed Stop is ignored on the terminal branch.

   Confidence: 100%.

4. **High — the new draft test can terminate unrelated live jobs.**  
   `tests/store-job-draft.test.ts:70`

   `claimedJob` updates every `running` row to `done`. Running this beside the parity suite—or against a local database containing a genuine ingest—kills that job, without a terminal timestamp, and its claimant subsequently loses its fence. Vitest normally runs files concurrently.

   Confidence: 100%.

5. **Major — “draft belongs to another article” is not a valid fallback.**  
   `src/store/pg-revisions.ts:675`

   The function never verifies that the fenced job’s stored slug equals `opts.slug`. Given a valid job token and the wrong slug, it treats the mismatch as unusable state, mints under the supplied article, and repoints the job. Null, deleted, and non-draft are recoverable; cross-article ownership should be refused.

   Confidence: 98%.

## Fix-by-fix result

| Fix | Result |
|---|---|
| 1. Expiry sweep | Fixes dead claims, but exposes the still-open live-claimant/artefact race above. |
| 2. Cancellation | Fixes `queued + cancelling` permanently. Final-step finish still ignores cancellation. |
| 3. Existing-slug rename | Fixed. The 409 is correct for different active work. |
| 4. URL identity | Fixed correctly with `urlKey` in both rules. |
| 5. Filesystem key | Fixed for newly written jobs. Pre-fix active files with no key remain unrecognisable. |
| 6. Legacy owner | Fixed functionally, although terminal legacy files are not rewritten with the owner. |
| 7. Overrun label | Both success-after-abort and thrown-abort branches now say interrupted. Wider finding remains. |
| 8. Retention failure | Fixed: terminal result survives and failure is logged. |
| 9. Enqueue finish race | Fixed by bounded reinsertion. |
| Attempt UUID | Production caller fixed. |
| Job draft | Sequential reuse fixed; concurrency and fence behavior are not. |

## SQL and enqueue audit

The `CASE` expressions do read the pre-update row:

- Queued cancel becomes `cancelled`, with token and lease cleared.
- Running cancel remains `running`, retaining token and lease.
- Release observes the old `cancelling` value and chooses `cancelled` or `queued`.

Every branch satisfies `jobs_running_is_fenced`. Concurrent cancel/release operations are also safe whichever obtains the row lock first.

`failExpired` adds one database round trip per advance. Because `jobs_only_one_running` limits the candidate set to one indexed running row, its database scan cost is bounded; polling volume is the material cost.

I found no improper enqueue refusal:

- Identical work is returned.
- A finished job no longer occupies the partial index.
- The finish-between-insert-and-select race retries.
- Retry or forced refresh is refused only when different work is presently active on that article, which is the intended 409 policy.

## Test quality

Several tests can stay green with their fix removed:

- Remove `advanceJob`’s `failExpired()` call: the new parity test still passes because it invokes the store sweep directly.
- Remove filesystem key writing: the loader tests still pass because their fixture already contains `workKey`.
- Revert `advanceJob` to `mintId()`: the parity suite still passes because it independently calls `mintAttempt()`.
- There is no targeted test for overrun attribution, retention failure, or the enqueue finish race.
- The draft test is sequential; it misses both concurrent minting and losing the fence during reopen.
- Its “gone draft” case actually changes the revision to `failed`; it tests only the non-draft fallback.
- The busy-article 409 test races the automatic pump, so its prerequisite is scheduler-dependent.

I did not execute the mutating suites: this is a managed read-only workspace, and the shared tree also contains unrelated uncommitted changes. The reproductions above were rerun as exact state-transition schedules against the committed `6d501cf` blobs.

**NO-SHIP.**