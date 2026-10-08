Verdict: Approve with one P2 follow-up; the desktop implementation and interaction logic are sound.

1. **CR-1 — P2 — Not fixed:** At 390px with Diagram enabled, More spans x=354–398, leaving 8px outside the viewport until the bar is scrolled. This misses the plan’s original “fully visible without scrolling” goal, although the control remains usable. A runtime fix needs a phone-layout trade-off, so I documented the limitation in the [plan](/var/tmp/spideryarn-worktrees/bottom-bar-groups/docs/plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md).

2. **CR-2 — P3 — Fixed:** Several comments and docs still described More as separately framed, Comments as loose, or the old TooltipGroup/count arithmetic. Corrected:

   - [Dock.tsx](/var/tmp/spideryarn-worktrees/bottom-bar-groups/src/web/Dock.tsx)
   - [dock-fit.css](/var/tmp/spideryarn-worktrees/bottom-bar-groups/src/web/styles/dock-fit.css)
   - [narrow-window.css](/var/tmp/spideryarn-worktrees/bottom-bar-groups/src/web/styles/narrow-window.css)
   - [dock-mode-tooltips.test.tsx](/var/tmp/spideryarn-worktrees/bottom-bar-groups/tests/dock-mode-tooltips.test.tsx)
   - [tooltips.md](/var/tmp/spideryarn-worktrees/bottom-bar-groups/docs/project/tooltips.md)
   - [261008d plan](/var/tmp/spideryarn-worktrees/bottom-bar-groups/docs/plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md)

No further defect found in `cutForMore`, the counts/frames, `fitSignature`, Comments styling, focus/Escape handling, or retargeted selectors.

Checks: requested Vitest selection passed, 20 files/567 tests. Direct typecheck passed all 3,509 sources; the npm wrapper itself hit the sandbox’s `tsx` Unix-socket `EPERM`. Targeted lint passed with existing advisory warnings. No commit made.