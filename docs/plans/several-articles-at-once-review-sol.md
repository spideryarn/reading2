# STOP — do not build this plan as written

## Blockers

1. **The motivating production path cannot currently run.**

A queued Tweets/Summary job does not read the article previously published by the ingest. `claimSession` always gives stages filesystem-backed reads; Postgres is only wrapped around final publication ([src/jobs.ts:1003](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1003)). Deployed scratch is isolated by job id ([src/store/data-root.ts:31](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/data-root.ts:31), [src/store/data-root.ts:168](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/data-root.ts:168)), while Summary directly opens `blocks.json` and `tree.json` there ([src/summarise.ts:1013](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:1013)). The Postgres draft is opened only after all steps finish ([src/store/publish-session.ts:151](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:151)).

Therefore, on a cold or different Vercel instance:

1. Ingest A publishes.
2. Queued Summary B claims.
3. B sees an empty job-specific directory and fails before generating anything.

The plan’s 202-response test would pass while the feature still fails. Make “late steps read the published store” a prerequisite, with a cold-instance integration test.

2. **The proposed article mutex is not scoped to the actual article identity.**

The plan proposes `(owner_id, slug)` ([plan:89](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/several-articles-at-once.md:89)), but article slugs are globally unique ([src/db/schema.ts:130](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:130)). Two owners can therefore run the same slug simultaneously after the global index is removed.

Today `jobs_only_one_running` prevents that. Under the plan, both jobs can do all their expensive pipeline work; because the draft is opened lazily, the loser only discovers at publication that the slug belongs to the other reader ([src/store/pg-revisions.ts:386](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:386), [src/store/pg-revisions.ts:408](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:408)).

The running mutex—and probably name reservation—must be global on `slug`, unless article identity itself changes to `(owner, slug)`. `jobs_active_work` should remain owner-scoped.

3. **This creates contention, not a per-article queue. There is no FIFO rule.**

`claim(id)` claims whichever job id a caller presents; it never checks for an older active job on the slug ([src/store/pg-jobs.ts:214](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:214)). `useJobs` drives every active id ([src/web/useJobs.ts:360](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:360)), and Postgres lists newest first ([src/store/pg-jobs.ts:157](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:157)).

Consequences:

- Several queued jobs race rather than run in request order.
- A newly queued late step can beat an ingest that is itself still queued, then fail because the article does not exist.
- Summary can run before an older re-extraction and immediately become stale.

The migration even claims claiming scans the oldest queued row, but current claiming does not use that index ([drizzle/0001_auth_fks_and_guards.sql:117](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0001_auth_fks_and_guards.sql:117)).

Claiming needs a deterministic predecessor rule, for example no older active `(created_at, id)` row for the same global slug.

4. **The two enqueue indexes overlap, so constraint-name dispatch is unsound.**

Two identical URL ingests have the same slug and `work_key`, and both have `reserves_name=true`. The second insert violates both `jobs_active_work` and `jobs_reserved_slug`. PostgreSQL does not provide a semantic priority saying the de-duplication constraint must be reported first.

If `jobs_reserved_slug` is reported, the proposed mapping declares different work ([plan:115-120](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/several-articles-at-once.md:115)). That can produce a 409 loop—`freeSlug` deliberately adopts the same slug for the same URL ([src/jobs.ts:1813](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1813))—or, if forced past it, create a second article and pay twice.

On any reservation conflict, reread the reserver and compare its work key and source. Also, “request carried a URL/upload” is too broad a definition of reservation: a re-ingest of an already-owned URL is targeting an existing article, not claiming a new name.

## High severity

### The queued sweep should be removed

The proposed heartbeat conflicts with existing deliberate resume behaviour. A fresh page explicitly restarts jobs left by a closed tab or restarted server ([src/web/useJobs.ts:365](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:365)).

A legitimate job can receive no touches during:

