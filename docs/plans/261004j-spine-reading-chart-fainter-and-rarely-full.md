# The spine's reading-time chart, fainter and rarely full

Up: [reading-time.md](../project/reading-time.md). Greg, 2026-10-04, relayed by the Overseer. It
follows [261003o](261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md), which made the
chart a quiet curve the day before.

> Spine reading chart make the cyan horizontal-reading-level slightly fainter. and also somehow make
> it a bit logarithmic so it's rarer that the reading-time fills up completely all the way to the
> right
>
> — Greg, 2026-10-04

## What is there now

`readReach` (reading-time.ts) gives each block a width in sixteenths of the rail. It is already a
logarithm, but a short one: it starts at 4 when the time spent is 0.35 of the block's reading time
and is full, 16, at 2.8 of it, three doublings later. Those are the gutter line's four levels, made
four times finer. spine.css paints the area at 0.22 and its edge line at 0.8.

## What Greg's reading looks like

Read from production, read-only, on 2026-10-04: every `reading_time` row joined to its block's word
count in the article's current revision. 1,220 passages over 22 articles, all one owner's; 18 more
rows belong to blocks no longer in a current revision and were left out.

- 595 of the 1,220 are drawn at all (0.35 of the reading time or more).
- Of those 595, **255 (42.9%) are at full width**. By article (the 13 with 20 or more drawn
  passages) the share runs from 21% to 67%.
- The time spent is spread roughly evenly on a log scale from 0.35 to about 30 times the reading
  time, with a tail to 168. Quantiles of the drawn passages, as multiples of the reading time:
  median 2.0, 75% 6.9, 90% 18.7, 95% 30.8, 97% 41.4, 99% 66.

For the goal of only a few percent of drawn blocks being full in this sample, the scale fills too
soon. A longer logarithmic range preserves the existing shape while meeting that goal.

## What we build

**1. A longer logarithm.** The reach still starts at 4 at 0.35 of the reading time, where the gutter
line starts. It is full at **seven doublings of that, 44.8 times the reading time**, and each of the
twelve sixteenths between is the same multiple of time (2^(7/12), about 1.5).

| time spent, as a multiple of the reading time | before | after |
| --- | --- | --- |
| 0.35 | 4 | 4 |
| 1 (one read at the expected pace) | 10 | 6 |
| 2.8 | 16 | 9 |
| 10 | 16 | 12 |
| 40 | 16 | 15 |
| 44.8 and over | 16 | 16 |

On the same 595 passages: **16 (2.7%) at full width**, 32 (5.4%) at 15 or 16, and no article over
11%. The thirteen widths hold 58, 65, 81, 75, 52, 46, 45, 49, 38, 32, 22, 16 and 16 passages, where
before they held 17 to 41 each and then 255.

The scale is one named function, `readReach`, with its two ends as named constants
(`READ_REACH_FROM`, `READ_REACH_FULL`). The steps are a table of thresholds rather than
`floor(log2(…))`, so a boundary is a comparison and cannot round a step ahead.

**2. Fainter.** Area 0.22 → **0.18**, line 0.8 → **0.65**: between 261003o's option A, which Greg
chose, and its option B (0.15 and 0.5). The browser check decides whether those stand.

### What it gives up

**The rail and the gutter line no longer run on one scale.** Before, a block's gutter level was
always its reach's quarter, so a full-strength hairline beside a paragraph meant a full rail. Now
they agree only on whether anything is drawn. The gutter's levels are not changed: the quiz's "read"
is one of them, and Greg asked about the rail.

**This is a calibration of recorded block ratios, not proof of repeated reading.** A passage left
on screen during thought or revisited could reach the tail, but the supplied histogram cannot tell
why it did. It has no word counts or block types: the tail could instead be dominated by headings
or figures whose expected time is floored at one second. A breakdown by word count and block type
would distinguish those explanations. Seven doublings meets the width goal in this one owner's
sample; it does not establish that the same proportions hold for other readers or for prose alone.

