I found one P1 issue and fixed it. No unresolved P0/P1 findings remain.

### Findings

- **CR-1 — P1, reasoned:** The More menu could exceed a short landscape viewport.  
  **(a)** Open More around `844×390`, especially as a visitor where five descriptions may also include availability sentences. The menu had no height ceiling or scrolling, so upper items could leave the viewport.  
  **(b)** Applied: constrain it to Radix’s collision-aware available height and enable vertical scrolling in [Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:3427). Added a regression test in [dock-more.test.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/tests/dock-more.test.tsx:397). The new test failed before the fix and passed afterward.

- **CR-2 — P3, established:** The experimental-features documentation said FAQ and Timeline were in More “not the bar,” overlooking the current-mode exception.  
  **(a)** Open `?mode=faq`; it appears both as the checked radio and in More.  
  **(b)** Applied: documented the current-mode exception in [experimental-features.md](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/project/experimental-features.md:196).

- **CR-3 — P3, established:** Several docs overstated mode reachability through the command bar or direct buttons. Signed-out visitors have no command bar, and unoffered experimental modes have no direct button.  
  **(a)** Visit a shared article signed out, or disable an experimental mode that is not currently open.  
  **(b)** Applied: qualified the claims in [interface-vision.md](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/project/interface-vision.md:233), [reading-view-overview.md](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/project/reading-view-overview.md:125), and [mode.md](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/docs/project/mode.md:110).

- **CR-4 — P3, established:** Comments called More the application’s second Radix dropdown, but `DataTable` already contains another.  
  **(a)** Search for `DropdownMenu` in `src/web/lib/DataTable.tsx`.  
  **(b)** Applied: comments now describe Shelf and Dock as the two callers sharing these particular helpers, without claiming an application-wide count, in [menu.ts](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/menu.ts:1) and [Dock.tsx](/var/tmp/spideryarn-worktrees/fbdest8x-bottom-bar-more/src/web/Dock.tsx:3328).

I audited all changed tests: no assertion was weakened, and no current sweep can pass while visiting nothing. The shared helper can return an empty array by design, but its caller compares against the exact non-empty expected mode set; the other sweeps use explicit mode lists and fail on missing controls.

The Shelf menu extraction preserves its classes and pointer behavior. `scripts/measure-cpu.ts` was inspected statically: its More-path lookup reports unreachable modes and exits nonzero rather than silently skipping them. I did not execute it because browser/loopback access was excluded.

The entrance guard, neutral `forwards` endpoint, non-modal Escape handling, Tooltip/Trigger composition, radio invariant, fit counts, and command-bar reachability revealed no further defect.

Checks:

- `tests/dock-more.test.tsx`: intended red, then **38/38 passed**
- `tests/dock-entrance.test.tsx`: **16/16 passed**
- `tests/doc-links.test.ts`: **18/18 passed**
- Shelf actions test, independently: **22/22 passed**
- `git diff --check`: clean

Changed files:

- `docs/project/experimental-features.md`
- `docs/project/interface-vision.md`
- `docs/project/mode.md`
- `docs/project/reading-view-overview.md`
- `src/web/Dock.tsx`
- `src/web/menu.ts`
- `tests/dock-more.test.tsx`

No commit was made.

VERDICT: approve with the changes I made