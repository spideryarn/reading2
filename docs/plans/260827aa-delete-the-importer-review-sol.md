# Verdict: NO-SHIP

The destination is sound, and the central premise is mostly true: there is no live production path that publishes new pipeline output to Postgres without `db:import`. But the proposed sequence has several blockers, including one missing schema decision and an irreversible deployment step that is not actually atomic.

## Findings

### 1. Critical — the Postgres shape cannot store the raw provenance B2 promises

**Confidence: high**

`RawManifest` carries per-revision provenance: `origin`, `uploadId`, `filename`, the server-declared content type, detected encoding, and the network-byte hash (`src/fetch.ts:93-149`).

The built schema has nowhere for three of those fields:

- `article_revisions` adds only `raw_source_sha256` and `raw_source_kind` (`src/db/schema.ts:267-294`).
- `raw_sources` contains shared object facts only: stored-byte hash, kind, byte count, stored content type and verification time (`src/db/schema.ts:1006-1050`).
- `origin`, `upload_id`, and `filename` have no column. The current exporter already admits that (`src/store/export.ts:191-197`).

Worse, the demolition leaves open dropping `raw_content_type`, `raw_encoding`, and `raw_sha256` (`docs/plans/260827aa-delete-the-importer.md:153-160`). `raw_sources` does not replace their meanings:

- `raw_sha256`: network bytes.
- `raw_sources.sha256`: stored, possibly UTF-8-normalised bytes.
- `raw_content_type`: origin server’s claim.
- `raw_sources.content_type`: the object’s stored MIME type.
- `raw_encoding`: the original decoding decision; no equivalent exists.

**Reproduction:** ingest an uploaded PDF through D, delete the filesystem artefacts, then try to reconstruct its source manifest from Postgres. The database cannot say that it was uploaded, what its filename was, or which upload produced it. If the old three columns are also dropped, a non-UTF-8 URL fetch loses its original encoding, response hash and claimed type too.

C cannot be implemented as specified until the plan either adds per-revision provenance columns or explicitly retracts that contract. `raw_sha256` should not be bundled into the `raw_bytes` drop merely because both names contain “raw”; keeping two clearly typed hashes is not the trap. Using the wrong one as the object key is.

### 2. High — “no legacy rows” is false, and the new gate freezes existing articles

**Confidence: high**

The plan says existing rows remain (`docs/plans/260827aa-delete-the-importer.md:63-72`) and also simplifies the gate on the premise that there are “no legacy rows” (`docs/plans/260827aa-delete-the-importer.md:45-54`). Those statements conflict.

Every current imported revision with raw bytes has:

- a `fetch` step row with `status = 'done'` (`src/store/import.ts:800-837`);
- no `raw_source_sha256`, because the importer does not write the new reference.

`beginDraftIn` copies the step rows (`src/store/pg-revisions.ts:593-611`) and carries the null source pair (`src/store/pg-revisions.ts:165-188`). Therefore, after the gate is enabled, any later job that does not run `fetch`—glossary, ideas, summary, ToC, or metadata-only work—ends at publication with `fetch = done` and a null reference and is refused.

**Reproduction:** take any currently imported article containing `raw.html`; begin a draft, write only `glossary`, then publish. The proposed gate rejects it even though the accepted loss was only the old source document.

Existing rows continue to read, but they do not “keep working” operationally. Every future draft-based job on them requires a successful fetch/re-ingest first. That may be an acceptable consequence, but Greg did not explicitly accept freezing all later work, and the plan currently says the opposite.

### 3. High — D breaks `/api/source`, and no listed landing repairs it

**Confidence: high**

`sendSource` authorises through the selected store, then unconditionally reads `data/<slug>/raw.json` and the file beside it (`src/routes.ts:203-236`). Landing D removes those filesystem writes for the Postgres pipeline.

The demolition list rewrites `db:export` but never mentions `sendSource` (`docs/plans/260827aa-delete-the-importer.md:151-161`).

**Reproduction:** ingest an uploaded PDF through the planned Postgres runner, confirm its `raw_sources` row and reference, then request `GET /api/source/:slug`. `shelfStore.read` succeeds against Postgres; `readRaw(data/<slug>)` finds nothing; the route returns 404 despite the verified object existing.

The source route must move to the reference-backed signed-URL path no later than D. During the mixed window it can use the reference when present and retain the filesystem fallback for old articles.

Also, dropping `raw_bytes` is not what breaks today’s route: the route has never read that column. The loss occurs when filesystem output disappears or when the route is rewritten without a legacy fallback.

### 4. High — ArtifactStore parity does not replace either reader-wire parity or export coverage

