# A layout read from a number that means a different viewport on iOS

The reading view has computed its whole layout — how many gist columns, how wide the mode band, which
face Structure draws — from `window.innerWidth` since the day it was written. On iPad Safari that
number is the **visual** viewport, and it shrinks when the page is zoomed in; everything else on the
page, every media query and every `100vw`, is the **layout** viewport. Rotate a zoomed-in iPad and
the reading view is laid out for a window about two-thirds the size of the one it is in, until
something unrelated resizes the window. **It reached a reader**: Greg, on an iPad in production,
SPIDERYARN-READING2-33 and -34, 2026-09-12 — one column in Structure mode on a landscape iPad, then
two a couple of minutes later, "unprompted". The fix is
[260912b](../plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md).

## What happened

`useWindowWidth` ([`src/web/reader/measure.ts`](../../src/web/reader/measure.ts)) stored
`window.innerWidth − the notch` on every `resize` and `orientationchange`. `fitMode` turned that into
a band width, and `structureFace` measured the band and chose between two columns and the list.

Three facts about WebKit on iOS, each from its source (the plan has the file and function for each):

1. `innerWidth` is the unobscured content rect in page coordinates, so at zoom ×1.5 it is two-thirds
   of the screen.
2. The page's zoom is carried across a rotation.
3. A zoom change fires no window `resize` — iOS's resize size is in screen points — so only
   `visualViewport` hears it.

So the rotation's own `resize` stored the zoomed width, zooming back out changed nothing the app was
listening to, and the layout stayed narrow until Safari's toolbar collapsed on a scroll and fired a
`resize` with the scale back at 1. Greg's second report is that last step, observed.

## The class: a layout read from a number that means a different viewport on one engine

The same property name, `innerWidth`, is the layout viewport in Chromium (since Chrome 61) and on
desktop, and the visual viewport on iOS. The stylesheet has no such ambiguity, because `@media` and
`vw` are defined against the layout viewport everywhere. So the JavaScript half of the layout and the
CSS half agreed on every machine we develop on and disagreed on exactly one kind of device, and only
while zoomed in.

It is a sibling of the class
[narrow-windows.md § a band with no room](../project/narrow-windows.md) records: **two
halves of one layout computing the same width from two sources**, where there the two sources were a
`@media` guess and `fitMode`, and here they are two viewports under one name.

**The sibling instances**, found by grepping for the name before writing this, and **none of them
is the same bug**, which is worth knowing before "fixing" them. `SmallScreenHint` compares
`innerWidth` with `innerHeight`, and zoom scales the two together, so its ratio cannot flip.
`OutlinePanel` compares the band's `getBoundingClientRect().right` with `innerWidth − 8`, and which
coordinate space that rect is in under iOS zoom is itself an open WebKit question — swapping one side
for the layout width could create the mismatch rather than remove it. Both are left, allowlisted in
the guard with those reasons (GPT Sol's plan review, F2 and F3). `feedback-diagnostics.ts` reports
`innerWidth` as `viewportW`, honest as a record of what the browser said but misleading as "the
window" — left, and named in the plan.

## Why nothing went red

- **Every browser on this box agrees with the code.** Chromium's `innerWidth` does not move under
  pinch zoom, so a Playwright run at any width, zoomed or not, lays out correctly. The defect needs
  WebKit on iOS *and* a zoom *and* a rotation.
- **jsdom has one width.** Every test that sets a window width sets `innerWidth`; none could express
  "the visual viewport is narrower than the layout viewport", so the suite shared the code's
  assumption that there is only one.
- **The instrument was pointed the other way.** `?probe=1` ([`ViewportProbe.tsx`](../../src/web/ViewportProbe.tsx))
  does record `innerWidth` beside `visualViewport.scale` — the two numbers that would have shown
  this — but only on visual-viewport events, because it was built for the keyboard. It never sampled
  a rotation.
- **The comment was right about the events and silent about the value.** `useWindowWidth`'s header
  reasons carefully about `resize` and `orientationchange` firing in either order; the question of
  *which width* the value is was never asked.

## What would have caught it, ranked by ease against value

1. **One definition of "the window's width", and a guard that names it.** `layoutViewportWidth()` in
   `measure.ts`, and `tests/layout-viewport-width.test.tsx` fails on any `innerWidth` in `src/web`
   code outside an allowlist that gives each file's reason for wanting the browser's raw answer. It
   turns the next `window.innerWidth` in a layout decision into a test failure that says why. Width
   only: the client's `innerHeight` reads want the visible height and are right to. **Done, in this
   change.**
2. **The probe records rotations and both widths.** Costs a listener and a field; turns "an iPad
   misbehaves" into a trace that says which viewport was read. **Done, stage 2 of the plan.**
3. **Feedback diagnostics carry the layout width beside `innerWidth`.** Every future report from a
   zoomed device would then say so on arrival. Cheap, but it changes the wire shape the server
   validates, so it is a change of its own. **Deferred, named in the plan.**
4. A real-iOS lane — a cloud device farm in the test run. **Rejected**: a paid service and a flaky
   lane for a class that item 1 closes at the source, and the checks that would matter need a person
   to pinch.

## The fix that is right for the long term

`Math.max(innerWidth, documentElement.clientWidth)` is the shipped fix, and it is a compromise rather
than the ideal: the ideal is "the width the media queries see", which no single DOM number gives on
every engine — `clientWidth` alone is the layout viewport on iOS but excludes a desktop's classic
scrollbar, which the media queries include. Taking the larger keeps every case that was right and
fixes the zoomed one. What it does not fix is iOS zoomed *out* below 1 to fit overflowing content,
where `innerWidth` is wider than the layout; that is a page that already overflows, which
narrow-windows.md § the check is the guard for.

## The thing I would tell myself

I read `window.innerWidth` as "the window" because that is what it has meant in every browser I have
debugged in for a decade, and on the one device where it means something else the symptom — a layout
that corrects itself a minute later — looks like a timing bug. I spent the first half of this looking
for a missed event. The events were fine; the number was the wrong kind of number.