- a suspended mobile browser;
- a network or server outage;
- the interval between enqueue succeeding and the client starting its driver;
- a closed tab that the reader expects to resume later.

Worse, `advanceJobWith` calls `failExpired()` before claiming or touching the requested job ([src/jobs.ts:1049](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1049)). The first request after an outage would sweep the very job it is trying to resume.

Queued rows consume no worker slot. Keep them durable, or make abandonment an explicit cancellation/retention policy. `last_seen_at` cannot distinguish abandonment from disconnection.

### Singular-job consumers need redesign, not just ordering

`activeForSlug` currently returns an arbitrary active row: no ordering in Postgres ([src/store/pg-jobs.ts:324](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:324)), insertion order in filesystem ([src/store/jobs-fs.ts:373](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/jobs-fs.ts:373)). Preferring the reserver is necessary, but other callers also assume singularity:

- Upload repeat-claim recovery returns the first job with that slug, from a newest-first list; it can return a later Tweets job instead of the upload ingest ([src/routes.ts:2576](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2576), [src/routes.ts:2602](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:2602)).
- `useStepJob` chooses the first active job writing a step, so two same-step jobs with different profile/force can display the queued one rather than the running one ([src/web/useStepJob.ts:145](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:145)).

Use purpose-specific lookups: active reserver, matching upload, running step job, etc.

### Cancelling is unresolved

The proposed predicates include a running job with `cancelling=true`. An identical new request therefore de-duplicates to a job that is about to become cancelled, and the new request disappears.

`jobs_active_work` should likely exclude cancelling rows, while the article mutex and name reservation continue holding until the old claimant becomes terminal.

## Answers to the five questions

### 1. Global cap: choose A

Counting inside the locked `queue_state` transaction is safe under READ COMMITTED, provided every transition into `running` takes that lock.

The count and `UPDATE` may be separate statements. Other claimers cannot increase the count between them because they wait on the singleton lock. A concurrent finish/release can only decrease it, producing at worst a conservative `busy`, never exceeding N.

The current comment is indeed false: schema says claiming locks the row ([src/db/schema.ts:1195](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1195)), while the claim is only an update to `jobs` ([src/store/pg-jobs.ts:214](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:214)).

B is incomplete as described:

- A unique nullable slot does not require a running row to have a slot.
- It does not stop slot `N+1`.
- Concurrent “lowest free slot” statements can choose the same slot from their snapshots. One succeeds; the others receive `23505` despite other slots remaining free. Retrying progresses, but an unlucky job can starve.

A robust slot design needs a fixed slot table and locked available rows, not merely a column. For configurable N, A is simpler. Drop or explain the now-meaningless singular `queue_state.running_job_id`.

### 2. Three replacement indexes: no, not as written

They cover the ordinary same-owner cases only after fixing:

- global slug scope for mutex/reservation;
- overlapping constraint handling;
- reservation meaning;
- cancelling behaviour;
- deterministic reservation lookups.

`work_key` itself is appropriately comprehensive: steps/force, upload id, profile and normalized URL are included ([src/jobs.ts:1651](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1651)).

The database’s global article uniqueness prevents two final article rows sharing a slug, but the plan allows two owners to run toward one slug and makes one fail after spending. Constraint misclassification can instead produce two slugs for one URL and duplicate spend.

### 3. Freshness after waiting

Conceptually, the late job should re-evaluate at execution:

- `workKeyFor` records request identity, not a revision snapshot.
- `stepIsDone` computes the expected stamp at run time ([src/pipeline.ts:681](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:681)).
- Summary/Tweets stamps hash the current stored blocks ([src/pipeline.ts:1795](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1795), [src/pipeline.ts:1660](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1660)).
- A proper Postgres session begins its draft after claim and copies the then-current revision ([src/store/pg-revisions.ts:576](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:576)).

So after the storage prerequisite is fixed, B should regenerate against A’s new blocks. Current deployed wiring prevents that entirely.

