# Plan review: tidy an imported title, and keep the original

You are reviewing a plan before it is built. Read-only: change no files.

Read, in this order:

- `docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md` — the plan.
- `docs/research/261005c-title-capitalisation-and-light-tidying-at-import.md` — the research behind it.
- The two seams: `src/extract.ts` around `plainTitle(article.title)` in `runExtract`, and
  `src/pdf-read.ts` around `plainTitle(plainMaths(front?.title ?? titleFrom(…)))` in `runPdfExtract`.
- `src/html.ts` § `plainTitle`; `src/store/artifacts-pg.ts` § `metaColumns`, `readMeta`,
  `META_COLUMNS`; `src/store/pg-revisions.ts` § `REVISION_CARRY_POLICY`; `src/store/pg.ts` §
  `REVISION_PROJECTIONS` (how `journal` is mapped, since the plan copies it);
  `src/web/Metadata.tsx` and `src/web/TitleEditor.tsx` § `useArticleRename`.
- Commit `c0e992349` is the last time a `Meta` field and column were added; its file list is the
  checklist this plan is following.

The owner's request is quoted at the top of the plan. He asked for the simplest version that gets
most of the value.

Please answer:

1. Is anything in the rule set likely to make a title worse often enough that it should come out of
   v1? Try it in your head on real titles: book titles, paper titles, news headlines, titles with
   subtitles, initials, numerals, possessives (`ROVELLI'S`), apostrophes (`O'BRIEN`, `DON'T`),
   `McDONALD`, non-ASCII capitals, a title in a non-English language arriving through a PDF.
2. Is the acronym-from-the-body rule sound? What does the body text look like at each seam, is it
   really in hand there, and can running heads or a repeated title in capitals fool the count?
3. Is the storage right: a nullable `title_original` set only when the title changed, carried with
   the revision, in the article and library reads only, in no fingerprint? Is there a mapping the
   plan has missed that `journal` went through (export, the public DTO, the offline copy, a
   round-trip test)? Does `metaColumns`' backstop or anything else re-derive the title in a way
   that would disagree with the stored original?
4. `jobs.title` and the PDF's rendered `<title>` are fed from the same string. Should they get the
   tidied title? The plan leaves the HTML `<h1>` block as the author wrote it; is there anything
   that compares `meta.title` with that block and would now disagree (a de-duplication, a
   registry title match in `src/article-registry.ts`, the front-matter pass)?
5. Is undo-by-rename the right mechanism, and does anything about `title_override` make it wrong?
6. Is leaving existing rows alone right, given the fingerprint claim? Check that claim.
7. Anything else that would be a bug, a silent failure, or needless complexity.

Give findings as a numbered list, each with a severity (P0 to P3), the evidence (file and line),
and what you would change. Say plainly if a section is fine. End with a one-line verdict.
