# Verdict: NO-SHIP

Two findings can create or accept dangling source references. The excluded `pg-uploads.ts` edit does not affect this verdict.

## Findings

1. **High — concurrent repair can delete a correct object after another caller returned success.**  
   `storeRawSource` reads corruption, then later unconditionally removes the key (`src/store/blobs.ts:271-284`). Reproduction:

   1. A and B both read the corrupt object.
   2. A removes it, stores the correct bytes, and returns `repaired`.
   3. B—acting on its stale read—removes A’s correct object.
   4. B’s second upload fails or B crashes.
   5. A’s caller may already have committed a reference, but the object is absent.

   The second `already-there` is also trusted without verification. A fake conforming store reproduced `outcome: "repaired"` while leaving `"poison"` at the key. Repair needs serialization or a version-conditioned delete/replace; otherwise mismatch should fail closed. **Confidence: 99%.**

2. **High — uploads bypass the new verification guarantee.**  
   `acquireUpload` still calls `putIfAbsent` directly and accepts `already-there` “by construction” (`src/pipeline.ts:734-742`). It neither calls `storeRawSource` nor writes `storedSha256` into its manifest.

   Reproduction: pre-place wrong bytes at the uploaded PDF’s canonical hash, then acquire that upload. Promotion returns `already-there`, the upload becomes `verified`, and the corrupt canonical object remains. This is precisely the condition `storeRawSource` was introduced to prevent. Use the helper here after fixing finding 1. **Confidence: 100%.**

3. **High — Postgres mode does not actually refuse a missing blob-store configuration.**  
   `projectMismatch` receives no service key, while `blobStore()` requires both URL and key (`src/store/blobs.ts:185-195`). `src/store/index.ts:131` performs no separate key check despite its comment claiming one exists.

   Reproduction: select Postgres, provide matching database/API URLs, and unset `SUPABASE_SERVICE_ROLE_KEY`. Boot passes and `blobStore().head(...)` reads the filesystem adapter. The health endpoint warning is not a boot refusal. Blank or whitespace-only values also need consistent handling. **Confidence: 100%.**

4. **High — `projectMismatch` rejects valid Supabase configurations and accepts an invalid local pair.**  
   It extracts the database project only from `username.split(".")[1]`. Valid direct and dedicated-pooler URLs use plain `postgres` and carry the ref in `db.<ref>.supabase.co`, so both are refused as project `"unknown"`. This also affects direct URLs using the IPv4 add-on. [Supabase documents all of these formats](https://supabase.com/docs/guides/database/connecting-to-postgres).

   Conversely, `postgres://…@127.0.0.1:54322`—the old app—and `http://127.0.0.1:54361`—Spideryarn—return `null` because “both local” compares only hostnames. That is a real split brain using this repo’s documented port layout. Extract hosted refs from either username or hostname, and give local stacks an explicit identity or validated port pairing. **Confidence: 100%.**

5. **High — the publication guarantee is not built and is absent from the remaining-work list.**  
   The plan says a revision with a successful inherited `fetch` run must have a source reference. `publishRevision` validates blocks, tree and `toc`, but never queries a done `fetch` run or checks `rawSourceSha256`/`rawSourceKind` (`src/store/pg-revisions.ts:888-921`).

   Reproduction: create an otherwise publishable draft with a `fetch` step run having `status='done'` and both source columns null; `publishRevision` accepts it. The `CARRY` choice is correct only once this gate exists; today it is the vacuous pass previously warned about. Land the gate with import/backfill. **Confidence: 100%.**

6. **Medium — “never delete raw-source rows” is policy, not enforcement.**  
   The default `NO ACTION` FK is correct: it prevents deletion of referenced rows. But unreferenced rows remain deletable, and the documented default privileges grant `spideryarn_app` `DELETE` on new tables.

   Reproduction: insert an unreferenced `raw_sources` row, then delete it; nothing refuses. Revoke `DELETE` for this table or add an explicit guard and a schema test. Also consider `CHECK (bytes > 0 AND bytes <= 52428800)`; `integer` itself is the right type for the 50 MiB ceiling. **Confidence: 98%.**

7. **Medium — the security documentation now states two false MIME guarantees.**  
   `docs/project/security.md:667-669` still calls the bucket PDF-only and says Storage enforces the allowlist at upload. The bucket now permits HTML, and the measured service-role path did not enforce it.

   The browser-path belief is supported by current upstream code: the [signed-upload route](https://github.com/supabase/storage/blob/master/src/http/routes/object/uploadSignedObject.ts) calls `uploadFromRequest`, which [loads `allowed_mime_types`](https://github.com/supabase/storage/blob/master/src/storage/object.ts) and passes them to validation. But your service-role measurement contradicts current upstream behavior too, so the exact deployed Storage version still needs testing. Moreover, this validates the claimed `Content-Type`, not PDF bytes. Update `security.md` to treat `%PDF-` plus the checksum as the content control. **Confidence: 95%.**

## Other attacked points

- `maxBytes: bytes.byteLength` is the safe behavior. A larger object should fail without an unbounded download; do not auto-repair it until repair is concurrency-safe.
- The filesystem temp-then-`link` path is sound for process-kill atomicity: target and temp share a directory, cleanup is correct, and `stored` is returned only after the canonical link exists. It is not power-loss durable without `fsync`, but I would not block this landing on that.
- Letting `writeRaw` propagate Storage failure is correct. `raw.json`—the step’s completion marker—is written last, so retry does not mistake a partial local write for a completed fetch.
- Having `npm run fetch` perform the same durable write is architecturally consistent, though its output should disclose that it may permanently write to remote Storage.

## Required ordering

1. Fix repair concurrency, upload-path verification, and boot/project pairing.
2. Make `db:import` perform the verified object write plus `raw_sources` row and revision reference, then backfill existing revisions.
3. Add the publication rule in the same rollout.
4. Rewrite `db:export`, verifying downloaded length and hash and retaining a temporary `raw_bytes` fallback until backfill is proven.
5. Change `sendSource` last.

That last step is larger than stated: no store contract currently returns an owned current-revision source reference, and no capability currently signs downloads. `ShelfStore.read` only proves ownership, while `RawSourceStore` can only proxy bytes. Add a store-owned source lookup and a separate signed-download capability; do not make `sendSource` reach directly into Postgres or Supabase.

Validation: all 23 schema tests passed; all 8 existing project-pair tests passed but omit the failing URL forms above. The revision-column suite was blocked solely by the excluded `guardDbStore` edit. No files were changed.