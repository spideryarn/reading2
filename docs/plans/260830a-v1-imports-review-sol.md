# Verdict: NO-SHIP

The plan fixes the previous proposal’s three headline mistakes, but the new happy path still does not finish correctly. The central problem is that publication is neither a valid pipeline step nor atomic with job completion.

## Critical findings

### Critical 1 — `publish` cannot be implemented as the step described

A pipeline step must declare at least one artefact. `checkProduct` explicitly rejects `produces: []`, and the filesystem session runs that check before finishing the step or job ([session.ts:175](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:175), [session.ts:201](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:201), [session.ts:281](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:281)).

There is also a compile-time form of the same rule: a new step not listed in `LEGACY_UNCONVERTED_STEPS` must return `parts` ([pipeline.ts:390](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:390)).

The deterministic trace is:

1. The five real default steps write valid files ([pipeline.ts:166](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:166)).
2. `publish.run()` calls `importArticle`.
3. `importArticle` commits a revision and moves `currentRevisionId` last ([import.ts:1092](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1092)).
4. The Postgres reader can now load it because blocks and tree exist ([pg.ts:1237](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:1237)).
5. `session.commit()` then rejects the zero-artefact publish step.
6. The article is readable, but the job reports an error.

A fake “publish receipt” file is not a fix: a warm receipt could skip publication when Postgres does not contain it, recreating the previous plan’s quiet success.

Concrete action: do not add `publish` to `StepName`. Add a job finalizer after the last real step. Split the database-writing half of `importArticle` so the article publication and fenced `jobs.status = 'done'` update occur in one Postgres transaction. This is a small vertical slice of D1b, not the whole artefact conversion.

### Critical 2 — publication and job completion have an unrecoverable crash gap

Even if the step contract is special-cased, `importArticle` commits its own transaction before `runStep` settles the job ([import.ts:533](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:533), [jobs.ts:423](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:423)).

Kill the invocation after the import commits but before the job finishes:

- The article is published.
- The job remains running and is later failed by `failExpired`.
- Retry encounters the proposed first-ingest guard because the article now exists.
- Allowing the retry to re-import instead would risk deleting reader state created after the first publication; the importer deletes it wholesale before reinserting the files’ version ([import.ts:825](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:825), [import.ts:850](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:850)).

Concrete action: publication and terminal job settlement must be one transaction. Alternatively, publication needs a durable job-id idempotency record plus a content-only importer that never touches reader state, but that is more machinery.

### Critical 3 — looping `advanceJob` does not guarantee one invocation owns the job

Every `advanceJob` call takes one claim, runs one step, then releases it ([jobs.ts:816](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:816), [jobs.ts:915](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:915), [jobs.ts:948](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:948)). A route loop cannot remove the gap between release and the next claim.

With two tabs:

1. Invocation A completes `fetch` and releases.
2. Invocation B claims `extract`, potentially on a different instance with empty `/tmp`.
3. It sees no fetch artefact and runs `fetch` again.
4. At the next release A can take over again.

In an unlucky two-instance alternation, both repeatedly restart from their own partial filesystem. The database claim prevents simultaneous steps; it does not give one route invocation ownership across steps.

Concrete action: implement `advanceJobToCompletion` inside the job coordinator. Claim once, retain the same attempt while walking the real steps, and release only on an intentional handoff or terminal settlement. The route should call that once rather than loop the one-step API.

### Critical 4 — owner-scoped `/tmp` accepts stale artefacts as another job’s work

`stepIsDone` derives only interruption, readable outputs and optional stamps ([pipeline.ts:675](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:675)). Fetch, extract and ToC do not bind their outputs to the current job or requested URL.

A concrete failure:

1. Job A for URL A completes fetch/extract/blocks and later fails.
2. No article was published, so Postgres says the slug is free.
3. Job B for URL B receives the same slug.
4. Warm `/tmp/spideryarn/<owner>/<slug>` still contains A’s valid artefacts.
5. B skips them and can publish A under B’s request.

Markers only protect a partial run of the same step. Completed earlier steps have no marker. Artifact writes are also not fenced against an expired claimant; the filesystem implementation explicitly admits a read/unlink race ([artifacts-fs.ts:553](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:553), [artifacts-fs.ts:585](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:585)).

Therefore `/tmp/spideryarn/<ownerId>` is insufficient. Same-owner, different-slug jobs are separated, but sequential jobs for the same slug, and a retry racing a late expired writer, collide.

Concrete action: scope scratch storage at least by job id:

```text
/tmp/spideryarn/<ownerId>/<jobId>/
```

Accept that a retry with a new job id repurchases work. That is safer than opportunistically treating unbound files as checkpoints.

### Critical 5 — Stage 5 hydration can resurrect or delete reader state

`exportArticle` writes into an existing directory and only writes optional files when corresponding rows exist ([export.ts:378](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:378), [export.ts:441](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:441), [export.ts:526](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:526)). It does not remove files that Postgres says are absent.

Therefore “Postgres wins over warm `/tmp`” is false:

- A deleted comment with a stale `comments.json` is resurrected.
- A null old arc with a stale `arc.json` can be treated as current.
- Old searches, chat or lookup files can reappear.

