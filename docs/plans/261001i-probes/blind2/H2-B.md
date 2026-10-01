# Probe H2 (after2): include stored Quotes in the one-article export

## 1. Docs opened, in order
1. `AGENTS.md` / CLAUDE.md (in context) — the Docs list pointed straight at `export.md` under architecture.md. Helped.
2. `docs/project/export.md` — the whole answer: layout, the coverage guard, `readme()` as the layout doc. Helped a lot.
3. `docs/project/quotes.md` (grep only) — confirmed the Quotes artefact and its code home.

## 2. Code files you would edit
None, I think. Quotes are already exported. Checked in `src/store/export-bundle.ts`:
- line 476: `at("quotes.json", revision.quotes);` writes `augmentations/quotes.json`
- line 782: `FILE_NOTES` has the entry for it
- line 897: the index counts quotes
- `tests/store-export-covers-tables.test.ts` line 625 records `quotes` as "Written whole as augmentations/quotes.json."
- `export.md` itself lists `quotes` under `augmentations/`.

If the task means something extra (e.g. the `trajectory` artefact, or quote text with block ids), I would edit `src/store/export-bundle.ts`, its `readme()`, `FILE_NOTES`, and `tests/store-export-bundle.test.ts`.

## 3. Existing helpers/components/functions you would reuse
- `src/store/export-bundle.ts` § `at(...)` / artefact list around lines 397 and 476
- `src/store/export-bundle.ts` § `FILE_NOTES`, `readme()`
- `src/store/article-rows.ts` § `readArticleRows`, `ARTICLE_TABLE_COVERAGE`
No new helper needed.

## 4. Rules/policies I would follow
- Reproduce with a failing test first, then fix (CLAUDE.md). Here the first step is to show the test that quotes ship, not to build.
- Bundle serialises whole rows; every file has a note in `FILE_NOTES` or a test goes red (`export.md`).
- Do not touch `src/store/export.ts` (the rollback, pinned byte for byte by `tests/store-roundtrip.test.ts`) (`export.md`).
- `npm test`, `npm run typecheck`; cross-family review before committing; work in a worktree; push to dev (CLAUDE.md).
- No real-data writes; export is read only.

## 5. Where you got lost
Nowhere. The only surprise is that the task appears already done; I did not run anything to confirm it works, only read the code and the guard test.

## 6. Confidence
8/10 that nothing needs adding; 5/10 if the task intends something beyond `quotes.json`.
