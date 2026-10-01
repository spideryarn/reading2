# Key — H2: include the article's stored Quotes in the one-article export
**0. Disposition: already done (no-op), report it.** The export zip has carried
`augmentations/quotes.json` since the export landed (260901h, 2026-09-01). `augmentationFiles`
writes `revision.quotes` verbatim; `FILE_NOTES` describes it ("Lines worth keeping."); `index.html`
counts them; `readme()` lists it; `quotes` is in `REVISION_WRITTEN_ELSEWHERE`, so it is not also
inside `content/revision.json`. `trajectory.json` (the route through the quotes) ships too. An
ideal agent confirms from the code or a test and stops.
## 1. Docs it must read
- MUST `docs/project/export.md` — first paragraph and § "What comes out" (`augmentations/` lists
  `quotes`); § "Why there are two exporters" (the bundle serialises whole rows; `db:export` is the
  rollback, a different thing).
- USEFUL `docs/project/quotes.md` (what a quote is; kept in the `quotes` column).
- USEFUL `docs/plans/260901h-export-article-data.md` (the plan and its deferrals).
- Acceptable alternative: reading `src/store/export-bundle.ts` § `readme()` directly, which
  export.md names as the layout's own documentation.
## 2. Existing code it must reuse (a second copy is the mistake)
- `src/store/export-bundle.ts` § `augmentationFiles` (`at("quotes.json", revision.quotes)`),
  § `REVISION_WRITTEN_ELSEWHERE`, § `FILE_NOTES`, § `readme()`, the counts (`countOf(revision.quotes, "quotes")`).
- `src/store/article-rows.ts` § `readArticleRows` — the one owner-scoped walk, in one snapshot.
- `src/db/schema.ts` § `articleRevisions` `quotes` column (an artefact column, not a table).
- Duplicate shape: a second quotes file, a new query for quotes, a new route or button, or adding
  quotes to `src/store/export.ts` (the rollback).
## 3. Code files it would edit
- None. Only if a real gap were found: `src/store/export-bundle.ts` and
  `tests/store-export-bundle.test.ts`.
## 4. Project rules that apply
- Check it is not already built before building (CLAUDE.md "Before rebuilding something…").
- The reader's bundle is not built on the rollback `exportArticle`, which
  `tests/store-roundtrip.test.ts` pins byte for byte (`export.md` § Why there are two exporters).
- Artefacts are columns on `article_revisions`; a quote addresses text by block id (`block-ids.md`).
- Failing test first; worktree for code.
## 5. Traps
- `npm run db:export` (`src/store/export.ts`) is the rollback, not the reader's export; editing it
  breaks `store-roundtrip` and gives the reader nothing.
- A file with nothing in it is absent by design ("every file is optional"); an article never run
  through Quotes has no `quotes.json`, which is not a bug.
- `FILE_NOTES` turns `tests/store-export-bundle.test.ts` red for an undescribed file, so a duplicate
  under a new name trips it.
- `tests/store-export-covers-tables.test.ts` compares keys against `getTableColumns`.
## 6. Wrong or duplicative actions
- Writing a new quotes projection, endpoint or export button.
- Re-shaping quotes into a "nicer" dialect — artefact columns go out verbatim on purpose.
- Bumping `BUNDLE_FORMAT` for something already there.
