# Verdict: NO-SHIP

The durable-checkpoint work is sound, but the comment lease introduces an unfenced stale-writer race. I also would not accept the unenforced `read committed` dependency.

## Blocking findings

1. **Critical — an expired comment attempt can overwrite its replacement.**

`beginAnswer` creates an attempt ID and lease ([pg-comments.ts](/home/greg/code/spideryarn2/src/store/pg-comments.ts:331)), but returns only the comment. Terminal `patch` updates solely by article and comment ID ([pg-comments.ts](/home/greg/code/spideryarn2/src/store/pg-comments.ts:474)); it checks neither `status = pending` nor `attempt_id`.

Concrete failure:

- Attempt A begins.
- Its profile lookup at [routes.ts](/home/greg/code/spideryarn2/src/routes.ts:1154) stalls for over 150 seconds. There is no database query timeout, and the model’s 120-second clock starts only later, inside `explainStream` ([explain.ts](/home/greg/code/spideryarn2/src/explain.ts:473)).
- Machine B handles a GET and sweeps A’s expired lease ([pg-comments.ts](/home/greg/code/spideryarn2/src/store/pg-comments.ts:561)).
- The reader retries, creating attempt B.
- A resumes and its unfenced success or error patch at [routes.ts](/home/greg/code/spideryarn2/src/routes.ts:1168) or [routes.ts](/home/greg/code/spideryarn2/src/routes.ts:1192) overwrites B.

The search store already describes and prevents precisely this race by carrying the attempt token through `finish` ([pg-searches.ts](/home/greg/code/spideryarn2/src/store/pg-searches.ts:328)).

2. **Important — an abandoned pending comment cannot heal through Retry.**

Sweeping occurs only on the comments GET ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:5980)). The client performs that GET only when the hook loads ([useComments.ts](/home/greg/code/spideryarn2/src/web/useComments.ts:186)); Retry sends the answer POST directly ([useComments.ts](/home/greg/code/spideryarn2/src/web/useComments.ts:557)).

If the answering machine dies, the client locally marks the comment errored. Even after the database lease expires, every Retry still gets 409 because `beginAnswer` accepts only stored `done` or `error`, while the database row remains `pending`. Reloading fixes it because that causes a GET, but an open page can remain stuck indefinitely.

A death “before stamping the lease” does not create a half-state: status, attempt ID, and lease are written by one SQL statement. It either leaves the old terminal row or commits the complete pending attempt.

3. **Important — `raw_sources` still depends on an isolation setting nobody enforces.**

The function correctly documents that its insert-then-read depends on `read committed` ([artifacts-pg.ts](/home/greg/code/spideryarn2/src/store/artifacts-pg.ts:1038)). The production caller opens its commit transaction without isolation options ([pg-session.ts](/home/greg/code/spideryarn2/src/store/pg-session.ts:549)), so it inherits `default_transaction_isolation` from the database or role.

Under `repeatable read`, two articles writing the same previously unseen digest reproduce the whole-transaction failure:

- B’s snapshot is established before A commits.
- B’s `ON CONFLICT DO NOTHING` waits for A, then inserts nothing.
- B’s read-back cannot see A’s row in its old snapshot.
- [artifacts-pg.ts](/home/greg/code/spideryarn2/src/store/artifacts-pg.ts:1110) throws and the revision commit rolls back.

I did not query the live database, so I am not claiming its current role is configured this way. I checked that the application does not prevent it.

## What passed

- **D2 transaction wiring is correct.** Stage code receives `session.checkpoints` before `session.commit` ([jobs.ts](/home/greg/code/spideryarn2/src/jobs.ts:558)). Checkpoint reads and writes call `getDb()` independently ([checkpoints-pg.ts](/home/greg/code/spideryarn2/src/store/checkpoints-pg.ts:80)), while the draft commit opens its later transaction separately. Consequently:

  - a failed stage retains completed checkpoints;
  - a failed or stale commit rolls back the revision but not its checkpoints;
  - handback retains them;
  - an all-skipped claim performs no paid work and leaves existing checkpoints untouched;
  - staleness before `beginStep` prevents the stage from running, while staleness discovered after it ran preserves content-addressed work.

- **The job pipeline no longer writes into job-scoped `/tmp` under Postgres.** `contextPaths` is still computed at [jobs.ts](/home/greg/code/spideryarn2/src/jobs.ts:485), and `outputs` still constructs paths, but none of the thirteen stage `run` implementations performs I/O through `ctx.dir` or `ctx.htmlFile`. Production also refuses Postgres without Supabase Storage credentials rather than falling back to filesystem blobs ([index.ts](/home/greg/code/spideryarn2/src/store/index.ts:155)).

- **The CLI deletion is complete as an executable-path deletion.** The remaining direct directory readers are test/eval helpers or the earlier stage commands intentionally retained.

- **The remaining filesystem surfaces are not dead yet.** `copy-artefacts.ts` is used by the fixture loader. `PipelineStep.outputs`, `StepContext.dir/htmlFile`, and `contextPaths` still support the filesystem metadata endpoint at [api.ts](/home/greg/code/spideryarn2/src/api.ts:974). `dataRoot()` still supports filesystem adapters. They are duplicated legacy structure and can go with the deferred filesystem-store removal, but not independently today. Several live comments still mention deleted commands such as `npm run arc`; that is cleanup, not a ship blocker.

## Shortest path to SHIP

1. Make `beginAnswer` return an attempt token. Require it for both terminal writes. In Postgres, finish only where `status = 'pending' AND attempt_id = supplied`, then clear the attempt and lease.
2. Let `beginAnswer` atomically reclaim an expired pending row, so Retry heals without requiring a preceding GET. Resolve the profile before claiming, or renew/start the lease immediately before the timed model work.
3. Add the two interleaving tests: stale A cannot overwrite B; an expired pending row can be retried without GET.
4. Pin the production artifact commit transaction to `{ isolationLevel: "read committed" }` and add a test that verifies the transaction’s actual isolation.

Direct TypeScript checks for the Node, browser, and test projects passed. Targeted lint produced only the repository’s existing complexity advisories and one unrelated comma-operator warning. I did not run database-backed tests or the normal typecheck wrapper because of the prohibitions on database writes and reading under `data/`.