No P0 findings. I found and fixed two P1s and one P2 test gap; nothing is left for the author.

## Findings

- **P1 — production shallow branches changed behavior.** [position.ts](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/src/web/position.ts:122), [outline.ts](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/src/web/outline.ts:249), [structure.ts](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/src/web/structure.ts:564)  
  On a mixed tree, a part with leaves directly beneath it changed from leaf-granular navigation/current marking to one whole-part stop. That violated the required identity with today’s trees.  
  **Fixed:** the frontier now starts with the existing section-level answer and only substitutes a deeper internal node. Removed the “must have children” filters that prevented existing shallow leaves from being current.

- **P1 — uncovered rows could become the root or shift later anchors.** [position.ts](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/src/web/position.ts:134), [useColumnContext.ts](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/src/web/useColumnContext.ts:128)  
  Geometry repeats the root through columns where child coverage is missing. `structureFrontier` accepted that root; simply filtering it would then compress the omitted span and give later entries incorrect row numbers. Above such a partial projection, the focus sampler would also clamp to the first later part.  
  **Fixed:** exclude root continuations, construct frontier items with their true row starts, preserve supplement collapsing, and keep Structure unmarked above a partial projection.

- **P2 — tests blessed the shallow-tree regression and did not exercise rendered level 4.** [structure-ragged-tree.test.ts](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/tests/structure-ragged-tree.test.ts:176), [structure-ragged-tree-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-one-level-deeper/tests/structure-ragged-tree-panel.test.tsx:92)  
  The direct-leaf test explicitly expected the behavior change, and the panel test checked sub-sections but not the level-4 paragraph markup.  
  **Fixed:** added identity/current-marking checks for the mixed shallow branch, uncovered-row coverage, partial-front-matter focus, and actual `lvl-4` measuring markup.

The `sections`/`frontier` consumer split is otherwise correct: URL state, Quiz, breadcrumbs, return chips and block-link cards remain on `sections`; only Structure focus and ←/→ use `frontier`. The `buildGeometry` continuation change has no behavior-changing consumer on uniform trees, and its supplement behavior remains intact. O(rows × depth) is reasonable inside the memo.

## Verification

- Requested focused suite plus `structure-focus-row`: **6 files, 162 tests passed**.
- Full typecheck script: **all projects passed; all 4,079 source files covered**.
- `npm run typecheck` was attempted but its `tsx` wrapper could not open an IPC socket in the sandbox; running the same repository script directly with Node passed.
- `npm test` could not start the full suite because the sandbox cannot reach the local Postgres/Docker private lane.
- No commit made.