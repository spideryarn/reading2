# Review and fix: the spine's reading-time layer redrawn as an area chart

Repo: this worktree, branch worktree-fbjhe9mc-reading-time-area-chart. TypeScript, React, Vite, vitest.

## The candidate

Committed: commit dd80f1158 (one commit). `git show --stat dd80f1158` prints the manifest; `git diff dd80f1158^..dd80f1158` the diff.

Start with: src/web/reading-time.ts § readReach, src/web/spine-marks.ts § readingRuns and readingAreaPaths, src/web/Spine.tsx (search `spine-read`), src/web/useReadingTime.ts § recompute and withValue, src/web/styles/spine.css § reading time, src/web/reader/Reader.tsx § selectProse. Not the limit of scope; the manifest is.

## What it is meant to do

The plan is docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md, with your plan review's F1-F4 accepted in it. In short: one svg in the rail, a semi-opaque area from the left edge whose width is the block's reach in sixteenths, an opaque 1px line down its right edge, nothing drawn on unread stretches. `levels` (gutter hairline, quiz) must behave exactly as before. The svg must stay where the old divs were in the track's child order.

## What I want

An independent pass first. You may write: fix what is inside this stage, narrowly, with a test seen red first; report but do not fix anything wider. Run these yourself (none needs a network or a database):

  npx vitest run tests/reading-time.test.ts tests/spine-reading.test.ts tests/use-reading-time.test.tsx tests/spine-quote-strip.test.ts

Do not run the whole suite, do not commit, do not run git commands that change state.

Severity: P0 data loss/security; P1 user-visible wrong behaviour or a contract violated; P2 design/maintainability; P3 prose. Number findings from F5 (F1-F4 were the plan review's). Say for each whether it is established or reasoned, and whether you fixed it. Check the docs changed in the commit (docs/project/reading-time.md, colour-scales.md, the two Help sentences in src/web/help/help-topics.tsx) say what the code does. End with one line: VERDICT: land | land after fixes | do not land.

## My own suspicions (already mine; spend most of the run elsewhere)

- Three tests read source text (the selectProse dependency list, the CSS width rule, Reader passing `reach`) rather than behaviour. Are they worth keeping, and is there a cheap behavioural test instead?
- readingAreaPaths joins runs whose gap is under one document pixel. Can a real unread row be under a pixel tall and be bridged?
- `ReadReach` is a plain `number` alias.
- docs/project/reading-view-overview.md and experimental-features.md still say the spine is "thicker where you have spent longer".
