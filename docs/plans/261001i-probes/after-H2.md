# Probe H2 (after): include stored Quotes in the one-article export

## 1. Docs opened, in order
- `docs/project/export.md` — found via the CLAUDE.md `architecture.md` line ("export.md (one article's data, out)"). It answered at once: quotes are already listed as `augmentations/quotes.json`.
- (Only one doc opened; the rest was grep on code.)

## 2. Code files you would edit
- None expected: the task already appears done. `src/store/export-bundle.ts` line 397 lists "quotes" among augmentations, line 476 does `at("quotes.json", revision.quotes)`, the README text (line 597) and `FILE_NOTES` (line 782) describe it, and the counts (line 897) include it. `tests/store-export-covers-tables.test.ts` line 625 records it.
- If a gap were found, edit `src/store/export-bundle.ts` and `tests/store-export-bundle.test.ts` only.

## 3. Existing helpers/components/functions you would reuse
- `src/store/export-bundle.ts` § `articleBundle`, `at(...)`, `FILE_NOTES`, `readme()`. No new helper needed.
- `src/store/article-rows.ts` § `readArticleRows`.

## 4. Rules/policies you would follow
- Add a test that fails first (CLAUDE.md "Reproduce before fixing"); with `FILE_NOTES` drift guard (export.md).
- `npm test` and `npm run typecheck` (CLAUDE.md). Worktree + push to `dev`. Docs edits to export.md are signposting, no approval.
- No migration, no AI call, so no cost tracking or streaming.

## 5. Where you got lost
- Nowhere; the premise of the task looks false (quotes already exported). I did not run the export to confirm quotes.json is actually written for a real article, only read the code path.

## 6. Confidence
9/10 that quotes are already exported and nothing needs doing; 5/10 that the task intended something narrower (e.g. a quotes-specific gap) that I did not see.
