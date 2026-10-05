# Code review: tidy an imported title, and keep the original

You are reviewing code that has been built and committed. **Fix what you find inside this stage**:
edit the files, add or correct tests, and say what you changed. Report anything wider (a design
change, something outside these files) for me to decide rather than doing it. Do not commit, do not
run any git command that changes history or the working tree's tracked state other than your edits,
and do not touch a database other than the local one the tests use.

The work is commit `ac47cad4b` on this branch. See it with `git show ac47cad4b --stat` and
`git show ac47cad4b -- <file>`.

Read first:

- `docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md` — the plan, the owner's
  request quoted at the top, the known misses, and what your plan review changed.
- `docs/plans/261005g-tidy-an-imported-title-plan-review-sol.md` — your earlier plan review.
- `src/title-tidy.ts` and `tests/title-tidy.test.ts` — the rule.
- The seams: `src/extract.ts`, `src/pdf-read.ts`, `src/paper-metadata.ts` (search `tidiedTitle`).
- Storage: `src/db/schema.ts` (`titleOriginal`), `src/store/artifacts-pg.ts` (`storedOriginal`,
  `metaColumns`, `readMeta`), `src/store/pg.ts`, `src/store/pg-revisions.ts`, `src/store/export.ts`,
  `drizzle/20261005105117_article_title_original.sql`.
- UI: `src/web/Metadata.tsx` § `ImportedTitle`.
- Tests: `tests/title-tidy-seams.test.ts`, `tests/title-original-pg.test.ts`,
  `tests/metadata-imported-title.test.tsx`, and the additions in
  `tests/pdf-frontmatter-wiring.test.ts` and `tests/store-artefacts-pg.test.ts`.

Please check, by running code rather than reading it where you can:

1. **The rule on real titles.** Write a scratch script that runs `tidyTitle` over forty or so
   realistic all-caps titles (books, papers, headlines, subtitles, quotes, brackets, slashes,
   ampersands, numbers, possessives, names, abbreviations like `U.S.`, `VOL. 2`, `PH.D.`, `A.I.`,
   `AI`, `UK`, `WWII`) and over mixed-case titles that must not change. Is any result worse than the
   input? Fix what is cheap and safe; list what is not as a known miss.
2. **Whether the conclusion in the plan holds**: that this is "very light", that a mixed-case title
   is never recased, and that every change is undoable. Look for an input where `tidyTitle` changes
   a title that is not wholly capitals in a way other than removing a trailing `*`, `†` or `‡`.
3. **The acronym rule**: can it keep a word in capitals that is not an acronym, or crash or run
   slowly on a very large body (a 1,000-page PDF's text; a title containing regex-special
   characters; an empty title; a title that occurs thousands of times)?
4. **Storage**: every place a `Meta` or an `article_revisions` row is rebuilt field by field. Is
   `titleOriginal` named where it must be and absent where it must be (public DTO, any prompt, any
   fingerprint or source hash, the shelf/library list)? Does a re-extraction that no longer tidies
   clear it? Does anything read `meta.title` expecting it to equal the `<h1>` block's text?
5. **The Metadata page**: is `ImportedTitle` shown only to an owner with a shelf row, and is the
   button's failure visible? Does it behave when the reader has already renamed the article?
6. **The tests**: is any of them unable to fail? Mutate the code and see.
7. The migration is one nullable column. Confirm the snapshot chain is sound (`npm run db:chain`).

Run `npm run typecheck` and the test files above before you finish. Give findings as a numbered
list with severity (P0 to P3), evidence, and for each one whether you fixed it. End with a one-line
verdict.
