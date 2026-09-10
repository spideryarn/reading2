No P0/P1 findings.

1. **P2 — address-settling test bypassed the real client parser. Fixed.**  
   [address-settling.test.ts:150](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/address-settling.test.ts:150) used `MODES.includes`, which interpreted retired `outline` as Plain. It now calls `modeParam.parse` and includes `?mode=outline` in the cross-product at [line 190](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/address-settling.test.ts:190). The direct parser assertion is at [structure-mode-faces.test.tsx:66](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/structure-mode-faces.test.tsx:66).

2. **P2 — clamp-floor behavior lacked discriminating coverage. Fixed.**  
   The implementation correctly searches whole-title candidates before clamped candidates at [OutlinePanel.tsx:234](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/OutlinePanel.tsx:234), using the same `listClass` for visible and measured markup. New tests distinguish their heights and prove both preference and fallback at [outline-panel.test.tsx:285](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/outline-panel.test.tsx:285) and [line 303](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/outline-panel.test.tsx:303).

3. **P2 — the semantic sweep left source/test comments describing Outline as a current mode. Fixed.**  
   Updated affected references, including arc ownership at [tree.ts:324](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/tree.ts:324), [layout.ts:394](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/layout.ts:394), and routing at [last-view.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/last-view.ts:97). Remaining `outline` occurrences are intentional: the retired alias, historical statements, pipeline terminology, compact-table state, CSS outline, button variants, and deferred marketing assets.

The threshold and ref conclusions checked out. Width/border remain owned by `.mode-band` and `.band-covers`; `.struct`/`.outln` only vary padding and overflow. The slide changes `top`, not width or transform. `offsetWidth` therefore reads the stable layout width. The callback ref assigns `panelRef` before layout effects and re-arms the parent observer when faces switch.

Checks:

- Requested Vitest command: **exit 0** — 7 files, 217 tests passed.
- `npm run typecheck`: **exit 1**, before checking code; sandbox denied `tsx` permission to create its Unix IPC socket (`EPERM`).
- Same typecheck script via `node --import tsx scripts/typecheck.ts`: **exit 0** — all four projects and all 2,075-file coverage checks passed.
- Scoped lint: exit 123 from existing advisory/baseline findings; no new finding from these fixes.
- `git diff --check`: clean.

No commit or index-changing command was run, and `docs/project/` was untouched.