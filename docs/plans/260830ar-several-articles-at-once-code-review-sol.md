# STOP — do not commit stage 1 yet

## Blockers

1. **The test typecheck gate is red.**

`JobStore.claim` now requires five arguments, but six calls still pass four. At runtime, `maxRunning` becomes `undefined`, so `running >= maxRunning` is false and the cap is silently disabled in those helpers.

Failures:

- [tests/jobs-publish-finalizer.test.ts:986](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-publish-finalizer.test.ts:986)
- [tests/jobs-walk.test.ts:272](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-walk.test.ts:272)
- [tests/jobs.test.ts:819](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs.test.ts:819), [860](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs.test.ts:860), [1272](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs.test.ts:1272)
- [tests/store-pg-session.test.ts:688](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-pg-session.test.ts:688)

Direct `tsc --noEmit -p tests/tsconfig.json` reports all six as `TS2554`.

2. **The core lock is not tested.**

The cap test is sequential: claim A, then claim B ([tests/store-jobs-parity.test.ts:382](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-jobs-parity.test.ts:382)). It remains green if the `queue_state FOR UPDATE` statement at [src/store/pg-jobs.ts:345](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:345) is deleted. Watching it red against an implementation that ignored `maxRunning` proved the arithmetic, not the serialization.

Add a deterministic PostgreSQL test:

- Hold `queue_state` from an external transaction.
- Start two cap-1 claims for different queued jobs.
- Confirm both are blocked behind that transaction.
- Release it.
- Assert exactly one claims and one returns `busy`.

That fails if the lock is absent or if the count moves before it. This is the missing red test identified in the plan review.

3. **At saturation, PostgreSQL classifies the cap before classifying the job.**

Postgres returns cap `busy` at [src/store/pg-jobs.ts:354](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:354) before reaching the missing/finished/stopping classifier at [src/store/pg-jobs.ts:210](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:210). Filesystem does the reverse at [src/store/jobs-fs.ts:297](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/jobs-fs.ts:297).

When the cap is full:

- Missing or foreign non-running job: PostgreSQL says `busy`; filesystem says `gone`.
- Finished job: PostgreSQL says `busy`; filesystem says `finished`.
- `advanceJobWith` then casts a possibly `undefined` `get()` result to `Job` ([src/jobs.ts:1129](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1129)), producing HTTP 200 rather than the route’s intended 404.
- A known foreign ID can distinguish “that job is running” from “that job exists but is not running,” contrary to the owner-isolation contract.

At the cap branch, classify the requested row inside the transaction and return cap `busy` only when it remains an eligible queued job. Add saturated-cap parity cases for missing, foreign, and finished targets.

## High severity

**The configured cap creates a blocking database queue.**

`JobStore.claim` promises “Refuses rather than waits, always” ([src/store/jobs.ts:147](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/jobs.ts:147)), but `FOR UPDATE` waits without a lock timeout. Each waiter occupies a transaction and connection. The local pool defaults to five ([src/db/client.ts:58](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/client.ts:58)), while production’s pooler limit is shared across instances. The browser starts a driver for every active job concurrently ([src/web/useJobs.ts:360](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useJobs.ts:360)).

I found no deadlock cycle: claim is `queue_state → job`; publication/session work is `article → job` and never later requests `queue_state` ([src/store/pg-session.ts:57](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-session.ts:57), [src/store/publish-session.ts:71](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:71)). This is convoy and pool-exhaustion risk, not lock-order deadlock.

`FOR UPDATE NOWAIT`, mapping `55P03` to ordinary `busy`, fits the existing browser backoff and avoids holding connections merely to wait for another cap decision.

## Medium severity

**The singleton lock silently succeeds if the row is absent.**

The code explicitly explains this danger at [src/store/pg-jobs.ts:319](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:319), but discards the result of the locking query at line 345. The delete trigger does not protect against `TRUNCATE`, disabled triggers, or migration mistakes.

Assert that the lock query returned exactly one row. Otherwise the most dangerous state produces no error.

**The filesystem store’s enqueue interface can bypass claiming.**

`enqueueOrGet` accepts a full `Job` and stores its caller-provided status unchanged ([src/store/jobs-fs.ts:270](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/jobs-fs.ts:270)). A caller can therefore insert `running` without a cap check or attempt token. The sole application caller currently supplies `queued` ([src/jobs.ts:1589](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1589)), so the current route is safe; the store contract is not sealed. Make its input queued-only and write `"queued"` rather than copying arbitrary status.

Postgres copies arbitrary status too ([src/store/pg-jobs.ts:120](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:120)), although its fencing constraint rejects a normal `Job` marked running because enqueue supplies no token or lease.

## Running-writer audit

The ordinary production paths are exact:

- PostgreSQL’s only successful normal transition is private `claimIn`, called under the singleton lock ([src/store/pg-jobs.ts:167](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:167), [364](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:364)).
- Filesystem has no `await` between counting and setting `running` ([src/store/jobs-fs.ts:303](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/jobs-fs.ts:303)).
- Disk-loaded running jobs are converted back to queued before indexing ([src/store/jobs-fs.ts:137](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/jobs-fs.ts:137)).
- The importer only verifies and locks an already-running job; it does not create one ([src/store/import.ts:472](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:472)).
- No script or migration creates a running job.

Test-only bypasses exist:

- Committed during fixtures: [tests/helpers/load-article.ts:246](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/load-article.ts:246), [tests/store-import-active-job.test.ts:158](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-import-active-job.test.ts:158), [tests/store-job-draft.test.ts:99](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-job-draft.test.ts:99).
- Rollback-only: [tests/store-step-fence.test.ts:318](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-step-fence.test.ts:318), [tests/store-artefacts-pg.test.ts:1092](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-artefacts-pg.test.ts:1092), and the schema case itself ([tests/db-schema.test.ts:299](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/db-schema.test.ts:299)).

They do not threaten production, but the committed fixture helpers can exceed the cap when a dev server is concurrently running N real jobs.

## Other conclusions

- Excluding the requested ID cannot admit N+1: a running row cannot satisfy the queued-only update. It does misreport the reason if the cap is lowered below the current running count, so the categorical comment at [src/store/pg-jobs.ts:347](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:347) is false in that case.
- `failExpired` remains sound with N jobs. It only lowers the running count; sweep/claim races can cause a conservative `busy`, not oversubscription.
- The schema test allowing two running rows correctly records the loss of the old index. It is not a cap test and does not replace the missing concurrency test.
- There is no cheap declarative constraint for configurable N. A fixed slot table could provide a true database backstop, but it is materially more machinery. Count-plus-lock is reasonable once the lock is genuinely tested and the store surface is sealed.

Several comments still describe the removed design:

- [src/store/pg-jobs.ts:667](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:667) says `claim` still catches `jobs_only_one_running`.
- [src/db/schema.ts:1212](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1212) says the singleton guarantees concurrency 1.
- [tests/db-schema.test.ts:260](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/db-schema.test.ts:260) repeats that.
- The live delete-trigger error still says “global concurrency-1 guarantee” ([drizzle/0001_auth_fks_and_guards.sql:92](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0001_auth_fks_and_guards.sql:92)); migration 0032 should replace that function text rather than rewriting the historical migration.