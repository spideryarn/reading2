## Verdict

Refuse the plan as written. Three established P0s remain:

- Stage E’s check-then-remove race can delete another owner’s live blob.
- Stage B freezes the wrong price and breaks live public pricing.
- Stage C can delete a charged queued job while leaving its reservation consuming allowance forever.

The Stage A cascade result does not address any of these.

## Findings

### F1 — P0 — established: refcount-then-remove can corrupt another owner’s article

(a) Stage E proposes counting references and then removing the object after the article transaction ([plan:319](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:319), [plan:331](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:331)). That is not atomic with writers.

Concrete interleaving:

1. Alice deletes her article and commits.
2. Alice’s cleanup counts zero references.
3. Bob ingests identical bytes. `storeRawSource` finds and verifies the shared object.
4. Bob commits a revision referring to it.
5. Alice’s cleanup removes the object based on its earlier count.
6. Bob’s committed revision now points to missing bytes.

The blob implementation already documents this exact class: an uncoordinated remove can delete a winner’s correct object after its caller committed a reference, and says repair requires serialization or version-conditioned replacement that the seam does not have ([src/store/blobs.ts:375](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/blobs.ts:375)). Blob writing currently happens before, and outside, the transaction that records the reference ([src/store/artifacts-pg.ts:1015](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/artifacts-pg.ts:1015)).

The planned sequential two-owner test cannot exercise this race.

(b) Replace Stage E’s counting design with:

> Every canonical object has a relational catalogue row and every article revision has relational references to the objects it uses. Writers and deleters lock the same catalogue row before committing or retiring a reference. When the deletion transaction removes the last reference, it marks the object `pending_delete` and writes a durable cleanup task; it does not perform a free-standing count followed by `remove`. A writer encountering `pending_delete` waits or retries after ensuring the object has been restored, and may never commit a reference to an object still scheduled for deletion. A barrier test races a second owner’s reference commit against deletion and proves that every committed reference still resolves.

Scanning JSON manifests can help backfill the catalogue, but it cannot be the live arbitration mechanism.

### F2 — P0 — established: “stamp at charge time” misprices later sharing changes

(a) The billing contract explicitly requires live recomputation: sharing an article lowers its usage and unsharing raises it again. It specifically rejects charging based on visibility at ingest time because that misses articles shared later ([docs/project/billing.md:617](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/project/billing.md:617)).

Stage B does exactly that rejected thing by stamping visibility “at charge time” ([plan:217](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:217)):

- Ingest privately, then share: remains full-price incorrectly.
- Ingest publicly, then unshare: remains half-price incorrectly.

The current query deliberately asks whether the article is public “right now” ([src/store/pg-billing.ts:408](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-billing.ts:408)). This is incorrect charging in both directions.

(b) Stamp only when the article is deleted:

> Add nullable `ingest_events.article_visibility_at_delete`. While an article exists, usage continues to use its live `articles.visibility`. Immediately before deleting the locked article, stamp its current visibility onto every attached ingest event. After the FK becomes null, use that frozen value. The billing and admin predicates are:
>
> `coalesce(a.visibility, e.article_visibility_at_delete, 'private') = 'public'`
>
> Add tests for private→public and public→private after charge, followed by deletion; the first two operations must continue to change usage, while deletion must not.

A `BEFORE DELETE` trigger is the safest place to guarantee the stamp for every deletion path. The application transaction should still take `billing_accounts` then `articles`.

Rejecting the schema note’s “warn about the delta” policy is a defensible product decision. The defect is not that overrule; it is freezing at charge rather than at deletion. A deletion-only snapshot is not a competing source of truth because it is ignored while the article row exists.

### F3 — P0 — established: deleting a missed active job permanently leaks its billing reservation

(a) Stage C copies the glossary predicate and then deletes the active jobs that predicate missed ([plan:252](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:252), [plan:255](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:255)).

