# Review: a plan to redraw the spine's reading-time layer as an area chart

Repo: this worktree, branch worktree-fbjhe9mc-reading-time-area-chart. TypeScript, React, Vite. Read-only review: change no file.

## The candidate

Live pre-commit: one untracked file, docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md. Nothing is built yet.

Start with: that plan; then src/web/Spine.tsx (search `spine-read`), src/web/spine-marks.ts § readingRuns, src/web/reading-time.ts, src/web/useReadingTime.ts, src/web/styles/spine.css § reading time, tests/spine-reading.test.ts, docs/project/reading-time.md. Not the limit of scope.

## What it is meant to do

An admin's feedback report (quoted in the plan) says the spine's reading-time display cannot be read, and asks for a rotated area chart: distance from the left margin is time spent, semi-opaque colour, a visible line. The plan is the simplest version of that inside the existing 12px rail.

## What I want from you

An independent pass first. Is the plan the simplest version that gets most of the value? Is anything in it wrong about the existing code? Is anything going to break: the paint order, the SVG with preserveAspectRatio none over a very tall viewBox, re-render cost, the quiz or gutter that read `levels`, tests that name `.spine-read` or `readingRuns`? Is the reach formula consistent with readLevel at every boundary, floating point included?

Severity: P0 data loss/security; P1 user-visible wrong behaviour or a contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID F1, F2, ... and say whether it is established (direct evidence) or reasoned. End with one line: VERDICT: build as planned | build after fixes | do not build.

## My own suspicions (already mine; spend most of the run elsewhere)

- floor(4*log2(ratio/0.175)) at ratio exactly 0.35, 0.7, 1.4, 2.8 may land one short through floating point.
- Whether the layer should stay under `.spine-here`.
