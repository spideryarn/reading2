Verdict: **approve** after fixes.

What changed:

- [TouchSelectionChip.tsx](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:169): recorded ownership when a selection first becomes readable. A later unrelated `touchstart`, scroll, or repeated `selectionchange` can no longer promote mouse-selected words.
- [TouchSelectionChip.tsx](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/TouchSelectionChip.tsx:282): verified the listener only marks `finger.current`, exempts the chip, uses passive capture, and is removed on cleanup.
- [annotations.css](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/src/web/styles/annotations.css:1430): confirmed the arithmetic. When the room term wins:
  - bottom edge: chip top = words bottom + 80px
  - top edge: chip bottom = words top − 80px
  - the old docked offsets remain floors.
- [touch-selection-chip.test.tsx](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/tests/touch-selection-chip.test.tsx:548): strengthened geometry, mouse-ownership, chip-press, passive/capture/cleanup, and no-geometry tests. Every new test now goes red under a full production-code revert.
- [touch.md](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/docs/project/touch.md:878) and [the plan](/var/tmp/spideryarn-worktrees/fbkwcn4x-ipad-selection-chip/docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md:94): corrected stale docking descriptions, the exact floor condition, input ownership, and the erroneous `touchend`/`touchcancel` inventory.

Checks:

- Focused test: **30/30 passed**
- Typecheck: **passed**, all 3,840 source files covered. The requested npm wrapper hit sandbox `tsx` IPC `EPERM`; running the same script via `node --import tsx` completed successfully.
- `git diff --check`: passed
- Scoped lint: clean except an existing, unrelated descending-specificity warning at `annotations.css:1159`
- Full `npm test`: could not start because local Postgres was unavailable.

Not changed:

- The provisional 80px clearance; it still needs real-iPad validation.
- The unrelated lint warning and other untracked review/screenshot artifacts, because they are outside this change’s scope.
- No commit was made.