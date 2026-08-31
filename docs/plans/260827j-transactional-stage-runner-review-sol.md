# Verdict: NO-SHIP

The desired boundary—stage execution outside a transaction, followed by one fenced commit—is correct. The proposed contracts and landing order cannot implement it safely.

## Findings

### 1. Critical — the “one transaction” cannot be expressed by the current seams

The plan requires artefacts, `revision_step_runs`, and the job transition in one transaction, then says release remains outside it (`docs/plans/260827j-transactional-stage-runner.md:142`).

But:

- `ArtifactStore.write()` accepts neither a transaction nor job attempt (`src/store/artifacts.ts:244`).
- `pgJobStore.releaseStep()` obtains its own `getDb()` and performs the job transition separately (`src/store/pg-jobs.ts:217`).
- `publishRevision()` opens another transaction (`src/store/pg-revisions.ts:690`).
- The production connection is a transaction pooler, so separate calls cannot share implicit session state (`src/db/client.ts:10`).

Reproduction: A writes artefacts and commits. Before the external `releaseStep`, `failExpired` invalidates A. `releaseStep` throws, but A’s artefacts remain. Reversing the order gives the opposite corruption: the job reports success and the artefact transaction can then fail.

The job release/finish is the fenced commit. It cannot remain outside.

Confidence: 100%.

### 2. Critical — every `/advance` would replace the job’s draft

The runner sequence says “begin the revision” for each `runStep` (`docs/plans/260827j-transactional-stage-runner.md:145`), while `advanceJob` deliberately runs one step per request (`src/jobs.ts:841`).

`beginRevision()` always:

- Mints a new UUID.
- Copies only `articles.current_revision_id`.
- Overwrites `jobs.draft_revision_id`.

See `src/store/pg-revisions.ts:513` and `src/store/pg-revisions.ts:584`. There is no reopen operation in `RevisionLifecycle` (`src/store/revisions.ts:109`), and `toJob()` does not expose the draft pointer (`src/store/pg-jobs.ts:67`).

Reproduction:

1. Request 1 creates R1 and writes `fetch`.
2. Request 2 creates R2 from the still-empty published state and points the job at R2.
3. `extract` reads R2 and cannot find the raw document.

The runner needs an atomic `openOrBeginJobDraft(jobId, attemptId)` that reuses the existing job-owned draft.

Confidence: 100%.

### 3. Critical — `raw` still has no bytes

The plan notices that `ArtifactMap.raw` is wrongly typed, but proposes correcting it to the manifest object. That still cannot populate `article_revisions.raw_bytes`.

Evidence:

- `ArtifactMap.raw` is currently `string` (`src/store/artifacts.ts:88`).
- `RawManifest` contains a filename and byte count, not the bytes (`src/fetch.ts:92`).
- The payload is written separately from the manifest (`src/fetch.ts:138`).
- Postgres requires the actual bytea value (`src/db/schema.ts:256`).

Reproduction: `fetch` returns `{parts: {raw: manifest}}`; the PG adapter can fill URLs, encoding and SHA, but has nothing for `raw_bytes`. `extract` then cannot read either HTML or PDF. Reading `manifest.file` would reintroduce the filesystem dependency the plan removes.

Define a store-neutral raw product containing both provenance and payload bytes/decoded text.

Confidence: 100%.

### 4. High — landing C cannot compile or preserve the CLIs

C removes `dir` and `htmlFile` from `StepContext`, but the remaining `outputs(ctx)` consumer is left as an open design question (`docs/plans/260827j-transactional-stage-runner.md:236`).

`articleMetadata()` still constructs those fields and calls every step’s `outputs()` (`src/api.ts:624`, `src/api.ts:646`). C therefore does not typecheck as specified.

C also moves `writeFile` out of functions directly called by the CLIs. For example, `generateArc()` writes `arc.json`, and `main()` assumes that side effect and prints `run.outFile` (`src/arc.ts:345`, `src/arc.ts:363`). The same pattern exists in toc, tweets, glossary, summaries and ideas.

Reproduction: after converting `generateArc()` to return an artefact without writing, run `npm run arc -- data/example`; it reports completion but creates no `arc.json`. D repairs this later, so C cannot stand alone.

Confidence: 100%.

### 5. High — the plan misses durable working state

Not every stage write is an artefact:

- ToC writes `labels-progress.json` batch-by-batch and reuses it after failure (`src/toc.ts:710`, `src/labels.ts:1271`).
- PDF extraction caches each validated model chunk so Retry pays only for failed chunks (`src/pdf-read.ts:703`, `src/pdf-read.ts:796`, `src/pdf-read.ts:829`).

Neither belongs in the atomic published artefact set, but both require a storage abstraction once `dir` disappears.

Reproduction: fail label batch eight or one PDF chunk, then retry on another Vercel invocation. Without a durable working-state store, every successful paid batch/chunk is lost and purchased again.

Returning `StepProduct` correctly eliminates published partial output; it must not accidentally eliminate private resumable checkpoints.

Confidence: 100%.

### 6. Major — cross-instance progress disappears in landing A

