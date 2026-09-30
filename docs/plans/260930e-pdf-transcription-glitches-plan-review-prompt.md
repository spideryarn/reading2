# Plan review: PDF transcription glitches (260930e)

You are reviewing a plan, read-only. Repo: the current directory (TypeScript + ESM, vitest).

Read:

1. `docs/plans/260930e-pdf-transcription-glitches.md` — the plan.
2. `src/pdf-read.ts` — `renderHtml` (around line 1630) and `mendSeamHyphens` (around line 1541), and
   the comment in `runPdfExtract` about the front-matter pass running before `renderHtml` (search
   "Available online").
3. `src/pdf.ts` — `RecordType`, `RENDERED`.
4. `tests/pdf-seam-hyphens.test.ts` (esp. "does not reach across a record renderHtml would not join"),
   `tests/pdf-frontmatter-wiring.test.ts` (the Kuhn "Available online" case), `tests/pdf-read.test.ts`
   ("records into HTML").
5. `src/pdf-authors.ts` — `verifyAuthors`, and where `runPdfExtract` builds `meta.byline` from its
   verdict (search "authors.map((a) => a.name)").
6. `docs/project/content-extraction.md` § "Two extractors, one artefact" — the bullets on
   `mendSeamHyphens` and "A continuation joins only on the same source page or the immediately
   following one".

Evidence from the survey (production, read-only): in the 7 papers re-read with the current pipeline,
25 boundaries have the shape `paragraph(ends mid-sentence) · figure · paragraph(continues:true)`; and
in the stored checkpoints, 47 boundaries have `paragraph · publisher/footnote … · paragraph(continues:true)`
across a page turn. Every one of those has `continues: true` from the model.

What I want from you:

- **Is the join rule right?** Construct the record sequences where rule 2 (bridge publisher/footnote
  at a page turn) or rule 3 (bridge back past figures/tables) makes a join a reader would see as
  wrong. In particular: interaction with the front-matter pass retyping records to `publisher`
  (`withFrontMatterHidden`); two-column pages; a figure whose caption continues onto the next page
  (`figure` `continues` `figure`); lists (`listitem`), where `renderHtml` opens and closes `<ul>`;
  `tabledata` between; the figure ordinal counter in `figureMarker`; `mendSeamHyphens`' own page and
  evidence checks with a non-adjacent target.
- **The page-gap extension** ("further only across pages that hold nothing but the bridged records"):
  is that well-defined, and is it safe?
- **Stage 2** (names-only byline when only an affiliation fails, no author list stored): anything
  downstream that treats `byline` without `authors` differently from the old fallback, and whether
  the note on the Metadata page still makes sense.
- **Anything the plan claims that the code or the evidence does not support.**
- Whether the scope is right: what should be cut, or what is missing that is cheap and clearly right.

Write findings as a numbered list, each with severity (P0/P1/P2), the file/line, the concrete
failing input, and the fix you suggest. End with a one-line verdict.