The glossary query explicitly misses a claimed job with no draft ([src/store/pg-glossary.ts:149](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-glossary.ts:149)); a null draft is the ordinary first-step state ([src/db/schema.ts:1828](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:1828)).

Concrete scenario:

1. An owner pastes the URL of an existing article again. URL ingestion reserves a slot, while adopting an existing article is supported.
2. The resulting job is queued, charged, and still has `draft_revision_id = null`.
3. Delete’s “live job holding a draft” query misses it.
4. Step 5 deletes the job.
5. Its `ingest_event` remains unsettled. Deleting a job deliberately does not touch its reservation ([src/db/schema.ts:1976](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:1976)).
6. Unsettled reservations never expire and count against usage forever ([src/db/schema.ts:4253](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:4253)).

(b) Replace Stage C steps 4–5 with:

> Under the locked article row, select and lock every owner-and-slug job whose status is `queued` or `running`, regardless of draft pointer or lease age. If any exists, return 409 and delete nothing. Never delete an active job as part of article deletion. Terminal jobs remain as history.

Add a charged queued job with a null draft to the 409 test and assert the article, job, reservation state, and computed usage are all unchanged.

`queue_state.running_job_id` is not a dangling-pointer problem: its FK already uses `ON DELETE SET NULL` ([src/db/schema.ts:2223](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:2223)).

### F4 — P1 — established: enqueue can race the check and resurrect a successfully deleted article

(a) The bare-slug ownership check occurs before job construction and insertion ([src/jobs.ts:2965](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:2965), [src/jobs.ts:3066](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/jobs.ts:3066)); `enqueueOrGet` does not lock the article ([src/store/pg-jobs.ts:704](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-jobs.ts:704)).

Interleaving:

1. Enqueue confirms the article exists, then pauses.
2. Delete locks the article, finds no active job, deletes it, and commits.
3. Enqueue inserts its queued job.
4. The worker later calls `lockOrCreateArticle`, whose documented behavior is to create the absent article row ([src/store/pg-revisions.ts:482](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-revisions.ts:482)).

Delete has reported success, but the article can return.

(b) Add this requirement:

> Every enqueue that targets an existing/adopted article must lock the owner-scoped article row and insert the job in the same transaction. It must not rely on the earlier `articleExists` preflight. If enqueue wins the article lock, deletion subsequently sees the active job and returns 409. If deletion wins, enqueue re-reads absence after the lock and returns 404 without inserting.

Add a barrier test covering both legal outcomes and forbidding “delete succeeds plus job/article later exists.”

The proposed billing→article lock order is correct. The missing coordination with enqueue, not that order, is the problem.

### F5 — P1 — established: storage cleanup is incomplete and cannot support the promised success state

(a) There are three concrete gaps:

- A crash after the database commit but before object deletion loses the only candidate list. A mid-loop crash leaves an unknowable partial cleanup. The plan explicitly reduces removal failure to a logged orphan ([plan:331](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:331)) while claiming this stage makes permanent deletion true about bytes ([plan:334](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:334)).
- Illustrated plates are absent from the inventory. Their manifests live in `article_revisions.illustrated`, and their bytes share the same content-addressed bucket ([src/db/schema.ts:851](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:851), [src/illustrated-image.ts:107](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/illustrated-image.ts:107)).
- Stage C deletes upload rows but deliberately leaves staging objects. Deleting the row destroys the durable mapping to the staging key ([src/store/pg-uploads.ts:221](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/pg-uploads.ts:221)), and there is currently no production sweeper ([docs/project/ingest-queue.md:258](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/project/ingest-queue.md:258)).

Thus the request can report permanent deletion while retaining the original uploaded PDF or generated images indefinitely—the house definition of silent success ([docs/reusable/silent-success.md:6](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/reusable/silent-success.md:6)).

(b) Replace the relevant Stage C/E wording with:

