# Plan review: Trajectory opens on its first stop, two end-of-pass doors, centred jumps, compact position mark

You are reviewing a plan, read-only. Do not edit files. Repo root is the current directory.

The plan: `docs/plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md`.
Read it first, then the code it touches:

- `src/web/modes/trajectory/TrajectoryMode.tsx` (the band's controller, `arrive`, `moveTo`, the deep-link one-shot, `TrajectoryControl`)
- `src/web/trajectory-route.ts` (`stepStop`, `stopAfterDepthChange`, `doorAfter`) and `tests/trajectory-route.test.ts`
- `src/web/TrajectoryPanel.tsx` (`TrajectoryDoor`, `StopPosition`, `RouteHead`) and `src/web/styles/trajectory.css`
- `src/web/scroll.ts` (`scrollToBlock`, `aimAt`, `glide`, `stickyDestination`, `dockOffset`), and `docs/postmortems/260928c-a-scroll-aimed-at-a-pixel-not-at-the-element.md`
- `src/web/keynav.ts` (`beginJump`, `measureOrigin`, `readingLine`), `src/web/flash.ts`
- `src/web/reader/useReadingPosition.ts` (`jumpTo`, the `?at=` tracker) and `src/web/position.ts` (`positionToWrite`)
- `src/web/ReturnChip.tsx`, `src/web/jump-history.ts`, `src/web/reader/Reader.tsx` (search for `trajectoryArrival`, `afterBlock`, `trajectoryKeys`)

What I want from you, as numbered findings (F1, F2, …), each with severity (P0 blocks the plan / P1 should change the plan / P2 worth noting), the evidence (file:line), and what you would do instead:

1. **The finding I would least like to be wrong about: centring (§ 3).** Is "centre inside `aimAt`, per frame, fall back to top when taller than the free area" correct with the bar that hides on downward scroll (`stickyDestination` vs `stickyOffset`), the dock, and `glide`'s 200ms chase cap? Does centring break anything that reads the reading line after a jump — `measureOrigin` for the *next* jump's chip, `positionToWrite` rewriting `?at=`, `isBlockOnScreen` / `whereIsBlock`, `beginJump`'s "already there" check (it compares `measureOrigin` to the target: after a centred jump, the reader is "at" the block above, so a second press on the same link would jump again rather than flash — is that a problem)? Is my "known cost, accepted for v1" honest and small, or does it need fixing now?
2. Measuring the passage's marks (`mark.hit[data-hit=…]`) rather than the block row when a passage key is given — sound? Any case where marks exist in two places (e.g. gist columns) or are split across blocks?
3. **The opening jump (§ 1).** Is a one-shot ref in the band the right place, given `Reader.tsx` owns the deep-link token above the mode boundary and mode switches remount the band? Any double-fire (StrictMode, route arriving after Quotes, stale `?stop=`), or a fire that pushes a history entry the reader did not ask for in a way that breaks Back? Is jumping to the *current* stop (not literally stop 1) when `?stop=` survives a mode switch the right reading?
4. **The doors (§ 2)**: dropping the going-round branch of `stopAfterDepthChange` — anything else depend on it? Is "More detail" landing on stop 1 of the deeper pass (rather than the first new stop) consistent with Greg's words? History semantics (again = replace, deeper = push) right?
5. Anything in the plan that is wrong about the code as it is, and any simpler design I passed over.

Be concrete and brief. Findings only; no preamble.