**Confidence: high**

`tests/store-parity.test.ts` explicitly compares `fsArticleReader` and `pgArticleReader` after all mapping, optional-property handling and serialisation (`tests/store-parity.test.ts:1-30`, `155-223`). An `ArtifactStore` suite exercises the layer below that.

**Concrete mutation:** remove `byline` from `metaFrom`, reverse `blocksFor`, or return an explicit `undefined` property from `pgArticleReader`. ArtifactStore `write`/`read` parity stays green; the current reader parity test fails.

A second property is also being folded into the wrong replacement: `ArtifactStore` explicitly excludes comments, chat, searches, lookups and shelf state (`src/store/artifacts.ts:62-65`), while `tests/store-roundtrip.test.ts` verifies that `db:export` preserves them (`tests/store-roundtrip.test.ts:51-66`, `233-379`). If export survives, that coverage still needs to survive.

The smallest honest replacements are:

- An adapter suite for `ArtifactStore`.
- A separate reader-contract suite that populates both stores through their production coordinator/adapters, publishes, then compares `fsArticleReader` and `pgArticleReader`, including library order and optional artefacts.
- An export test that creates a Postgres article through the production path, writes reader state through the live Postgres stores, exports it, and verifies the files.

Running the pipeline once through a test-only dual-writing store would not exercise production reads between stages. Reusing deterministic `StepProduct`s for both production adapters is reasonable; one separate full Postgres-runner integration test should cover the store-dependent stage chain.

### 5. High — the failed-fetch state is accepted by the proposed gate

**Confidence: high**

The proposed implication—`fetch done ⇒ source reference`—correctly handles successful URL fetches and uploads. It is not a complete truth table.

A revision whose `fetch` row is `running` or `error` must not publish. The current `publishRevision` already demonstrates the hazard: even the ToC guard checks the row and hash without checking `toc.status` (`src/store/pg-revisions.ts:902-918`).

**Reproduction:** begin a re-extraction from a valid published article, leaving its carried blocks/tree/reference intact; overwrite its `fetch` row with `status = 'error'`; call `publishRevision`. The proposed raw-source condition passes because the reference is non-null and there is no done fetch row. The structural checks also pass against the carried article, so a failed refresh becomes a newly published success.

The gate needs this truth table:

- No fetch row: no source requirement.
- Fetch `done`: source reference required.
- Fetch `running` or `error`: publication refused.

For a draft that only ever had `meta`, the source rule should add no refusal reason, but the existing no-blocks/no-tree checks will still refuse publication. The test should assert that distinction rather than expect the whole publication to succeed.

### 6. High — one Git commit is not an atomic demolition, and the column drop is not reversibly deployable

**Confidence: high**

The importer/gate conflict does not require one commit. Delete the importer first, after D and replacement tests are green; then there is no importer left for the gate to reject.

More importantly, a Git commit cannot atomically combine an application deploy with a database migration. Dropping `raw_bytes` destroys data and creates a rollback hazard.

**Reproduction:** deploy the demolition migration, then roll the application back to its parent. The parent’s carry policy includes `rawBytes` (`src/store/pg-revisions.ts:165-172`), and `beginDraftIn` renders that schema column into its `INSERT … SELECT` (`src/store/pg-revisions.ts:546-561`). Ingestion fails with “column raw_bytes does not exist.” Re-adding the column does not recover its contents.

A safe split exists:

1. Delete the importer after D.
2. Enable the gate separately.
3. Deploy a compatibility release that stops writing, copying, exporting or otherwise referencing `raw_bytes`, while the column still exists.
4. Rewrite source/export paths and validate them.
5. Drop the column in a later migration, after the immediately preceding application release is known to work with the column absent.

Only the column drop is materially irreversible. The importer deletion, gate and exporter code can all be reverted from Git.

### 7. High — the B–D window can create a hybrid revision that passes every constraint

**Confidence: high**

For an article originally created by the importer, a later D run can publish a reference-backed revision. If `db:import` is then run again and the block text is unchanged, it selects the current revision and updates it in place (`src/store/import.ts:453-468`, `509-561`).

`revisionValues` rewrites `raw_bytes`, `raw_content_type`, `raw_encoding`, `raw_sha256` and URLs, but omits `rawSourceSha256` and `rawSourceKind`. The existing reference therefore survives while its surrounding provenance is replaced from filesystem files.

The both-or-neither CHECK and FK remain green because the pair itself is still valid (`src/db/schema.ts:419-443`). They cannot detect that it now points at bytes from another acquisition.

In the same window:

