You are reviewing a plan in the spideryarn2 repo (a TypeScript reading app). Read-only review: do not edit files.

Read docs/plans/260924e-a-pdf-figure-paired-to-the-wrong-caption.md, then the code it bears on:
src/pdf-figures.ts (`pairPageFigures`, `PdfFigureFailure`), src/pdf-figure-read.ts (`readPdfRasters`, `pageWords`),
src/collect-pdf-figures.ts (the sequence, `pdfFigureFailure`, the drawn route's candidate filter), src/pdf-figure-region.ts
(`findCaption`, `normalise`, `CAPTION_MATCH_CHARS`), src/assets.ts (`PdfFigureFailure`), src/web/PdfFigureNote.tsx,
and docs/project/article-images.md.

The conclusion I would least like to be wrong about: **"a picture attaches only if the marker's caption, normalised and cut to its
first 60 characters, appears in the text layer of the marker's page" is safe to ship: it breaks no figure we recover correctly today,
and it closes the wrong-picture hole the plan describes.** Attack that claim. In particular:

1. Captions that ARE printed on the page but would fail the substring check: a caption split across two columns or text runs in a
   different content-stream order, a caption with maths that the transcriber writes as LaTeX (`\\(x_i\\)`, rule 8 in src/pdf-read.ts)
   while the text layer has glyphs, ligatures, hyphenation at a line end, a caption the transcriber lightly normalised (quotes,
   dashes, "Fig." vs "Figure"), a caption rendered as outlined glyphs (no text layer). How much of the correct corpus would this lose,
   and should the needle be shorter, or be matched differently (for example, the leading "Figure N" label plus some words)?
2. Cases where the caption IS on the page and the pairing is still wrong (for example, a caption at the bottom of page P whose figure
   is at the top of page P+1, while page P has a different, uncaptioned picture). Is that worth guarding in this stage?
3. Whether the new failure word belongs in both unions (src/pdf-figures.ts and src/assets.ts) and in the mapping, and whether anything
   reads the manifest's reason (the reader-facing note, the export, any test pinning the vocabulary) that would need a change.
4. Whether `PDF_FIGURE` recovery's policy version (the assets input hash; see `assetsInputHash` in src/collect-assets.ts) must be bumped
   so existing articles re-run, and what that re-run would do to articles in production that are correct today.
5. The stage 2 proposal (a model locates the figure, the box picks an embedded image by overlap, or PDFium renders it for vector pages):
   any flaw in the verification idea, and anything in the spike numbers that looks wrong.

Answer with numbered findings, each with a severity (P0 blocks shipping, P1 should fix in this stage, P2 later), the evidence (file:line),
and a concrete fix. Say explicitly if you think the central claim holds.