Export is also not one snapshot: it performs many separate queries without a wrapping transaction. A comment written during hydration can be missed, after which `importArticle` deletes it from Postgres.

Concrete action: do not round-trip live reader state through files. Hydrate pipeline artefacts only into a fresh job directory, and use a live publication path that preserves shelf/comments/chat/searches/lookups in Postgres. Stage 5 must not lift the first-ingest guard as currently designed.

## High findings

### High — The first-ingest guard needs two enforcement points

Before hydration exists, reject jobs for an existing article at enqueue time. Otherwise `{steps:["arc"]}` spends work against an empty scratch directory before reaching a publish-time guard.

Keep an authoritative check inside the publication transaction as well; enqueue-only is racy.

The job-id exemption is safe only if the transaction positively verifies that the exempt job is the currently running job for that owner, slug and attempt. Merely adding `jobs.id != exemptId` lets any internal caller suppress the holder it names.

### High — Stage 2 needs global slug reservation, not merely an owned article lookup

Article slugs are globally unique ([schema.ts:129](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:129)), but active jobs reserve `(ownerId, slug)` only ([schema.ts:1175](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:1175)). Two owners can therefore queue the same unused slug; one completes and the other spends the full pipeline before publication refuses it.

Use the existing global boolean lookup ([slug-is-taken.ts:45](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/slug-is-taken.ts:45)) for existing rows, and introduce a global slug reservation for active ingests. Do not expose another owner’s URL while resolving the collision.

### High — The 405-second figure is not a worst case

The current default no longer includes `arc`, so the plan is stale in that direction ([pipeline.ts:143](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:143)).

It is much more optimistic about assets. Policy permits 200 images, two concurrent, two attempts, with a 15-second timeout ([collect-assets.ts:106](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:106), [collect-assets.ts:112](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:112), [collect-assets.ts:418](/Users/greg/Dropbox/dev/experim/spideryarn2/src/collect-assets.ts:418)). A timeout-heavy article can approach:

```text
200 / 2 × 2 × 15s = 3,000s
```

Give `assets` an article-wide wall-clock budget and turn unvisited images into explicit failed entries.

### High — PDF source viewing remains tied to ephemeral `/tmp`

The article text can be served from Postgres, but `GET /api/source/:slug` still reads `raw.json` and the PDF through `fsLocations` ([routes.ts:243](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:243)). A later cold invocation returns 404.

Move this route to the stored raw-source reference/signed URL now, as the long-term plan already requires.

## Ordering and time budget

Stage 0 first is correct, provided `LEASE_MS` and `maxDuration` deploy together.

For the current per-step design, I would set:

```text
LEASE_MS = 7 * 60_000
self-abort = 400s
maxDuration = 800s
```

A longer lease does not break `failExpired` or browser backoff. It delays reclamation to seven minutes; the browser continues receiving `busy` until the next advance sweeps it ([pg-jobs.ts:276](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:276)).

`maxDuration: 800` is allowed on Pro with Fluid Compute. Pin `"fluid": true` in `vercel.json` or verify the project setting; account plan alone does not prove Fluid is enabled. [Vercel’s current duration documentation](https://vercel.com/docs/functions/configuring-functions/duration) lists 800 seconds for Pro with Fluid Compute.

The route must enforce an absolute deadline and abort before Vercel kills it. It should not start a fresh 400-second step late in an 800-second invocation. More importantly, handing back mid-job is not a durable checkpoint: a cold next invocation loses `/tmp`. For v1, fail the job cleanly before the platform deadline and let Retry restart; do not promise transparent handoff.

Revised order:

1. Stage 0: duration, lease, Fluid pin.
2. Stage 1: job-scoped scratch root.
3. Stage 2: global existing-slug check and reservation.
4. Stage 3: claim-once, server-side full-job coordinator with a hard deadline.
5. Stage 4: transactional job finalizer, not a pipeline step.
6. Defer Stage 5 until it is artifact-only and cannot round-trip reader state.

Stage 4 cannot be committed independently as written: it fails the current step contract. Stage 5 should not be built in its present form.

## Remaining operational points

- The 4.5 MB request limit is already handled correctly for uploads because PDFs go directly to Storage. Advance responses are small. The separate risk is an article response exceeding 4.5 MB while filesystem artefact ceilings allow much larger data. [Vercel documents the 4.5 MB request and response limit](https://vercel.com/docs/functions/limitations).
- Load-test a maximum-size PDF in one invocation while recording peak RSS. Pro defaults to 2 GB and permits 4 GB; PDF buffers, pdf-lib copies and base64 expansion coexist.
- Platform termination will not reliably reach the step’s Sentry capture. Log job id, attempt, scratch scope and final revision id at claim, publication and expiry; make `failExpired` report affected job ids rather than only a count.
- Add adversarial tests for two route callers on different scratch roots, stale same-slug files, a kill between publication and settlement, foreign-owner slug races, and hydration with a concurrent comment.

The honest stepping-stone claim is narrower than the plan says. Store-backed slug checks, the root-injection mechanism and an end-to-end publication contract survive. The separate `publish` step does not: D1b publishes inside the last real step’s transaction. The route loop is discarded, and the largest stage—hydration—is also disposable glue. The position of publication therefore has not survived; only the acceptance test has.