# Verdict: NO-SHIP

Storage is probably the right eventual home for original raw bytes. This proposal does not yet define a safe reference/deletion protocol, and its proposed backfill can violate content addressing itself.

## Findings

### 1. Critical — the sweeper can delete an object immediately before its reference commits

The sentence “at a name nobody will mint again” is backwards: content addressing guarantees that the same document will mint that name again. See `docs/plans/raw-bytes-in-storage.md:109-117`.

Reproduction:

1. Failed job leaves object `H`; it ages past the grace period.
2. Sweeper selects `H` because no revision currently references it.
3. Another job calls `putIfAbsent(H)` and receives `already-there`.
4. That job commits a revision referencing `H`.
5. Sweeper acts on its stale candidate list and deletes `H`.
6. The committed revision now dangles.

The same race exists if candidate selection occurs after upload but before commit. Object age does not protect an old dedup hit, because `putIfAbsent` does not refresh `created_at`.

`publishRevision` will not catch this: its validation covers blocks, tree, and the ToC stamp only (`src/store/pg-revisions.ts:868-901`).

Two already-committed articles sharing a PDF are safe in a quiescent snapshot: the proposed `NOT EXISTS` sees the sibling and retains the object. The concurrency window—not static deduplication—is the blocker. The previous review had the necessary missing mechanism: two-phase candidate marking or a recorded candidate timestamp (`docs/plans/pdf-upload-storage-review-sol.md:83-95`).

Publication need not read 11 MiB of bytes, but it must reference a transactionally managed, verified source record whose deletion state is locked against new references.

Confidence: 100%.

### 2. Critical — the proposed backfill can put the wrong bytes under a hash

For HTML, `writeRaw` hashes the original network bytes but writes decoded, UTF-8-reencoded text to `raw.html` (`src/fetch.ts:139-160`). Import then stores that re-encoding in `raw_bytes` while copying the original-byte hash into `raw_sha256` (`src/store/import.ts:313-318`, `src/store/import.ts:529-534`).

Reproduction:

1. Fetch ISO-8859-1 HTML containing byte `E9`.
2. `raw_sha256` hashes `E9`.
3. `raw.html`, and consequently imported `raw_bytes`, contains UTF-8 `C3 A9`.
4. Backfill uploads `raw_bytes` at `sha256/<hash-of-E9>.html`.
5. The object’s contents do not hash to its key.

A later `putIfAbsent` returns `already-there` without downloading or verifying the existing object, permanently accepting the mismatch. The filesystem adapter can similarly retain a partial create after a crash (`src/store/blobs-fs.ts:77-93`).

Every backfilled row therefore needs `sha256(raw_bytes) = raw_sha256` verification. Where it fails—or the legacy hash is null—the recoverable bytes need a newly computed identity and explicit degraded provenance.

Confidence: 100%.

### 3. Critical — `raw_sha256` is not the pointer the proposal says it is

`canonicalKey` requires both SHA and media kind (`src/source.ts:150-155`). The schema stores no `raw_kind` or complete object key (`src/db/schema.ts:245-265`). `raw_content_type` cannot substitute: stage 1 deliberately recognizes PDFs served as `application/octet-stream`.

The database also loses `RawManifest` fields such as `origin`, `uploadId`, and `filename` (`src/fetch.ts:92-136`). The checked-in `source` and `source-2` fixtures demonstrate two uploaded articles sharing one hash but carrying distinct upload identities; import cannot preserve those identities.

Reproduction: import an uploaded PDF, clear `raw_bytes`, then export. There is insufficient stored information to choose `.pdf` versus `.html` robustly or reconstruct the original `raw.json`. The current exporter already always writes `raw.html` and never writes `raw.json` (`src/store/export.ts:199-202`).

There is also a PATCH-shaped ownership hazard: `Meta.rawSha256` is produced by PDF extraction while the raw manifest also owns the SHA. The future adapter must forbid `meta` from independently updating `raw_sha256`, or compare it with the raw product. No database constraint currently prevents partial or contradictory raw metadata.

The transaction needs a complete `raw_object_key`, or a `raw_sources` reference containing hash, kind, size, verification state, and provenance—not only a hash.

Confidence: 100%.

### 4. High — an orphan is not inert

Reproduction:

1. Upload a private PDF.
2. Crash or roll back before inserting its revision.
3. Delete the article/upload record.
4. The bytes remain stored, billed, and no longer associated with the reader record needed to answer an erasure request.

A private bucket limits access; it does not make retained personal material nonexistent. Global deduplication also means deletion must distinguish “remove this reader’s association” from “delete the shared object after its final reference disappears.” The proposal defines neither a retention deadline nor auditable deletion completion.

