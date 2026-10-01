# Plan review: 261001q — a PDF's tables and composite figures

You are reviewing a plan before it is built, in the repo at the current directory
(Spideryarn, a reading app; TypeScript). Read `CLAUDE.md` for house rules if useful.

The plan: `docs/plans/261001q-pdf-tables-and-composite-figures.md`. Read it first.

Then read the code it changes, in full where it matters:

- `src/pdf-read.ts` — `renderHtml`, `continuationTargets`, `FLOATS_AND_FURNITURE`, the prompt's rule 7.
- `src/pdf.ts` — `RecordType`, `RENDERED` and their comments.
- `src/pdf-figure-locate.ts` — `judgeLocatedBox` and its header.
- `src/collect-pdf-figures.ts` — `locatedRoute`, the drawn route, `storeOne`, the phase wiring.
- `src/pdf-figure-region.ts` — `bandFor`, `isProse`, `PRINTED_CAPTION_START`, `findCaption`.
- `src/pdf-figure-render.ts` — `renderPdfRegion` and its containment contract.
- `src/pdf-figures.ts` — `captionPrintedOn`.
- `src/collect-assets.ts` — `PDF_FIGURE_RECOVERY_POLICY`, `assetsInputHash`.
- `docs/project/article-images.md`, `docs/project/content-extraction.md` (the figure bullets).

Evidence gathered (not in the repo): the production article's three figures reproduce the
same outcomes locally with the real locator; the model's boxes, in `box_2d`
[ymin,xmin,ymax,xmax] 0–1000, were p4 `[492,80,870,919]`, p5 `[75,128,570,871]`, p6
`[750,79,893,703]`, each the figure's printed frame. Page 4 holds six image xobjects in a
3×2 grid (gaps 17 pt horizontal, 11 pt vertical); page 6 holds eight xobjects in 2×4 plus
two `other` (inline-image) paints; page 5 has no image, 143 ink boxes. Each of those pages
also carries one or two tables and two-column prose. Production: 36 PDF figure markers on
current revisions, 10 stored, 22 `ambiguous`, 4 `not-located`. Eval-corpus `tabledata`
records look like `"Panel A1 | Panel B1"`, sometimes several rows joined by `\n` in one
record.

What I want from you:

1. **Is the diagnosis right?** Anything in the code that contradicts the plan's account of
   why tables and composite figures are lost?
2. **Stage 1** — the table-row attribution rule, the `|`/newline parsing, the orphan case,
   anything that would break block ids, continuations, `mendSeamHyphens`, the scorer, or
   the reading view. Is a `<figure>` with a `<table>` really handled downstream?
3. **Stage 2** — attack `judgeLocatedRegion`'s rules as an adversary would: a box that
   passes and shows the wrong thing, prose, a different figure, or part of a table; a page
   shape where snapping misbehaves; whether "one printed figure caption on the page" is
   strong enough; whether admitting everything PDFium draws inside the region is safe
   given rule 3 is the only content check; whether `other` paints and text-as-outlines
   need refusing; the gate change to ask on pages with no picture; the policy bump.
4. **Simpler**: is there a simpler design that gets the three figures, or a rule that can be
   dropped?

Read-only review. Answer as a numbered list of findings, each with severity (P0 blocks
building, P1 should change the plan, P2 worth noting), the file/line evidence, and the
change you recommend. End with a one-line verdict.
