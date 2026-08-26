> **Link paths rewritten.** Sol emits absolute `file://`-style links; they are code spans naming repo-relative paths here, so `tests/doc-links.test.ts` can read the file and so the references survive somebody else's checkout. Nothing else is changed.

## 1. Central claim — conditionally sound, but not yet enforced

Content addressing protects the canonical object only if all of these remain true:

- The browser can write only `staging/<server-generated UUID>`.
- The server hashes the exact buffer it downloaded.
- Canonical creation is create-only and derives its key from that server hash.
- Extraction consumes that same buffer, or later reads only through `raw_sources.object_key`.
- A claimed upload is never resumed by reading staging again.

The pure model states those rules at `src/source.ts:40`, but no adapter, repository, type boundary, or database constraint enforces them yet.

A replay can become dangerous after this sequence:

1. Staging contains A; the worker claims, reads, and hashes A.
2. Promotion removes staging.
3. The worker crashes before committing the verified source.
4. The live grant recreates staging with B.
5. A retry resumes the claimed upload and reads staging again.

That reads bytes different from those originally verified. Re-running every validation would catch B only if `claimedSha256` is mandatory; it is currently nullable at `src/db/schema.ts:1248`. The stronger rule is that a claimed upload is never resumed: expire it and require a new upload ID.

Enforce “never read staging again” structurally:

- Expose `readStaging(uploadId)` only to the claim/verification operation.
- Have it return a verified in-memory buffer plus its server hash.
- Let extraction accept that buffer or a `RawSource`, never a storage key.
- Let all later source reads resolve `raw_source_id → canonical object_key`.
- Do not expose a generic `read(key)` to pipeline code.
- Make claiming, job linkage, and state transitions conditional database operations rather than calls to the optional `canTransition` helper.

### Safe promotion order

