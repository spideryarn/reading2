# Code review: plan 261029a stage 1 (Structure copes with a ragged tree)

You are reviewing commit 7cc28dc53 in this worktree (`git show 7cc28dc53`). The plan is
docs/plans/261029a-structure-one-level-deeper.md (§ Stage 1); your own earlier plan review is
docs/plans/261029a-plan-review-sol.md. Read docs/project/block-ids.md, docs/project/structure.md and
docs/project/granularity-zoom.md § The tree for the contracts.

Goal of the stage: a tree whose sections are sometimes divided into sub-sections (leaves at depth 4
under them, depth 3 elsewhere) must not break anything, and on every tree production holds today
(uniform three levels, a root-and-leaves tree, parts with leaves directly under them, apparatus /
endnotes) the behaviour must be identical to before.

Look hardest at:
1. `sectionDepth` cap and every consumer of `sections` vs `frontier` (Reader.tsx, quiz-sections.ts,
   useColumnContext.ts, keynav.ts, StructureMode.tsx). Any consumer that should have switched and
   did not, or vice versa?
2. `structureFrontier` in src/web/position.ts: correctness on all shapes, apparatus collapse, rows not
   covered by the tree, performance (it is O(rows × depth) inside a memo; fine?).
3. `buildGeometry` continuation change in src/web/tree.ts: any reader of `continuation` or of real
   cells that changes behaviour on uniform trees?
4. The "only a node with children can be current" rule in src/web/structure.ts and src/web/outline.ts:
   does it ever leave the reader unmarked on a real tree, e.g. a part whose children are all leaves,
   or front matter?
5. outline.ts rung logic and Expanded clamp; outline-mode.css lvl-4.
6. Whether the tests would really catch a regression (identity tests on uniform trees).

You may fix what you find inside these files (workspace-write). Do not commit. Run
`npx vitest run tests/structure-ragged-tree.test.ts tests/structure-ragged-tree-panel.test.tsx
tests/structure-projection.test.ts tests/url-state.test.ts tests/keynav-horizontal.test.ts` and
`npm run typecheck` after any fix. Report: findings with P0/P1/P2, file:line, failure scenario, and
for each whether you fixed it (and how) or leave it for the author.
