# Code review: bulk import, Stage 3 — the thin article on the server (261001m)

You are reviewing, and you may fix what you find. The plan:
`docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md` — § Greg's answers (including
the 19:55 addition: a batch takes a mix of PDFs and HTML), § The build (all; *What Opus changed* and
*What Sol's plan review changed* control), § Stages item 3. Read `docs/project/security-map.md`
and `docs/project/block-ids.md` first: this stage touches publication, routes and a model's output.

`docs/plans/261001m-bulk-import-stage3.diff` is every uncommitted change in the tree. **Stage 2's
billing files** (`src/billing/*`, `src/store/pg-billing.ts`, `pg-admin.ts`, `pg-vouchers.ts`,
`drizzle/20261001182129_*`, `tests/billing-*`) **were reviewed by you already**
(`docs/plans/261001m-bulk-import-stage2-code-review-sol.md`). Look at them only where Stage 3 calls
them. Stage 3's own files are: `src/minimal-paper.ts`, `src/not-processed.ts`,
`drizzle/20261001191021_minimal_articles.sql`, `tests/minimal-paper.test.ts`, and the Stage 3 hunks
in `src/{pipeline,step-order,types,jobs,routes,messages,paper-metadata,paper-text,library-scalars,feedback-article,reset-role,sharing-steps}.ts`,
`src/store/{pg,pg-revisions,pg-session,pg-uploads,pg-visibility,artifacts-pg,artifact-storage,artifacts,export-bundle}.ts`,
`src/web/Metadata.tsx`, the docs (`ingest-queue.md`, `library.md`, `architecture.md`) and the
tests the builder touched. Combined suites are green (644 tests over 24 files, including
`tests/minimal-paper.test.ts` and every billing file).

Hunt above all for these:
1. **Free processing.** Any route, job, retry, step re-run, Rebuild, mode, chat/live/search/referee
   path, or admin path that spends AI on a `processing = 'minimal'` article without the admitted
   *Read this* (`POST /api/jobs {slug, process: true}` → `withUpgradeSlot`). Read `enqueue`'s guard
   in `src/jobs.ts`, and grep for every caller of `loadArticle`, `currentRevision`,
   `articleExists` and `enqueue`. Check that the publication (`pg-session.ts` / `pg-revisions.ts`)
   lets a tree land on a minimal article only with a charged, target-bound Read-this reservation, or
   for the verified administrator, and supersedes the minimal row in the same transaction.
2. **Idempotency and the duplicate rule.** Is it inside `withMinimalSlot`'s `inLock`, with the
   upload claimed in that same transaction? Look at the two-hour no-job window, the `slug is null`
   refinement, archived and deleted articles, two tabs, and a retry racing a re-drop.
3. **The metadata step.**
   - PDF and HTML branches through one `extractMetadataFromText`.
   - The `<document_text>` fence.
   - The HTML path, `htmlDocumentText`: no second HTML parser, and the page's meta treated as
     untrusted.
   - No text, then no call.
   - A model failure fails the job and releases the slot.
   - It stays runnable on its own against a slug, and its cache/freshness follows
     `docs/project/architecture.md § Conventions`.
4. **The publish gate.** It allows no blocks and no tree only when the article is minimal and the
   metadata ran for this revision. Does anything that reads a published revision assume a tree and
   crash? Check `listArticles`, `describeArticle`, the shelf topics, the reader profile, export,
   admin, the public shelf/reader, `articleMetadata`, and feedback.
5. **The NOT_PROCESSED 409 contract.** Is it a plain sentence for every caller? Is any 409 turned
   into a 500 or a misleading "not shared"? Does it leak another owner's paper (it must be
   owner-only)?
6. **The migration.** Additive, sorted after `20261001182129_ingest_events_minimal`, snapshot
   consistent, safe on production rows. The `revision_step_runs_step` check gains `metadata`.
7. The builder's open decisions: `refuseMinimalUploadAtTheDoor` living in `minimal-paper.ts`, the
   duplicated lost-claim branch (`answerALostClaim` vs `queueAnUpload`),
   `STEP_BUDGET_MS.metadata = 90s`, and an optional `LibraryEntry.processing`. Say what is right.
8. The tests: the builder wrote most of the code before its tests and proved the guards by
   mutation. Check that they would catch the obvious mistakes.

No git commands that change the index or discard work; no commits. The shared local database is
behind (a peer's unlanded migration blocks `db:migrate`); the private-postgres test lane builds its
own database. Run `npm run typecheck` (or `node --import tsx scripts/typecheck.ts`) and
`npx vitest run tests/minimal-paper.test.ts tests/paper-metadata.test.ts tests/jobs.test.ts tests/job-state.test.ts tests/messages.test.ts`
plus whatever you change.

Report: numbered findings (P0/P1/P2) with file:line and what you changed for each, the test
results, anything wider left unfixed, and a one-line verdict.
