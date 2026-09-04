# The touch card closed itself on every tap

> If it has been generated, display the dotted-lines for Glossary terms in the text, no matter which
> mode is active. Make it work well for both desktop and mobile devices, i.e. hover-tooltips if
> there's a mouse, otherwise click to show, etc.
>
> — Greg, 2026-09-03

Checking the second half of that ask in a real browser found that the hover card was, and had been
since 2026-08-27, useless on every touch device. Tapping an underlined glossary term opened the card
and then closed it again about 220ms later — every tap, every mode. The second tap that is supposed
to commit to glossary mode never had anything left to commit against, because the card it was aiming
at had already shut itself.

## The line

[`src/web/useHoverCard.ts`](../../src/web/useHoverCard.ts), before the fix:

```js
/* Leaving the window entirely, which fires no `pointerover` at all. */
const leave = () => close();
document.addEventListener("pointerleave", leave);
```

Written for a mouse leaving the browser window. A touch pointer does not hover, so the Pointer
Events spec destroys it the instant the finger lifts — and destroying it fires `pointerout` at the
target and `pointerleave` at every ancestor being left, `document` included. So every tap ended with
this listener hearing what looks exactly like a mouse leaving the window, and arming the 220ms close
against the card the same tap had just opened. This is spec behaviour, not an emulator artefact:
Chrome does it on real touch hardware too.

Measured with Playwright at 390×844 with `hasTouch: true` (timestamps in ms, this box, 2026-09-03):

```
pointerdown 6197.6 → pointerup 6246.4 → pointerout/pointerleave 6246.8–6246.9
  → setTimeout(shut, 220) armed 6246.9 → card shown 6262.9 → card hidden 6497.8
```

The fix is the guard `over`, twelve lines above `leave` in the same file, already had:

```js
const leave = (event: PointerEvent) => {
  if (event.pointerType === "touch") return;
  close();
};
```

Deleting the listener outright was considered and rejected — it has a real customer, a mouse
leaving the window fires no `pointerover` on anything, so nothing else closes the card.

## The class

**A listener added for the hover path has to say what it thinks of touch, because touch fires the
hover events too.** `over` got this right when it was written and says so in its own comment,
in as many words, since 2026-08-27:

> Mouse and pen only. A touch fires `pointerover` on the tap and never fires the leaving one…

`leave` was written the same day, in the same commit, by the same author — and never asked the
question. Knowing the hazard in one place in a file does not put it in the other; each document-level
pointer listener has to state, for itself, what it does for `pointerType: "touch"`. This is not a
one-off slip specific to this hook: any delegated listener on `document` or `window` for a pointer or
mouse event is a candidate, because a touch synthesises the whole mouse-compatibility sequence as
well as its own pointer events, and a handler reasoned about only from the mouse's side is reasoned
about wrong.

## Why it went uncaught for a week

`tests/hover-card-touch.test.tsx` had 24 tests driving the hook with synthetic pointer events, and
every one stayed green through this bug, for two independent reasons.

**1. The `tap()` helper modelled the gesture its authors had in mind, not the one the browser
makes.** It fired `pointerdown`, `pointerup`, `mouseup`, `click` — a plausible reading of "what does
a tap dispatch" — but not the `pointerout`/`pointerleave` a real lift fires, because nobody writing
it had reason to know the spec destroys a touch pointer on lift. A synthetic-event test is only as
good as its author's model of the event stream, and the model here was missing exactly the events
that caused the bug.

**2. Every assertion was synchronous, and the close is a 220ms timer.** Even with the leaving events
added, `expect(card()).toBe("alpha")` on the line right after the tap passes over a card that shuts
itself a fifth of a second later. The bug lived entirely in the gap between "assert" and "the timer
fires," and nothing in the suite ever waited that long.

Both had to be fixed, and neither alone would have caught it: the two events were added to `tap()`
(now via a `lift()` helper with its own comment explaining the spec), and a new `describe` block
installs fake timers and asserts again after `HOVER_DELAY.close * 2`. With both in place and the fix
reverted, exactly those two new tests go red and the other 24 stay green — proof the rest of the
suite genuinely could not have found this.

This is [silent-success.md](../reusable/silent-success.md)'s pattern by name: **a check that shares
an assumption with the code it checks.** The harness's model of "what a tap does" and the listener's
model of "what a tap does" were the same wrong model, arrived at independently, so the test could
not see the gap between them.

## The commit

`b20eef59` *"Underline every glossary term, and answer for it when pointed
at"* (2026-08-27) introduced both handlers in the same diff, in `TermTooltip.tsx` (the file
`useHoverCard.ts` was later extracted from): `over` with the `pointerType === "touch"` guard and its
explaining comment, and `leave` — a few lines below it — without one. `b0112a95`, later the same day,
simplified `leave`'s body (`() => { if (current) close(); }` to `() => close();`) but did not touch
the missing guard. `306ceb54` extracted the hook into `useHoverCard.ts` on 2026-08-27 and carried the
line forward unchanged. So the gap is a week old and was there from the first commit that made touch
a customer of this file at all — nothing after it introduced or could have introduced the asymmetry.

## What would have caught the class, ranked

1. **Assert after the timer, not on the line after the gesture — cheap, and now done.** The new
   `describe` block costs a `vi.useFakeTimers()` and one `advanceTimersByTime` per test. Any hook
   with a debounce or a delayed close should get this as standard practice, not as an afterthought
   found by a browser pass.
2. **Derive the tap helper from a recorded real event stream, not from memory of the spec — cheap
   once, valuable everywhere `tap()` is reused.** `lift()` now exists and cites the Pointer Events
   spec directly rather than the previous comment's belief. The risk this doesn't fully retire: the
   next new document-level listener on a *different* event still has to be checked against the same
   spec by a human, because the helper only replays the events already known to matter.
3. **A convention that a document-level pointer/mouse listener's own comment states what it does for
   `pointerType: "touch"` — cheap to write, easy to skip in review.** Nothing enforces this
   mechanically; it is a habit, and `over`'s comment having the answer twelve lines from `leave`'s
   lack of one shows a habit is not durable protection on its own. Worth asking for in review of any
   new `document.addEventListener` on a pointer or mouse type, but it would not have caught this
   specific bug faster than the test fix above already did — the comment convention prevents the
   *next* one, not this one.
4. **A periodic mobile-viewport browser pass — most expensive, and what actually found this one.**
   The bug was found only because the glossary-everywhere feature was checked in Chrome with touch
   emulation at a phone viewport, as part of unrelated work. Nothing in the automated suite, as it
   stood, could have found it; a scheduled pass over the touch-carrying surfaces
   ([touch.md](../project/touch.md) names them) would catch a class no unit test reaches, at the
   cost of a human or an agent actually running one on a schedule rather than only when a feature
   happens to be re-checked.

**What this was not checked on.** Chrome with touch emulation, on this box — not a physical phone.
The physical-device questions in
[260827ak-touch-glossary-card.md](../plans/260827ak-touch-glossary-card.md) are still open.

## Related

- [260903l](../plans/260903l-glossary-underlines-in-every-mode-and-the-touch-card-that-closed-itself.md)
  — the plan this bug was found inside of; has the fix and the rest of that day's work.
- [touch.md](../project/touch.md), [glossary.md § The hover card](../project/glossary.md#the-hover-card)
  — where the feature this broke is documented.
- [silent-success.md](../reusable/silent-success.md) — the pattern this belongs to.
