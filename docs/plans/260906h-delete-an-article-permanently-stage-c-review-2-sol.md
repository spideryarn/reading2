Refuse. The previous all-retries `requiresArticle` fix was indeed wrong, but the replacement still leaves two resurrection races. I also found the database-permitted unsettled-terminal state the safety argument asked for.

### Findings

**F40 — P1 — established: an in-flight Retry survives deletion and resurrects the article**

`destroy()` removes terminal jobs only after locking the article ([pg-shelf.ts:396](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-shelf.ts:396)). But `retryJob()` reads the old job before enqueueing ([jobs.ts:4004](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:4004)); nothing locks that row or requires it still to exist.

The losing sequence is:

1. Retry reads terminal job J.
2. Delete removes J and the article, then reports success.
3. Retry continues from its cached `old`.
4. With no article now on the shelf, `slugForRetry` classifies a URL retry as `minted`; an upload retry is always `minted` ([jobs.ts:3738](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:3738)).
5. `requiresArticle` is false, so `enqueueIn` inserts despite the missing article ([jobs.ts:3164](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:3164), [pg-jobs.ts:302](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-jobs.ts:302)).
6. The worker recreates it through `lockOrCreateArticle`.

(a) Deterministic test: pause a mocked `pgJobStore.get` after it has read J but before returning; destroy the article; release the read; then assert `retryJob(J)` leaves a queued job on the deleted slug and advancing it recreates `articles`.

(b) Smallest closure: carry `retryOf` into `EnqueueTicket`; inside `enqueueIn`, after the article lock, lock and require that exact same-owner terminal source job before inserting. If delete won, it is absent and Retry returns 404. This preserves queued-cancel-retry because its source job still exists even though its article does not.

---

**F41 — P1 — established: `adopted from:"queue"` can also outlive deletion**

The new provenance correctly distinguishes shelf and queue, but queue provenance is only a stale lookup result. The source already acknowledges its lookup-to-insert race ([jobs.ts:3356](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:3356)).

Sequence:

1. Job Q is minting slug S for URL U; no article exists yet.
2. A second paste of U runs `freeSlug`, sees Q, and retains `{ adopted, from:"queue", slug:S }`.
3. Before the second request inserts, Q publishes and becomes terminal.
4. The owner destroys S; deletion removes Q and the article and reports success.
5. The delayed paste resumes. Queue adoption deliberately sets `requiresArticle:false`, so it inserts on S.
6. Its worker recreates S.

(a) Pause `pgJobStore.enqueueOrGet` for the second paste after `freeSlug` has found Q. Publish/finish Q, destroy S, then resume the insert. It leaves a queued job on the deleted slug.

(b) Carry the queue holder’s job ID in `SlugAllocation`, not merely `"queue"`. Under the article lock, if the article is absent, lock and require that exact holder to remain active before inserting. That lock must cover the insert; an unlocked existence check recreates the same race.

---

**F42 — P0 — established: Postgres permits a terminal job with an unsettled reservation**

I found no fifth application transition: the seven application endings do settle in their transaction. Crashes between their statements therefore roll both back.

The database itself does not enforce the claimed implication, however. `jobs_status` permits `error`, while `ingest_events_settled_once` permits both settlement timestamps to remain null ([schema.ts:2007](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:2007), [schema.ts:4408](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:4408)).

(a) This valid mutation establishes it:

```sql
-- E is an unsettled ingest_events row linked from queued job J
update spideryarn.jobs
set status = 'error', finished_at = now()
where id = J;
```

Now `destroy()` sees no active job, deletes J through `deleteTerminalJobs`, deletes the article, and reports success. E remains unsettled and counts against quota forever, with the only job-to-reservation provenance erased.

This can arise from a manual/admin repair, migration, or direct database writer. Existing `forget`/`trimFinished` behavior is precedent for the same vulnerability, not proof that the state is impossible.

(b) Before deleting terminal jobs, lock them and refuse the transaction if any linked reservation has both `succeeded_at` and `released_at` null. Do not infer whether to charge or release: that would itself change billing based only on a possibly-corrupt job status.

---

**F43 — P3 — established: `pg-shelf.ts` still says terminal jobs survive**

The comments say the explanation is “not a function” and that terminal jobs survive with stale slugs ([pg-shelf.ts:172](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-shelf.ts:172), [pg-shelf.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-shelf.ts:341)). Both contradict `deleteTerminalJobs`.

Smallest closure: remove those two stale statements.

### Load-bearing claim

Your queued-cancel-retry objection is correct. The article is created only when a worker opens the draft, and `jobWorthRetrying` treats absent `failureKind` as retryable ([job-failure.ts:415](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/job-failure.ts:415)). Requiring an article for every retry would incorrectly 404 that ordinary sequence.

I did not rerun database tests because loopback is unavailable. No files were changed.