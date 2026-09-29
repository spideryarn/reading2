# GPT Sol plan review — 260929e, Trajectory: each pass walks only its new stops

You are reviewing a plan in the spideryarn2 repo, read-only. Read:

- the plan: docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md
- the measurement script and its output: scripts/eval/trajectory-diversity.ts,
  evals/results/trajectory-diversity-2026-09-29T13-11-37-091Z.json
- the code it changes: src/web/trajectory-route.ts, src/web/modes/trajectory/TrajectoryMode.tsx,
  src/web/TrajectoryPanel.tsx, src/web/stop-card.ts, tests/trajectory-route.test.ts,
  tests/trajectory-panel.test.tsx
- the vision doc: docs/project/trajectory.md, and the earlier eval
  docs/plans/260929b-trajectory-stage2-deeper-passes-eval.md

**The conclusion I would least like to be wrong about:** that the between-level repeats Greg
reported are structural (nested passes), so a client-only change to the walk — each depth walks
only the stops with exactly that depth — answers his report, with no prompt change. Check whether
that is true, and whether there is a cheaper or better way to answer "diversity within levels" that
the plan dismisses too quickly.

Also check:

1. The depth-change landing rule (always stop 1 of the new pass, and a link's `?stop=` wins over its
   `?depth=`): any history, URL or arrival interaction in TrajectoryMode.tsx that breaks (the
   arrival mailbox, `?stop=` links, Back/Forward, `stopAfterDepthChange` callers, the door's
   `deeper`).
2. Anything else that assumes nesting: counts, `offeredDepths`, `effectiveDepth`, `coverageNote`,
   the stop card's "also at stop k", keyboard, the url-state docs, tests.
3. Whether the measurement script's numbers are right — the table in the plan against the JSON.

Give numbered findings (F1…), each with a severity (P0/P1/P2), the file and line, and the change
you recommend. End with a verdict: approve, approve with changes, or rethink.