There is also a pre-existing edge: Summary hashes blocks, not the ToC tree, so a tree-only change can leave Summary marked current even when its ranges no longer match ([src/pipeline.ts:1408](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1408)).

Within-article serialization remains necessary: publication never compares the draft’s base revision with the current pointer ([src/store/pg-revisions.ts:1278](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1278)).

### 4. Queued sweep

No: not worth the column as proposed. It changes “durable until resumed or cancelled” into “alive only while a browser keeps reaching the server.” That is a product-policy change, not repair of an expired lease.

### 5. The four constants

The plan is too relaxed.

- **Assets:** not merely latency. The process-global FIFO gate’s wait time counts against each article’s budget ([src/collect-assets.ts:424](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:424), [src/collect-assets.ts:571](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:571)). A later article can time out solely behind another article, then successfully publish a current manifest containing `out-of-time` failures ([src/collect-assets.ts:699](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:699), [src/pipeline.ts:1529](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1529)). That leaves images hot-linked despite the step existing to prevent reader requests reaching publishers ([src/pipeline.ts:1506](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1506)). Do not simply scale the gate with N; keep global politeness and add fairness between articles.
- **Labels/Summary:** primarily spend and provider-rate-limit availability; add a global model-call ceiling.
- **Step budget:** yes, contention can make pre-flight start work that no longer fits. The deadline aborts it and ends the job as an interrupted retryable error, not silent bad data ([src/jobs.ts:1191](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1191), [src/jobs.ts:1302](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1302)). That is reliability and duplicate-spend risk, stronger than a note.
- **Pool:** explicitly an availability limit, not latency; the code says oversized pools cause other instances to be refused connections ([src/db/client.ts:57](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/client.ts:57)).
- The plan’s claim that process state is not shared on Vercel is contradicted by the job runner’s own concurrency comment: several advances can be in flight in one instance ([src/jobs.ts:1163](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1163)).

## Missing tests

Most important additions:

1. Cold-instance late-step: published PG article, empty job scratch, queued Summary/Tweets must finish against published blocks. The plan’s 202 test passes without this.
2. Cross-owner same-slug claims. A same-owner/different-slug cap test passes while the article mutex is wrongly owner-scoped.
3. Three jobs on one slug, claim attempts deliberately reversed; assert FIFO completion. The proposed two-job test starts the first manually and cannot catch unordered claiming.
4. Identical URL and upload inserts that violate reservation and active-work simultaneously; assert exactly one job. “Double-click Tweets” has `reserves_name=false` and cannot catch this.
5. Same URL with different work: queue on the same article rather than rename, loop or 409.
6. Cancelling identical work: the new request survives as its own queued job.
7. `activeForSlug` with both row/insertion orders, plus repeat-upload route recovery returning the upload ingest.
8. Deterministically concurrent N+1 Postgres claims using separate connections/barriers. Sequential claims would pass if the count were mistakenly outside the lock.
9. Sweep-after-outage/suspension and the `failExpired-before-touch` case, if the sweep is retained. “Being polled” alone passes while legitimate resumptions are killed.
10. Re-extract A followed by already-queued Summary B; assert B’s stored source hash equals A’s new blocks. Merely checking that a summary exists can pass with carried stale output.
11. Two simultaneous asset jobs; assert one article cannot consume the FIFO ahead of the other’s entire budget.
12. A contended runtime budget test. The existing test only compares fixed constants and therefore stays green when contention makes real execution exceed them ([tests/jobs-lease-budget.test.ts:84](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-lease-budget.test.ts:84)).

Finally, the migration surface is larger than listed: `jobs_active_slug` was added in [drizzle/0014_uploads_and_job_work_key.sql:22](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0014_uploads_and_job_work_key.sql:22), and many helpers explicitly catch the two old constraint names, including [tests/helpers/running-slot.ts:83](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/running-slot.ts:83). The plan’s “three parity tests invert” understates the audit needed.