---
reports: spya-s46j8f
ending: shipped
---
# Structure's Fisheye keeps the sections you are among and their summary, and scrolls

Report `spya-s46j8f`, a suggestion, from Greg (admin), 2026-10-03, relayed by the Overseer (Sentry
event `e908a52958924d2aa20a8f491e2a0fda`), on the Entropy article in Structure mode's Fisheye view:

> In structure mode, in fisheye submode, it does a good job of kind of expanding and contracting to
> try and keep the whole structure visible. But actually, I think it probably treats that constraint
> of making sure that the whole structure is visible within the column as more important than, you
> know, than the desire to be able to show a bit more detail. So I'm wondering how to tweak it, but
> at the very least, if I'm reading, you know, a subsection or whatever the term is, I think at the
> very least I want all the headings for this subsection and its siblings to be visible. I mean, I
> think I'd also like to see the summary for this lowest level subsection, even if that does mean
> that it can't show the whole top-level structure visibly, that I'd have to scroll in structure
> mode to see the whole of the top-level structure. I think that's probably better because though
> it's nice to be able to always see where I am within the whole piece, it's probably also important
> to be able to see where I am within this section and to get the summary of this. So there's a
> balance between saying probably always show the summary for the lowest-level heading. And probably
> always show the lowest level headings and their siblings.

**Ending: Shipped**, on `dev`. Plan
[261003k](../plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md).

- **The one-list Fisheye always shows** every part, every section of the part you are in, and the
  summary of the section you are in. When that does not fit, the list scrolls and follows you,
  where before it dropped the sections and the summary to keep every part on screen.
- **Titles are never cut to one line** any more. That was the old last resort; scrolling is now.
- **The two-column Fisheye (wide windows) is unchanged.** It already showed the sections of the
  current part and the current section's summary.

**Deferred, and queued** as `qi-qe8gh9pp`: an article whose tree is four levels deep. There the
lowest-level heading is a sub-section the Fisheye list does not draw, so it shows the section above
it. One of 43 articles in production is that deep.
