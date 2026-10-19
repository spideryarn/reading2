Code review, workspace-write: fix what you find inside this change's scope (src/web/TouchSelectionChip.tsx, src/web/styles/annotations.css § .touch-select-chip, tests/touch-selection-chip.test.tsx, docs/project/touch.md § A finger's selection gets a button, and the plan), and report anything wider for me to decide. Do not commit. Do not run git commands that discard work.

The plan: docs/plans/261019b-ipad-selection-chip-sits-near-the-words-and-a-finger-is-known-from-touchstart.md (read it, including § Review of this plan, which records your earlier plan review: docs/plans/261019b-ipad-selection-chip-plan-review-sol.md).

The change is `git diff HEAD` in this worktree (uncommitted). Run `npx vitest run tests/touch-selection-chip.test.tsx` and `npm run typecheck`.

Check in particular:
1. The CSS arithmetic for both edges with `--chip-room` (px from the words to the chosen viewport edge, measured against innerHeight) and the fixed `--chip-clear: 80px`: chip top = words bottom + 80px on the bottom edge; chip bottom = words top − 80px on the top edge; the old docked offsets as floors.
2. The `touchstart` listener: only sets `finger.current = true`, exempt on the chip, passive, capture, removed on cleanup. Any way it makes a mouse selection show the chip, or breaks pointerdown's hide, the grace logic, or the chip press.
3. Whether the new tests would go red if the change were reverted (each of them), and whether they test what their names say.
4. Doc accuracy: touch.md and the comments match the code.

Reply with a verdict (approve / changes needed), what you changed (file:line), and anything you did not change and why.