Supabase explicitly says orphaned underlying objects remain billed, while Storage objects are outside database backup/PITR coverage. [Storage schema](https://supabase.com/docs/guides/storage/schema/design), [database backups](https://supabase.com/docs/guides/platform/backups).

Confidence: 99%.

### 5. High — the filesystem fallback creates a split-brain installation

`SPIDERYARN_STORE` selects articles independently (`src/store/live.ts:45-61`), while credentials select blobs (`src/store/blobs.ts:108-128`).

Reproduction:

1. Set `SPIDERYARN_STORE=postgres` and a remote `DATABASE_URL`.
2. Omit `SUPABASE_SERVICE_ROLE_KEY`.
3. Fetch commits a Postgres reference but stores its object under local `data/_blobs/`.
4. Another process, laptop, or Vercel invocation reads the same Postgres row and cannot find the object.

The inverse configuration—filesystem articles with Supabase credentials—also splits the raw manifest from the bytes unless every filesystem reader is rewritten. Credential presence additionally does not prove the Storage project matches `DATABASE_URL`.

The blob backend needs explicit configuration and a startup invariant tying it to the selected article store. The fallback is coherent for isolated filesystem tests, not as an implicit companion to Postgres.

Confidence: 100%.

### 6. High — landing B piece 2 changes shape; it does not disappear

The runner still needs a store-neutral raw product. Its payload becomes a verified source reference rather than inline bytes, but it must carry:

- Complete object key or hash plus kind.
- Provenance.
- Byte count/content metadata.
- Evidence that `putIfAbsent` completed successfully.

Hidden work includes:

- Backfilling and integrity-checking existing revisions, including null or mismatched hashes.
- Rewriting import and export.
- Making `db:export` a permanent data-portability path dependent on Storage credentials and object availability.
- Adding raw files/manifests to `tests/store-roundtrip.test.ts`; they are currently omitted at lines 41-57, so total raw loss can pass.
- Rewriting the filesystem-only source route.
- Updating fixtures and fetch/extract tests.
- Provisioning/changing the remote bucket; `supabase/config.toml` is explicitly local-only at lines 157-161.

Concrete reproduction: set `revision.rawBytes` to null and run the current exporter. No raw source is emitted, while the round-trip artefact list still passes because it never compares raw files.

Confidence: 100%.

### 7. Medium — the performance evidence does not establish what the table claims

The spike uses one fixed canonical key and never deletes it. On the second run, “Storage put” measures an `already-there` rejection, not an 11 MiB upload. The script logs `stored` versus `already-there`, but the reported table omits that result.

It is also one local-container sample with no distribution, cold/warm separation, or remote measurement. It supports “`bytea` copying has a cost,” not “this design is less work.”

The corpus percentage is arithmetically wrong: 18.2 MiB out of 25 MiB is about 73%, not 86%.

Confidence: 100%.

### 8. Medium — the decision slogan does not classify all twelve artefacts

`extractedHtml` is the counterexample. It is revision-scoped but, in the product model, immutable: stage 3 produces the distinct `stampedHtml` artefact. The fact that the filesystem overwrites the same path does not make `extractedHtml` rewritable (`src/store/artifacts.ts:53-79`, `src/store/artifacts-fs.ts:112-119`).

The correct boundary is finer:

- Original raw payload bytes: immutable/shareable, suitable for Storage.
- Raw provenance and verified reference: transactional Postgres state.
- Revision products, including immutable `extractedHtml`: Postgres because they participate in revision consistency and recovery.

The proposed placement may still be right, but its stated rule is not exhaustive.

Confidence: 100%.

### 9. Medium — the main Supabase facts are right, with one documented error

Correct:

- A Storage upload does not join the application’s Postgres transaction.
- `storage.objects` contains queryable metadata, not file bytes, and Supabase says to treat it as read-only.
- Database backup and PITR exclude actual Storage objects.
- Consequently a restored database can reference a Storage reality from another time.

Wrong:

- `pg_net` is not “POST-shaped” or POST-only. It supports asynchronous `http_get` and `http_delete`; Supabase also offers a synchronous `http` extension. [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [http extension](https://supabase.com/docs/guides/database/extensions/http).

That correction does not rescue the design: neither extension provides a sensible transactional path for arbitrary 11–32 MiB binary payloads.

Confidence: 99%.

The minimum ship condition is a verified `raw_sources`-style row or equivalent deletion protocol, an integrity-checked migration, a complete source reference, explicit backend selection, and raw-inclusive export/round-trip tests.