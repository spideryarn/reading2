# GPT Sol code review — 260929e, Trajectory: each pass walks only its new stops

You are reviewing uncommitted changes in this worktree (spideryarn2). You may edit files to fix
what you find, inside the scope below; report anything wider for me to decide. Do not run git
commands that change history or the index, do not touch the database, and do not start servers.

The plan, with your own plan review's findings (F1–F6) and how each was taken, is
docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md. Your plan review is
docs/plans/260929e-trajectory-plan-review-sol.md.

The change set (see it with `git diff HEAD -- <file>` and `git status`):

- src/web/trajectory-route.ts — `passRoute`, `passCount`, `offeredDepths` on any stop, `locate`
  (stop wins over depth), `firstStopOf`; `visibleRoute`, `countAt`, `currentStop` and
  `stopAfterDepthChange` removed.
- src/web/modes/trajectory/TrajectoryMode.tsx — uses `locate`; a depth change lands on the new
  pass's stop 1; rows lose `seen`.
- src/web/TrajectoryPanel.tsx — `seen` gone; `coverageNote` counts the whole route; the door's
  tooltip.
- src/web/styles/trajectory.css, src/types.ts, src/web/params.ts — comments and the `.seen` rules.
- tests/trajectory-route.test.ts, tests/trajectory-panel.test.tsx.
- docs/project/trajectory.md, keyboard.md, url-state.md.
- scripts/eval/trajectory-diversity.ts and the results under evals/results/ (measurement only).

**The conclusion I would least like to be wrong about:** that `locate` plus "a depth change lands
on stop 1" leaves no path where the band, the URL and the prose disagree — in particular: a
`?stop=` whose pass differs from `?depth=` followed by a step (only `stop` is written, so `depth`
stays stale in the URL), Back/Forward across a depth change, the arrival mailbox on opening the
mode, the door's `deeper`, a route where a pass is empty, and a stale route whose stop's quote is
missing (`blockOf` null) — does a depth press then refuse to move, and is that right?

Also look for anything else in src/ or tests/ that still assumes the passes nest on the client
(grep for `depth <=`, `≤`, "shallower", "seen", "keeps your place"), and whether the tests would
have failed against the old code.

Run `npx vitest run tests/trajectory-route.test.ts tests/trajectory-panel.test.tsx` and
`npm run typecheck` after any edit. Give numbered findings (F1…), each with severity (P0/P1/P2),
file and line, and what you changed or recommend. End with a verdict.
