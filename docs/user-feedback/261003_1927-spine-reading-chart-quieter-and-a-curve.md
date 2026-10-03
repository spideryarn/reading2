---
reports: spya-bguwsn
ending: shipped
---
# The spine's reading-time chart, quieter and a curve

Report `spya-bguwsn` (Sentry confirmed), a suggestion, from Greg (admin), 2026-10-03 19:27 UTC, from
Structure mode on `/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, relayed by the
Overseer:

> We recently added the cyan kind of horizontal levels to the spine to indicate what we've read. I
> wonder, well, firstly, I think the cyan is too opaque to visible somehow, so it kind of drowns
> other stuff out. Secondly, I was wondering, what if we were to smooth it a bit so it'd be a bit
> more like a curve and less like a bunch of blocks, like skyscrapers on a skyline.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261003o](../plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md). The rule now
lives in [reading-time.md](../project/reading-time.md).

## What changed

- **Quieter.** The cyan area is about half as strong as it was, and the line down its edge is
  slightly see-through instead of solid. The section ticks, the part tints, the orange "you are
  here" fill and the search marks all show more clearly through it.
- **A curve.** The outline no longer steps at every paragraph. It eases from one paragraph's amount
  to the next, and eases in and out at the two ends of a stretch you have read. A stretch you have
  not read still has nothing drawn in it.

Before and after, at 3x: [before](../plans/261003o-shot-before-desktop-rail.png),
[after](../plans/261003o-shot-after-desktop-rail.png). The other `261003o-shot-*.png` files are the
whole view at desktop, iPad and phone widths, and a light-theme rail.

## What was checked

`tests/spine-reading.test.ts`, red against the old drawing first. A browser check in Chrome on the
box at 1440, 820 and 390 wide, dark theme, and the desktop rail in light. GPT Sol reviewed the plan
and the code.

**Not checked**: Safari or an actual iPad; the light theme at iPad and phone widths; real reading
data (the check used seeded amounts, which jump about more than real reading does).

## Question for Greg

### [Q-bguwsn-strength] Is it now quiet enough, or too quiet?

The strength is two numbers, picked by eye against the other marks on one article. Three settings
were tried side by side:

- **A. As built**: area 0.22, line 0.8. The other marks read clearly; read and unread still tell
  apart at a glance. Inside the orange "you are here" fill the line is the weakest it gets, but can
  be followed.
- **B. Fainter**: area 0.15, line 0.5. Hardly there. The line is hard to follow in the orange
  section, and read versus unread takes a second look.
- **C. Stronger**: area 0.3, line 0.85. Easier to read, and some of the loudness comes back.

Recommendation: **A**. It is one line of CSS either way, so say "fainter" or "stronger" after a day
with it.
