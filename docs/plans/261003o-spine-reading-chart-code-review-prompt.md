# Code review: the spine's reading-time chart, quieter and curved

Repo: this worktree, branch worktree-fbbguwsn-spine-reading-chart-softer. TypeScript, React, Vite.

You may fix what you find **inside this stage's files** (listed below) and must report anything wider for me to decide. Do not commit, do not run git commands that change anything, do not touch files outside the list. Do not run the full test suite; `npx vitest run tests/spine-reading.test.ts` is the focused one.

## The candidate

Live pre-commit, uncommitted in the working tree. `git diff HEAD -- src/web/spine-marks.ts src/web/Spine.tsx src/web/styles/spine.css tests/spine-reading.test.ts docs/project/reading-time.md` is the scoped diff. The plan is docs/plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md (untracked), and your own plan review is docs/plans/261003o-spine-reading-chart-plan-review-sol.md.

## What it is meant to do

An admin's feedback report (quoted in the plan): the cyan reading-time chart on the spine is too opaque and drowns the other marks, and should be smoothed into a curve rather than steps. So: `readingAreaPaths(runs, docHeight)` now draws each read stretch as one outline of cubic eases; the area is the same outline closed; the area's fill-opacity is 0.22 and the edge's stroke-opacity 0.8.

## What happened to your plan findings

- F1 (eases overlapping when joined runs' edges disagree): the outline tracks the y it has reached and never moves back (`down`, and `Math.max(y, …)` on each ease's end). Three tests, one of them seen red with the clamp removed.
- F2 (tapering to zero at stretch ends may be louder, extra scope): kept. The browser check looked at an isolated block (a small pointed bump, still visible) and at stretch ends (a smooth taper, nothing in the gap), and the reporter asked for less skyline; square ends are the skyline. Say if you think that is wrong on the evidence.
- F3 (cap is a half-span): wording fixed in the plan and the constant's comment; the cap itself kept.

## Evidence

- tests/spine-reading.test.ts: 22 pass. It was red (8 failures) against the old step function before the change.
- Browser check, Playwright on this box, 1440, 820 and 390 wide, dark and light: before and after shots are docs/plans/261003o-shot-before-*.png and 261003o-shot-after-*.png (the after shots were taken with the edge at 0.7; it is 0.8 now because the line was weak inside the orange current-section fill).
- One thing that looked like an artefact in the check and I believe is data: near the end of the seeded saturated stretch the edge dips to about half and returns. The seed gives every block 3.5× its reading time, but reading time is never under a second (reading-time.ts), so a block of a few words ends up near reach 8. Check that reasoning against reading-time.ts § readReach rather than taking it from me.

## What I want from you

An independent pass first. Then: is the path geometry right for every input `readingRuns` can produce (zero-height folded rows, sub-pixel gaps and overlaps, a single run, hundreds of runs)? Does any ease leave its stretch or the 0…16 rail? Is the `useMemo` dependency change in Spine.tsx right? Do the tests pin the behaviour or just restate the implementation; is there a mutation they would miss? Are any comments or docs now false (search for "step", "steps sideways", "rectangle")? Is my conclusion on F2 supported?

Severity: P0 data loss/security; P1 user-visible wrong behaviour or a contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID F4, F5, … and say whether it is established or reasoned, and whether you fixed it. End with one line: VERDICT: land as is | land after fixes | do not land.
