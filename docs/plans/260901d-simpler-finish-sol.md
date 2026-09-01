## Verdict

Yes. The simpler finish is:

1. Wire the two real checkpoints to Postgres.
2. Deploy with `SPIDERYARN_STORE=postgres` and the migrations.
3. Canary a normal article and a deliberately interrupted PDF.
4. Ship.
5. Move filesystem deletion and most test conversion into a cleanup appendix.

Under the newly stated production bar, deleting the filesystem store is not required for correctness. The roughly 100 test-file conversions are now principally work needed to make dead code deletable. They are not work needed to make the deployed application use Postgres.

The one genuine production gap is durable checkpoints. For PDFs, it can become a liveness failure, not merely extra cost.

## 1. Is production still reaching the filesystem store?

Statically, with `SPIDERYARN_STORE=postgres`, I found no production path that reads or writes article artefacts, jobs, uploads, AI calls, reader state, or source blobs through the filesystem adapters:

- The main store composition selects the Postgres halves in [`src/store/index.ts`](/home/greg/code/spideryarn2/src/store/index.ts:197).
- Production refuses to boot with the filesystem store in [`src/store/index.ts`](/home/greg/code/spideryarn2/src/store/index.ts:165).
- A claimed job opens `openPgStoreSession`, not `fsStoreSession`, in [`src/jobs.ts`](/home/greg/code/spideryarn2/src/jobs.ts:1203).
- `articleExists` and `urlForSlug` branch to Postgres before their filesystem code in [`src/pipeline.ts`](/home/greg/code/spideryarn2/src/pipeline.ts:1035).
- Upload records make the same selection in [`src/upload-records.ts`](/home/greg/code/spideryarn2/src/upload-records.ts:55).
- The blob fallback cannot quietly split rows and bytes in a correctly configured Postgres deployment: boot constructs `postgresBlobStore`, which requires both Supabase credentials and checks the project pair in [`src/store/blobs.ts`](/home/greg/code/spideryarn2/src/store/blobs.ts:302).

Some filesystem modules are still imported and bundled, but their adapters are not called. That is dead weight, not a production data dependency.

There are exactly two qualifications:

- Every step still computes `dir` and `htmlFile` through `contextPaths` in [`src/jobs.ts`](/home/greg/code/spideryarn2/src/jobs.ts:485). On Vercel this resolves to job-scoped `/tmp` through [`src/store/data-root.ts`](/home/greg/code/spideryarn2/src/store/data-root.ts:160). Computing the path is harmless.
- PDF extraction and hierarchy labels actually write checkpoints there: [`src/pipeline.ts`](/home/greg/code/spideryarn2/src/pipeline.ts:1481) and [`src/pipeline.ts`](/home/greg/code/spideryarn2/src/pipeline.ts:1741).

So the honest answer is: **leave the filesystem store, ship, delete it later**. Stage 4 B–H is cleanup under the new definition of done.

This is a static reachability conclusion, not a trace from a deployed Vercel function.

## 2. The test corpus is solving too many problems at once

The current helper is right for one particular integration test: “can filesystem-shaped products be driven through the real draft/write/publish machinery?” It is a poor universal fixture seeder.

[`tests/helpers/load-article.ts`](/home/greg/code/spideryarn2/tests/helpers/load-article.ts:1) creates source storage, a job, a draft, copies every artefact step by step, publishes, then deletes the job. Most route tests merely need “a published article belonging to this owner.” Making them simulate thirteen pipeline products is why a seed costs about 280 ms.

[`tests/helpers/scratch-article.ts`](/home/greg/code/spideryarn2/tests/helpers/scratch-article.ts:153) is stronger evidence of the mismatch: it clones a directory, mirrors duplicate block files, and recomputes a hierarchy stamp so that a database fixture can be expressed through old filesystem rules.

I would eventually use two fixture paths, with deliberately different purposes:

- A small number of publication/session integration tests use the real `StoreSession` and production writer. These prove drafts, fences, stamps and publication.
- Ordinary route and store tests use one centralized, typed `seedPublishedArticle` helper that directly inserts the minimum coherent database state in one transaction.

