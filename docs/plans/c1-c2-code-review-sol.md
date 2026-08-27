# NO-SHIP

## Ranked findings

1. **CRITICAL — `finishStepRun` accepts a stale job attempt. Confidence: high.**

   Its predicate checks only the step row’s token and status, not whether the job still holds that token or draft: `src/store/pg-revisions.ts:871-908`.

   Reproduction:

   1. Job J owns draft R with token A.
   2. `beginStepRun` writes `running/A`.
   3. `failExpired` clears J’s token and marks it errored: `src/store/pg-jobs.ts:329-355`.
   4. The stale worker calls `finishStepRun(R, A)`.
   5. The row still says `running/A`, so the update succeeds and commits `done`.

   C7’s planned atomic job transition could roll this back, but that safety is not enforced by this exported function or tested here. Either include the live job/draft fence, or make and test a combined finalizer that cannot commit without it.

2. **HIGH — the claimed global lock order is inverted elsewhere. Confidence: high.**

   `openOrBeginJobDraft` locks job then article: `src/store/pg-revisions.ts:703-708,725-726`. `publishRevision` locks article then fences the job: `src/store/pg-revisions.ts:1087-1089,1120-1123`. `failRevision` does the same at `1168-1194`; direct `beginRevision({job})` reaches article-then-job at `502-615`.

   Concrete deadlock:

   - T1 holds job in `openOrBeginJobDraft`, waits for article.
   - T2 holds article in `publishRevision`, waits for job.

   `beginStepRun` alone does not deadlock—it never requests the article—but the comment’s “every caller” assertion is false.

3. **HIGH — the C1 consumer reasoning is wrong, although there is no cross-artefact node-ID reference. Confidence: high.**

   Arc and summary artefacts do use block ranges, not node IDs. But a rebuilt tree need not retain the same ranges. Both readers join by exact endpoint pair and silently omit unmatched entries:

   - Arc: `src/web/tree.ts:218-244`
   - Summaries: `src/web/tree.ts:318-323,370-398`

   Therefore “a rebuilt tree over unchanged blocks orphans nothing” is false. A forced ToC rebuild can change boundaries while `summary.sourceHash` remains current because it hashes only blocks: `src/summarise.ts:768-777`. Arc is worse: it has no stamp, so C1 can produce new tree boundaries beside an arc that stays “done”.

   I found no durable consumer resolving `n0001`-style node IDs across an artefact boundary. Range joining prevents wrong-node attachment; it does not prevent orphaning.

4. **HIGH — `beginStepRun` can reopen an ended row under the same token. Confidence: high.**

   The conflict update is unconditional: `src/store/pg-revisions.ts:828-844`. While the job remains `running/A`, another caller with A can turn `done/A` or `error/A` back into `running/A`, clear `finishedAt`, and replace the hash with `unstamped`.

   A genuinely new token is safe: locking the job first serializes it, and an old token cannot pass afterward. The unsafe case is duplicate callers carrying the same live capability. C7’s atomic finish-plus-job-transition would narrow the window, but C2 itself does not establish that invariant.

5. **MEDIUM — `copyArtefacts` finishes partially present steps. Confidence: high.**

   It skips only when *no* artefact exists, then always calls `finishStep`: `tests/helpers/artefacts.ts:87-110`.

   A source containing only one of `extract`’s two outputs is copied and marked finished. Postgres `has` may still answer false, but the step-run row claims `done`; `articleMetadata` trusts that row for unstamped steps at `src/store/pg.ts:682-695`.

   It should either refuse partial source steps or finish only when all declared products are readable.

6. **MEDIUM — the fence suite does not test several advertised conditions. Confidence: high.**

   `tests/store-step-fence.test.ts` covers attempt mismatch, draft mismatch, and successful begin, but not:

   - removal of `jobs.id`,
   - removal of `jobs.status = 'running'`,
   - job expiry between begin and finish,
   - same-token re-begin after completion,
   - successful `status: "error"` completion.

   The exact named finish mutations are sound:

   - Removing the attempt predicate fails the wrong-token case at `168-176` and null-token case at `188-197`.
   - Removing the status predicate fails only the ended-row case at `178-186`.
   - The null-token case genuinely exercises SQL’s attempt comparison, not an incidental condition.

   `withClaimedJob`’s retry is sound for its present bodies: it retries only the named global-slot constraint, and the transaction rolls back. None of those bodies can independently raise that constraint.

## Checks that survived

- `NO_INPUT_HASH` is honest. Running/crashed and errored rows remain non-`done`; `articleMetadata` gates currency with `run.status === "done"` at `src/store/pg.ts:688-695`. A failed row is also distinguished by `finishedAt`.
- `rowCount !== 1` is correct because `(revision_id, step_name)` is the primary key. Concurrent finishes serialize; one succeeds and the other is refused.
- The constants re-export preserves existing imports. The focused cycle check passed with no remaining cycle.
- Focused baseline: 29/29 tests passed across the copy, ToC-stamp, and step-fence suites.