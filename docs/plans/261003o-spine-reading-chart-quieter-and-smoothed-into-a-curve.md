# The spine's reading-time chart, quieter and smoothed into a curve

Up: [reading-time.md](../project/reading-time.md). Report `spya-bguwsn`, Greg, 2026-10-03, relayed
by the Overseer. It follows [261003j](261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md),
which drew the chart the same day.

> We recently added the cyan kind of horizontal levels to the spine to indicate what we've read. I
> wonder, well, firstly, I think the cyan is too opaque to visible somehow, so it kind of drowns
> other stuff out. Secondly, I was wondering, what if we were to smooth it a bit so it'd be a bit
> more like a curve and less like a bunch of blocks, like skyscrapers on a skyline.
>
> — Greg, 2026-10-03 (spya-bguwsn)

## What is there now

`readingAreaPaths` (spine-marks.ts) turns the runs into two path strings: one closed rectangle per
run for the area, and a step outline (`V`, `H`) for the edge. spine.css paints the area in
`--read-time` at `fill-opacity: 0.4` and the edge as a fully opaque 1px stroke. A block is two or
three pixels of rail, so neighbouring blocks at different reaches draw as a row of towers.

## What we build

Two changes, both small.

**1. Quieter.** `fill-opacity` 0.4 → 0.22 on the area, and `stroke-opacity: 0.7` on the edge. The
colour token does not change. The numbers are a first guess; the browser check, with the other marks
in view, decides them.

**2. A curve.** `readingAreaPaths` draws each read stretch (runs with no unread gap between them) as
one smooth outline instead of steps:

```
 before                 after
 |####|                 |###\
 |####|____             |####`-._
 |#########|            |########\
 |#########|            |########/
 |##|‾‾‾‾‾‾             |###.-'‾
 |##|                   |##/
```

- **Where two neighbouring runs differ**, the step becomes an S-shaped cubic from the upper run's
  reach to the lower one's, centred on the boundary. It starts and ends going straight down, so a
  long run of one reach still has a straight side.
- **At the top and bottom of a stretch**, the outline eases out from the left edge and back to it,
  inside the read run. It never enters an unread block, so an empty stretch of rail still means
  "not read".
- **How long an ease is**: either side of a boundary it reaches half the shorter of the two runs it
  joins, and never more than a hundredth of the document's height. That is 8px each side on an
  800px rail, so a whole join is 16px at most. The cap is what keeps a long
  run's reach honest: without it two long runs would be joined by one long slope. So
  `readingAreaPaths(runs, docHeight)` gains a second argument; Spine.tsx already has it for the
  viewBox.
- **The area is the same outline, closed.** One string builds both: `edge` is the open subpaths,
  `area` is each of them with `Z`. Today they are built separately.

Nothing else moves: `readingRuns`, `readReach`, the two svgs and their paint order, the half-pixel
inset, the token.

### What it gives up

A curve is less exact than steps. Where a much-read block sits beside a barely-read one, the ease
shows up to half of the barely-read block at more than its reach, and half of the much-read one at
less. That is what smoothing is. Between short blocks, two or three pixels of rail each, it is under two
pixels; between two long runs it is the cap, 8px each side.
261003j passed the curve over for this reason; Greg has now asked for it by name.

### Passed over

- **Only rounding the corners** (`stroke-linejoin: round`, or a small radius). Cheapest, but at a
  12px rail with 2–3px blocks the towers stay towers.
- **A smoothing filter over the reaches** (a moving average before drawing). It changes the amounts
  rather than the drawing, bleeds reach into unread blocks unless special-cased, and needs the
  unmerged per-block list rather than runs.
- **A spline through block centres** (Catmull-Rom, monotone cubic). Overshoots past the rail's side
  or needs clamping; the per-boundary ease cannot overshoot, because each cubic's control points
  share its end points' x.
- **A new colour.** He says too opaque, not the wrong hue.

## Stages

One stage. Done means: `tests/spine-reading.test.ts` rewritten for the new paths and seen red
against the old function first; `npm test` and typecheck; a GPT Sol code review; a browser check at
desktop, iPad and phone widths with before and after shots (`261003o-shot-*.png`).

## GPT Sol's plan review — build after fixes

[The review](261003o-spine-reading-chart-plan-review-sol.md). Three P2s.

- **F1 (established), accepted.** Joined runs may overlap or gap by under a pixel, so two eases each
  taking half a run could cross. Fix: the outline keeps the y it has reached and never goes back.
- **F2 (reasoned), not taken.** Sol would keep square ends on a stretch and curve only between read
  neighbours, because a taper across the rail adds stroke to an isolated block. Square ends are the
  skyline the report asks to lose, so the taper stays, and the browser check looked at exactly that:
  an isolated block is a small pointed bump, still visible. Sol's code review agreed on the shots.
- **F3 (established), accepted.** "A hundredth of the document" is each side of a boundary, so a
  whole join is twice that. Wording fixed above; the cap is kept.

## What landed

- As planned, with **the line at 0.8, not 0.7**: at 0.7 it was hard to follow inside the orange
  current-section fill. Three settings were compared in the browser (0.15/0.5, 0.22/0.7, 0.3/0.85);
  the choice is [Q-bguwsn-strength] in
  [the note](../user-feedback/261003_1927-spine-reading-chart-quieter-and-a-curve.md).
- **GPT Sol's code review — land after fixes**
  ([the review](261003o-spine-reading-chart-code-review-sol.md)). It fixed four things: a
  zero-height run drew a horizontal stroke (F4; production never sends one, since a folded row has
  no reach row, but the function accepted it); no test noticed the opacities being put back (F5);
  stale "opaque line" wording (F6); a lint error in the test (F7).
- **Browser check** at 1440, 820 and 390 wide in dark, and the desktop rail in light, on a seeded
  article: the other marks read more clearly; read and unread still tell apart; the edge is whole at
  full reach; stretch ends taper and nothing is drawn in a gap. Shots: `261003o-shot-before-*.png`
  and `261003o-shot-after-*.png`.
- **A dip that is data, not a fault.** In the seeded "all saturated" stretch the line dips halfway
  in places. Those are blocks of one to three words: the seed gave them 3.5 times an unfloored
  reading time, and a block's reading time is never under a second, so they come out at reach 9 to
  15. Sol computed the same numbers.
- **Where read and unread blocks alternate one by one, the line is a comb**: each lone block tapers
  out and back. Seeded data does that; reading does not much. Left as it is.
- Not checked: Safari or a real iPad; light theme at iPad and phone widths; real reading data.

## The tests

Tests pin, without copying the whole string where a property says it better: no `H` in either path;
every y inside its stretch; a long single run has a straight `V` side at its reach; an unread gap
gives two subpaths; the ease is capped; `area` is `edge` with each subpath closed; and no x outside
0…16.
