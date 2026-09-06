# Move the wordmark and the Feedback button into the Dock

**Status: staged, in build as of 2026-09-06.** Written 2026-09-05 as the successor to stage 4 of
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

## What was open, and what it was settled as

This was a sketch when it was written. Everything below is now decided; the one question that
was Greg's is marked as his.

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
  survivable and both are honoured below: the Dock is *already* where a reader looks to leave the
  thing they are in, since it is how you leave a mode; and the wordmark keeps its identity across
  the move — same glyph, same word, same colour.

  **"Where there is a Dock" is three pages, not one**, and that is the operative reading of Greg's
  answer rather than a widening of it. The article, its metadata page and its tweets page all mount
  `Dock` and are one click from each other; leaving the corners on two of the three would put the
  wordmark top-left and bottom-left on pages a reader flips between in a tighter loop than
  library → article. The rule is *the Dock takes them where there is a Dock*, which is exactly what
  Greg's answer says.

- **What the Dock can afford: the ladder already answers this, so the wordmark joins it.** The
  word `Spideryarn` is marked `dock-btn-label`, the same class every other button's word carries, so
  § the bar's fit ladder drops it at rung 2 along with all the others and keeps it at rungs 0 and 1.
  No new rung, no new class, no second mechanism deciding when the brand is affordable. The glyph
  never goes.

  Measured need moves and nothing has to be told: rung 0 wanted ~1416px at thirteen modes and now
  wants roughly 1600; rung 1 wanted ~808px and now wants roughly 990. That is the ladder working,
  not a regression — `dock-fit.ts` walks down until the row fits.

- **The way home is not a mode**, and the markup says so three ways: it is outside the
  `role="radiogroup"` that `DockModes` draws, it is a `Link` rather than an `aria-checked` button,
  and it never takes `.dock-btn.on`. It also does not take `aria-current="page"` the way `DockLink`
  does, because it is not a link to the page you are on — it is the way off it.

- **The Dock hides on scroll, and the way home goes with it.** That is the right answer rather than
  a cost to mitigate: the corner controls *not* joining the hide is precisely the live bug in
  [the postmortem](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md),
  where the wordmark stays fixed over the top 44px of the spine on a phone that has scrolled the
  bars away. Both controls now travel with a bar, and any upward scroll brings them back.

- **`--bar-h` keeps both its consumers, because they still exist elsewhere.** `.logo-home` and
  `.fb-button` are unchanged on the library, the profile, `/privacy`, the landing pages and the
  article's loading and error screens. What goes is the *reservation* the reading view was holding
  for them, which is a different thing in a different place — see stage 2.

- **The reservation comes out in the same run**, as stage 2, and it is the visible half of this
  work: ~136px of left gutter and ~120px of right gutter given back to the article's own title.

## The one thing this makes worse, stated

**The Feedback button stops being always-visible on a phone.** At rung 2 on a 390px screen the row
already overflows and scrolls (measured 2026-09-05: `scrollWidth` 617 against `clientWidth` 390);
Feedback sits at the right-hand end of it, so a reader has to drag the bar to reach it, where today
it is fixed in the corner. The wordmark does not have this problem — it is at the left-hand end,
which is where the scroll starts.

Taken anyway, because the alternative is keeping one fixed control in the corner of the reading
view, which is the thing this plan exists to stop, and because the button is chrome offering to take
a complaint rather than something a reader is reaching for mid-sentence. Recorded here so that if
bug reports from phones fall off, this is the first place to look.

## Stages

**Stage 1 — the Dock takes the two corners.** `Dock.tsx` grows a `DockHome` at the left-hand end,
before the modes, and renders `FeedbackButton` at the right-hand end, after the experimental switch
and before `.dock-tail`. The three pages that mount a `Dock` stop drawing the corner pair:
`ArticlePage`'s final branch loses its `<HomeLogo />`, and `App`'s single `<FeedbackButton />` stops
covering the `read` route — with the four branches of `ArticlePage` that have **no** Dock (loading,
error, not-shared, reauth-required) each drawing the corner button themselves, so nothing that has
it today loses it.

Done when: every route draws exactly one way home and at most one Feedback trigger, asserted by a
test that walks the routes rather than by reading; the modes still announce as a radiogroup of
thirteen; the feedback dialog still opens and still centres on the viewport from inside a
transformed, `overflow-x: auto` bar (a browser check, not a reasoned one — `.dock` carries a
`transform`, which would capture a `position: fixed` descendant if the top layer did not escape it).

**Stage 2 — the reservations come out.** `.masthead` and `.controls` drop `--masthead-pad-l` /
`--masthead-pad-r` and their `padding-left` / `padding-right` expressions, along with the § a narrow
window rules that give the same two terms back after a shorthand ate them. `Metadata.tsx` and
`Tweets.tsx` drop the `3.5rem + var(--safe-top)` of top padding they hold for a wordmark that is no
longer above them. `--logo-w` and `--feedback-w` stay, with their comments rewritten to say they now
size two controls and reserve space on the pages that still have them.

Done when: the article's title starts at the ordinary 1.5rem gutter at every width, and nothing on
the three Dock pages reserves space for a corner control; screenshots at 1440, 1024, 800 and 390
show the title using the room.

**Stage 3 — the top bar stops being drawn when it has nothing in it.** This is stage 4 of
[260905d](260905d-declutter-the-reading-view-top-bars.md), which was abandoned because the bar was
holding two controls up. It is not any more. `.controls` renders only when it has content —
which, `inMode` being `mode !== "hierarchy"`, means Hierarchy for the granularity pills and a
visitor's read-only chip — and `--bar-bottom` falls to `var(--safe-top)` where it does not.

The `commentError` chip leaves the bar rather than being what puts it back: the Dock already knows
the comments failed to load (`own.loadFailed` reaches `Questions` through the drawer's `access`), so
the bar was carrying a second copy of a fact that has a home. **That is what removes the 44px jump
on an error path** which was the last argument against stage 4, rather than a tidy-up.

Done when: Plain mode above 1080px has no chrome above the prose but the masthead; a comment
transport failure moves nothing; and the phone bug in the postmortem is gone because there is
nothing left fixed in that corner.

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
