# GPT Sol's review of the built upload path

**2026-08-27**, gpt-5.6-sol, high effort, read-only, via `CODEX_API_KEY`. The prompt is
[pdf-upload-code-review-2-prompt.md](pdf-upload-code-review-2-prompt.md); what was done about each
finding is [pdf-upload-and-storage.md § The third review](pdf-upload-and-storage.md#the-third-review-of-this-code-and-the-ten-things-it-found).
Absolute paths in the original have been rewritten repo-relative.

---

## Findings

### Critical — the three-request flow cannot rely on filesystem upload records in production

- **What is wrong:** `POST /api/uploads` writes the record into the function’s local filesystem. A later `POST /api/jobs` must read the same file. Vercel provides neither a durable nor shared writable filesystem, so the normal flow can fail before queueing.
- **File and line:** `src/upload-records.ts:48`, `src/upload-records.ts:108`, `src/routes.ts:2063`.
- **Why it follows:** minting and queueing are separate HTTP requests. Even if a function invocation could write the file, the queue request may execute elsewhere and return `404 No such upload`. The project’s deployment document already says filesystem-backed adding is broken on the serverless host at `deployment.md:348`.
- **Confidence:** Certain.

The state machine can remain storage-agnostic, and `raw_sources` need not necessarily land now. But the upload attempt itself needs shared durable storage now if this feature is meant to work on Vercel. The already-broken filesystem queue is not evidence that another filesystem record is sufficient.

### High — uploads have no owner, and authentication identity is discarded

- **What is wrong:** the route verifies a user but throws away their identity. Upload records contain no owner, and upload lookup/claiming uses only the UUID.
- **File and line:** `src/routes.ts:2462`, `src/upload-records.ts:60`, `src/routes.ts:2063`, `src/routes.ts:2701`.
- **Reproduction:** sign in as two users. User B can query user A’s upload record if they know its ID. A pending ID obtained through a shared `/add/upload/<id>` address can be claimed by B. All jobs are also returned globally, including queued upload IDs and filenames.
- **Confidence:** Certain.

The test called “refuses an upload id that is not one of ours” merely rejects malformed UUIDs and deliberately accepts any well-formed UUID: `tests/uploads-api.test.ts:91`. It tests syntax, not ownership.

A stranger still cannot supply an object path or download the private object from its ID alone. The object-path invariant itself holds.

### High — slug allocation and job insertion are not atomic

- **What is wrong:** two different uploads named `paper.pdf` can both allocate `paper`.
- **File and line:** `src/jobs.ts:935`, `src/jobs.ts:954`, `src/jobs.ts:1218`.
- **Reproduction:** queue two newly claimed uploads concurrently. Both can check `activeFor("paper")`, await `articleExists`, and return `paper` before either inserts its job. The later `activeFor` check only deduplicates identical work; it does not reallocate a different upload.
- **Impact:** under the single-process queue, the second job can find the first upload’s artefacts, skip its steps, and report success while its own upload remains merely claimed. Across runners, both can write the same article.
- **Confidence:** High.

The same-name test injects an already-occupied set, so it cannot expose this race: `tests/uploads-api.test.ts:196`.

### Medium — the upload endpoint accepts job controls that can burn the claim

- **What is wrong:** the stated API is `{uploadId}`, but the upload branch also accepts `steps`, `force`, and `guidance`. Claiming happens before `enqueue` validates the step list.
- **File and line:** `src/routes.ts:1893`, `src/routes.ts:2066`, `src/jobs.ts:927`.
- **Reproduction:** send `{"uploadId":"…","steps":[]}`. The create-only claim succeeds, then `enqueue` returns 400 because the job has no steps. The attempt is now stuck claimed with no job. `steps:["arc"]` similarly bypasses acquisition and leaves a poisoned attempt.
- **Confidence:** Certain.

### Medium — reload and double-click recovery does not work until acquisition finishes

- **What is wrong:** on a duplicate claim, recovery looks up a job through `record.slug`, but no slug is stored when the job is enqueued.
- **File and line:** `src/routes.ts:2063`, `src/routes.ts:2071`, `src/pipeline.ts:771`.
- **Reproduction:** reload `/add/upload/<id>` while its job is queued behind another job or while the fetch step is starting. The second request receives 409 rather than the existing job. If acquisition never begins, every reload does so forever.
- **Why:** `noteSlug` exists but is never called. The slug is first recorded only after the bytes have been verified.
- **Confidence:** Certain.

This directly contradicts the new claim at `pdf-upload-and-storage.md:1006`.

### Medium — “Re-fetch and rebuild” is offered for uploads and necessarily fails

- **What is wrong:** every shelf entry gets a refresh button, but the request for an uploaded article contains only its slug. The new job therefore has neither a URL nor upload metadata.
- **File and line:** `src/web/ShelfEntry.tsx:348`, `src/web/ShelfEntry.tsx:387`, `src/pipeline.ts:637`.
- **Reproduction:** ingest an uploaded PDF, then press “Re-fetch and rebuild”. The fetch step fails with “No source URL”.
- **Confidence:** Certain.

### Low — the browser misclassifies Storage’s duplicate response

- **What is wrong:** the server adapter reads Storage’s real status from the JSON body, but the XHR client uses only the outer HTTP status.
- **File and line:** `src/web/upload.ts:96`, `src/web/upload.ts:124`, compared with `src/store/blobs-supabase.ts:51`.
- **Reproduction:** PUT through the same live grant twice. Storage returns outer 400 with inner `"409"`. The client displays `[st-grant]`—permission expired—instead of `[st-dup]`.
- **Confidence:** High, based on the measured Storage behaviour documented in the code and prompt.

### Low — grant expiry is stored correctly but consumed using the wrong clock

- **What is wrong:** `claimUpload` checks `mintedAt + GRANT_TTL_MS`, ignoring `grantExpiresAt`.
- **File and line:** `src/upload-records.ts:191`, `src/upload-records.ts:194`.
- **Reproduction:** mint using an issuer that returns a 60-second expiry, then claim after 61 seconds. `asOf` reports expired, but `claimUpload` still accepts it.
- **Confidence:** Certain.

The issuer-expiry test only proves that the value was recorded; its claim test advances by the fixed TTL and therefore stays green: `tests/upload-records.test.ts:80`, `tests/upload-records.test.ts:108`.

### Low — the client router accepts thirty-six hyphens as an upload ID

- **What is wrong:** `[0-9a-f-]{36}` checks length and alphabet, not UUID structure.
- **File and line:** `src/web/router.ts:186`.
- **Reproduction:** `parseRoute("/add/upload/------------------------------------")` produces an upload route. The server eventually rejects it, so this is not a path-security hole, but the client renders a real ingest page for an invalid address.
- **Confidence:** Certain.

There are no upload-route cases in `tests/router.test.ts`.

### Low — an already-aborted signal can still start the PUT

- **What is wrong:** the XHR code listens for a future `abort` event but never checks `signal.aborted`.
- **File and line:** `src/web/upload.ts:110`.
- **Reproduction:** abort after the grant request settles but before `put()` registers its listener. Abort events are not replayed; `xhr.send(file)` still runs.
- **Confidence:** High about the code path, low about its timing frequency.

## Deliberate departures

- **Shared `fetch` step:** Fine. It is genuinely bracketed by `beginStep`, `assertProduced`, `finishStep`, cancellation, and the common `raw.json` postcondition. Preserving the persisted step name is sensible.
- **No filesystem grant issuer:** Fine. The split interfaces are clean, and returning 503 without Supabase is honest.
- **Leaving staging objects:** Fine for v1 under the measured grant-replay behaviour.
- **No client-supplied object path:** Confirmed. Minting derives `staging/<server-generated UUID>`; acquisition derives the same key again. Neither job request nor upload request accepts a key.
- **XHR 4xx and file mutation:** `onload` correctly rejects non-2xx. Hashing one read and uploading another is safe because acquisition hashes the arrived bytes and rejects a mismatch. `crypto.subtle` failure also occurs before a grant is minted.
- **`source.ts` and `uploads.ts`:** Their key validation, PDF checks, and cap are consumed correctly. The exceptions are the unused claimed byte count and the expiry misuse above.

The acquisition tests call `STEPS.fetch.run` directly at `tests/upload-acquire.test.ts:90`, so they do not prove upload acquisition is actually inside the runner’s transactional markers. The generic runner code does satisfy that contract, but the named upload test would remain green if the wiring later bypassed it. The Supabase adapter, XHR path, and router upload path have no automated coverage.

I attempted the targeted Vitest files, but the read-only environment prevented Vitest from creating `node_modules/.vite-temp` (`EPERM`), so this review does not claim a passing test run. The advertised `scratchpad/upload-code.txt` was also absent; I reviewed the live files and current diffs.

**Verdict: NO-SHIP for a deployed end-to-end upload feature. The local single-user path can work, but the filesystem handoff, missing ownership, and non-atomic slug allocation are blocking correctness and isolation defects.**