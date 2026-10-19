You are reviewing a plan before it is built. Read-only: do not edit any file.

The plan: docs/plans/261019e-uncaptioned-pdf-figures-are-kept.md (read it first, in full).

Background docs: docs/project/article-images.md (the PDF figure routes, especially the bullets from
2026-09-12 onwards), docs/project/block-ids.md, and the plans it links (260906a, 260924e, 261001q).

Code to read before judging:
- src/pdf-read.ts — the SYSTEM prompt rule 7, and `renderRecords`-area code around the comment
  "A record with no caption still produces nothing at all" (the `if (!text) continue` in the render
  loop), `figureMarker`, and how per-page ordinals are counted.
- src/pdf-figures.ts — `pairPageFigures`, `captionPrintedOn`, `normalise`, `CAPTION_MATCH_CHARS`,
  `pdfFigureRef`.
- src/collect-assets.ts — `pdfFigureMarkersIn`, `pdfFigureCaptionsIn`, `PDF_FIGURE_RECOVERY_POLICY`,
  `assetsInputHash`.
- src/collect-pdf-figures.ts — how captions gate the bitmap, drawn and located routes; the failure
  vocabulary.
- src/blocks.ts — `exactKey` / `emptyKey` (id stability for an empty `<figure>` carrying a marker).
- src/figures.ts — Skim/Structure figure list, for the "empty stop" consequence.
- src/web/rehost.ts — how a PDF figure's `<img>` is inserted, and what an uncaptioned figure with no
  stored picture renders as.
- src/sanitize*.ts — whether an empty `<figure data-spya-pdf-figure>` survives sanitising and
  stage 3 as a block of its own.

Questions, answer each:
1. Is the diagnosis right — would these figures have been recovered by the change, and is anything
   else in the path (sanitiser, block splitting, furniture/front-matter filters, the injection scan,
   any "empty block" pruning) going to drop an empty marked `<figure>`?
2. Is the neighbour-text gate ("the end of the text before it OR the start of the text after it is
   printed on the marker's page") a sound substitute for the caption gate? Construct the most
   plausible wrong-pairing case on a real book layout and say whether the rest of the gate (one
   marker, one usable picture on the page) still stops it. Propose a stricter rule if one exists
   that still accepts a picture-at-top-of-page layout.
3. Where should the neighbour text come from — the stored blocks (as proposed), or should pdf-read
   carry it? Any trap in "nearest non-empty, non-figure block" (footnotes, headings, front/back
   matter folded away, a figure inside a list, a table block, continuation joins)?
4. Ref and id stability: an uncaptioned figure's ref hashes page, ordinal and "" — any collision or
   churn risk? Does `emptyKey` really give it a stable, distinct id?
5. Anything downstream that assumes a PDF figure has a caption (Skim, Structure, Illustrated,
   locator, export, chat context, excerpts) and would now break or show something wrong?
6. Should `PDF_FIGURE_RECOVERY_POLICY` be bumped, and does anything else need a version bump
   (the extract step's implementation version, so existing PDF articles are re-rendered)?
7. Is there a simpler version with the same safety?

Write findings as a numbered list, each with severity (blocker / should-fix / nit), the evidence
(file:line), and the fix. End with a one-line verdict: BUILD AS PLANNED, BUILD WITH CHANGES, or
RETHINK.
