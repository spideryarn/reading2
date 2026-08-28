PROCEED-WITH-CHANGES. Your instincts on 1, 2, 3, and 4 are broadly right, but the loader has several correctness gaps before C7 can rely on it.

## Publication truth table

Publication succeeds only if every applicable row passes:

| Area | State | Result |
|---|---|---|
| Core | no blocks or no tree | refuse |
| ToC | no run | refuse |
| ToC | `running` or `error` | refuse |
| ToC | `done`, hash absent/wrong | refuse |
| ToC | `done`, hash matches blocks | pass |
| Fetch lineage | none | no source-specific refusal |
| Fetch lineage | `done`, source reference present | pass |
| Fetch lineage | `done`, source reference absent | refuse |
| Fetch lineage | `running` or `error` | refuse, even if a reference was inherited |

One discrepancy: the current [`reasonsNotToPublish`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1024) implements the core and ToC rows, but not yet the fetch rows. Therefore the measurements exercise the ToC gate, not the complete planned gate.

## Decision 1: choose (a)

Keep `constitution` as an explicit legacy-refusal case, outside the publishable parity corpus.

Assert:

- `labels.json` lacks `sourceHash`.
- `copied` includes `toc`.
- publication returns `PublishRefused`.
- its structured reasons contain the unstamped-ToC reason.

It does not need to remain stale forever. If someone regenerates it, the red test should instruct them to retire the legacy case and move `constitution` into the publishable corpus—not restore the stale file.

Do not choose (c). It manufactures provenance. A direct synthetic gate test remains the permanent test of the gate; `constitution` covers the real legacy-data boundary.

## Decision 2: yes, with one additional divergence

Exempting only `meta.fetchedAt`, followed by strict equality on everything else and the two positive ownership assertions, is strong enough for fixtures with `raw.json`.

Also assert that at least one fixture genuinely has differing raw/meta times, so the exemption cannot become dead normalization.

But `noema` differs on both:

- `meta.fetchedAt`
- `meta.url`

With no raw step, nothing writes `final_url`. Do not exempt `url` globally. Give noema its own explicit legacy assertion: the filesystem gets those fields from `meta.json`, while a clean Postgres load lacks both.

The plan currently says a fresh `test-c7-clean` clone already proved this at [delete-the-importer.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/delete-the-importer.md:877), contradicting “I have not yet run it clean.” Resolve that evidence statement.

Other contamination:

- Every skipped optional step may have been carried from the previous import: fowler’s tweets/summary/ideas; revistes/source/source-2’s tweets/glossary/summary/ideas.
- All shelf and reader-state equality is inherited from the importer because this loader never writes it.
- Raw-present fixtures may also depend on a previously populated blob bucket.

`writes` is the strongest Article comparison because all its visible artefact steps were overwritten.

## Decision 3: choose (B), but revise the round-trip test

Keep the artefact loader thin. Do not let it call a reader-state helper.

However, “restore all five reader-state files through live stores” is not actually possible:

- [`pgCommentStore.create`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-comments.ts:156) creates only current free comments and cannot restore historical answered comments or timestamps.
- [`pgShelfStore.patch`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-shelf.ts:61) cannot set exact `opens`, `lastOpenedAt`, or historical `archivedAt`.
- Chat creation mints message identities rather than restoring arbitrary transcripts.

Therefore split the claim:

- Artefact round trip: filesystem artefacts → real loader → Postgres → export.
- Reader-state export: seed representative Postgres rows explicitly, export, and compare the files.
- Store parity: use live stores where they can express the tested state; use narrowly named test seeders for historical columns they cannot express.
- Chat anchor: use the standalone two-revision identity test already planned.

A test-only `seed-reader-state.ts` can be reasonable, but call it a seeder, keep it separate, and never compose it into `loadArticleIntoPg`.

## 4. Export must read the blob

Do not weaken the raw-byte assertion. Raw source recovery is part of what makes `db:export` a rollback/data-portability tool.

The exporter should:

- Resolve `raw_source_sha256` and kind through the matching blob store.
- Read and hash the object, checking digest and stored length.
- Fail loudly for a dangling or corrupt reference.
- Require database/blob credentials belonging to the same project.
- Write `raw.json.bytes` from `raw_byte_count`.
- Write `storedBytes` from the object/blob row.

For non-UTF-8 HTML, network `bytes` and stored UTF-8 `storedBytes` can differ. The test should compare the exported file length to `storedBytes`, not necessarily `bytes`.

## 5. Loader findings

These need correction:

1. `createdAt` updates the wrong table. The library uses `articles.created_at` via [`ADDED_AT`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg.ts:786), while the helper updates `article_revisions.created_at` at [load-article.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/load-article.ts:189).

2. It does not store raw bytes. `copyArtefacts` copies only `raw.json`; production assumes fetch already called [`storeRawSource`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs.ts:313). “Every byte crosses the same seam” is currently false.

3. `publish: "try"` catches every error. Database failures, lost fences, and bugs become ordinary refusals. Catch only `PublishRefused` and return its `reasons` array.

4. Carry-forward can make an empty copy publish. Reject `copied.length === 0`, and require a never-published target for parity tests—ideally `draft.basedOn === null`.

5. `ownerId` does not control article ownership. Draft creation uses `currentOwnerId()` at [pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:490). Either remove the option or wrap the whole operation in `runAsOwner`.

6. The `finally` is unfenced and marks the job `done` even when the body failed. It can overwrite an externally failed job and leaves synthetic job history behind. Prefer deleting the synthetic job with `id + attemptId + status=running`, or use a fenced terminal transition that distinguishes success from failure.

7. Use the existing `violatesConstraint` helper. The current one-level `cause.constraint` check can miss Drizzle’s nested wrapper.

8. `jobs_active_slug` also covers queued jobs, not merely a running-slot collision. The retry is defensible, but its comment and timeout error should distinguish the two cases. Retrying cannot repair a wedged row.

9. The helper still copies stage-3 stamped HTML into the stage-2 `extractedHtml` column. C7 already calls that dishonest; the built loader has not resolved it.

10. The single transaction around every copied step is a reasonable fixture guarantee, but it is not production’s transaction boundary, which is one step per transaction. Narrow the “real path” claim accordingly.

No files were changed and I did not run the database-mutating suites.