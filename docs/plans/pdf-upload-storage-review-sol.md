## 1. The bytes question

The appendix has the right destination but an incomplete design. Canonical raw bytes should live in Supabase Storage for every new document, including HTML. The revision should hold a foreign key to a verified source record, not an ad hoc object key and not `bytea`.

I would add a `raw_sources` table containing the owner, immutable object key, server-computed SHA-256, byte length, document kind, original content type and encoding. `article_revisions.raw_source_id` points to it. Separate short-lived `uploads` rows own the pre-verification state.

That is better than putting the key directly on each revision because the same source can be reused across retries and revisions without copying either bytes or metadata. It also gives deletion and integrity checks one place to work from.

### Transactionality

“Write the object first, then the row” is necessary but not sufficient.

It handles one sequence:

1. Object write succeeds.
2. Revision transaction commits with the key.
3. The revision has its source.

It does not handle:

- **Object succeeds, row fails.** The object is orphaned.
- **Object succeeds, job is cancelled.** Immediate deletion races both the unwinding worker and a still-valid two-hour upload token; no deletion leaves litter.
- **Row commits, object is later removed.** For a published upload, this is data loss, not merely “the step is not done.” Unlike a URL, it may be impossible to reacquire.
- **A transient Storage failure.** `HEAD` returning 503 must not be converted into “absent” and cause a re-run. The filesystem artefact adapter deliberately distinguishes absence from operational failure for this reason (`src/store/artifacts-fs.ts:254-275`).
- **A re-run.** A new random key leaks one object per attempt; a stable article key either conflicts under `upsert:false` or permits a destructive overwrite under `upsert:true`.
- **Two finalisations of one upload.** Without a conditional state transition or unique work key, both can enqueue and spend money.
- **Two jobs for one article.** Current deduplication is slug-based and compares steps, guidance and profile, but has no upload identity (`src/jobs.ts:587-600`, `src/jobs.ts:680-718`). Slug allocation is also check-then-use (`src/jobs.ts:772-805`).
- **Verification followed by a second read.** Hashing one version and extracting another is possible unless the object is immutable or the exact downloaded bytes are passed directly to extraction.

The correct protocol is:

1. Insert an owner-scoped upload row before minting the grant.
2. Mint a unique path with `upsert:false`.
3. Conditionally claim that upload exactly once when finalising.
4. In the worker’s first visible pipeline step, download once with a byte cap and abort signal; compute the actual hash and magic bytes over those exact bytes.
5. Store a verified `raw_sources` record and bind it to the job/draft.
6. Publish only when that source record is verified and still owned by the fenced job.
7. Sweep expired uploads and unreferenced objects after a grace period.

A missing object must prevent draft publication. A published revision whose object later disappears should raise an integrity alarm and make export/source download fail loudly.

### HTML in Storage versus the hybrid

The strongest case for the hybrid is real:

- HTML is usually small.
- `bytea` preserves atomic row-and-bytes writes.
- Normal HTML reading avoids a second service.
- A database dump contains most sources.

But it is still the worse eventual design:

- HTML can reach the 32 MiB fetch ceiling, so “HTML is kilobytes” is not an invariant.
- PDFs already force backups and recovery to span two systems; the hybrid does not preserve a one-system operation.
- Every extraction path, importer, exporter, source route and freshness check gains two representations.
- New drafts currently carry `rawBytes`, with explicit WAL, cleanup and storage costs (`src/store/pg-revisions.ts:817-822`).
- The rare PDF path is precisely the path most likely to rot.

Object storage for all sources also forces an important correction: fetched HTML’s canonical object should contain the original undecoded response bytes. Today `writeRaw` hashes the original bytes but writes a UTF-8 decoded string to `raw.html` (`src/fetch.ts:116-140`). Extraction will therefore need to decode the object using the recorded encoding, or keep decoded HTML as a separate derived artefact.

### What moving the bytes breaks

The appendix understates this substantially.

