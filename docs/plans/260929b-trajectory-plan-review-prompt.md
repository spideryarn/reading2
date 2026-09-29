# Plan review — 260929b (Trajectory: deeper passes, one door, promise in a tooltip, list follows)

Read-only: do not change any file. The plan is
`docs/plans/260929b-trajectory-deeper-passes-one-door-promise-in-a-tooltip-list-follows-the-stop.md`
(uncommitted in this worktree; there are no other changes). Greg's reports are quoted in it.

Start with `src/web/TrajectoryPanel.tsx`, `src/web/modes/trajectory/TrajectoryMode.tsx`,
`src/web/trajectory-route.ts`, `src/web/reader/Reader.tsx` (where the door and keys are wired),
`src/trajectory.ts` (the prompt), `docs/project/tooltips.md`, `docs/project/trajectory.md`,
`docs/project/prompting-guide.md`, `scripts/eval/trajectory-coverage-eval.ts`.

Attack, briefly — this is a small plan with a tight clock:

1. Stage 1: is anything in it false about the code? For 54, is a direct `scrollTop` on the list's
   scroller right (which element actually scrolls — `.tl-scroll`, the ModeSurface body?), and does
   it fight the band stepping aside on a narrow window or the page scroll? For 51b, what else uses
   `again()` / the "end" door; what does the end of the deepest pass show? For 52, is there a house
   tooltip that works on touch and keyboard, and where in the head should it go?
2. Stage 2: is the instruction likely to work without breaking nesting (a deeper pass *contains*
   the shallower one), and is the measurement sound and affordable? Anything simpler?

Severity P0–P3; IDs from **F1**; evidence as file:line; a concrete fix each. Verdict: approve /
approve with changes / rethink. Keep it short.
