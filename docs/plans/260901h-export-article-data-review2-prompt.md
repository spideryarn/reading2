# Review the built code (second review, weighted higher than the plan review)

You reviewed the PLAN for this work earlier; your review is at
`docs/plans/260901h-export-article-data-review-sol.md` and it changed the design substantially — your
central finding was that `exportArticle` projects into a legacy format pinned byte-for-byte by
`tests/store-roundtrip.test.ts`, so sharing its `put()` sink would have carried its losses
(`candidates`→`chat`, dropped `passages`/`interrupted`, missing `extractedHtml`) into a new
user-facing format. That was accepted.

**This is now a review of the CODE that got built.** The house rule says to weight this review
higher than the plan-stage one, because a plan review cannot find a handler that writes one field
and then rejects the request.

## What was built

An Export button on the article Metadata page downloads a zip of everything Spideryarn holds for one
article. Read `docs/project/export.md` first for the intent, then
`docs/plans/260901h-export-article-data.md` for what each stage claims to have done.

The scoped diff of my five code commits is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/f01ff285-eba4-41e0-912a-1f8b03d67fd5/scratchpad/export-mine.diff`.
Read the files in the working tree too — `src/routes.ts` and `src/web/Metadata.tsx` also contain
other agents' unrelated changes, so trust the named functions over the raw diff hunks.

The pieces:
- `src/store/article-rows.ts` — `readArticleRows(slug)`, the ONE owner-scoped walk (via `ownedSlug()`);
  `ArticleNotFound`; and `ARTICLE_TABLE_COVERAGE`, which moved here and now declares, per table, a
  destination for BOTH projections.
- `src/store/export.ts` — the pre-existing CLI rollback. Its projection is meant to be UNCHANGED,
  now fed from `readArticleRows`.
- `src/store/export-bundle.ts` — `articleBundle(slug)`: the reader's zip (fflate async `zip()`),
  `manifestJson`, `readme()`, the new `index.html`, `omissions()`, `BUNDLE_BYTE_CAP`/`overBundleCap()`.
- `src/routes.ts` — `sendExport` and `GET /api/export/:slug`; and `contentDisposition` now takes an
  explicit `"inline" | "attachment"`.
- `src/web/Metadata.tsx` — `ExportSection`.
- Tests: `tests/store-export-bundle.test.ts`, `tests/store-export-covers-tables.test.ts`,
  `tests/export-route.test.ts`, `tests/metadata-export-button.test.tsx`, `tests/source-*.test.ts`.

## What I most want you to attack

1. **Correctness bugs.** Anything that is wrong, not merely arguable. Especially: the bundle's
   whole-row serialisation (`rowJson`) — does it drop, mangle or double-encode anything? Dates,
   nulls, JSONB columns, `bytea`, generated columns like `fts`? Does it leak a column it should not
   (`ownerId` is meant to be stripped — verify, and check every table, not just the obvious ones)?
2. **Owner isolation, again, in the built code.** `sendExport` deliberately does NOT re-check
   ownership, relying on `ownedSlug()` inside `readArticleRows`. Is that actually airtight for
   EVERY table the bundle reads — including the child tables, which are fetched by `article_id`
   after the article is resolved? Is there any table where a row could belong to a different owner
   than the article? Can anything reach `articleBundle` outside a request owner scope?
3. **Did the rollback really not move?** `store-roundtrip` passes (263), but check the code: is
   `exportArticle`'s projection genuinely identical in behaviour, including ordering, `compact()`
   semantics, and absent-vs-null keys?
4. **The `index.html` escaping.** It renders reader- and model-controlled strings and is opened from
   `file://`. Is `safe()` applied at EVERY interpolation? Any attribute context where HTML-escaping
   is insufficient? Is the CSP correct and does `style-src 'unsafe-inline'` open anything? Is
   `isWebUrl()` a sufficient gate for the one `href`?
5. **The guard.** `tests/store-export-covers-tables.test.ts` now runs sentinels through both
   projections. Is the check real, or can it pass while data is lost? What class of loss still
   slips past it?
6. **The client.** `ExportSection`'s blob/anchor/revoke lifecycle, the pending state, error handling.
   Any leak, race, or way to get a dead button or a truncated file?
7. **Anything the plan claims that the code does not do.** The plan doc is full of confident claims;
   check them against the source and tell me which are false.

Be specific, cite file and line, and say plainly which findings are real bugs versus taste. If
something is fine, don't pad. If you find nothing serious in an area, say that too.