The histogram totals 595: bins k ≥ 12 contain 255 (42.857%), and k ≥ 28 contain 16 (2.689%). Near
full (reach 15 or 16) starts at about 29.9004 times the reading time, inside bin 25. The histogram
therefore only bounds that count at 29–37 (4.9–6.2%); the reported raw-row count of 32 (5.4%) is
consistent, but cannot be recovered exactly from these bins. Six doublings would leave 47/595
(7.9%) full, eight 4/595 (0.7%); seven is a defensible middle choice for this sample.

**The word-count breakdown, which the reviewer did not have.** The first production query also
counted blocks under 8 words in each bin. Of the 16 passages still at full width, 10 are under 8
words; of all 595 drawn, about 180 are. So the far tail is mostly headings and other short blocks,
whose expected time is floored at a second, and a full rail after this change will most often be a
heading its reader sat under. That is the floor in `expectedSeconds` doing what its comment says,
and it is not changed here.

### Passed over

- **A square root or `1 − exp(−t/k)`.** Both squash the low end, where most passages are: with
  either, a single read and three reads are a pixel apart on a 12px rail. The logarithm spreads the
  real distribution almost evenly across the widths.
- **Scaling to the article's most-read passage.** reading-time.md already says why not: one
  paragraph stared at makes the rest look unread.
- **Moving the gutter's levels too**, to keep one scale. Not asked for, and it would move the quiz's
  boundary.
- **Widths finer than sixteenths.** A 12px rail cannot show them.

## Stages

One stage. Done means: `tests/reading-time.test.ts` rewritten for the new scale and seen red against
the old function first; `npm test` and typecheck; a GPT Sol code review; a browser check at desktop
and phone widths with before and after shots (`261004j-shot-*.png`).

No plan review: the Overseer's brief for this small job asks for the code review only.

## The tests

`readReach`: nothing under 0.35; 4 at 0.35; 16 only from 44.8, and 15 at the double just under it;
one read is 6 and the old full width is 9; every step mid-step; never goes back as time passes;
drawn exactly when `readLevel` is above 0, including the doubles either side of the start.
`tests/spine-reading.test.ts` pins the two opacities, so putting them back is noticed.

Seen red first: six tests failed against the old function and the old opacities.

## GPT Sol's code review — land after fixes

[The review](261004j-spine-reading-chart-code-review-sol.md). No P0 or P1.

- **F1 (established), not taken.** `readReach(1, NaN)` is 16 and a word count near the largest
  double overflows. Both are `expectedSeconds`' and older than this change; `words` is a non-null
  integer column, so neither can arrive.
- **F2 (established), fixed by Sol.** No test noticed an interior step moving by one double. Each
  of the eleven is now pinned by a literal, below, at and above.
- **F3 (established), fixed by Sol.** `readLevel` spelt 0.35 itself; it now uses `READ_REACH_FROM`.
- **F4 (reasoned), accepted.** "Is what the data says" claimed a cause the histogram cannot show.
  Sol reworded it; the word-count breakdown above is the missing evidence.
- **F5 (established), fixed by Sol.** Three stale phrases.

Sol recomputed 255/595 and 16/595 from the histogram and agrees.

## The browser check

A Sonnet subagent, Playwright on the box, dark theme, 1440 and 390 wide, on a local article of 427
blocks. "Before" was the primary checkout's dev server (0.22 and 0.8 read back from the page),
"after" this worktree's (0.18 and 0.65).

- **Real pattern**: one production article's ratios in block order (numbers only), stretched over
  the local article. 131 blocks drawn; at full width 38 (29%) before and 5 (3.8%) after.
- **Ladder**: stretches at 0.4, 1, 2.8, 6, 12, 25, 45 and 100 times the reading time. Before they
  drew at 4, 10 and then 16 for every other step; after, 4, 6, 9, 11, 12, 14, 16, 16. The full
  step is not clipped at the rail's side.
- **Opacity**: 0.15/0.5, 0.18/0.65 and 0.22/0.8 side by side in
  `261004j-shot-opacity-options.png`. 0.18/0.65 stands: fainter than before against the part
  tints and the ticks, and the line can still be followed through the orange section fill; at
  0.15/0.5 the line starts to go.

Shots: `261004j-shot-{before,after}-{desktop,phone}-{real,ladder}.png`,
`261004j-shot-compare-{desktop,phone}.png`. Not checked: light theme, Safari, a real iPad, and a
real article with its own real times (the pattern is real, the article is not).