- **`has` and freshness.** Today the fetch artefact is only `raw.json`; `has` parses that manifest without checking the named raw file (`src/store/artifacts-fs.ts:93-109`, `src/store/artifacts-fs.ts:400-419`). A database row containing an object key cannot mean “present” until the object is readable and its verified identity matches. The acquisition step also needs an expected stamp containing the upload/source identity; otherwise an old source can satisfy a new upload. `sameStamp` already correctly refuses empty expectations (`src/store/artifacts.ts:144-165`).

- **The raw type is already lying.** `ArtifactMap.raw` is declared as `string`, while the filesystem decoder returns the parsed manifest object through a cast (`src/store/artifacts.ts:86-98`, `src/store/artifacts-fs.ts:231-245`, `src/store/artifacts-fs.ts:416-419`). That must become a validated `RawManifest`/source reference before extending it.

- **Manifest failure is swallowed.** `readRaw` turns every read or parse error into “legacy article, assume HTML” (`src/fetch.ts:144-157`). With object keys in the manifest, malformed JSON, EACCES and absence cannot all mean the same thing.

- **Export/import.** The exporter reads `rawBytes` and always writes `raw.html`, even for PDFs, and writes no `raw.json` (`src/store/export.ts:122-142`, `src/store/export.ts:177-180`). Import chooses `raw.pdf` only when a manifest says so (`src/store/import.ts:305-316`). Both must use the source store, preserve kind and exact bytes, and fail if a referenced object is missing.

- **The round-trip test excludes all raw artefacts.** Its list starts at `meta.json`; `raw.html`, `raw.pdf` and `raw.json` are absent (`tests/store-roundtrip.test.ts:41-56`). It can therefore pass while every source byte is lost.

- **The artefact-manifest test is documentary, not operational.** Its values are not inspected, so changing the text to “Storage” proves neither a schema reference nor an object exists (`tests/store-artefact-manifest.test.ts:47-64`, `tests/store-artefact-manifest.test.ts:136-146`).

- **Revision policy and metadata.** `rawBytes` is explicitly carried into drafts and the metadata page says fetch lives in that column (`src/store/pg-revisions.ts:165-172`, `src/store/pg.ts:227-236`). Both exhaustive maps will need deliberate source-reference entries.

- **Source serving.** `sendSource` is hardwired to `fsLocations`, `readRaw` and `readFile`; it is not reusable unchanged for object-backed sources (`src/routes.ts:135-149`).

- **Rollback and backup.** A Postgres export ceases to be a database-only rollback. Credentials, object availability, coordinated backup and an integrity inventory become part of the recovery contract.

### Orphans and deletion

Archiving must retain the object. Archive is deliberately only `articles.archived_at`, not deletion (`src/db/schema.ts:172-173`).

For permanent deletion:

- Delete the database reference transactionally.
- Do not synchronously delete the object.
- Periodically mark and sweep source objects with no live revision/upload reference and older than a grace period.
- Use two sweeps or a recorded candidate timestamp so a concurrent object-first/row-second creation cannot be collected.
- Keep shared content-addressed objects while any revision references them.

The same sweep handles failed row writes, cancelled jobs, abandoned browser uploads and hard-deleted articles. That is cheaper and more complete than adding compensating deletion to every failure path.

### A third option

The missing third option is a content-addressed source layer:

- Staging/upload identity: owner plus `uploadId`.
- Canonical identity: owner plus actual SHA-256.
- One `raw_sources` row per canonical object.
- Revisions reference the source row.

That deduplicates re-runs, makes conditional writes naturally idempotent, gives checksums structural meaning, and prevents revision retention from multiplying blobs. Two uploads of the same bytes may still create two articles if product semantics require it; they merely share the source object.

**Single recommendation:** store every new canonical raw document, HTML and PDF, as an immutable, owner-scoped, content-addressed Storage object; represent it through a verified `raw_sources` row referenced by revisions; retain `raw_bytes` only during migration and then drop it. The strongest argument against this is operational: a database transaction, dump and restore no longer contain the whole source, so an object-store outage or incomplete backup can make an irreplaceable upload unavailable even while every database row is healthy.

## 2. Blocking problems

### Verification is simultaneously before and after enqueue

