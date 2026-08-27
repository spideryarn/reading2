# Verdict: NO-SHIP

The direction survives again, but the second draft still lacks a complete acquisition/deletion state machine. The row lock fixes the original stale-candidate race; it does not yet control the non-transactional object operation.

## Findings

### 1. Critical — `deleting` has no safe completion or recovery protocol

The lock is released before Storage deletion (plan (`docs/plans/raw-bytes-in-storage.md`), lines 226–235).

Reproduction:

1. Sweeper locks `H`, marks it `deleting`, commits.
2. It crashes before removing the object.
3. An acquirer still holds the bytes and sees `deleting`.
4. Its required “re-upload” receives `already-there`, because the object still exists.
5. Nothing defined in the plan completes the abandoned deletion.

Letting the acquirer take over is unsafe: the original sweeper may resume later and delete the newly referenced object. The safe protocol is a terminal `deleting` tombstone: acquirers never revive it; a retryable deletion worker removes the object and row; acquirers retry only after the row disappears. A generation/operation token is required if takeover is allowed.

Confidence: 100%.

### 2. Critical — object creation has no corresponding row-creation protocol

The plan says fetch uploads and then “registers” the object (plan (`docs/plans/raw-bytes-in-storage.md`), lines 307–308).

Reproduction:

1. `putIfAbsent(H)` returns `stored`.
2. The process crashes before inserting `raw_sources`.
3. The object is not discoverable by the row-based sweep.
4. It remains retained and billed indefinitely.

Creating the row first merely reverses the failure: a crash leaves a `present` row pointing to no object. The current states have no `uploading`/acquisition-intent state.

Two first-time acquirers expose the same omission: `SELECT … FOR UPDATE` locks no nonexistent row, so both can upload and both attempt insertion. Conflict/retry behavior is unspecified.

This needs either:

- An `uploading` row with ownership/lease, followed by upload, verification, and transactional promotion; or
- Object-first creation plus an explicit bucket-to-table reconciler for rowless canonical objects.

Confidence: 100%.

### 3. High — the filesystem configuration cannot implement the claimed lock

The plan retains filesystem blobs for “a laptop with no container” (plan (`docs/plans/raw-bytes-in-storage.md`), lines 301–303). In that configuration there is no Postgres `raw_sources` row to lock.

Additionally, `fsBlobs.putIfAbsent` (`src/store/blobs-fs.ts`) uses `writeFile(..., {flag:"wx"})`. A process crash can leave a partial file; the next acquisition receives `EEXIST`/`already-there` and may register corrupt bytes unless it downloads and hashes them.

The plan must either forbid sweeping/content-addressed references outside Postgres, require Postgres even with filesystem blobs, or define a filesystem metadata/locking adapter. Explicit backend selection alone does not supply transactions.

Confidence: 99%.

### 4. High — the composite reference admits half-pointers and references to `deleting`

Both reference columns must be nullable for legacy articles. Under PostgreSQL’s default composite-FK semantics, this is accepted:

```sql
raw_source_sha256 = '<hash>',
raw_source_kind = NULL
```

A composite foreign key checks neither half when one is null. Use `MATCH FULL` or a `CHECK` requiring both-null-or-both-non-null.

The FK also proves only that a row exists; it does not prevent importing or backfilling a reference to a `deleting` row. Every reference writer—not merely the primary acquirer—must use the locking coordinator.

Confidence: 100%.

### 5. High — change A misclassifies a real class of PDFs

`sniffKind` (`src/fetch.ts`) accepts PDFs with leading junk because real files contain it; `looksLikePdf` (`src/source.ts`) requires `%PDF-` at byte zero. `writeRawDocument` (`src/store/export.ts`) uses the stricter function.

Reproduction:

```text
\r\n\r\n%PDF-1.4...
```

`sniffKind(null, bytes)` returns `pdf`, so stage 1 accepts it. `looksLikePdf(bytes)` returns false, so export writes those PDF bytes to `raw.html`.

The existing fetch test already pins the leading-junk case, but the round-trip fixtures contain no such PDF. Export should use the same classifier and retained acquisition evidence as stage 1.

