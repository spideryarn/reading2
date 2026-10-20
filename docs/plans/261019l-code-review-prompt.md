You are reviewing the code for one stage in the Spideryarn repo (this worktree), and you may fix
what you find inside it. Commit nothing; leave your changes in the working tree for me to read.

The stage is commit 9908df026 (`git show 9908df026`). The plan it builds is
docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md; your two
plan reviews are docs/plans/261019l-plan-review-sol.md and docs/plans/261019l-plan-review-r2-sol.md.
The postmortem is docs/postmortems/261019d-a-line-number-spliced-into-a-block-id-cost-the-whole-tree.md.

Evidence already gathered: four real answers re-run against the production body now give — runs 2
and 3 build on a first answer (root > child 9: line-number); runs 1 and 4 refuse a first answer and
build on the last, dropping `3 > 3` and `3 > 2`. Before the change all four refused. The structure
suites (`npx vitest run tests/structure-*`) and typecheck pass.

Review for correctness first:
1. `deriveStartRanges` in src/start-ranges.ts: the recovery loop, the window (`after`, `before`),
   the placeholder for a dropped child, the two-children floor, and whether the heading snap and the
   clamp now see anything they did not before. Is there an input where a recovered or dropped start
   yields a tree that tiles but attaches a title to the wrong prose in a way the plan did not accept?
2. `splicedLineNumber`: uniqueness over the whole input, then the window. Leading zeros. A digit run
   long enough to overflow. A `start` that is a real id never reaching it.
3. `modelNodeFromStarts`: the answer-wide budget — computed after the whole conversion, denominator
   correct, message safe to log (no model text other than via `nameValue`).
4. src/structure.ts `generateStructure`: the three `treeFrom` modes (first fresh answer `recover`;
   re-ask and checkpoint replay `recover-or-drop`; the no-time-left first answer re-parsed as
   `recover-or-drop`, reporting the first error if that refuses too); `usableWholeDocument`; the
   failure-message enrichment; `StructureRun.startsRecovered/startsDropped` and src/pipeline.ts.
5. Anything that still constructs or merges a `BuildReport` without `unresolvedStarts` merged
   (search for every place `droppedChildren` is pushed or copied).
6. Tests: does each new test fail if the guard it names is removed? I mutation-checked three
   (uniqueness-before-window, the two-children floor, the checkpoint gate's mode).

Also, as a quality fix: biome flags `deriveStartRanges` for excessive cognitive complexity, which this
stage raised. If you can split the recovery loop into a small named helper without changing
behaviour, do it; and take biome's `useOptionalChain` at src/start-ranges.ts near line 312.

Write your findings to the answer file first, numbered, with severity, file:line, what was wrong and
what you changed (or why you left it). Then make the fixes. Run `npx vitest run tests/structure-*
tests/adversarial-shapes.test.ts tests/tree-redundant-rung.test.ts` and `npm run typecheck` after,
and say in the answer file whether they passed. End with a one-line verdict.