The plan says `POST /api/jobs` verifies before enqueue (`docs/plans/pdf-upload-and-storage.md:215-234`), then says byte-dependent checks happen in the worker (`docs/plans/pdf-upload-and-storage.md:236-237`).

Why: those are different security and API contracts. In the latter, an unverified object has entered the queue and may block the single worker.

Instead: name the state honestly. The request may check ownership, upload status and cheap metadata, then enqueue a job whose first step is `verify-source`. No article, slug or successful ingest exists until that step passes.

### The upload has no pipeline step that produces `raw`

The plan removes `fetch` but leaves “write raw.json + raw.pdf” floating outside the step list. That bypasses `beginStep`, `finishStep`, cancellation, retry, `assertProduced` and freshness—the machinery specifically built to expose interrupted work (`src/jobs.ts:420-440`, `src/pipeline.ts:441-453`).

Instead: introduce a common acquisition step, or two explicit source-producing steps with the same `raw` output contract. Verification and materialisation belong inside it.

### The source model is not designed

There are two independent axes:

- Origin: URL or upload.
- Media kind: HTML or PDF.

`Meta.source` already means `"pdf"` (`src/types.ts:640-662`), while the plan proposes another `source.kind` meaning upload. `RawManifest` also requires two URLs and a fetch timestamp (`src/fetch.ts:92-113`), and extraction still calls `requireUrl` even for PDFs (`src/pipeline.ts:634-665`).

Instead: define discriminated `SourceOrigin` and `RawDocument` types first. Do not overload `source`.

### Retry, cancellation, deduplication and slug allocation lose upload identity

`EnqueueRequest` and `Job` contain only `slug` and optional `url` (`src/jobs.ts:511-560`, `src/types.ts:1027-1034`). Retry copies only the URL (`src/jobs.ts:896-910`). `sameWork` cannot distinguish two uploads, and an upload job has no URL for `onShelfOrInFlight` to return.

The proposed title-derived slug is also deeper than “open up `freeSlug`”: `runPdfExtract` needs a slug and output paths before pass 0 has produced the title (`src/pipeline.ts:661-668`).

Instead: persist source/upload identity on the job, include it in the immutable work key, make finalisation idempotent, reserve the slug transactionally, and split PDF preflight/title selection from extraction before claiming this is scoped.

### The signed token is not one-time

The installed Storage client describes signed upload URLs as valid for two hours and supports `upsert` at mint time (`node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:344-400`). The plan measured path binding, but not replay or an `x-upsert:true` attempt.

Why: “one-time” and “path-bound” are different properties. A stolen token can win the initial upload; if the object is removed while the token remains valid, it may be replayed. Any accidental upsert-enabled grant permits replacement and reopens the TOCTOU race.

Instead: mint only `upsert:false`; test a second PUT and a hostile upsert header; retain immutable accepted objects; add an application expiry shorter than two hours; rate-limit and authenticate grant creation. The token is a bearer credential, even though it is not an API key.

The current security document explicitly says the API is neither authenticated nor rate-limited (`docs/project/security.md:601-603`). Exposing token minting and model jobs before the beta gate would be an open storage quota and open wallet.

### PDF resource limits run too late

The page cap is checked only after `pass0` returns (`src/pdf-read.ts:588-603`). `pass0` has already opened the PDF and iterated every page and every text item (`src/pdf.ts:222-265`). A small, valid PDF with thousands of pages defeats the stated cap before it fires.

There is also no parser timeout, memory limit or object/decompression limit; the security document already records that only the page cap exists (`docs/project/security.md:781-784`).

Instead: check `doc.numPages` immediately after opening and before page iteration, execute parsing in an isolatable worker/process with deadline and memory bounds, and test pathological page/object/text counts. The provider chunk-size guard does not protect pass 0.

### The blob interface combines incompatible capabilities

`signUpload` does not belong beside ordinary server-side blob operations. The filesystem implementation cannot implement it, and a health check cannot repair an interface that lies (`docs/plans/pdf-upload-and-storage.md:173-200`).

The interface also cannot perform the plan’s own ranged read, has no streaming or abort signal, no conditional `put`, and conflates missing with every other `head` failure.

