# A tap judged at `pointerup` and acted on at `click`

On a home-screen iPad, a tap on one of the article's own hyperlinks sometimes opened the external
page instead of the link card — on top of the whole app, which in that mode has no back button.
**It reached a reader**: Greg, 2026-09-12 (SPIDERYARN-READING2-3Y), eight days after the card was
put in front of that tap precisely so this would not happen. The plan with the fix is
[260915a](../plans/260915a-ipad-link-taps-that-escape-the-link-card.md).

## What happened

Since `0f754742` (2026-09-04) a finger's first tap on a link that leaves the app shows the card and
its second opens the tab ([links.md](../project/links.md#on-a-coarse-pointer-the-first-tap-reveals-and-the-second-opens)).
The decision lives in `pointerUp` in [`useHoverCard.ts`](../../src/web/useHoverCard.ts): if the press
was a tap by our test, on a tap target by `closest`, it reveals and arms a swallow for the `click`
the platform synthesises afterwards. The swallow is from `cce3f776` (2026-08-27), where it was
built for glossary terms.

But the thing that navigates is the **click**, and the click is a separate decision the platform
makes about the same gesture, later, with different inputs:

- **Where.** Pointer events go to the raw touch point. The click goes to the node *touch adjustment*
  chose — WebKit's `attemptSyntheticClick` calls `nodeRespondingToClickEvents(point, adjustedPoint)`.
  A finger on the words just beside a one-word link can give a `pointerup` on the words and a
  `click` on the link. Read from WebKit's source; headless Chrome on the box did *not* show it, so
  this one is the engine's design rather than a measurement.
- **Whether.** Our `isTap` says 10px, 600ms, no selection. The platform's own tap recogniser has its
  own numbers — measured in Chrome with real touch input, a 15px sideways drift and a 700ms still
  press both still click the link, and both are refused by ours — and a Pencil (`pen`) was never on
  our path at all.
- **When.** WebKit can hold the click ~350ms to rule out a double-tap zoom, so it can land after our
  400ms swallow has expired — and then even a tap we *did* act on navigates, under the card it had
  just opened.

Every one of those is the same failure: we answered "was that a tap on a link?" at one event, and
the platform answered it independently at another, and only the platform's answer was wired to
navigation. `tests/link-tap-escapes.test.tsx` has one case per disagreement; before the fix, eight of
its thirteen cases were red.

## The class: a gesture judged at one event and acted on at another

**When the action you are guarding is performed by a later event, your guard has to be at that
event — or be keyed to it — not only at an earlier one you believe predicts it.** Here the guard
predicted the click from the `pointerup`; the platform is free to disagree about target, occurrence
and timing, and every disagreement fails open.

The sibling, looked for: `swipe.ts` swallows a click on a deadline and a place from the `pointerup`
it saw, and has the same shape — but fails *closed* in the harmless direction (a missed swallow is
an extra jump in the app, not an exit from it). The shelf's action row decides at `onClickCapture`,
i.e. at the click itself, and has none of this.

## Why nothing went red

- **Every test drove events at one element.** `tests/hover-card-touch.test.tsx` dispatches
  `pointerdown`, `pointerup`, `mouseup` and `click` all at the same node, at the same coordinates,
  in the same millisecond. That encodes exactly the assumption that broke: that the click goes where
  the pointer went, straight away. The test and the code shared it, so the test agreed —
  [silent-success.md](../reusable/silent-success.md).
- **The browser check on 2026-09-04 tapped the centre of each link**, through CDP touch input with
  the default radius — the one place where the raw point and the adjusted point coincide.
- **Nobody asked what the click would do if the swallow missed.** The swallow was designed as a
  cleanup after a decision, not as the thing standing between a tap and leaving the app; once the
  link rule reused it, it became the latter without anything saying so.

## What would have caught it, ranked by ease against value

1. **A test harness whose click can land somewhere else, later.** `tests/link-tap-escapes.test.tsx`
   now dispatches the click at a different node, at different coordinates and after a delay. Done.
2. **Guard the action at the event that performs it.** The fix adds a net in the `click` capture
   listener for any click that would navigate after a touch or pen press, keyed to the press rather
   than to a timer alone. Done.
3. **For a tap test on a real browser, tap off-centre and with a finger's radius**, not at the
   centre of the target. A line in [touch.md](../project/touch.md). Done.
4. Moving the whole decision to `click` — rejected: `mouseup` comes before `click`, and TableView
   opens a chat thread on `mouseup`, which is why the decision was put at `pointerup` in the first
   place.

## The fix that is right for the long term

What shipped is a net under the `pointerup` path. The cleaner long-term shape would be one decision
per gesture, made once and read by every later event of it — a gesture id from `pointerdown` that
the `mouseup` and `click` handlers look up — rather than two paths that have to agree. It is not
built because the net is small, covers every disagreement listed, and the `pointerup` path is shared
with glossary terms and footnote markers that have no escape to guard.

## The thing I would tell myself

The first thing to ask of a guard is *what performs the thing I am preventing, and does my check run
there?* The swallow ran at the click, but only as the tail of a decision made earlier, so it could
only ever be as right as that decision's prediction of the click. On a platform that corrects where
a fat finger meant to press, a prediction of where the click lands is not a fact about the click.
