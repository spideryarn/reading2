# Probe H2 : include the article's stored Quotes in the one-article export

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — signpost listed `export.md` under architecture.md; found it quickly.
- `docs/project/export.md` — very helpful. Says `quotes` is already in `augmentations/`, and explains the layout, the coverage guard and the "whole rows" design.
- (Did not open `docs/project/quotes.md` beyond grepping it for "export": no hits.)

## 2. Code files you would edit
- Probably none: grep shows `src/store/export-bundle.ts` already writes `augmentations/quotes.json` (`at("quotes.json", revision.quotes)`, ~line 476), lists it in the augmentations names (~397), in `FILE_NOTES` (~782) and in the README text (~597), and counts it on the index page (~897).
- If a gap exists (e.g. the `quotes` column is null for a never-run article, which is by design), the only places would be `src/store/export-bundle.ts` and `tests/store-export-bundle.test.ts`.

## 3. Existing helpers/components/functions you would reuse
- `src/store/export-bundle.ts` § `articleBundle`, `at(...)`, `FILE_NOTES`, `readme()`.
- `src/store/article-rows.ts` § `readArticleRows`, `ARTICLE_TABLE_COVERAGE`.
- No new helper needed.

## 4. Rules/policies you would follow
- Reproduce with a failing test first (CLAUDE.md "Before you call it finished"); here the first step is to verify the task is already done, and if so say so rather than build.
- Run `npm test` and `npm run typecheck`; `tests/store-export-covers-tables.test.ts` and `tests/store-export-bundle.test.ts` guard the layout (export.md).
- Layout change means editing `readme()` and `FILE_NOTES` (export.md); additive fields do not bump `BUNDLE_FORMAT`.
- Work in a worktree, commit by name, push to `dev`, GPT Sol review before commit (CLAUDE.md).
- Real data belongs to the reader: no writes to the production database.

## 4b. Verdict on the task
The task appears already implemented; I would report that to Greg and ask what he saw missing (e.g. trajectory, or an empty quotes column on an article with no quotes step run).

## 5. Where you got lost
- Not lost. The main surprise was that the brief's premise looks false; export.md said so in its first paragraph and the code confirmed it with one grep. I did not verify with a test run (forbidden), nor check that `revision.quotes` is the right column shape.

## 6. Confidence
8/10 that the quotes export already exists; 6/10 that nothing else is needed.
