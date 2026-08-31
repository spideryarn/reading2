NO-SHIP as written. B is right. A2 is the better base, but the proposed global scratch-first layering is unsafe across claim handbacks and introduces an all-skipped publication failure.

## 1. A1 or A2

Choose A2, with two additions:

- Bind once to the exact published revision ID at claim creation.
- At publication, verify the lazily opened draft was based on that same revision. If the pointer moved, fail or rerun instead of combining inputs from revision R1 with a draft copied from R2.

The missing A2 semantics are coherent:

- `readBaseline` should run the existing three-state baseline validation against that exact published revision. That is precisely the previous glossary or ideas artefact the stage needs ([artifacts-pg.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:606)).
- `hasEarlierBlocks` should be true when the bound published revision exists and has blocks. Publication already refuses revisions without blocks ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1205)). With no published revision, it is false.
- Use a narrower read reference containing `slug`, `articleId`, and `revisionId`; do not fabricate `jobId` and `attemptId` merely to satisfy `JobDraftRef`.

A1 is more broken than the plan says. Opening a draft eagerly and then failing or cancelling sends the non-`done` ending straight to the inner session ([publish-session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:366)). `finishIn` does not clear `draftRevisionId` ([pg-jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:511)). The sweeper spares any revision still named by a job. Therefore these drafts are not merely left for `sweepAbandonedDrafts`; they are retained indefinitely. Cancellation during a release has the same problem because `releaseStepIn` can make the job terminal without clearing the pointer ([pg-jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:450)).

A1 also creates an article row before success. `articleExists` deliberately treats even an article with no published revision as existing ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:819)). That changes slug allocation after every failed first ingest.

## 2. Is scratch-first layering safe?

No. The statement “this claim wrote it” is false.

The path contains the job ID, not the attempt ID ([data-root.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/data-root.ts:168)). A claim can deliberately hand the same job back after completing a step ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1256)). The next `/advance` mints a new attempt but calls `runInJob` with the same job ID ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1067), [jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1105)).

Concrete failure:

1. An existing article has published arc A0.
2. A forced multi-step job runs arc A1 on instance X.
3. There is not enough claim budget for the next step, so arc becomes `done` and the job is released.
4. The next advance lands on instance Y. Its same-job scratch is empty.
5. `stillForced` is now false because the step status is `done` ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:366)).
6. The layered store falls back to published arc A0 and may declare arc done.
7. The job finishes without ever recovering or publishing A1.

A third claim landing back on X can instead find X’s older same-job scratch. Thus two instances can hold different generations under the same job-scoped path. Job scoping prevents cross-job contamination; it does not establish claim freshness.

There is also an interface problem. Filesystem `read` flattens “absent” and “unusable” to `null` ([artifacts-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:316), [artifacts-fs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:365)). A composite cannot safely decide whether `null` means “fall through” or “this job wrote a corrupt artefact; do not hide it with the published copy.” Similar ambiguity exists for `has` and `stampFor`. A correct overlay needs tri-state source arbitration and must not assemble one step’s products from different layers.

Retries and cancel-then-retry are safe from cross-job scratch: retry creates a new job and therefore a new job ID ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1986)). The dangerous path is release and resumption of the same job.

## 3. Second-order behaviour

The largest immediate failure is the all-skipped path:

1. Published Postgres says a late artefact is present and current.
2. Empty scratch falls through to it, so every requested step skips.
3. The walk ends through `settleJob` ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1388)).
4. `publishingSession` opens a draft and copies the empty scratch.
5. The zero-copy guard refuses publication ([publish-session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:193)).

Thus an unforced job for an already-current artefact changes from a no-op into an error. The finalizer must distinguish “proved no work necessary” from “work supposedly happened, but its scratch vanished.” Claim handback makes that distinction non-trivial.

Other changes:

- Glossary append is correct but conditional. It appends only when source hash, prompt version, and profile hash all match ([glossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:361)). Then `passes` increments, existing entries retain their IDs, and new collisions are deduplicated ([glossary.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:647)). With unchanged source but a new prompt/profile, it rewrites while inheriting matching IDs. With changed source, it intentionally starts new identities.
- Ideas will begin inheriting IDs from the published ideas artefact when its source fingerprint matches ([ideas.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:569)).
- The incomplete freshness stamps become active. Tweets, glossary, and summary consume tree and metadata but stamp only the blocks hash ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1651), [pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1715), [pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1786)). Ideas and sketch consume metadata but omit it from their fingerprint ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1871), [pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1977)). After A, those incomplete stamps can cause a stale published artefact to skip rather than merely returning `null`. The older migration plan already says the fingerprints must cover every real input before conversion ([260827aa-delete-the-importer.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827aa-delete-the-importer.md:2318)).
- `assertProduced` must remain scratch-only. If it receives the layered view, a stage that wrote nothing can pass against the published artefact. The current filesystem session correctly checks its own filesystem store ([session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/session.ts:449)).
- `htmlCarriesItsIds` can read a cross-layer pair of blocks and HTML ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:611)). The overlay needs one-generation semantics, not independent fallback per artefact.
- With A2, `articleExists`, `freeSlug`, and `urlForSlug` do not otherwise change. With A1, eager article creation changes them as described above.

## 4. All six stages or only tweets and arc?

Convert all six read sides together. They have the same production defect, and A activates their skip and baseline behaviour whether or not their generator has been converted.

Treat sketch separately in the implementation: it is already write-converted and returns `parts`; only its input read remains path-based ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1950)). It also derives its slug from `path.basename(opts.dir)`, so the new signature must pass the slug explicitly rather than accidentally retaining a path dependency ([sketch.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch.ts:452)).

## 5. Other path reads in this class

These remain:

- A forced single-step `toc` job on a cold instance reads the stage-3 blocks path through `blocksPathFor(ctx)` and fails although the store holds blocks ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1445)).
- A forced `blocks` job obtains its previous blocks from the store, then `runBlocks` opens `ctx.htmlFile` and fails ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1312), [blocks.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:1479)).
- A forced `extract` job still reads `raw.json` and the raw payload from scratch ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1193)).
- Upload slug collision/retry is only half converted: `articleExists` asks Postgres, but when it returns true, `slugIsSpokenFor` reads `raw.json` through `contextPaths` during enqueue ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1893)). On deployment that happens before `runInJob`, so `dataRoot()` throws “deployed with no job in scope.”
- `GET /api/source/:slug` authorises through the store and then reads the PDF from `fsLocations` ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:226)). `data-root.ts` explicitly identifies this as a deployed jobless caller ([data-root.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/data-root.ts:47)).

The first three are already assigned to later D stages, but they are the same live class.

## The failing test

The focused test is valid for B. It tests the `PipelineStep.run` contract: the store can see the article while `ctx.dir` cannot. I ran it; tweets and arc fail with the expected ENOENT.

It does not test A, source selection, `stepIsDone`, handback, publication, or the zero-copy guard.

Its resistance to hydration depends on where hydration is put:

- Coordinator-level hydration would not make this direct `STEPS.*.run` test green.
- Hydration inside `run` would make it green while preserving the wrong path-based generator.

Strengthen it by asserting that `blocks.json`, `tree.json`, and `meta.json` were not materialised in scratch, and that the produced source fingerprint came from distinctive store inputs. Add database-backed cases for:

- published input plus empty scratch;
- all steps skipped;
- forced step followed by claim handback to a cold instance;
- the same job returning to an older warm instance;
- corrupt scratch not falling through;
- the published revision changing between claim binding and publication.

The central correction is: `/tmp` is scoped to one job, but the read model needs a generation. Those are not the same boundary.