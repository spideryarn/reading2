# Code review — Trajectory stage 5-i (plan 260928a)

You are the stage's reviewer **and fixer**. Candidate: commit `71256d78` on branch
`worktree-trajectory-flash-position-0928` (its parent `fffa54cc` is plan-only). Changed paths:
`git show --stat 71256d78`. Start with `src/web/modes/trajectory/TrajectoryMode.tsx`,
`src/web/useTrajectory.ts`, `src/web/trajectory-route.ts` (`positionOf`), `src/web/TrajectoryPanel.tsx`,
`src/web/flash.ts`, `src/web/Dock.tsx`, `src/web/styles/trajectory.css`, and the tests — but do not
limit yourself to them.

The spec is the plan's "Stage 5" section, including 5-i in "How stage 5 lands" and the Sol plan-review
ledger (F28–F36) in `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md`. 5f
(promotion) and 5g (not built) are out of scope. Stage 6 is out of scope.

**Fix what is inside this stage**, narrowly and red-first (a test that fails before your fix). **Report,
do not fix**, anything wider. Do not commit. Do not touch `scripts/trajectory-coverage.ts` or the
stage-6 baseline doc (another piece of work). You can run a test file yourself:
`npx vitest run tests/trajectory-panel.test.tsx tests/trajectory-route.test.ts tests/modes-that-start-themselves.test.tsx tests/dock-mode-order.test.ts`
and `npm run typecheck` (read its exit code). You have no network, so nothing needing Postgres.

Attack in particular:

1. Every movement path flashes exactly once, at the right block, only when the scroll settles; no
   stale held flash surfaces later; a depth change that keeps the stop does not flash; the deep-link
   one-shot cannot fire twice (StrictMode, re-renders, the route loading after the blocks, a later
   change of `?stop=` by stepping) and cannot fire for a stop that fell back to the first.
2. `quotesFirst` with stale Quotes: does the server's `stepIsDone` for `quotes` actually treat stale
   Quotes as not done, so the preceding unforced step re-runs? (src/pipeline.ts, src/jobs.ts.) If not,
   the fix is a no-op — say so with evidence.
3. `regenerate` with `{ force: true, precededBy: ["quotes"] }`: does the force reach only `trajectory`?
4. `positionOf` correctness and cost (it runs per row per render?), and the track's accessibility.
5. The Dock order change: anything else that assumed the old order (command bar, narrow-bar fit
   ladder `keepLabel`, tests).

Severity: P0 data loss / security / incorrect charging / broadly unusable; P1 user-visible wrong
behaviour or contract violated; P2 design risk; P3 prose. IDs from **F37**. For each: severity,
evidence (file:line), and whether you fixed it (with the red→green test) or are reporting it. End with
a verdict: accept / accept after fixes / reject.