Current progress mutates the in-memory `JobStep` only (`src/jobs.ts:462`). `JobStore` has no progress transition, and PG `claim()` leaves the persisted step list unchanged (`src/store/pg-jobs.ts:165`).

Reproduction: instance A runs a two-minute ToC step; polling lands on instance B. B reads a `running` job whose step still says `pending`, with none of the streamed detail.

This is not inherently a cost of returning products—the `report` callback can remain—but A needs a deliberately throttled durable progress operation or an explicit decision to remove live progress.

Confidence: 98%.

### 7. Major — the blocks mapping is underspecified

The adapter must reproduce all of the existing import discipline:

- Upsert `block_identities` first and never delete them (`src/store/import.ts:563`).
- Delete revision rows even when the replacement array is empty.
- Supply the revision’s `article_id` for both composite FKs (`src/db/schema.ts:489`).
- Write ordinal from the array index (`src/store/import.ts:578`).
- Omit generated `fts` (`src/db/schema.ts:471`).

Because `blocks` and `toc` collapse onto the same rows, rows alone cannot prove which step produced them. `has(slug, step, ["blocks"])` must also require the matching step-run state/attempt; otherwise `toc` can see carried or stage-3 rows.

Reproduction: insert a newly minted block before its identity and get `revision_blocks_identity_fk`; or inspect rows alone after copying a draft and incorrectly declare `toc` complete.

Confidence: 100%.

### 8. High — upload settlement needs two adapter-specific protocols

Moving successful settlement into the PG commit is right, but the present upload API cannot do it: `pgUploadStore.settle()` and `reject()` obtain their own database handle and have no attempt token (`src/store/pg-uploads.ts:153`, `src/store/pg-uploads.ts:182`).

More seriously, leaving rejection inside the stage contradicts the earlier plan’s own requirement that both terminal transitions be fenced (`docs/plans/260827h-durable-queue-and-uploads.md:387`).

Reproduction: A’s lease expires while it is still completing validation; the job is failed, but stale A calls `rejectUpload`. The upload becomes terminal even though A no longer owns the job.

For Postgres:

- Success: artefacts + verified upload + step-run + release/finish in one transaction.
- Validation failure: rejected upload + step error + failed revision + job failure in one fenced transaction.

For filesystem storage, retain the existing weaker recoverable order: write artefacts → settle → finish marker. It cannot promise PG atomicity and should not pretend parity here.

Confidence: 99%.

## Ordering and landings

| Landing | Can stand? | Assessment |
|---|---:|---|
| A | Partly | Durable job and live attempt claims are real, but progress regresses and its external `releaseStep` API must be replaced for C. |
| B | No | The current artefact seam lacks revision identity, job attempt, transaction scope, and raw payload bytes. |
| C | No | Fresh ingest loses its draft after the first request; raw payload is absent; metadata code does not compile; CLIs stop writing. |
| D | Only after C | It repairs a regression C creates. CLI compatibility must travel with each stage conversion or C+D must be one landing. |

The ordering premise is factual: `fenceJob()` really updates `jobs` under `id + attempt_id + running` (`src/store/pg-revisions.ts:394`). The conclusion does not follow. `pgJobStore` already exists; adapter and runner tests can create and claim real rows without first switching production `src/jobs.ts`. Wiring A first merely commits the wrong release boundary and then rewrites it in C.

## Return value and transaction boundary

Returning a product is preferable, but the best reason is not “a stage might forget one artefact”—a transaction-scoped collector could track required kinds and refuse commit too. The decisive reason is keeping the model/fetch work outside the database transaction.

The intended timing should be:

1. Short claim transaction.
2. Short open-or-create-draft transaction.
3. Run the stage with no database transaction or row lock held.
4. One success or failure commit transaction.

No model call should hold a row lock. The longest commit will be either the blocks identity/delete/bulk-insert path or a 32 MiB raw/HTML write; final publication additionally holds the article `FOR UPDATE` lock while it loads, hashes and validates all blocks (`src/store/pg-revisions.ts:328`). That is bounded database/CPU work, not remote model latency.

Returning costs:

- All parts remain live together until commit and may be duplicated during JSON/driver serialization.
- The current ceilings permit 32 MiB HTML, blocks, tree, labels and raw payloads.
- The contract rules out streaming into the final table without a separate spool/blob mechanism.
- Durable partial work needs the separate checkpoint store above.
- Live progress remains possible, but needs deliberate persistence.

## Build order instead

1. Define the transaction coordinator first: `openOrBeginJobDraft`, atomic success commit, atomic failure commit, and adapter-specific upload intent.
2. Correct the product types, especially raw provenance plus payload; add an explicit working-state/checkpoint store.
3. Implement the PG artefact/block writer inside that coordinator, including attempt fencing and publication.
4. Convert stages one at a time, retaining filesystem-writing CLI wrappers in the same commit.
5. Wire `src/jobs.ts` to `JobStore` and the transactional runner together; test two connections and at least two `/advance` invocations on one fresh job.
6. Move every CLI onto the shared runner before enabling Postgres pipeline writes or the Vercel upload path.

**NO-SHIP.**