You are reviewing Stage A of a plan, as built, in this worktree. You may edit files to fix what you
find (workspace-write). Do not run git commands that commit, reset, stash, checkout or restore. Do
not touch any database.

Read first:
- docs/plans/261019e-uncaptioned-pdf-figures-are-kept.md — the plan as revised after your own plan
  review (docs/plans/261019e-uncaptioned-pdf-figures-plan-review-sol.md, verdict RETHINK). Stage A is
  built; Stage B (positional pairing) is deliberately not.
- The diff: docs/plans/261019e-uncaptioned-pdf-figures-code-review.diff (src and tests), plus the new
  test file tests/pdf-uncaptioned-figures.test.ts.

What Stage A claims:
1. `renderHtml` (src/pdf-read.ts) keeps an empty `figure` record as `<figure data-spya-pdf-figure="…"></figure>`,
   unless it is the continuation of an earlier block.
2. Its ref folds in `neighbourContext` (end of the rendered block before, start of the one after);
   `pdfFigureRef` (src/pdf-figures.ts) hashes `context` only when given, so every captioned ref is
   byte-identical to before and `PDF_FIGURE_REF_VERSION` stays `pdffig1`.
3. `pairPageFigures` refuses a marker with no caption as `uncaptioned` (new word in both failure
   unions, mapped in src/collect-pdf-figures.ts), but still counts it among its page's markers.
4. The reader sees the existing "We couldn't recover this figure" note (src/web/PdfFigureNote.tsx).
5. `PDF_FIGURE_RECOVERY_POLICY` is not bumped (argument in the plan).

Check, and fix in place where you are confident:
- Correctness of the render loop change: continuation targets (`continuationTargets`, `blockOf`), a
  `continues: true` record after an empty figure, an empty figure first or last in the document,
  footnote marker finding (`findMarkers`) and endnote retyping, list open/close, and the per-page
  ordinal (does counting empty figures now change any captioned ref on a page that has both, and is
  that acceptable as the plan says?).
- Whether anything else in the pipeline or reading view now mishandles an empty marked figure:
  sanitiser, stage 3 block classification (`kind`, `words`, `gistable`), Structure/hierarchy and the
  gist/labels steps (an empty block sent to a model?), Skim, quotes, search/FTS, export, the
  injection scan, `pdf-integrity` / `pdf-score` recall checks that count records or figures, and
  any test fixtures/evals that snapshot PDF HTML.
- Whether the `uncaptioned` reason needs handling anywhere that enumerates `PdfFigureFailure`
  (admin views, cost/assets reports, copy maps) without an exhaustive type check.
- `neighbourContext`: deterministic for the same transcript? Any case where two uncaptioned figures
  on one page get the same ref (e.g. adjacent empty figures with identical neighbours), which would
  make `pdfFigureMarkersIn` drop both and `assertDistinctRefs` throw? If so, fix it (e.g. by
  including the ordinal — it is already in the hash — or by reaching further for a neighbour).
- Tests: are they red without the change and green with it? Missing cases?

Then run: `npx vitest run tests/pdf-read.test.ts tests/pdf-figures.test.ts tests/pdf-uncaptioned-figures.test.ts tests/collect-assets.test.ts`
and `npm run typecheck`.

Write your findings first as a numbered list (severity, evidence file:line, what you changed or why
you did not), then a one-line verdict: SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP.