Confidence: 100%.

### 6. High — `backfilled` makes the round trip discard known provenance

Export writes `rawContentType`, `rawEncoding`, and `rawSha256`, then stamps the manifest `backfilled` (export (`src/store/export.ts`), lines 178–203). On re-import, `provenance` (`src/store/import.ts`) converts every backfilled manifest to `null`, so those three known values become null.

That contradicts the plan’s decision to preserve the original received-byte hash.

The “absent manifest may become reconstructed manifest” decision is a genuine schema limitation, not inherently a weakened test. The weakened part is that `preserves the raw manifest` asserts only filename and `backfilled`; setting content type, encoding, hash, byte count, and URLs incorrectly would still pass.

Use a distinct provenance status for “reconstructed from authoritative database columns,” and test filesystem → DB → filesystem → fresh DB semantic preservation.

Confidence: 100%.

### 7. High — the signed redirect weakens authorization without defining the window

Today `sendSource` (`src/routes.ts`) performs `shelfStore.read(slug)` before every response and forces PDF, `nosniff`, and inline disposition.

After redirect:

1. The reader passes the ownership check and receives a signed URL.
2. Their association is removed, access is revoked, or they sign out.
3. The bearer URL remains usable until expiry.

That tradeoff may be necessary, but the plan defines no signing TTL, revocation bound, `Cache-Control: no-store`, or preservation of the PDF-only/type/header behavior. The route must authorize before signing the exact referenced `(sha256, kind)` and explicitly bound how long that decision survives.

Confidence: 99%.

### 8. Medium — the key is defensible, but its semantics need stating

The same bytes can currently receive two kinds:

```text
bytes = "\r\n\r\n%PDF-1.4..."
content-type absent     → pdf
content-type text/html  → html
```

Therefore `kind` is an interpretation, not purely a property of the bytes. `(sha256, kind)` matches the existing physical keys and safely separates a hypothetical cross-kind hash collision, but it can store identical payload bytes twice. That is acceptable only if intentional; otherwise payload identity should be SHA-only and kind should live on the reference.

The two-hash answer is honest, but the plan claims it “records” re-encoding without adding such a field. A null original hash plus a re-encoded stored source cannot express that fact. Rename `raw_sha256` to something like `received_sha256` and add `representation = original | utf8-reencoded | unknown`.

Confidence: 98%.

### 9. Medium — change B is correct, but its guard overclaims

`getTableColumns` is safe here: `drizzle-orm` is exactly pinned to `0.45.2`, and the installed helper returns the typed table-column map. `RevisionRead` prevents `metaFrom` from reading `rawBytes`; it does not prevent callers passing a full row.

The source test is easily bypassed:

```ts
const revisions = articleRevisions;
.select({ revision: revisions })
```

It also scans only two files. There is a fourth whole-row read in `exportArticle` (`src/store/export.ts`), which the test does not scan—but that read is justified because export genuinely consumes `rawBytes` and the revision artefacts. I found no fourth unnecessary whole-row read.

Treat the regex as a tactical regression check, not proof that no query can regress.

Confidence: 100%.

### 10. Medium — “we never had the bytes” remains indistinguishable from failure

The plan gives an article with null `raw_bytes` no reference. That is honest, but incomplete.

A legitimate legacy absence and a failed fresh acquisition both become the same null pair. Current `publishRevision` (`src/store/pg-revisions.ts`) validates blocks, tree, and ToC, not source availability, so the database cannot enforce “legacy source unavailable” versus “new revision lost its required raw product.”

Database restore adds a third state: a `present` row whose Storage object was deleted after the restore point. In that case no acquirer still holds the bytes.

Define the read/export/source-route behavior and an explicit availability/representation state before dropping `raw_bytes`.

Confidence: 97%.

The `npm run fetch` divergence is fixed at current `HEAD` by `37806f1`: the CLI now uses `writeRaw` and writes a manifest. The focused tests passed: 133 assertions across the revision-column, source, and fetch suites. Full typechecking could not start because the read-only sandbox blocked `tsx`’s IPC socket.