Instead, split:

- `RawSourceStore`: bounded read/stream, metadata, immutable put-if-absent, remove.
- `UploadGrantIssuer`: create direct-upload grant.
- Upload repository/state machine: claim, verify, expire, associate job.

Use local Supabase for direct-upload development as the plan already proposes. Do not route large local uploads through the server. Blob selection should not be coupled to `SPIDERYARN_STORE`, which currently selects article reads (`src/store/live.ts:24-61`).

### The build order starts implementation before settling the invariant

Routes cannot be safely built before the upload state, source types and acquisition-step contract. Step 4 is not merely `requireUrl` and `freeSlug`; it includes `RawManifest`, `FetchedDocument`, `Job`, `EnqueueRequest`, retry, `sameWork`, slug reservation, step stamps, source serving, publication, import/export and tests.

The storage/source model and state machine should precede the bucket adapter and routes.

## 3. Should-fix

- The inventory is stale: `@supabase/supabase-js` is already a direct dependency (`package.json:51-59`). Adding `storage-js` separately needs a measured reason.

- “The browser needs no credentials” should say “no long-lived API key.” The signed token is a credential.

- `GET /api/uploads/:id` cannot be optional if `/add/upload/:id` is promised to survive reload. It also needs token-expired, uploaded, verifying, rejected, queued and consumed states.

- The server-selected key should contain only validated UUID/hash components. Never include the filename. Bound filename length and control characters before storing or displaying it.

- Client SHA-256 proves “the bytes received match the bytes the client claimed,” not safety or ownership. Store the worker-computed value as authoritative.

- A claimed `bytes` value is only early UX. The grant does not bind that exact size, so quota/rate controls still matter.

- The 11.5 MB browser test is necessary but insufficient. Add: double finalisation, concurrent finalisation, cancellation during download, retry after verification, server restart, object missing, Storage 5xx, same-length substitution, second PUT, hostile upsert, expired upload, >100-page tiny PDF, huge text layer, HTML raw-byte round-trip, archive retention and shared-object deletion.

- Integration tests must say loudly when local Supabase is absent. This repository already recognises that a skipped database suite can look like a green run (`tests/store-roundtrip.test.ts:149-179`).

- Plain PUT above the provider’s recommended TUS threshold is a reasonable v1 UX trade, but record upload failure telemetry before deciding it is adequate.

## 4. Where the plan is right

- Direct browser-to-Storage upload is the correct response to Vercel’s body limit.
- Keeping `MAX_BODY_BYTES` small is correct (`src/routes.ts:111-170`).
- The server must mint the key, the bucket must be private, and grants must be path-bound and non-upserting.
- Size, magic bytes and a full checksum are all necessary; MIME alone is not validation.
- Upload acquisition should not refetch a URL, and downstream extraction should converge on one raw-document contract.
- The original document should remain available to the reader.
- Remote bucket creation needs an explicit deployment check.
- The 11.5 MB production-shaped browser test is the right positive control.
- One authority per revision is exactly the right invariant.

This was a read-only review; I changed nothing.

## 5. Questions the plan should be asking Greg and isn't

1. If the same PDF is uploaded twice, is that one article, two articles sharing bytes, or always two independent articles?
2. Is the final slug derived from filename, PDF metadata, extracted title, or reader choice—and when does it become immutable?
3. Must authentication land before the upload-token endpoint is deployed?
4. What upload and model-spend quotas apply per reader and per day?
5. Are raw sources retained forever, for all historical revisions, or only for the current revision?
6. What does permanent deletion mean, separately from archive, and what grace period applies?
7. What recovery promise is required: database-only restore, coordinated database-plus-bucket restore, and what acceptable data-loss window?
8. Should uploaded filenames be retained and shown, or treated only as transient client metadata?
9. May two revisions or two articles share one raw source object?
10. What should the reader see during verification: “uploaded,” “checking,” or already “queued”?
11. Is a 100-page cap enough, or are there explicit parse-time, memory and decompressed-content limits?
12. Should source viewing redirect to a short-lived Storage URL, and must it be owner-authenticated before issuance?