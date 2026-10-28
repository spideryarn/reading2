# A touch guard named one of hover's two close reasons

Up: [postmortems.md](../project/postmortems.md)

Report `spya-r246pf` (Greg, an iPhone, 2026-10-28): tapping a term in Skim *"didn't seem to show the
entry"*. Plan: [261028a](../plans/261028a-skim-on-a-phone-shows-whole-quotes-and-a-tapped-term-card-stays-open.md).

**This root cause is the best candidate, not a proven one.** Chromium and Playwright's WebKit, at
phone width with touch, opened the card and kept it every time. The hole below is real and is
closed by a test that was red first, but the exact event sequence on Greg's phone was not
captured. Whether it was *his* bug waits on him tapping a term again after the deploy.

## What happened

`Tooltip.tsx § changeOpen` keeps a controlled card that a finger opened from being closed by
hover, because a tap's synthesised `mouseleave` used to shut it about 20ms after it appeared
(`byTouch`, 261003p). It did that by naming the reason: `reason === "hover"`.

Floating UI has **two** reasons for a hover close. A plain card closes as `"hover"`; an
`interactive` card's leave goes through `safePolygon`, which installs a document `mousemove`
handler on `mouseleave` and closes as **`"safe-polygon"`**. Neither `mouseOnly` nor
`isClickLikeOpenEvent()` stops that handler for a card opened by the `open` prop. So on an
interactive, controlled card — Skim's term chip is one, since 261006e — a compatibility
`mouseleave` and any `mousemove` away from the chip unpinned what the finger had pinned.

The same function already treated the two reasons as one, a few lines further down, for focus
inside the card. The guard written earlier never got the second name.

## The class: a guard that enumerates one of a family of equivalent values

A condition written as `x === "a"` when what it means is "any of the ways this kind of thing
happens", where the library has several names for that kind of thing and adds new ones by
configuration. It passes every test written for the case it was written for, because those tests
produce `"a"`. It fails silently when a later caller turns on an option that produces `"b"`.

## Which commits

- `d85598ac2` (261003p) added the `byTouch` guard, for Search's score card, which is not
  interactive: `"hover"` was then the only reason that could arrive.
- `0432a7404` (261006e) gave Skim's term chip a controlled **and** interactive Tooltip, which is
  the first combination that can produce `"safe-polygon"` under a finger. Nothing in that change
  touched the guard, and nothing told its author the guard was reason-specific.

## The fix, and the long-term one

Shipped: the guard names both reasons. That is also the long-term fix as far as this file is
concerned, because both reasons now live in one place, beside the other line that already groups
them. A named constant (`HOVER_CLOSES`) shared by both lines would be tidier. It is not worth a
second edit while there are two uses.

## What would catch the class, ranked by ease against value

1. **A test per combination of Tooltip options a caller actually uses**, not per Tooltip. The
   Skim test added here (*keeps a tapped card open through a mouseleave and a move away*) covers
   controlled + interactive + touch. Cheap; this is the one to keep doing.
2. **Grouping a library's reasons in one place.** When a library reports an enum, any guard
   written against it should read a set defined beside the library's options. Cheap when there are
   two uses; worth doing at the third.
3. **A real-device check for anything touch-specific.** This is what would have caught it, and it
   is the one thing no harness here has. Rejected as a gate: there is no iPhone on the box. It is
   asked of Greg instead.
