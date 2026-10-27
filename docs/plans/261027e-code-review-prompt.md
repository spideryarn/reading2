You are reviewing code, and you may fix what you find inside this change's scope. Report anything wider for me to decide.

The plan is docs/plans/261027e-a-picture-inside-a-drawing-is-not-the-figure.md, including its "After GPT Sol's plan review" section, which says how your plan review (docs/plans/261027e-plan-review-sol.md) was answered. The postmortem is docs/postmortems/261027b-a-part-of-a-figure-was-taken-for-the-whole-figure.md. The diff is docs/plans/261027e-code-review.diff (src, tests, docs/project); the working tree is the truth if they differ.

Files: src/collect-pdf-figures.ts (settleDrawingPart, the per-page loop in everyFigure, WHOLE_DRAWING_ONLY, REGION_PICTURE_SHARE, sharedShare, compositeRegion's `pictures` and `wholeDrawing`, the located route's conflict rules, MAX_LOCATE_CALLS 16), src/pdf-figure-region.ts (drawingAround, isPartOfDrawing, IN_A_DRAWING_RATIO), src/pdf-figures.ts and src/assets.ts (two new failure words), src/collect-assets.ts (PDF_FIGURE_RECOVERY_POLICY 8), and the tests in tests/collect-pdf-composite-figures.test.ts, tests/collect-pdf-figures.test.ts, tests/pdf-figure-region.test.ts and tests/collect-assets.test.ts.

Evidence outside the repo: a replay of the real collectPdfFigures on the LeCun PDF with an oracle locator, /tmp/claude-1000/-home-greg-code-spideryarn2/1ae3039e-5b97-43ea-ab29-64ab10903cc8/scratchpad/full-wt.ts (run: `npx tsx <that file> /tmp/claude-1000/-home-greg-code-spideryarn2/1ae3039e-5b97-43ea-ab29-64ab10903cc8/scratchpad`), gives 18 stored (14 before), 9 calls. measure2.ts in the same folder is the corpus measurement (151 pages; only LeCun 9/11/12 flagged).

Product bar (Greg, 2026-10-01): "I'd rather accidentally pull in a bit of extra stuff that got included within the bounding box than have no figure imported at all." Not accepted: a wrong picture under a caption, or a region tied to the wrong caption.

Look hardest at:
1. Whether any path can still store the refused icon (or any single picture) under an `in-a-drawing` / `unmeasured-picture` figure's caption.
2. Whether the summed-share conflict rule is applied consistently in all three places (taken, region-vs-region, region-vs-choice) and whether `taken` is computed from the settled outcomes.
3. The abort/clock handling in the new per-page loop: can any marker vanish, be recorded twice, or be stored after abort?
4. Whether each new test fails without the change it protects (I mutation-checked the icon-only, grid, fail-closed and share tests; not the incremental-deadline one, because the batch version no longer exists).
5. Type-level holes: is the new failure word exhaustively handled everywhere a PdfFigureFailure is switched on (grep the repo, including src/web)?

Run `npx vitest run tests/collect-pdf-composite-figures.test.ts tests/collect-pdf-figures.test.ts tests/pdf-figure-region.test.ts tests/collect-assets.test.ts` and `npm run typecheck` after any fix. Do not commit. Write your findings, ranked, with file:line and what you changed for each.
