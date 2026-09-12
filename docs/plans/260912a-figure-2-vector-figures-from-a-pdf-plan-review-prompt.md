# Plan review: rendering PDF figures that are drawn rather than pictured

You are reviewing a **plan**, read-only. Nothing is built yet.

## The candidate

- Repo: the worktree you are running in. Commit **`ad65edb2`** adds exactly one file:
  `docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md`. `git show ad65edb2` is the whole
  candidate. Start there; it does not limit where you may read.
- The code it proposes to change, to read against the plan:
  `src/collect-pdf-figures.ts`, `src/pdf-figure-read.ts`, `src/pdf-figures.ts`, `src/assets.ts`
  (§ `PdfFigureFailure`, `PdfFigureEntry`, `pdfFigureMarkersIn`), `src/collect-assets.ts`
  (§ `pdfFigureMarkersIn`, `assetsInputHash`), `src/web/PdfFigureNote.tsx`, `src/pdf.ts`
  (`loadPdfjs`, the worker trick), `tests/pdf-bundle-trace.test.ts`,
  `tests/cold-start-lazy-imports.test.ts`, `vite.api.config.ts`, `vercel.json`.
- Background docs: `docs/project/article-images.md`,
  `docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md` (the route this extends,
  and Fable's *one marker, one raster* rule), `docs/project/security.md` § the PDF (search
  "We parse a stranger's PDF in our own process").

## What the work is for

An admin's report: Figure 2 of an MDPI paper showed a caption and "We couldn't recover this figure
from the PDF." Reproduced: that page carries no bitmap, only vector paths, and the figure route only
recovers embedded bitmaps. The plan adds a second route — locate the figure's rectangle above its
caption from pdf.js's operator list and text, render just that rectangle with PDFium compiled to
WASM (`@embedpdf/pdfium`), and store it through the existing PNG path. The spike numbers are in the
plan; you cannot re-run them (no network in your sandbox, and the package is not installed in this
tree).

## What I want from you

An independent attack on the plan first. In particular, but not only:

1. Is locating a figure by "the ink between its caption and the nearest prose line above it, within
   the caption's column" safe against the failure 260906a cares most about — **a picture that is not
   this caption's figure, shown under it**? Construct the page layouts that defeat it.
2. Is PDFium-in-WASM in the Vercel API function a sound choice against the alternatives, and what
   does the plan get wrong about its cost, bundling, lazy loading, memory, or a synchronous render
   that nothing can interrupt?
3. Security: the plan makes security.md's "we never render" false. Is its account of the new
   exposure honest and sufficient? Is anything it proposes an edit to a defence listed in
   `docs/project/security-map.md` § Where the defences physically live?
4. Anything in the shape — the two new failure words, which markers take the route, caption text
   reaching the step, freshness and `assetsInputHash`, the stages — that will produce wrong behaviour
   or a check that passes while the feature does nothing.
5. Is there a **simpler** version that gets most of the value, or a reason to reframe or not do it?

## Severity, and what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference.
Reasoned findings rank and inform but do not block. Give every finding a stable ID (`F1`, `F2`, …),
its severity, whether it is established or reasoned, and the change you would make.

End with a one-line verdict: **proceed**, **proceed with changes** (list the IDs), or **do not
proceed**.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- The prose threshold (≥ 8 words, ≥ 30% page width) is a guess from three figures.
- A two-column paper where a figure sits in one column beside the other column's prose.
- Figures whose axis labels are long enough to look like prose.
- Whether Vercel's file tracer will see a `.wasm` read by path from a lazily imported package.