That direct helper is not a second production importer. It is test setup. The distinction matters: tests of publication must not use it; tests of comments, search, routes or ownership should not have to test publication again.

Its input should be an article aggregate or pipeline-product shape, not raw Postgres rows and not filenames. For example: owner, slug, blocks, tree, metadata, optional feature products, and the step stamps those products require. The helper owns the row mapping, generates unique identifiers, refuses an empty article, and reads the result back once through the Postgres reader. That consolidates the hand-written inserts the plan already records without coupling every test to the schema.

I would not use a SQL dump restored once per run:

- It couples fixtures directly to migrations and generated identifiers.
- Shared tests mutate and delete articles, so one global restore is not isolation.
- Fixed owners and slugs create cross-worker collisions.
- It is another “setup succeeded” path whose contents are easy not to verify.

Nor would I introduce a template database, transaction-per-test wrapper, or in-memory third store. Those are substantially more machinery than the problem merits.

The committed directory corpus can remain useful for extraction tests and evals. A test fixture being a file is fine. The mistake is requiring every database test to pass through `copyArtefacts`. Once the direct helper exists, [`src/store/copy-artefacts.ts`](/home/greg/code/spideryarn2/src/store/copy-artefacts.ts:87) can be deleted with the filesystem adapter instead of becoming permanent test infrastructure.

But none of this needs doing before shipping.

## 3. What should remain of the two-store abstraction?

Keep the boundaries that describe the pipeline. Delete the ones that merely permit adapter parity.

Keep:

- `ArtifactKind`, `ArtifactMap`, `ArtifactParts`, `StepProduct` and stamp validation.
- `ArtifactReads`, because stages should receive only the six reads they are allowed.
- `StoreSession`, because it represents a real atomic boundary: claim, draft, step commit, publication and job settlement. Its value does not depend on having two storage engines. See [`src/store/session.ts`](/home/greg/code/spideryarn2/src/store/session.ts:218).
- Domain contracts from `contracts.ts` when routes or business logic genuinely depend on them and tests supply a narrow fake.

Delete after the filesystem adapter and fixture copier are gone:

- The full mutable `ArtifactStore` interface in [`src/store/artifacts.ts`](/home/greg/code/spideryarn2/src/store/artifacts.ts:760). Its remaining production consumer is the internal Postgres writer. Make that writer private/concrete inside the PG session.
- `readsOf`, once PG constructs its read-only facade directly.
- `fsStoreSession` and its parity tests.
- Store-selection machinery: `StoreName`, `STORE`, `storeFromEnv`, `guarded`, and all filesystem halves. Preserve any still-needed “operation unavailable” refusal separately.
- `PipelineStep.outputs`, `StepContext.dir`, `StepContext.htmlFile`, `contextPaths`, `dataRoot` and job scratch scope once checkpoints no longer need paths.
- Filesystem parity suites. Do not convert them into Postgres tests of filesystem behavior.

I would not delete `contracts.ts` wholesale. “One implementation” is not itself a reason to remove a useful boundary. The test is whether an interface describes a domain capability used by consumers, or merely mirrors one adapter so that two implementations type-check. `ArtifactReads` and `StoreSession` pass that test; the full mutable `ArtifactStore` probably no longer does.

## 4. Checkpoints are the ship blocker

I revise the earlier judgment.

Losing a checkpoint cannot publish corrupt output, so it is not final-data correctness. But the PDF case is now a production liveness problem.

The application accepts up to 100 pages. The code itself records that 100 dense one-page chunks take about 585 seconds at the measured mean and can still exceed the 740-second deadline at a bad p95 in [`src/pdf-read.ts`](/home/greg/code/spideryarn2/src/pdf-read.ts:147). A retry on another instance starts from zero because the successful chunks were written to the first instance’s `/tmp` in [`src/pdf-read.ts`](/home/greg/code/spideryarn2/src/pdf-read.ts:1062). Therefore an accepted PDF can repeatedly fail without ever accumulating enough completed work to finish.

