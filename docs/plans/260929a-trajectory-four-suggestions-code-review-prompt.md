# Code review: plan 260929a — Trajectory opens on its stop, two end-of-pass doors, centred jumps, compact position mark

You are reviewing, and **fixing**, the code of one commit. Repo root is the current directory.

- The plan: `docs/plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md` — read § What we will build and § After the plan review (your own plan-review findings F1–F4 are in `docs/plans/260929a-trajectory-four-suggestions-plan-review-sol.md`; check they were actually addressed).
- The change: `git show fb21841f` (scope your review to that diff; `git show --stat fb21841f` lists the files).

**The conclusion I would least like to be wrong about:** that the *arrival anchor* in `src/web/scroll.ts` (`anchor`, `holdAnchor`, `onScrollWhileAnchored`, `arrivalAnchor`, and the change to `cancel` keeping `quietUntil` on a `settled` finish) is correct and safe for everything else that uses `scrollToBlock`, `glide` and `cancel` — the arrow keys, swipes, `scrollByScreen`, the `?at=` restore and re-flow re-anchor, `watchBarVisibility`'s use of the quiet window, the comment dialog — and that the anchor is never left set when the reader is somewhere else (so `?at=`, `measureRow`, `measureOrigin`, `whereIsBlock` never answer with a stale block). Look for: a path that moves the page without going through `cancel`; the trailing scroll event of an *instant* (reduced-motion / `"auto"`) move; the anchor surviving a mode switch or a re-flow; and whether keeping `quietUntil` after a settled glide changes the controls bar's behaviour in a way that matters.

Second: the opening-jump arming in `src/web/reader/Reader.tsx` (`poppedInto`, `modeBefore`, the `useLayoutEffect`) and `firstTrajectoryArrival` / the one arrival effect in `src/web/modes/trajectory/TrajectoryMode.tsx`. Does Back/Forward into Trajectory ever arm it? Does a press ever fail to arm it (nuqs defers its URL write ~50ms, so `location.href` at effect time may be the *old* address)? Does the layout effect really run before the freshly mounted band's passive effect?

Third: the doors (`doorAfter`, `DoorView`, `again`, `deeper`, `TrajectoryDoor`), ← on stop 1, the vertical position mark, and `alignedOffset`/`aimAt` (passage marks unioned by token, provisional aim).

What to do:

1. Fix what you find, inside the files this commit touched (and their tests). Keep the house style: comments that say why, in the surrounding voice. Add a failing-then-passing test for each bug you fix where a unit test can reach it.
2. Run `npx vitest run tests/trajectory-panel.test.tsx tests/trajectory-route.test.ts tests/scroll.test.ts tests/scroll-settlement.test.ts tests/scroll-glide.test.ts tests/reading-position.test.ts tests/begin-jump-flash.test.ts tests/jump-history.test.ts tests/return-chip.test.tsx tests/comment-jump.test.ts tests/spine-jump-origin.test.ts tests/term-jump-from-a-paragraph.test.tsx` and `npm run typecheck`, and say whether both pass.
3. Do not commit. Do not touch git state beyond editing files.
4. Report: numbered findings (F1…), each with severity (P0/P1/P2), evidence (file:line), and whether you **fixed** it or are **reporting** it for me to decide (anything wider than this diff, or a product call). Then the test and typecheck results.