- New D-written rows have `raw_bytes = null`, so current `db:export` silently omits their raw document (`src/store/export.ts:147-160`).
- `sendSource` fails as described above.
- `REVISION_COLUMNS` is safe during the window: it excludes `rawBytes` and automatically includes the new reference. At the drop, its destructuring and `tests/store-revision-columns.test.ts` must change.
- Postgres metadata still reports fetch storage as `article_revisions.raw_bytes` (`src/store/pg.ts:335-345`).

Once D can publish, leaving `db:import` available is actively unsafe, not merely redundant. It should be removed immediately after the replacement coverage passes.

### 8. Medium — the block-identity regression needs its own production-path test

**Confidence: high**

The existing chat test does more than check an anchor’s three columns. Its anchor names a block absent from the current revision, and import succeeds only because it inserts the permanent identity first (`tests/chat-anchor.test.ts:274-356`).

Ordinary adapter parity over a current `blocks` value does not prove identities are never deleted after a later revision drops the block.

The smallest replacement is:

1. Write and publish revision 1 through the Postgres artifact adapter with block `B`.
2. Begin revision 2, replace its blocks with a set not containing `B`, and publish.
3. Assert `block_identities` still contains `B`.
4. Create an anchored chat naming `B` through `pgChatStore` and read it back.

That directly tests the long-term production contract. No import or export is needed.

### 9. Medium — Open 3 is cheaper than stated, and its Postgres half already exists

**Confidence: high**

The filesystem implementation in `src/api.ts` will indeed stop typechecking when `outputs`, `dir` and `htmlFile` disappear (`src/api.ts:608-658`). But the design question is already answered one layer above it: `ArticleReader.articleMetadata` is store-specific (`src/store/contracts.ts:75-88`), and the Postgres implementation already derives completion and timestamps from revision rows (`src/store/pg.ts:592-701`).

The cheap answer is:

- Use `produces` for logical output names.
- Use the artifact adapter for presence/currentness.
- Keep filesystem byte size and mtime as an FS-specific inspection result.
- Continue returning `bytes: null` for Postgres, as today.

Using only `produces` and `read` loses exact filenames and actual stored byte weights; serialising returned objects would be expensive and would measure a different thing from file size or Postgres storage. That loss is already accepted on the Postgres side (`src/store/pg.ts:672-675`).

The stale `STEP_STORAGE.fetch = ["article_revisions.raw_bytes"]` also needs changing; otherwise the metadata page advertises a dropped column.

### 10. Medium — rewritten `db:export` can bypass the blob-project safety check

**Confidence: high**

`scripts/db-export.ts` imports `src/store/export.ts` directly, not `src/store/index.ts` (`scripts/db-export.ts:13-18`). The missing-credentials and project-pair refusal lives only in `src/store/index.ts:112-152`.

Meanwhile `blobStore()` silently falls back to filesystem blobs when either Supabase credential is absent (`src/store/blobs.ts:234-244`).

**Reproduction:** point `DATABASE_URL` at remote Postgres, unset `SUPABASE_SERVICE_ROLE_KEY`, and run the rewritten `db:export`. Unless the rewrite adds its own fail-closed setup, it reads `data/_blobs` rather than the bucket referenced by the rows. Depending on implementation it either omits every source or errors as if the objects were missing.

If export survives, it must require both Storage credentials and run `projectMismatch` itself, or use a shared explicit “Postgres plus matching blob store” constructor.

### 11. Medium — B3 remains a real prerequisite, not merely an open note

**Confidence: high**

The plan has thought about the checkpoint store, but has not decided it. D removes `dir`, while label progress and PDF chunks deliberately survive failed attempts (`docs/plans/260827j-transactional-stage-runner.md:72-80`, `424-426`).

D cannot start until the checkpoint interface, durable backing store, ownership/cleanup rules and cross-instance retry test exist. A small Postgres table keyed by revision/job, step and checkpoint key remains the obvious boring answer. It must stay outside the artifact/job commit because failed work is exactly what it preserves.

## Verified claims

- There is no current live route that successfully publishes pipeline content into Postgres without `db:import`. `src/jobs.ts` hardwires `fsArtifacts` at line 49 and runs every stage through it at lines 272-346.
- `revisionLifecycle` has no production caller: searching `src/` finds only its export in `src/store/revisions.ts:276`.
- The raw-source CHECK/FK correctly admit both old rows with both reference columns null and new rows with a complete reference.
- URL fetches and uploads can share the same successful-fetch rule because upload acquisition is the `fetch` step too.
- The plan says “four import-only test files,” but only three exist: `store-import-prune`, `store-import-revision`, and `store-import-convergence`. The other three importer users are precisely the suites that need replacement, not deletion.