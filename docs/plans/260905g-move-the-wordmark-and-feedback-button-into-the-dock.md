# Move the wordmark and the Feedback button into the Dock

**Status: planned, not built.** Written 2026-09-05 as the successor to stage 4 of
[260905d](260905d-declutter-the-reading-view-top-bars.md), which was abandoned once measuring showed
it could not deliver what it promised.

## Why this exists

Greg asked for the reading view's chrome to collapse to one top bar and one bottom bar:

> The top bars are really crowded and confusing. […] In short, we'd like to get to the point where
> there's a single top bar and a single bottom bar, along with the nice way that we already
> hide/reveal those when scrolling on mobile. And that everything we're showing is useful and
> understandable.
>
> — Greg, 2026-09-05

[260905d](260905d-declutter-the-reading-view-top-bars.md) emptied the sticky `.controls` bar and
then set out to stop rendering it where it was empty. That last step turned out not to be
available, and the reason is the whole premise of this plan.

**The controls bar is not only a bar. It is the thing that holds two fixed controls off the
article.** `.logo-home` (the wordmark, the way home) and `.fb-button` sit `position: fixed` in the
top corners at `top: var(--safe-top); height: var(--bar-h); z-index: 60`, on every page. They do not
reserve their own space: **the bars reserve it for them**, through padding, and
[`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) § The bars have to reserve the space says so
and prices it at about 120px of right-hand gutter held open on every page, including ones with no
button in them.

So removing the bar does not remove a bar. It removes the floor two controls are standing on, and
the article scrolls up behind a wordmark and a button that have no background of their own
(`.fb-button` is explicitly `background: none`).

Fable arbitrated stage 4 against that, 2026-09-05, and worked out where the 44px would actually have
landed:

| | |
|---|---|
| phones | the bar already leaves on scroll — nothing to gain |
| Hierarchy | the bar stays, it has the pills — nothing to gain |
| band modes | `.mode-band` is `top: var(--bar-bottom)`; remove the bar and you either leave a hole above the band or pad it back — nothing to gain |
| Plain, above ~1080px | 44px of page background: **the only real win** |
| Plain, 732–1080px | the centred column reaches the left edge, so the wordmark's 136px lands on the top line of prose — **worse than before** |

And one cost nobody had priced: `commentError` puts the bar *back*, so a comment-transport hiccup
would slide the spine, the band and every sticky gist 44px in a 180ms animation. **A layout that
jumps on an error path is worse than a strip that is always there.**

Greg's call, given all of that: don't patch it — move the corners.

## What this does

The wordmark and the Feedback button leave the top corners and live in the **Dock**, the bottom bar
that already names the mode and is already the way out of one. Then:

- the top of the reading view is genuinely free, and `.controls` can stop being rendered where it is
  empty with nothing left behind to hold up
- the ~120px right-hand gutter reservation goes, on every page in the app
- the [spine-under-the-wordmark bug](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md)
  dissolves rather than being fixed: there is nothing left in that corner to be under
- "one top bar and one bottom bar" becomes true in the plain sense of the words, rather than true if
  you agree not to count the masthead

## What has to be worked out before this is buildable

This is a sketch, not a spec. **The blocking question — which pages — was answered on 2026-09-06 and
is struck through below.** The rest are ordinary design work rather than things only Greg can settle,
so this is stageable now; it has not been staged only because nobody has picked it up.

- ~~**Which pages.**~~ **Decided by Greg, 2026-09-06: the reading view only. Every other page keeps
  its top corners exactly as they are.** The two controls move into the Dock where there is a Dock,
  and nowhere else — no page grows one to receive them.

  The reasoning is that the reading view is the only place the 44px is expensive: it is the one page
  whose whole job is a column of prose you scroll through, and the only one where a permanent strip
  of chrome sits between the reader and it. The library and the profile are pages of cards and
  fields, where a top bar is ordinary furniture and costs nothing anybody notices.

  **The cost Greg accepted, stated rather than discovered later:** the wordmark moves as you
  navigate. Going from the library into an article, the way home slides from the top-left corner to
  the bottom-left. That is a real inconsistency and it is the price of the 44px. Two things make it
  survivable and both should be honoured when this is built: the Dock is *already* where a reader
  looks to leave the thing they are in, since it is how you leave a mode; and the wordmark should
  keep its identity across the move — same glyph, same word, same colour — so it reads as the same
  control in a different place rather than as two different controls.
- **What the Dock can afford.** It already carries thirteen mode buttons and is under width pressure
  on a phone — `docs/project/touch.md` and § a coarse pointer in `styles.css`. Two more items is not
  free, and the wordmark is the widest single thing in the current chrome. Does it become an icon?
- **The way home is not a mode.** Every Dock button switches the band; this one leaves the page. It
  must not read as a fourteenth mode, and the visited-state and keyboard order both have to say so.
- **The Dock hides on scroll too.** On a small device both bars leave together. If the way home is in
  the Dock, the way home leaves with it — which may be right (it comes back on any upward scroll) or
  may not.
- **`--bar-h` sizes both corner elements** (`styles.css` § `.logo-home`, § `.fb-button`) and would
  stop having those consumers. It is also `.controls`'s own height. Untangle before, not during.
- **The reservation comes out in the same change**, or the gutter stays held open for controls that
  have left — the padding is on the masthead and the bar, not on the buttons.

## Then, and only then, stage 4 of 260905d becomes free

Once nothing is fixed in the top corners, `.controls` can be rendered only when it has content, and
`--bar-bottom` can fall to `var(--safe-top)` honestly rather than by ignoring two elements. The
`commentError` jump is still worth thinking about; it may want a different home, which
[260905d](260905d-declutter-the-reading-view-top-bars.md) § Decisions 8 already names as the
follow-up.

## The simpler options passed over

- **Give the two corners their own backgrounds and drop the bar anyway.** Two lines of CSS, and it
  buys 44px in one mode above one width while making 732–1080px worse and leaving the gutter
  reservation in place. Rejected on the table above.
- **Keep the empty strip and do nothing.** Fable's actual recommendation, and defensible: the strip
  reads as a seam rather than as a control, and Greg's "everything we're showing is useful" is about
  words, of which there are none left. Rejected by Greg in favour of doing it properly.
- **Fix the mobile spine bug on its own** — the corners joining the hide-on-scroll, a handful of CSS
  lines. Written up in the postmortem and still available if this plan stalls; it is strictly smaller
  and strictly less good.

## See also

- [260905d](260905d-declutter-the-reading-view-top-bars.md) — the declutter this came out of, stages
  1, 2, 3 and 5 of which have landed
- [the postmortem](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md) —
  the live bug this would dissolve, with the measurement
- [`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) and
  [`HomeLogo.tsx`](../../src/web/HomeLogo.tsx) — the two comments that explain the reservation and
  price it
- [reading-view-overview.md](../project/reading-view-overview.md), [web-client.md](../project/web-client.md)
