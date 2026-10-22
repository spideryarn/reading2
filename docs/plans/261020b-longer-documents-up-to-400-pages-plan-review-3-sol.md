# Plan review 3: narrow check of the round-2 fixes (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol (gpt-5.6-sol, effort high, `--sandbox review`), 2026-10-20, on plan commit `595b3f3fe`, verbatim.

Verdict: **approve with changes**. R2-F1–F3 are closed. R2-F4 remains open because the new raw-manifest page count has no specified durable home in Postgres.

### R3-F1 — P2 — Stage 2 loses the raw manifest’s `pages` before it can assert it

The plan says stage 1 writes `pages` into the raw manifest and stage 2 checks it ([plan:185](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md:185>)), but the only schema additions named are on `ingest_events` ([plan:198](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md:198>)).

`raw.json` is not stored as JSON in Postgres:

- `RawManifest` currently has no page field ([fetch.ts:131](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/fetch.ts:131>)).
- The artifact reader reconstructs it from revision columns ([artifacts-pg.ts:374](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/artifacts-pg.ts:374>)).
- The raw writer’s owned columns omit `pages` ([artifacts-pg.ts:980](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/artifacts-pg.ts:980>), [artifacts-pg.ts:1195](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/artifacts-pg.ts:1195>)).
- The existing revision `pages` column belongs to stage-2 metadata ([artifacts-pg.ts:874](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/artifacts-pg.ts:874>), [artifacts-pg.ts:952](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/artifacts-pg.ts:952>)).

Defeating path:

1. A new PDF is counted and correctly repriced in stage 1.
2. Fetch commits its raw manifest through the Postgres artifact adapter.
3. The page count is not among the persisted raw columns.
4. Stage 2 reads a reconstructed manifest without `pages`.
5. The proposed legacy exemption applies, so the assertion is skipped on every such PDF.

This does not reopen the quota bypass—rule 4 can still count the stored old bytes—but it makes the R2-F4 belt ineffective. The plan should explicitly give the raw count durable storage, preferably a distinct `article_revisions.raw_pages` column carried with the other raw-source fields, and name the corresponding `readRaw`, raw-write, and carry-policy changes.

### Per-finding verdicts

1. **R2-F1 — closed.**

   I found no remaining reader-reachable no-reservation path that can transcribe a heavier newly fetched PDF for free.

   - A shelf refresh sends `force: ["fetch"]` ([ShelfEntry.tsx:688](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/ShelfEntry.tsx:688>), [ShelfEntry.tsx:744](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/ShelfEntry.tsx:744>)); forcing fetch cascades through extraction ([jobs.ts:1101](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/jobs.ts:1101>)). Rule 4 now refuses an increased slot band before paid work.
   - `enqueueReset` actually forces `extract`, not `fetch` ([jobs.ts:3823](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/jobs.ts:3823>)). It therefore reuses the stored source rather than introducing a heavier one.
   - A new job draft copies the published revision, including all raw-source columns ([pg-revisions.ts:1233](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-revisions.ts:1233>), [pg-revisions.ts:246](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-revisions.ts:246>)). Thus the source being replaced is readable from the job’s draft even when the reset minted that draft.
   - Fetch performs the count/refusal before `writeRaw` replaces the manifest ([pipeline.ts:2902](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/pipeline.ts:2902>), [pipeline.ts:2910](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/pipeline.ts:2910>), [pipeline.ts:2921](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/pipeline.ts:2921>)).
   - Missing prior source and missing charged rows fall back to one slot, which fails safe for a heavier PDF.

2. **R2-F2 — closed.**

   The transition is precise enough to build: pre-migration minimal papers remain one-slot *Read this* upgrades, pre-migration full articles incur one slot for High-powered AI, and legacy refreshes may replace only up to their stored source’s existing band ([plan:175](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md:175>)).

   It does not grant a general null-pages exemption: a previous web source counts one, a missing source falls back to charged rows and then one, while a legacy PDF is measured from its stored bytes.

3. **R2-F3 — closed.**

   The revised plan passes the requested weighted cost, includes the *Read this* credit, orders candidates by points freed, and stops only when the same admission predicate that refused the request would admit it ([plan:252](</var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md:252>)). The named multi-article/five-slot test covers the original failure.

4. **R2-F4 — still open, P2, solely as R3-F1 above.**

   The no-reservation exemption itself is safe: force-extract/reset jobs reuse an already held raw source, and forced-fetch jobs pass rule 4. The problem is that the assertion’s required `manifest.pages` fact is not durably specified, so the ordinary new-PDF path bypasses the assertion via its “legacy manifest” arm.

No files were changed.