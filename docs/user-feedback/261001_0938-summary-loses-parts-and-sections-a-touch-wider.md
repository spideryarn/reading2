---
reports: spya-fc0h87, spya-wequmw, spya-b3ggv4
ending: shipped
---

# Summary loses Parts & Sections, and gets a touch wider

Three of Greg's reports from 2026-10-01, worked together as Overseer queue item qi-sv4fy24q. The
time in the file name is the first report's.

SPIDERYARN-READING2-7Q (spya-fc0h87):

> Make the Summary mode column ever so slightly wider (if on a wide screen)

SPIDERYARN-READING2-7R (spya-wequmw):

> In the Summary mode UI at the top, somehow indicate with the UI that *either* we're in
> Parts/Sections submode, or we're in simple-summarised-text submode. i.e. separate those two as
> submodes where you can only be in one or the other. Use Sonnet for web research on best practices
> for UI that might help with this.
>
> And get rid of the "Simple" text - perhaps replace with an icon or similar.

spya-b3ggv4, which replaced the first half of 7R:

> I'm looking at the summary mode, and I think actually getting rid of parts and sections is
> probably the way forward. It was an experiment, and it's just not working that well. We already
> have the structure mode, and so I think that probably overlaps with the summary parts and
> sections, and so let's just get rid of parts and sections.
>
> So that just leaves the slider that ranges from sort of brief to fuller summaries. So we can
> altogether get rid of all of the machinery that does those parts and sections summaries.

**Ending: shipped** to dev in 9e5cb2cca and 742bbe1e4 (plan
[261001p](../plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md), with GPT Sol's plan
and code reviews beside it).

- **b3ggv4 and the first half of 7R:** the Parts & Sections outline is gone from Summary. What's
  left is the Brief / Simple / Fuller slider and its paragraphs. An old link with
  `?summary=gists&deep=2` opens on the middle stop. The gists, the Hierarchy stage that writes them,
  and the Socratic questions are kept, because Structure, Marginalia, the shelf and others read
  them.
- **The second half of 7R:** the word beside the slider is gone. A small icon sits at each end:
  short text on the left, long text on the right. Each icon is a button that jumps to that level,
  and the tooltip names the level you are on. Sonnet's web research found this pattern, the small
  and large glyph at either end of a size slider, as on Apple's text-size control.
- **7Q:** Summary's band is now capped at 448px rather than 400px. It only grows once the article
  has its full width beside it, so phones and small laptops are unchanged.

Left for other queue items: whether opening Summary should write the paragraphs (fb7t-7v), which
level it opens on first (fb8n), and Brief being a little shorter (8F, fb8m-8f).
