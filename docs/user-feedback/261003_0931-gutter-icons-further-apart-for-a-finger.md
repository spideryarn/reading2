---
reports: spya-kwgem6
ending: shipped
---
# The gutter icons sit further apart, for a finger

Report `spya-kwgem6`, a suggestion, from Greg (admin), 2026-10-03, relayed by the Overseer (Sentry
event `898582de67ab45dfac1182dc32ffaae5`), on the Entropy article in Summary mode:

> Please, can we slightly increase the vertical gap between the icons in the gutter next to a block,
> you know, the permalink and the comment and the question. I feel like I've asked this at least once
> before. It's just a little bit hard to touch them with a finger on an iPad.

**Ending: Shipped**, on `dev`. Plan
[261003h](../plans/261003h-four-small-ui-fixes-gutter-gap-glossary-card-row-keyboard-dismiss-voucher-form.md).

He had asked before, twice ([261002_1005](261002_1005-gutter-icons-glow-have-tooltips-and-more-room.md),
[261003_0251](261003_0251-gutter-icons-move-to-the-right-of-the-block.md)), and the 4px that
answered it was already live when he wrote this. So this is a second widening:

- **8px between icons instead of 4px.** 17px of air between two glyphs (it was 13px), and 32px from
  the middle of one target to the middle of the next (it was 28px). For everyone, not only on touch.
- **No paragraph gets taller, and an ordinary paragraph shows the same icons as before.** Measured
  in a browser on 72 paragraphs at desktop, iPad and phone widths.
