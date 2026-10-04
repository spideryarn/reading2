---
reports: spya-ft2cgg
ending: shipped
---
# The headings rail uses the width above an open mode

One report from Greg, filed 2026-10-03 from an iPad in landscape, relayed by the Overseer as an
admin's report (queue item `qi-53x37gaw`). Proven from the production row with
`feedback-reporter.ts --report-id` (exit 0). SPIDERYARN-READING2-BM.

> I like the horizontal rail that we have now that shows at the top where we are in the document,
> with kind of heading breadcrumbs hierarchically. Great. The only thing is, when I've got it on
> landscape on an iPad with three columns, i.e., you know, the summary on the left and marginalia on
> the right, the headings rail spans the whole width of the screen, but the bit showing the headings
> actually only spans the middle column, and so it's wasting space either side that could be used to
> show more of the headings so they don't get so truncated.
>
> — Greg, 2026-10-03 (`spya-ft2cgg`)

## What we did

Plan, GPT Sol's two reviews, the measurements and the before and after shots:
[261004a](../plans/261004a-headings-rail-uses-the-width-above-the-mode-band.md).

- **The waste was on the left, not both sides.** The bar already ran over the marginalia to the
  window's edge. It started at the right edge of the open mode's panel, so the strip above the
  panel (336px on an 1180px-wide iPad) was empty while the section title was cut.
- **Once the article's title has scrolled away, the rail starts at the far left.** At 1180 wide the
  room for headings goes from 784px to 1120px; the section title measured, which was cut by 123px,
  is whole. At the very top of an article the rail stays where it was, because there it is level
  with the panel and its first words would be behind it. So the path moves sideways once as the
  title leaves; there is no slide.
- **The section you are in no longer loses its last two letters to an ellipsis when it fits.** The
  way the crumbs shared a shortfall cost it about 6px even with room to spare.
- A phone is unchanged.

## For Greg to look at

Whether that one sideways move, as the title scrolls off, reads as a glitch on the iPad. A slide is
the follow-up if so; it is not built and not queued.
