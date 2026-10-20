You are reviewing, and may fix, code in Spideryarn (repo at the current directory, a git worktree). This is the code review after your plan review.

FIRST write your findings to docs/plans/261020l-structure-columns-sankey-ribbon-code-review-sol.md (create it): numbered, each with severity (high/medium/low), what is wrong, the evidence (file:line), and what you changed or recommend. Then fix what you find inside this change's scope (the files below), and append to that file a list of what you changed. Anything wider, report and do not fix. End the file with a one-line verdict. Do not commit, do not touch git state (no stash/reset/checkout/restore), do not run the full test suite (the box is shared); you may run: `npx vitest run tests/structure-ribbon.test.tsx tests/structure-band-width.test.ts tests/structure-panel-draws-both-columns.test.tsx tests/structure-mode-faces.test.tsx tests/structure-figure-marks.test.tsx tests/structure-card-opens.test.tsx` and `npm run typecheck`.

The plan, as built and revised after your plan review: docs/plans/261020l-structure-columns-sankey-ribbon.md (your plan review is docs/plans/261020l-structure-columns-sankey-ribbon-plan-review-sol.md). Screenshots: docs/plans/261020l-shot-before-1440-light.png and docs/plans/261020l-shot-after-*.png.

The diff: docs/plans/261020l-structure-columns-sankey-ribbon-code-review.diff. Files: src/web/structure-ribbon.ts (new), src/web/StructurePanel.tsx (the ribbon effect and the SVG), src/web/styles/structure-mode.css (the ribbon rules), tests/structure-ribbon.test.tsx (new), docs/project/structure.md.

Check especially:
1. The ribbon effect in StructurePanel.tsx: correctness of the scoped selectors against the hidden `.struct-measure` copies; whether it can loop or thrash (it runs every render; guarded by `sameRibbon`); whether the ResizeObserver set is enough (grid, A's list, the marked row, B's header, B's list) and the font hook; cleanup.
2. Whether `data-ribbon` / the transparent border / the marked A row's grey ground can change any measured height or width (they must not: the capacity measurement depends on it), including the `.struct-measure` copies and the CSS `:has()` deepest-row rule.
3. The `left: -4px` thumb and `RIBBON_EDGE_INSET_PX` coupling; the edge rect at `xEdge` with `STRUCT_BRACKET_PX` width; whether the edge or band can overlap B's rows or the orange wash given `.struct-inner` padding 0.6rem and border 2px and `.struct-row` padding.
4. Hover and focus states on the marked A row now that it has a grey ground (the `:hover` rule's background vs the new one's specificity), in light and dark.
5. The interaction with the existing tooltip cards and touch tap-reveal (nothing should intercept pointer events).
6. Whether the tests can actually fail for the things they claim.