That is “does not work in production” under the new bar.

The existing checkpoint seam is the right shape:

- Stable article identity, not revision identity.
- Content-addressed keys.
- Bulk reads.
- Immediate per-result writes.
- Writes outside the revision transaction so they survive a failed attempt.

Those decisions are explicit in [`src/store/checkpoints.ts`](/home/greg/code/spideryarn2/src/store/checkpoints.ts:34) and its API is only two methods in [`src/store/checkpoints.ts`](/home/greg/code/spideryarn2/src/store/checkpoints.ts:234).

It went unused because stages were never handed the stable `articleId`. That is now readily available when `openPgStoreSession` builds its reference in [`src/store/pg-session.ts`](/home/greg/code/spideryarn2/src/store/pg-session.ts:184). The seam was not disproved; its last piece of plumbing was never built.

The smallest implementation is:

1. Construct `createPgCheckpointStore({ slug, articleId })` when opening the PG session.
2. Expose it as a read-only property of `StoreSession`.
3. Hand it to stages through `StepContext` or as the third `run` argument.
4. Replace `PdfExtractOptions.dataDir` with the checkpoint capability.
5. Replace `generateLabels({ dir })` with the same capability.
6. Bulk-read all known keys before starting work, then write each successfully validated result immediately.

For labels, row-per-batch makes the filesystem concurrency machinery unnecessary. Delete the whole-file manifest, `runId`, serialised rewrite and `clearCheckpoint` logic around [`src/labels.ts`](/home/greg/code/spideryarn2/src/labels.ts:2125) and [`src/labels.ts`](/home/greg/code/spideryarn2/src/labels.ts:2434). There should be no delete on success; retention is the sweeper’s job.

PDF is mandatory before ship. Labels is less clearly a correctness blocker for current measured articles, but it is the same plumbing and the only other caller, so I would wire both rather than leave half the path-based checkpoint design alive.

Do not put checkpoints inside the draft transaction. Their purpose is to survive that transaction failing.

## 5. What I would strike from Stage 4

| Sub-stage | Recommendation |
|---|---|
| A | Keep; it fixed the fixture helper reading the wrong root. |
| B | Stop before ship. Later replace broad production-path seeding with the central direct helper. |
| C | Stop. Do not create a third in-memory store merely to preserve old test shapes. Keep pure algorithm tests pure; use PG only where storage is the subject. |
| D | Defer. Hardwiring Postgres and relocating database error guards is good cleanup, not a production prerequisite under the current boot guard. |
| E–H | Move wholesale to an appendix. Delete later, inward-out, after tests no longer depend on the adapters. |
| I | Delete the eight per-stage directory-writing CLIs. Keep filesystem fixture loading for evals outside `src/`. |
| J | Do only the deployment configuration, migration and canary portions now. Fixture-copy and dead-store documentation cleanup can wait. |

For the CLI decision, the application already has the better “stage independently against a slug” mechanism: `POST /api/jobs { slug, steps: ["tweets"], force: ["tweets"] }`, documented beside the routes in [`src/routes.ts`](/home/greg/code/spideryarn2/src/routes.ts:5442). Eight separate CLIs should not each learn how to read Postgres, open a draft, commit a product and publish it.

If a shell command remains useful, add one generic command later that queues and advances an arbitrary named step through the real coordinator. Do not rewrite eight.

The evals are different: they need pinned, editable, committed inputs. Keep `readArticleFromDir` in eval/test support, not production `src/`. The shared working tree already contains in-flight edits moving it to [`tests/helpers/article-from-dir.ts`](/home/greg/code/spideryarn2/tests/helpers/article-from-dir.ts:1) and removing the stage CLIs; I treated those as concurrent unfinished work, but their direction is the simpler one.

Likewise, do not delete `example/` merely because production no longer reads it. Remove it from runtime fallback logic. Keep or relocate it if it remains useful as a fixture.

The resulting production-critical remainder is small: **two checkpoint callers, one session capability, deployment, and a canary**. Everything else is a worthwhile deletion project, but it is no longer the database migration’s ship gate.