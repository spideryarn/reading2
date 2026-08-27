Not safe to build exactly as stated. The lifecycle columns can go, but three non-lifecycle guarantees must remain.

1. **Critical — mismatched Supabase projects creates the requested dangling reference without deletion. Confidence: 100%.**

   Sequence:

   1. `DATABASE_URL` points to project A.
   2. `SUPABASE_URL` and its service key point to project B.
   3. `putIfAbsent` succeeds in B.
   4. The transaction commits `raw_sources` and the revision reference in A.
   5. Any correctly configured A instance finds no object.

   `src/store/blobs.ts:108-117` and `src/db/client.ts` select these independently. The third draft notices this at `docs/plans/raw-bytes-in-storage.md:320-339`, but the reduced protocol must retain a startup check that proves project identity—not merely “Postgres plus Supabase Storage are configured.” For hosted Supabase, compare the project ref in `SUPABASE_URL` with the ref encoded in the database username.

2. **High — `already-there` is not verification. Confidence: 99%.**

   A prior bad writer, failed backfill, or partial filesystem creation can leave wrong bytes at the canonical name without deleting anything. `putIfAbsent` then returns `already-there`, after which the proposed transaction certifies those bytes via `verified_at` without reading them.

   `src/store/blobs-fs.ts:77-93` has the concrete partial-write case; `wx` reserves the visible filename before the write completes.

   Keep no lifecycle, but require:

   - `stored`: the successful create plus the locally computed hash is sufficient.
   - `already-there`: download and hash before committing the reference.
   - Postgres plus filesystem blobs remains forbidden unless filesystem publication becomes atomic via temporary file plus link/rename.

   This is verification, not a state machine.

3. **High — 60 seconds is not an honest signed-URL window for the current inline-PDF contract. Confidence: 98%.**

   The redirect is one hop, but the PDF session is not necessarily one request. A browser may make later Range requests or resume after suspension; those requests retain the final signed URL and do not revisit `/api/source/:slug` for a fresh one.

   Supabase exposes TTL plus optional download/transform behavior, not single-use or application-level audience narrowing. Its documentation also says signed URLs remain valid until expiry and cannot ordinarily be revoked. [Supabase signed downloads](https://supabase.com/docs/guides/storage/serving/downloads)

   Worse, with Smart CDN enabled, token expiry and object `cacheControl` are independent: a cached signed response can remain usable after the token expires. The documented default cache TTL is typically one hour. [Supabase Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

   Therefore:

   - Set and test the object cache policy; otherwise “60 seconds” may actually mean about an hour.
   - Set `Cache-Control: no-store` on the redirect response.
   - Test the largest PDF under throttling, delayed Range requests, tab suspension and resume.
   - Either choose a TTL covering a realistic viewing session, or change from inline viewing to a single download. Sixty seconds cannot promise both short revocation and durable inline viewing.

   Proxying small documents is defensible only if preserving per-request authorization is worth size-dependent behavior. It does not solve large-document authorization.

4. **Medium — the publication rule works for lineage, not for “this revision fetched.” Confidence: 99%.**

   `beginDraftIn` copies both carried source fields and every step-run row (`src/store/pg-revisions.ts:530-595`). Thus a later revision legitimately inherits a reference and a `fetch` run it did not perform. That is not a bug; it means the rule should be described as:

   > A revision with successful fetch evidence in its lineage must carry the source reference.

   Check `status = 'done'`, not merely row existence; `revision_step_runs` also admits `running` and `error`.

   Legacy classification otherwise works: the importer creates a `fetch` row only when raw bytes exist (`src/store/import.ts:800-837`). For a forced fetch failure, safety additionally depends on the runner atomically recording the error and marking the revision failed.

   The manual-loss case remains distinguishable without a column:

   - null reference and no successful fetch evidence: never held;
   - non-null reference whose `head/get` is missing: lost.

   Publication cannot guarantee current bucket existence transactionally; the source route and export must explicitly report the latter case.

5. **Medium — remove only the canonical-object lifecycle. Confidence: 100%.**

   The upload acquisition state machine remains necessary. `acquireUpload` still verifies mutable staging bytes once, hashes them, promotes them and settles the upload (`src/pipeline.ts:692-782`). Removing `raw_sources.state` must not remove that separate `uploads` protocol.

   If “never delete” also covers staging, record the consequence plainly: every successful upload remains twice—under `staging/<id>` and its canonical hash—and abandoned or rejected uploads remain indefinitely.

**Bottom line:** remove `state`, `claimed_by`, `claimed_at`, `retire_after`, and the canonical sweeper. Build the reduced design only after project-pair validation and `already-there` verification are part of the protocol, and revise the 60-second signed-URL claim. With those changes, no `raw_sources` acquisition state machine is needed.