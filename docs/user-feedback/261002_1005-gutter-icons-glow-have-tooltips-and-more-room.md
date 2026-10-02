---
reports: spya-jc0vm6
ending: shipped
---
# The gutter icons glow, have proper tooltips, and sit a little further apart

Report `spya-jc0vm6`, a problem, from Greg (admin), 2026-10-02, relayed by the Overseer with no
Sentry mirror, on `https://www.spideryarn.com/read/s41598-023-33209-9-spya-hxekgz?term=spya-y2tchy&mode=glossary&summary=brief&at=spya-s9358s`:

> Re the icons in the vertical gutter next to a block:
> - Problem: when I hover my mouse over the Bookmark icon, it doesn't glow
> - Make sure they all have tooltips
> - Also, please slightly increase the vertical gaps between them

**Ending: Shipped**, on `dev`. Plan
[261002e](../plans/261002e-mode-corner-icons-and-gutter-icon-polish.md).

What changed:

- **Glow.** The bookmark and the "…" had no hover colour; the other three each had their own.
  One rule now lights all five orange when you point at them (and on keyboard focus).
- **Tooltips.** Every icon had a browser `title`, which shows after about a second in the
  browser's own style. They now show the app's own tooltip, the same card the reading-time line
  uses, on hover and on keyboard focus. A tap on a phone still just presses the icon.
- **Gaps.** 4px more between icons: 13px of air between glyphs instead of 9. No paragraph gets
  taller. On a paragraph with just under the room for its next icon, that icon now folds behind
  the "…".
