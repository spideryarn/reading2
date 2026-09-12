# A narrow check of one fix: F35, paint the locator never measured

Read-only. **Not** a new review — discovery on stage 1 is closed. One question.

Your narrow check of the F33 fix (`docs/plans/260912a-figure-2-vector-figures-from-a-pdf-f33-check-sol.md`)
found F35: pdf.js with `stopAtErrors` can resolve the already-flushed prefix before its rejection is
observed, so an operator dropped at a chunk boundary is missing from both reads, they compare equal,
and the page reaches PDFium with paint the locator never measured.

The decision, recorded in the plan's paragraph *"F33's fix, checked narrowly"*: move the check to the
renderer's side. After PDFium draws the region, **every non-white pixel must lie inside the ink and
the label text the locator measured**, padded for anti-aliasing and stroke, or the page is refused
(`not-located` / `unmeasured-paint`). The strict comparison stays as a second line. The residual the
plan names and accepts: skipped paint that lands entirely inside a box the locator did measure.

The fix is the single commit **`a4bcb82b`** on top of `d5c6d7d2`; `git show a4bcb82b` is the whole of it.

**The question: does the fix close F35?** In particular —

1. Is the mask built from exactly the boxes the ownership decision used — carried from the locator,
   not recomputed — at the bitmap's own resolution and offset, so a pixel and a box are compared in
   the same coordinates (the y-flip included)?
2. Is the padding small enough that a foreign mark near the figure cannot hide in it, and is the
   evidence that it is not tuned to pass (the in-padding pixel fractions on the three real figures)
   believable?
3. Does the red-first probe really exercise the gap: an operator pdf.js skips and PDFium draws,
   outside every measured box — and would the test have failed on `0201fdfc`? Run it:
   `npx vitest run tests/pdf-figure-render.test.ts tests/pdf-figure-strict.test.ts
   tests/collect-pdf-figures.test.ts` (whichever exist); they need no database.
4. Can any path accept a raster without the containment check running — an early return, a
   `blank` or `render` branch, a caller that bypasses it?
5. Is the named residual (paint inside a measured box) the only one, or is there a wider one?

Answer with findings `F36`, `F37`, … only if the fix is incomplete (P0–P3 by consequence;
established or reasoned), and a one-line verdict: **F35 closed** or **F35 still open** (IDs).
