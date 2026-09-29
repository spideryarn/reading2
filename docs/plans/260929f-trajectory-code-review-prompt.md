# GPT Sol code review — 260929f, Trajectory snippets in place, a sparkline, a where-card

Review the uncommitted changes in this worktree and fix what you find inside their scope; report
anything wider. Do not run git commands that change the index or history, do not touch the
database, and do not start servers.

The plan, with your plan review's findings and how each was taken, is
docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md; your review is
docs/plans/260929f-trajectory-plan-review-sol.md. See the change with `git status` and
`git diff HEAD -- <file>`:

- src/web/where.ts, src/web/WhereCard.tsx, tests/where.test.ts — the outline fisheye.
- src/web/route-spark.ts, tests/route-spark.test.ts — the sparkline's geometry.
- src/web/TrajectoryPanel.tsx — `RouteSpark` in the head, `OpenSnippet` state in the panel,
  `StopQuestions` above the current row, `StopCardView` with term and idea chips, `OpenIn` icon
  buttons, the `.traj-where` button over each row's position mark.
- src/web/stop-card.ts — `statement`, `CardPassage`, `{ kind: "faq" }`, `modeForCardTarget`.
- src/web/modes/trajectory/TrajectoryMode.tsx — `placeOf`, each row's `where`.
- src/web/reader/Reader.tsx — the FAQ link.
- src/web/styles/trajectory.css; tests/trajectory-panel.test.tsx, tests/stop-card.test.ts.
- docs/project/icons.md, docs/project/trajectory.md.

**The conclusion I would least like to be wrong about:** that the three new controls on a row —
the FAQ question above it, the where-button laid over its position mark, and the icon buttons in an
opened snippet — never press the row, never nest inside its button, and leave the band's existing
behaviour alone: the words tooltip on `.traj-go` (controlled, mouse-only), the list's follow-scroll,
the keys, and the visitor band (`access.kind === "visitor"`, where `canOpen` may refuse). Also: is
the `.traj-where` overlay's absolute position robust (it assumes the mark sits about 1.25rem below
the top of `.traj-line`), and is `whereForBlock` cheap enough to run for up to 36 rows on every
render of the rows memo?

Run `npx vitest run tests/trajectory-panel.test.tsx tests/stop-card.test.ts tests/where.test.ts
tests/route-spark.test.ts` and `npm run typecheck` after any edit. Numbered findings (F1…), each
with severity, file and line, and what you changed or recommend. End with a verdict.
