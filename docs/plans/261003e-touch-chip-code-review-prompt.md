# Code review (reviewer-fixer): 261003e touch selection chip

Review AND fix, in this worktree, commit fb5738446 (`git show fb5738446`). Context: Greg's report
spya-ma5h9b — on an iPad, selecting words showed only the system menu, because the comment box
opens from `onMouseUp` (src/web/TableView.tsx) and a long-press selection fires no mouseup. The fix
is one button below a settled TOUCH selection ("Highlight or comment") that calls the same
`selectProse` path. It is deliberately not the colour menu (that waits on Greg). Read
docs/project/touch.md § A finger's selection gets a button, and your own plan review
docs/plans/261003e-span-highlights-plan-review-sol.md findings S1, S7, S8, whose seams apply.

Files: src/web/TouchSelectionChip.tsx, src/web/selection.ts (`readSelectionWithRange`),
src/web/reader/Reader.tsx (the mount), src/web/styles/annotations.css (`.touch-select-chip`),
tests/touch-selection-chip.test.tsx.

Look hardest at:
- Stale saves: can a press ever open the box on words the reader has left (the kept-anchor
  fallback, the grace window, "no grace timer running yet", article change, mode change)?
- Listener lifecycle: document listeners added/removed correctly, timers cleared on unmount, no
  state update after unmount, no leak across articles.
- Interaction with the existing surfaces: the mouseup path must be byte-for-byte unchanged in
  behaviour; the chip must never be over a box; a hybrid device; a touch tap on a `<mark>` must
  still open its comment; the touch block-selection rules in touch.md must be unaffected (does the
  chip's pointerdown handling eat a tap meant for the row?).
- What real iOS Safari is likely to do that jsdom cannot show (selectionchange cadence while
  dragging handles, whether `click` follows a `pointerdown` preventDefault, the tap collapsing the
  selection). Say what you believe from knowledge of WebKit, marked as belief.
- CSS: fixed positioning and clamping with safe-area and the Dock; z-index.

Fix what is inside this change, narrowly and red-first; report anything wider. You can run
`npx vitest run tests/touch-selection-chip.test.tsx tests/selection.test.ts
tests/short-selection-in-a-mark.test.tsx tests/highlight-marks.test.tsx` and typecheck via
`node --import tsx scripts/typecheck.ts`. Do not commit. IDs T1, T2, …; severity P0–P3;
file:line evidence; fixed or not; the test. Verdict: land / land after fixes (made) / do not land.
