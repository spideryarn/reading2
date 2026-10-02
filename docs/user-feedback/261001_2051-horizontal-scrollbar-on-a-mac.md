---
reports: spya-y3747g
ending: shipped
---
# A horizontal scrollbar on every article, on a Mac

Report `spya-y3747g`, a problem, from Greg (admin), 2026-10-01, dispatched by the Overseer on
2026-10-02 with no Sentry mirror, on
`/read/s41598-023-33209-9-spya-hxekgz?term=spya-trxfqv&at=spya-pxfyh5`:

> For some reason, there's a horizontal scroll bar permanently visible at the bottom of the page on
> my Mac, even for quite a wide window. I'm fairly sure this is new, and I'd rather it wasn't there.
>
> I wonder if it has anything to do with moving the feedback button to the right-hand side of the
> bottom-bar? Dunno.

**Ending: Shipped**, on `dev`. Plan
[261002a](../plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md)
§ 1; postmortem
[261002a](../postmortems/261002a-the-reading-view-laid-out-for-the-width-under-the-scrollbar.md).

What was wrong, in plain words: a Mac with a mouse plugged in (or *Show scroll bars: Always*) gives
the page a real scrollbar that takes 15px. The reading view was laid out for the whole window,
scrollbar included, so it was 15px too wide and scrolled sideways — with a mode open, and the title
bar in every mode. It was not the Feedback button, though the bottom bar did run 15px under the
scrollbar, and the Feedback button now sits at exactly that end. Our browser checks use scrollbars
that take no width, so none of them could see it.

What changed: the page is laid out for the width beside the scrollbar, the bars use that same
width, the bottom bar and the full-screen pictures stop at the scrollbar, and the scrollbar's room is
kept even on a page too short to scroll, so the layout cannot flip. Checked with real 15px scrollbars
at five widths in five modes.

Not confirmed: that it is *new*. The mechanism goes back to August; most likely the Mac started
showing classic scrollbars, or the Feedback button's move drew the eye to that corner.
