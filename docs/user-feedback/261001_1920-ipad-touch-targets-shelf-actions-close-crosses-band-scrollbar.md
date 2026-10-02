---
reports: spya-d7ftwk, spya-n3zujy, spya-gvcmx2, spya-f602m6, spya-af6hy8
ending: shipped
---

# iPad touch targets: shelf actions, close crosses, the band's scrollbar

Five reports from Greg (admin), all on an iPad: SPIDERYARN-READING2-9E, 9F and 9G, and two that never
reached Sentry (spya-f602m6, spya-af6hy8).

> Make the triple dot menu for items in my shelf a bit more visible. It's very small on my iPad in
> portrait mode.
>
> — 9E, spya-d7ftwk, 2026-10-01

> When I'm looking at my logged-in homepage shelf in portrait mode on an iPad, the multiple icons for
> each item on the shelf are collapsed down into a triple dot menu. Okay, that's fine, but it's just
> a tiny bit more cumbersome. And so I wonder if we were to slightly rearrange the cards for articles
> on the shelf, I think there'd be room for those, all those icons. So, for example, we could move the
> opened, you know, three days ago to the bottom left, and then we could put the icons in the bottom
> right, so they'd all be on that same bottom row. I think that would work. I wouldn't mind if the
> opened three days ago was next to the word count, for example, if that helps. We'd just make
> efficient use of space and save me a click. And we could keep the three dots menu just in case
> things are really, really narrow or whatever.
>
> — 9F, spya-n3zujy, 2026-10-01

> Can you make the little cross to close a comment a little bit larger? I kept missing it on my
> iPad. And if there are any other similar to the modals or panels, apply it to them as well.
>
> — 9G, spya-gvcmx2, 2026-10-01

> Why don't I see a scroll bar in the summary mode on iPad?
>
> — spya-f602m6, 2026-10-02

> Oops, there IS a scroll bar in summary mode on my iPad. It's just very hard to see.
>
> — spya-af6hy8, 2026-10-02

**Ending: shipped**, on `dev`.
[261002i](../plans/261002i-ipad-touch-targets-shelf-card-actions-on-the-bottom-row-bigger-close-crosses-a-visible-band-scrollbar.md)
has the reasoning and both GPT Sol reviews.

- **9F:** the five actions are on the card's bottom row at the right, and the note sits beside the
  word count. On an iPad (a card at least 28rem wide) a finger gets the five icons at 40px instead of
  the "⋯". A tap presses Edit, Open, Copy, Archive and Put back. Re-fetch, which queues paid work,
  and a control drawn unavailable still explain themselves on the first tap. Phones and the table
  view keep the "⋯".
- **9E:** the "⋯" has a border and a bigger, brighter glyph.
- **9G:** seven modal and panel closes share one cross: the comment card, Annotate, the chat dialog,
  Feedback, the Dock's drawer, the figure lightbox, and Referee's explanation. It is 32px with an
  18px glyph, and has a 40px target wherever there is a finger. Chat's own header ✕ goes back to the
  conversation list rather than closing anything, so it is queued for Greg as qi-q59z75vg.
- **Summary scrollbar:** the mode band now sets `scrollbar-color`, which iPadOS paints into its
  overlay scroll indicator from **Safari 26.2** on. Before 26.2 the line is ignored. **Not
  verifiable here**: Playwright has no iOS scroll indicator. Greg's iPad is the check, and if it is
  still faint, the next step named in the plan is a fade at the band's bottom edge.

Browser-checked with Playwright on the box at iPad portrait (touch), phone (touch) and desktop
(mouse): the row fits on one line on the iPad card, one tap copies or archives, the phone's "⋯"
opens its words, and every close measures 32px.
