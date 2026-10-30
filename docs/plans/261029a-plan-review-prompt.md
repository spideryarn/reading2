You are reviewing a plan, read-only. Do not edit files.

Plan: docs/plans/261029a-structure-one-level-deeper.md at commit 4f159cdf9 (this worktree's HEAD).
Read it, then check its claims against the code: src/web/position.ts (sectionDepth, buildSections),
src/web/tree.ts (buildGeometry, navigableItems), src/web/structure.ts (structureProjection and its
paragraph rung), src/web/outline.ts (the Fisheye list and Expanded), src/web/useColumnContext.ts,
src/web/keynav.ts, src/web/quiz-sections.ts, src/structure.ts (prompt + STRUCTURE_OUTPUT_SCHEMA),
src/heading-tree.ts, src/tree-invariants.ts, src/labels.ts (siblingSets). Background:
docs/project/structure.md, docs/project/granularity-zoom.md § The tree, docs/plans/260904d-deepen-fat-sections.md
§ "The idea that makes ragged depth work" and § "What else the tree's depth is wired into".

What I want from you:
1. Is stage 1 (client copes with a ragged tree, built before any tree is ragged) the right thing to
   build now, and is its "a section is the frontier" rule correct? In particular: is it identical to
   today on every uniform tree, what happens on a part with no sections, on supplements, on the
   provisional trees (headings / awaiting-structure), and with `?at=` URLs already saved by readers.
2. Consumers of `sectionDepth` / `buildSections` / the section list the plan missed.
3. The two-column splice of sub-sections under the current section: does it fit the existing
   windowing/capacity measurement (StructurePanel measures hidden copies), the cards (`attachCards`),
   the ribbon, and the "never scrolls" rule? What is the simplest correct version?
4. Stage 2's prompt/schema plan: anything that would break (labels, invariants, checkpoints keyed on
   request, the arc, question depth, the deepening wave's code which assumes depth-2 sections).
5. Anything simpler that gets Greg most of the value.

Severity: P0 (would ship broken / lose data), P1 (wrong behaviour a reader would hit), P2 (worth
fixing), P3 (nit). Give each finding an ID (PR-1, PR-2, …), file:line evidence, and a concrete fix.
Under 1,500 words. My own suspicions, last: the focus row is section-granular today, so making it
frontier-granular may change the once-a-second hold and `?at=` churn inside a deepened section; and
a sectionless part's blocks may today each be their own nameless "section".