> Before cascading the article, derive and persist cleanup tasks for every object class: the raw source, every stored article asset and PDF figure, every successful Illustrated plate, and every associated upload staging key. These tasks are committed with the article deletion and retried idempotently until complete. Staging keys are not removed until the existing upload-grant sweep predicate says deletion is safe; preserve the upload row or copy its key and eligibility time into the cleanup task until then. A storage failure remains pending work, never a discarded logged orphan.

If cleanup is asynchronous, the API/UI must distinguish “article access deleted; storage cleanup pending” from “all retained server copies removed.”

### F6 — P1 — established: the cache plan leaves deleted data and can make failure reconciliation lie

(a) Invalidating only `/api/article/<slug>` and `/api/library` ([plan:300](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/docs/plans/260906h-delete-an-article-permanently.md:300)) leaves cached metadata, comments, chat, search, glossary, illustrated data, and every other cacheable article endpoint. The complete list is at [src/web/lib/api.ts:834](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/lib/api.ts:834). The cache contract itself says stale data after a delete looks exactly like deletion failed ([src/web/lib/offline-store.ts:697](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/lib/offline-store.ts:697)).

The failure reread is also unsafe if implemented through normal `apiFetch`:

1. DELETE commits, but its response is lost.
2. The metadata reconciliation GET also suffers a transport failure.
3. `apiFetch` returns the old cached metadata as status 200 with `x-spideryarn-offline: copy` ([src/web/lib/api.ts:664](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/web/lib/api.ts:664)).
4. The UI says the article survived “untouched,” although it is gone.

Authenticated plates and assets also use one-year immutable browser caching ([src/routes.ts:605](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/routes.ts:605), [src/routes.ts:691](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/routes.ts:691)); already downloaded browser copies cannot honestly be claimed as recalled.

(b) Replace the cache bullet with:

> After confirmed deletion, call `forgetUser(ownerId)` so every application-managed cached body for that reader is retired; targeted per-article invalidation can replace this later. Reconciliation must be network-authoritative: a server 404 proves deletion, a fresh server 200 proves survival, and a transport failure or `x-spideryarn-offline: copy` proves neither. Change authenticated binary responses to revalidate authorization rather than remain immutable, and state plainly that copies already downloaded or cached on a reader’s device cannot be recalled.

## Open decisions

- Article images and PDF figures: add a catalogue. More precisely, use one catalogue/ref table for every canonical blob class, including raw sources, assets, PDF figures, and Illustrated plates. JSON scanning is suitable for migration/backfill or an independent consistency check, not live refcounting. Leaving orphans is the only safe simple v1, but it contradicts Decision 4 and must remove the claim that server bytes are deleted.

- Public link: return 404, not 410. That preserves the existing absent/private indistinguishability and requires no deletion tombstone. Public pages and public binary routes already re-check `publicSlug` and use `no-store` ([src/store/public-slug.ts:28](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/store/public-slug.ts:28), [src/public/page.ts:187](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/public/page.ts:187)). Test the page, public API, and public image URLs after deletion.

- Private audit trace: absence from `article_visibility_changes` is acceptable for takedown purposes because a never-public article was never served to strangers. Articles that were public already retain the evidence specifically for complaints arriving after deletion ([src/db/schema.ts:316](/home/greg/code/spideryarn2/.claude/worktrees/delete-article-permanently/src/db/schema.ts:316)). Separately, asynchronous cleanup requires a minimal durable deletion receipt/outbox for correctness. Keep identifiers, actor, time, former visibility, and cleanup state; retain no title, URL, or prose unless independently required.

- Archive prerequisite: Greg’s overrule creates no new integrity hazard. Archive was an accidental-action speed bump, not a concurrency or authorization boundary, and it would not prevent a public link dying. The proposed two-step confirmation is adequate provided the destructive confirm is never auto-focused, cannot inherit the trigger’s keyboard activation, and cannot run from offline/unestablished metadata.

No files were changed. I did not run a test: the decisive failures are database/storage concurrency properties, and the permitted environment cannot exercise Postgres or loopback.