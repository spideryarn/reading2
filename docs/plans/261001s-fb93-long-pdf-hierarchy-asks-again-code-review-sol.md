Found four issues; fixed three. I found no defect in the once-only re-ask, deadline, checkpoint, token, or call-count logic.

1. **P1 — missing required `BuildReport.rangelessChildren` initializers** — [adversarial-shapes.test.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/tests/adversarial-shapes.test.ts:151), [hierarchy-build.test.ts:558](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/tests/hierarchy-build.test.ts:558), [hierarchy-deepen-wave.test.ts:214](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/tests/hierarchy-deepen-wave.test.ts:214), [tree-redundant-rung.test.ts:60](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/tests/tree-redundant-rung.test.ts:60). Seven constructors failed the required pre-push typecheck. **Fixed.**

2. **P2 — lone next-start claims were measured with the wrong direction** — [hierarchy.ts:1501](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/src/hierarchy.ts:1501). When the previous child was rangeless and the next child claimed a start beyond its parent, the repair was logged as an overlap instead of a gap. Added a regression test that failed first. **Fixed.**

3. **P3 — internal invented-ID errors changed wording** — [hierarchy.ts:1369](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/src/hierarchy.ts:1369). Moving validation into `planChildRanges` replaced the established internal-node message with the leaf-node form. Added a regression test and restored the old message while retaining pre-validation. **Fixed.**

4. **P3 — documentation contradicts the implemented malformed-range rule** — [hierarchy.md:221](/home/greg/code/spideryarn2/.claude/worktrees/fb93-long-pdf-hierarchy-fails/docs/project/hierarchy.md:221). It says non-pairs and non-string pairs are derived, while the plan and code correctly refuse them. **Not fixed:** this is rule-bearing documentation and requires the repository’s before/after approval process.

Validation:

- Focused suites: **72 tests passed**.
- Exhaustive probe: all **19,683** three-child combinations of valid/null/absent ranges tiled successfully.
- Full typecheck: passed all four projects via `node --import tsx scripts/typecheck.ts`. The literal npm launcher was blocked by sandbox IPC permissions.
- Full `npm test` could not collect tests because local Postgres was unavailable.
- No commit made.