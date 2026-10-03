---
reports: spya-kd5dk5
ending: shipped
---
# The block's gutter icons move to the right of the block

Report `spya-kd5dk5`, a suggestion, from Greg (admin), 2026-09-29, relayed by the Overseer as queue
item `qi-crm2g6dr`, on `https://www.spideryarn.com/read/bf03197835-spya-qfwsw2?mode=structure&at=spya-v853r9&diagram=illustrated`:

> For the icons currently to the left of the block (e.g. Permalink, Comment, Question, etc)
> - Let's try moving them to the right-hand-side of the block
> - Add a slightly bigger vertical gap between each of them

**Ending: Shipped**, on `dev`. Plan
[261003c](../plans/261003c-block-gutter-icons-move-to-the-right-of-the-block.md), which has the
before-and-after screenshots.

What changed:

- **The gap** had already shipped on 2026-10-02 for `spya-jc0vm6`, which asked the same thing
  ([261002_1005](261002_1005-gutter-icons-glow-have-tooltips-and-more-room.md)): 13px between
  icons instead of 9. Not widened again.
- **The icons are on the right of each paragraph now.** The reading cell's padding swapped sides,
  so the text does not get narrower. On a phone the text starts about 21px further left and ends that
  much sooner.
- **Marginalia** (`?margin=1`) does not conflict: its notes start past the cell's edge, so the order
  across the page is text, icons, note, with at least 25px between the icons and a note's words.
- **A heading's fold chevron** stays at the end of the heading line, and the heading's icons start
  just past it.
- **A gap that was already there, fixed on the way.** Since the author's typeface became everyone's
  on 2026-10-02, the icons had been sitting 88px away from the text at 1440 (on the left, before
  this). They are now 5.6px away at every width. The same mistake had put the article's title 72px
  left of its first line; it is now within 10px. Footnotes and the in-prose quiz had the same fault
  and are fixed too.