Do not use `move`. Supabase documents that moving removes the original; its documentation also says a caller with update permission may copy as an upsert, so `copy` under broad service credentials is not a reliable create-only primitive. [Supabase’s copy/move documentation](https://supabase.com/docs/guides/storage/management/copy-move-objects)

Use:

1. Atomically claim the upload and create/link its job.
2. Download staging once; enforce the byte cap while reading; hash, checksum, magic-check and parse that buffer.
3. Create the canonical object from that buffer with `upsert:false`. Treat `409` as a possible dedup hit, not an outward error.
4. In one database transaction, insert-or-select `raw_sources`, validate all existing metadata, link the upload/revision, and mark the upload verified.
5. Leave staging present until the actual grant expiry plus margin, then sweep it.

Crash outcomes:

- Before canonical creation: staging remains; expire the claim and ask for a new upload.
- Canonical created, DB not committed: harmless orphan; a later identical upload can recover it.
- DB transaction committed: the referenced canonical object already exists.
- Before staging cleanup: expected temporary litter.
- Never write the DB reference before canonical creation; that creates a source row pointing at nothing.

### Cross-reader leakage

The canonical key is guessable by somebody who knows the exact bytes. That is acceptable only because the private bucket—not key secrecy—is the access boundary.

Do not expose:

- `object_key`, SHA, shared `raw_source_id`, or original `created_at`;
- an endpoint accepting a hash or canonical key;
- distinguishable 409/200 promotion results;
- different final responses for “new” versus “deduplicated”;
- unauthorised `HEAD`/existence responses that distinguish absent from forbidden.

There is one more serious conflict in the plan: it says an existing hash means “transfer nothing” and immediately creates a reader’s article (`docs/plans/pdf-upload-and-storage.md:558`). If that decision is based on the browser’s claimed SHA, the hash becomes a capability: creating the article reference may grant later source-read access. That contradicts “a hash is not a grant” at `docs/plans/pdf-upload-and-storage.md:585`.

The safe v1 is always upload, always server-verify, then deduplicate internally.

### Same-byte race

The unique SHA constraint is necessary but does not itself prevent a 500. A plain concurrent insert loses with a unique violation.

The repository should:

- `INSERT ... ON CONFLICT DO NOTHING RETURNING id`;
- if no row returns, issue a second `SELECT` by SHA;
- compare media, object key, size, content type and encoding before reuse;
- point both upload rows at that one source;
- normalize the canonical-object `409` internally.

## 2. Blocking problems

1. **The pre-upload dedup shortcut must be removed or explicitly rejected.** It contradicts the staging/server-hash invariant and can turn a claimed hash into authorization.

2. **Claim recovery is undefined.** `claimed` can reach only `verified` or `rejected`; `claimed → expired` is absent at `src/source.ts:199`. A crash leaves a permanent claimed row. Allow a time-fenced `claimed → expired`, then require a new upload rather than rereading staging.

3. **Uploads are not linked to jobs.** The plan puts verification inside the first job step, but `uploads` has no job/attempt identity (`src/db/schema.ts:1232`); current jobs require a slug and have no upload identity (`src/db/schema.ts:591`). Claiming and enqueueing cannot yet be made atomic or recoverable.

4. **The schema does not enforce its own row shapes.** Add:

   - SHA format, `media IN ('html','pdf')`, positive byte count, and `object_key = 'sha256/' || sha256 || '.' || media`;
   - upload status and rejection-reason checks;
   - claimed byte/hash checks;
   - state-dependent requirements for `claimed_at`, `verified_at`, `raw_source_id`, and `rejected_reason`;
   - indexes on both `raw_source_id` foreign keys and on sweepable upload status/time;
   - a published-revision check requiring exactly one authoritative representation, plus a rule forbidding legacy raw fields when `raw_source_id` is present.

   Default `NO ACTION` on source foreign keys is fine: it prevents deleting a referenced source.

5. **Promotion must be put-if-absent, not `move` or broad-permission `copy`.** The installed SDK’s `copy` method exposes no create-only option (`node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:601`).

## 3. Should-fix

- `isStagingKey` accepts `staging/------------------------------------` and any other 36-character hex/hyphen string (`src/source.ts:149`). Reuse the exact UUID matcher.

- Store `grant_expires_at`, derived from the successfully minted token. `minted_at` currently means row creation, which can precede minting (`src/db/schema.ts:1254`). Object creation time is not the replay clock; actual grant expiry is.

- One extra hour is generous operational slack, but `SWEEP_GRACE_MS > TTL` is not proof if the timestamp does not match the token’s `iat` (`src/source.ts:164`).

- `looksLikePdf` is only a cheap signature. `%PDF-not-a-document` passes (`src/source.ts:230`). It must not produce `verified` without a successful real parse. It also disagrees with URL ingestion, which accepts a valid PDF header within the first 1,030 bytes (`src/fetch.ts:650`).

- `cleanFilename` handles paths correctly, but retains Unicode bidi/format controls capable of visually spoofing a filename. Strip `\p{Cf}` or render inside `<bdi>`.

- Upload failure copy bypasses the project’s message registry. The new `[up-*]` codes are unknown to `kindOfMessage`, and `rejectionMessage` lives outside the mandated central file (`docs/project/copy.md:85`). “Nothing was uploaded” is also false if the rejection occurred after staging upload (`src/source.ts:270`).

- `MAX_UPLOAD_BYTES` is duplicated in `src/source.ts:161` and `src/uploads.ts:31`. Both test suites can remain green after those values diverge.

- `pass0` destroys the loading task only on the page-cap branch. Normal and parse-error paths call `doc.cleanup`, although the adjacent comment correctly says that does not destroy the worker (`src/pdf.ts:247`, `src/pdf.ts:313`). Destroy the loading task on every exit.

- The page cap does not bound work needed for `getDocument(...).promise` to parse the xref/catalog and obtain `numPages`. An open endpoint can still send malformed, parser-expensive 50 MB inputs.

### Accepted open-endpoint exposure

Without auth or a rate/challenge/global quota, an attacker can:

- mint unlimited grants and fill staging storage;
- grow `uploads` indefinitely;
- force repeated 50 MB storage downloads and hashing;
- consume pdf.js CPU/memory;
- enqueue unlimited valid ≤100-page PDFs and spend model money.

Per-file and page caps bound one attempt, not aggregate abuse. The cheapest meaningful mitigations are Turnstile on grant minting, an edge/IP limit, and a global daily storage/model budget circuit breaker. Queue concurrency and sweeping reduce blast radius but do not stop deliberate abuse.

For migration generation, serialize it. Let the `ideas` migration land first, then generate uploads as the next migration. A temporary clone can isolate generation without a worktree, but Drizzle’s journal/snapshot chain still needs one agreed ordering; do not generate two whole-schema migrations concurrently.

## 4. Decorative or materially incomplete tests

- “Never mistakes a canonical key for a staging key” (`tests/source.test.ts:60`) does not test malformed staging-shaped keys. It passes with the current loose regex.

- The state tests do not enumerate the complete transition matrix. They would pass if `claimed → pending` were accidentally added, and they never make a decision about `claimed → expired` (`tests/source.test.ts:69`).

- “Waits strictly longer” passes with `TTL + 1 ms` and proves nothing about whether `mintedAt` matches the real token lifetime (`tests/source.test.ts:93`).

- The magic-byte tests prove only the five-byte predicate, not that accepted bytes form a parseable PDF.

- The rejection-message tests check code shape and uniqueness but miss registration and failure kind. Every one remains green while the UI treats permanent upload refusals as unknown/retryable (`tests/source.test.ts:161`).

- The page-cap mock test’s core assertion—`getPage` was never called—is valuable. But because pdf.js is replaced completely at `tests/pdf-page-cap.test.ts:33`, it cannot prove the real library exposes `numPages` without page access or that destruction behaves identically.

## 5. What is right

- Origin and media are correctly separated.
- `stagingKey` and `canonicalKey` reject path-bearing inputs and strictly validate their generated components.
- Pending cannot transition directly to verified in the pure model.
- Content-addressed shared sources are the right storage shape.
- The SHA and object-key uniqueness constraints are useful race backstops.
- Private bucket, PDF MIME limit and 50 MiB bucket cap are correct.
- The page-cap fix is correctly placed before the page loop at `src/pdf.ts:276`.
- pdf.js 6.2.108 genuinely exposes `numPages` as proxy metadata, separately from `getPage`; a real in-memory smoke check returned three pages with zero `getPage` calls. The upstream implementation confirms this separation. [PDF.js source](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js#L3492-L3501)
- The core mock assertion would have failed against the old late-cap implementation.
- `raw_source_id` is now included in the revision carry policy at `src/store/pg-revisions.ts:188`.

Vitest could not execute in this read-only sandbox because Vite requires temporary writes. The direct typecheck is presently stopped by unrelated concurrent `Ideas` errors in the shared worktree, not by this upload code. No files were modified.

## 6. Questions for Greg

1. Should v1 always transfer and server-verify bytes before deduplication? Recommendation: yes; no claimed-hash shortcut.
2. After a claimed worker crashes, should the upload expire and require a fresh upload ID, or be resumable? Recommendation: expire it.
3. Should uploaded PDFs follow URL ingestion’s tolerant “header within 1,030 bytes” rule, or deliberately require `%PDF-` at byte zero?
4. Does “kept forever” mean never delete even an unreferenced canonical source, or only never delete while referenced?