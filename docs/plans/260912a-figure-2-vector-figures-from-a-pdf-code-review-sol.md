Found and fixed 18 issues/coverage gaps. One reasoned P1 remains and needs a parser-policy decision, so I cannot call the stage ready.

### Findings

- **F15 · P1 · established · fixed.** Valid NUL-delimited inline images bypassed the scanner. Red/green: `finds an inline image delimited by PDF NUL whitespace`.
- **F16 · P1 · established · fixed.** Type 3 glyph programs can paint vectors absent from pdf.js’s path list. Reachable Type 3 fonts now refuse the drawn route. Red/green: `marks Type 3 vector glyph paint...`; refusal wiring is also tested.
- **F17 · P1 · established · fixed.** Ignored clipping could make a clipped path falsely connect unrelated drawings. Rectangular clip state is now applied; unsupported clips refuse. Red/green: `intersects painted path bounds with a rectangular clip`.
- **F18 · P1 · established · fixed.** Alpha-zero and white-on-white paint could create invisible ownership bridges. Transparent/unknown compositing refuses; invisible white bridges no longer join components, while enclosing exported white artboards remain supported. Red/green: three transparency/white-path tests.
- **F19 · P1 · established · fixed.** Stroke bounds could extend beyond the four-point crop padding. This affected both thick strokes and acute miter joins; the generated acute triangle visibly reached the crop edge. Effective line width, transforms, joins and miter limits are now checked. Red/green: thick-stroke and acute-miter tests.
- **F20 · P1 · established · fixed.** A rotated rectangle lost its `rect` flag and bypassed the boxed-text refusal. Red/green: `keeps the closed-box flag through a rotated affine transform`.
- **F21 · P1 · established · fixed.** A large touching label could inflate a sub-36-point drawing past Fable’s minimum. Component eligibility now uses ink-only bounds. Red/green: `does not let a touching label enlarge a too-small drawing`.
- **F22 · P1 · established · fixed.** An unpunctuated second caption such as `Figure 4 The...` was missed. The conservative caption-opening matcher now counts it. Red/green: `counts an unpunctuated Figure N opening...`.
- **F23 · P1 · established · fixed.** Ink two points above the caption passed location checks, but the renderer’s four-point padding included caption text. Caption boxes now participate in the final crop exclusion. Red/green: `refuses a crop whose renderer padding would include the matched caption`.
- **F24 · P1 · established · fixed.** F12 was implemented crop-wide rather than band-wide, contrary to the final plan. Non-label text anywhere in the band now refuses, excluding running-margin furniture. Red/green: the two-column prose test; all three real figures remain accepted.
- **F25 · P1 · established · fixed.** Slow drawn-page analysis ran before already-decoded bitmaps were stored, allowing the new route to turn an unrelated bitmap into `out-of-time`. Bitmap outcomes now finish first. Red/green: deterministic injected-layout deadline test.
- **F26 · P1 · established · fixed.** A failed `FPDFBitmap_FillRect` was ignored, allowing uncleared black memory to pass the nonblank check. It now becomes `render-failed`. Red/green: mocked PDFium clear failure.
- **F27 · P2 · established · fixed.** If one PDFium destructor threw, later handles were not released. Cleanup is now nested so every acquired handle is attempted. Red/green: throwing bitmap-destructor test.
- **F28 · P1 · established · fixed.** An unclassifiable XObject was skipped despite the module’s “every doubt is yes” contract. Unknown/malformed XObjects, patterns, fonts and soft masks now fail closed. Red/green: malformed-XObject test.
- **F29 · P2 · established · fixed.** A `BI` token split across malformed `/Contents` stream boundaries escaped the per-stream scan while pdf.js recovered it. Page contents are now scanned as one bounded logical sequence. Red/green: split-token test.
- **F30 · P2 · established · fixed.** Removing pipeline caption forwarding left the original focused suite green, making the feature a silent no-op. A `recoverPdfFigures` integration test now fails under that mutation.
- **F31 · P2 · established · fixed.** Replacing `pageHeight - y1` with `y0` still passed the original renderer assertions. A pinned real-fixture raster digest now fails under that coordinate mutation.
- **F32 · P2 · established · fixed.** Mutations disabling exact freshness scoping, drawn counters, byte caps and abort/straggler protections survived the old tests. Added exact web/PDF/mixed freshness assertions and drawn-route bookkeeping tests.
- **F33 · P1 · reasoned · reported.** pdf.js is intentionally run with recoverable errors enabled. It may omit malformed paint while returning a partial operator list; PDFium could then render foreign content that ownership never measured. I would add a strict second operator-list pass for drawn candidates and refuse unless strict and permissive reads prove the same complete paint set. This changes parser policy and cost, so I did not slip it into this review.
- **F34 · P2 · established · reported.** Lint reports excessive complexity in the new layout interpreter/resource walker, now including scores of 147 and 83. I would split graphics-state interpretation, path/stroke measurement, and resource traversal into independently tested pure helpers.

Nested Form, Pattern, Type 3 and soft-mask image probes all return `true`; the oversized real bitmap remains on the bitmap route.

### Verification

- Focused eight-file gate: **232 passed**
- Exact TypeScript checker: **all four projects passed; 2,140 files covered**
- Touched-file lint: no errors; eight complexity advisories, covered by F34
- `git diff --check`: passed
- `npm test`: could not start because this sandbox cannot connect to local Postgres/Docker.
- `npm run typecheck`: its `tsx` wrapper cannot create `/tmp/tsx-1000/*.pipe` in this sandbox; `node --import tsx scripts/typecheck.ts` passed.
- No commit made.

Changed files:

- [src/collect-pdf-figures.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/collect-pdf-figures.ts)
- [src/pdf-figure-layout.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/pdf-figure-layout.ts)
- [src/pdf-figure-page.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/pdf-figure-page.ts)
- [src/pdf-figure-region.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/pdf-figure-region.ts)
- [src/pdf-figure-render.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/pdf-figure-render.ts)
- [src/collect-assets.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/src/collect-assets.ts) — EOF-only change from the mutation probe
- [tests/collect-assets.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/tests/collect-assets.test.ts)
- [tests/collect-pdf-figures.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/tests/collect-pdf-figures.test.ts)
- [tests/pdf-figure-page.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/tests/pdf-figure-page.test.ts)
- [tests/pdf-figure-region.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/tests/pdf-figure-region.test.ts)
- [tests/pdf-figure-render.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb31-figure-2-image/tests/pdf-figure-render.test.ts)

Other concurrent changes under `docs/`, `src/web/`, and unrelated tests were left untouched.

**Verdict: not ready (F33).**