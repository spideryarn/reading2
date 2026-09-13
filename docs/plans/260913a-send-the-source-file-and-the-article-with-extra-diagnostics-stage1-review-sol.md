Found and fixed three in-scope issues. No unresolved code findings remain.

### Findings

- **S1-1 — P0 — FIXED:** A hung source/database loader prevented Sentry capture, losing the report itself. Added a two-second gathering ceiling beside `MIRROR_ACK_MS`; source and article outcomes time out independently to `failed`, allowing completed attachments and the reader’s report through. [feedback.ts:149](../../src/feedback.ts:149), [feedback-article.ts:147](../../src/feedback-article.ts:147), [feedback-mirror.test.ts:786](../../tests/feedback-mirror.test.ts:786)  
  **Red → green:** the never-settling-loader test timed out before the fix; it now files the report with `source_file=failed` and `article_json=attached`.

- **S1-2 — P0 — FIXED:** `article.json` copied `Article` wholesale. Production `loadArticle` includes `Meta.filename`, the reader’s exact uploaded filename, so it reached Sentry despite the privacy promise. [types.ts:1313](../../src/types.ts:1313), [pg.ts:1490](../../src/store/pg.ts:1490)  
  `Article` and `Meta` are now explicitly picked field by field, excluding `filename`; metadata still excludes `profile` and `purpose`. [feedback-article.ts:249](../../src/feedback-article.ts:249), [feedback-article.ts:273](../../src/feedback-article.ts:273)  
  **Red → green:** after making the fixture production-shaped, the privacy test exposed `UPLOADED_FILENAME_MARKER.pdf`; it now excludes filename, profile, and purpose. [feedback-mirror.test.ts:543](../../tests/feedback-mirror.test.ts:543), [feedback-mirror.test.ts:840](../../tests/feedback-mirror.test.ts:840)

- **S1-3 — P1 — FIXED:** Although `fileFeedback` calls `send` before awaiting the mirror, invoking an async function executes through its first `await`; the source read therefore started before `res.end`. [routes.ts:6230](../../src/routes.ts:6230)  
  `mirrorFeedback` now yields before client lookup or any read. [feedback.ts:246](../../src/feedback.ts:246)  
  **Red → green:** the ordering test initially received `["read", "response"]`; it now receives `["response", "read"]`. [feedback-mirror.test.ts:603](../../tests/feedback-mirror.test.ts:603)

### Security audit

- All three slug resolutions use `currentRevision`, whose SQL applies `ownedSlug`; later block, stage, and blob reads use revision IDs/content hashes obtained only from that owned row. The size check introduces no unfiltered slug query. [pg.ts:1205](../../src/store/pg.ts:1205), [pg.ts:2368](../../src/store/pg.ts:2368), [pg.ts:2574](../../src/store/pg.ts:2574)
- With no Sentry client, no consent, or no slug, the gatherer is not called and no article read starts. [feedback.ts:257](../../src/feedback.ts:257), [feedback-mirror.test.ts:489](../../tests/feedback-mirror.test.ts:489), [feedback-mirror.test.ts:686](../../tests/feedback-mirror.test.ts:686)
- Ownership wording precision: a forged/non-owned slug necessarily causes owner-filtered lookup attempts, but they return no row or bytes. “Nothing is read at all” is literally true for the three gates above, not for determining ownership.
- Source attachment is capped at 10 MiB, with exact returned bytes attached. Supabase rejects a declared oversized object and cancels its body before `arrayBuffer`; `head` distinguishes `too_large` from store failure. [raw-document.ts:146](../../src/store/raw-document.ts:146), [blobs-supabase.ts:126](../../src/store/blobs-supabase.ts:126)
- `article.json` is encoded once, measured as UTF-8 bytes, and those same bytes are attached. [feedback-article.ts:249](../../src/feedback-article.ts:249)
- Nonces are server-minted, consumed, omitted from the allowlisted tags, and missing/unknown/mismatched registrations empty the envelope. Rebuilt fields and attachments come from the registration. [feedback.ts:310](../../src/feedback.ts:310), [feedback-envelope.ts:250](../../src/feedback-envelope.ts:250)
- Added logs contain IDs, outcomes, counts, and byte lengths only—no attachment bytes or prose. [feedback.ts:385](../../src/feedback.ts:385)

### Mutation evidence

Each requested mutation was applied separately and restored:

- Removed consent check → “reads nothing when box is not ticked” failed.
- Copied `ArticleMetadata` wholesale → profile/purpose privacy test failed.
- Keyed the guard on `report_id` → concurrent same-ID owners test failed.
- Used string `.length` → UTF-8 cap test failed.

### Verification

- Focused run: **5 files, 127 tests passed**, covering all requested tests, every test importing the reviewed feedback modules, `source-download`, and `store-revision-columns`.
- Biome: clean.
- Direct TypeScript checks: clean.
- `git diff --check`: clean.
- `tests/owner-isolation.test.ts` could not enter its private Postgres lane: sandbox connection to `127.0.0.1:54362` was denied. I reproduced its static checks directly; there were no bare slug lookups, and `ownedSlug` contained both slug and ambient owner predicates. Its regex would catch the ordinary regression from `ownedSlug(slug)` to `eq(articles.slug, slug)`.
- No git-writing command was run. Only the three stage files above were changed by this review; existing/concurrent plan, `.review/`, and user-feedback changes were untouched.

Verdict: **PASS after fixes — the stage-1 consent, ownership, privacy, cap, and nonce guarantees now hold, with no unresolved in-scope findings.**