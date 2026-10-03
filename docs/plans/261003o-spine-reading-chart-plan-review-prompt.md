# Review: a plan to make the spine's reading-time chart quieter and curved

Repo: this worktree, branch worktree-fbbguwsn-spine-reading-chart-softer. TypeScript, React, Vite. Read-only review: change no file.

## The candidate

Live pre-commit: one untracked file, docs/plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md. Nothing is built yet.

Start with: that plan; then src/web/spine-marks.ts (readingRuns, readingAreaPaths), src/web/Spine.tsx (search spine-read), src/web/styles/spine.css (the reading time section), tests/spine-reading.test.ts, docs/project/reading-time.md, and the earlier plan docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md. Not the limit of scope.

## What it is meant to do

An admin's feedback report (quoted in the plan) says the cyan chart is too opaque and drowns other marks, and asks for it to be smoothed into a curve rather than blocks. He asked for the simplest version that gets most of the value.

## What I want from you

An independent pass first. Is this the simplest version? Is anything in the plan wrong about the existing code? Will the geometry work: cubic eases in an svg with preserveAspectRatio none, a viewBox 16 wide and tens of thousands tall, non-scaling-stroke; an ease at the top and bottom of a stretch; a run shorter than two eases; runs joined within SAME_STRETCH_PX; the stroke at x = 0 and x = 16? Is the cap (a hundredth of the document height) sensible, or is there a simpler honest rule? Does anything else read the path strings or the function's signature?

Severity: P0 data loss/security; P1 user-visible wrong behaviour or a contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID F1, F2, ... and say whether it is established (direct evidence) or reasoned. End with one line: VERDICT: build as planned | build after fixes | do not build.

## My own suspicions (already mine; spend most of the run elsewhere)

- An isolated single read block becomes a small bump whose peak may be a point rather than a flat top.
- The edge now touches x = 0 at each stretch's ends, where the quote strip also is.
