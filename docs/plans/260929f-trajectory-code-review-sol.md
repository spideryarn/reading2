The control-boundary conclusion now holds: FAQ, where, and snippet controls are outside `.traj-go`, do not press it, and preserve the controlled words tooltip, follow-scroll, keyboard stepping, and visitor `canOpen` gating.

1. **F1 — P1 — stale snippets reopened after stepping** — [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:480)  
   Stepping hid the snippet but retained its state, so returning to the stop reopened it. Added cleanup and a regression test.

2. **F2 — P2 — stale where-cards reopened after route changes** — [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:471)  
   A row could unmount before its controlled tooltip reported closure. Stale where state is now cleared when the row or mark disappears.

3. **F3 — P2 — where-button positioning depended on a magic offset** — [trajectory.css](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/styles/trajectory.css:377)  
   Replaced `top: 1.25rem` with shared row-padding, number-line, position-gap, and mark-height variables. The number column is now top-aligned, removing baseline-dependent drift.

4. **F4 — P2 — repeated FAQ passages could share React keys** — [stop-card.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/stop-card.ts:75), [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:768)  
   FAQ permits identical words at different offsets. Carried `start` into `CardPassage` and now key by `blockId:start`.

5. **F5 — P2 — missing sparkline positions were not described** — [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:299)  
   The accessible label now says “position unavailable” when a stop breaks the sparkline.

`whereForBlock` is cheap enough: at most 36 pure outline descents plus bounded sibling projections inside the rows memo—no DOM work, network work, or whole-article text scanning. I would not add another cache without measured evidence.

Checks:

- Focused suite: **113 passed**
- Underlying typecheck: **4 projects, all 2,334 source files covered and clean**
- `npm run typecheck` was attempted, but this sandbox rejects `tsx`’s IPC socket with `EPERM`; running the same `scripts/typecheck.ts` directly under Node passed.
- Scoped lint: no errors or warnings; one pre-existing informational fragment suggestion.
- `git diff --check`: clean
- No database, servers, index, or history touched.

**Verdict: approve after fixes.** No wider findings.