# Code review — 260929b stage 1 (Trajectory: list follows the stop, one door, promise tooltip)

Reviewer and fixer, narrowly; there is a deploy cutoff, so keep it tight. Candidate: commit
`16b8d1d7` on branch `worktree-trajectory-51-52-54` — its client half: `src/web/TrajectoryPanel.tsx`,
`src/web/modes/trajectory/TrajectoryMode.tsx`, `src/web/reader/Reader.tsx`,
`src/web/trajectory-route.ts`, `src/web/styles/trajectory.css`, `tests/trajectory-panel.test.tsx`,
`tests/trajectory-route.test.ts`, `docs/project/trajectory.md`. The spec is stage 1 of
`docs/plans/260929b-trajectory-deeper-passes-one-door-promise-in-a-tooltip-list-follows-the-stop.md`
and the Sol plan-review findings F1–F5 in its Progress. Do not touch *Plan it again* (another
session removes it). The prompt/eval half is out of scope.

Attack: (1) the list-follow (`useFollow` reused) — does it fire on every stop change and on the
band's return from `away`, never scroll the page, and not fight a reader scrolling the list?
(2) the removed `again()` — anything left dangling (keys, tests, docs, the deepest pass's end
line)? (3) the tooltip — keyboard, tap, Escape/outside dismissal, and does the head still fit at
420px (reason from the CSS)? (4) anything that reads the removed foot text (tests, docs).

Run `npx vitest run tests/trajectory-panel.test.tsx tests/trajectory-route.test.ts tests/follow.test.ts`
(check the names exist) and `node --import tsx scripts/typecheck.ts`. Fix inside stage 1, red-first;
report anything wider. Do not commit. Severity P0–P3; IDs from **F10**. Verdict: accept / accept
after fixes / reject. Short.
