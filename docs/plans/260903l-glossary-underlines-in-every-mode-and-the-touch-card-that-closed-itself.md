# Glossary underlines in every mode, and the touch card that closed itself

Greg asked for two things on 2026-09-03:

> The Glossary is really useful. If it has been generated, display the dotted-lines for Glossary
> terms in the text, no matter which mode is active. Make it work well for both desktop and mobile
> devices, i.e. hover-tooltips if there's a mouse, otherwise click to show, etc.
>
> — Greg, 2026-09-03

**The first half was already true and the second half was broken.** That asymmetry is the whole of
this piece of work, and it is worth stating plainly because the natural response to the ask is to
build the underlines again.

## The first half: measured, not assumed

[glossary.md § The underline is always there](../project/glossary.md#the-underline-is-always-there)
has claimed since 2026-08-26 that every entry is underlined in every mode, and
[`ProseHoverCard`](../../src/web/ProseHoverCard.tsx) is mounted outside the mode band in
[`App.tsx`](../../src/web/App.tsx) on purpose so the explanation survives the mode too. A doc saying
so is not evidence, so it was checked in a browser rather than believed:
`fowler-phrenology` (20 entries, 47 occurrences), Playwright against system Chrome, signed in,
counting `document.querySelectorAll('mark.term').length` in **every one of the thirteen modes** the
Dock offers.

| mode | `mark.term` |
|---|---|
| plain, hierarchy, outline, summary, glossary, ideas, quotes, timeline, search, referee, diagram, chat, remember | 47 each |

Visible in all thirteen, checked through computed `border-bottom-style` rather than by eye. **No mode
loses the underlines**, so there is nothing to build here. Two things that fell out of the check and
are worth keeping:

- The marks appear **1.5–3s after load**, not at first paint — the glossary read is async and the
  annotate pass follows it. Anything querying `mark.term` immediately gets 0 and is measuring its own
  impatience.
- Under Playwright's mobile emulation on this box, `window.innerWidth` misreports (423 for a 390px
  viewport); `document.documentElement.clientWidth` and `visualViewport.width` are right. For
  [browser-testing-playwright.md](../project/browser-testing-playwright.md).

## The second half: a tap opened the card and the same tap closed it

On a 390×844 touch context the card opened and was gone again in about 220ms, on every tap, in every
mode — and the second tap that is supposed to commit to glossary mode never committed, because by
the time it could land the card had already been taken down.

```
pointerdown 6197.6 → pointerup 6246.4 → pointerout/pointerleave 6246.8–6246.9
→ setTimeout(shut, 220) scheduled 6246.9 → card shown 6262.9 → card hidden 6497.8
```

One line, [`useHoverCard.ts`](../../src/web/useHoverCard.ts):

```js
/* Leaving the window entirely, which fires no `pointerover` at all. */
const leave = () => close();
document.addEventListener("pointerleave", leave);
```

A touch pointer does not hover, so the Pointer Events spec destroys it the instant the finger lifts —
and destroying it fires `pointerout` at the target and `pointerleave` at every ancestor being left,
`document` among them. This listener was written for a mouse leaving the window and never asked what
a finger does, so it heard every tap as one and armed the 220ms close against the card that tap had
just opened.

**It is spec behaviour rather than an emulator's invention** —
[Pointer Events § the pointerup event](https://www.w3.org/TR/pointerevents/#the-pointerup-event) —
which is the reason to expect it on real hardware. That is an inference from the spec plus one
measured Chrome trace, and **no physical phone was tested**; saying more than that would be the same
species of claim as the comment that caused this.

`over`, twelve lines above it, has had `if (event.pointerType === "touch") return;` since
2026-08-27 and a comment saying why. The fix is that line, in the second listener that needed it.

### Why the test suite was green through all of it

`tests/hover-card-touch.test.tsx` drives the hook with synthetic events and had 24 of them. Two
reasons it slept:

1. **Its `tap()` helper did not fire the leaving events**, because nobody writing it knew a lift
   fires them. The harness was a model of the gesture we had in mind rather than of the one the
   browser makes.
2. **Every assertion was synchronous**, and the close is a *timer*. Even with the events added, a
   card that opens and shuts itself 220ms later passes `expect(card()).toBe("alpha")` on the line
   after the tap.

So the fix needed both: the two events in `tap()`, and two tests that ask after
`HOVER_DELAY.close` has run. With the events added and the fix reverted, exactly those two go red
and the other 24 stay green — which is the measurement of how blind the file was.

## The simpler option passed over

**Close the card on touch only when something else says so** — drop the `pointerleave` listener
entirely and rely on the scroll, resize, tap-elsewhere and Escape dismissals that already exist.
It fixes the reported bug in fewer characters. It was not taken because that listener has a real
customer: a mouse leaving the window fires no `pointerover` on anything, so without it a card the
pointer left by exiting the top of the page stays up until the pointer comes back. Guarding the
listener keeps both readers; deleting it trades one broken device for another.

## The guard says "not touch", and a contact-only stylus is the gap in that

GPT Sol's review made the sharper version of the point the fix rests on: the spec keys that
post-`pointerup` `pointerout`/`pointerleave` sequence on **whether the device can hover**, not on
whether `pointerType` is `touch`. A stylus that only reports on contact is therefore a non-hovering
pointer wearing the name `pen`, and it takes the mouse path here.

**Left as it is, deliberately.** What that costs is bounded and is not the bug this fixes: the tap
path already rejects pen, so a contact-only stylus never had the two-tap card — it gets a card that
needs the stylus held still for 320ms and then loses it on lift, which is a card that does not appear
rather than one that flashes. Phrasing the guard by hover-capability instead means tracking each
pointer's own `pointerup` to tell "destroyed" from "moved away", which is real state added for a
device nobody here can test. The name `pen` is also what `over` and the tap path already sort on, and
a third rule in the same file would be the second way to answer one question.

Worth revisiting the day somebody reads on one. Sol's finding 1 — that the mouse and pen behaviour
this listener exists for had no test at all, so deleting the listener outright left all 26 green — was
straightforwardly right and is now four tests, one pair per pointer type.

## The other half of "works well on mobile": a 17px button

The same browser pass measured the card's **in the glossary** button at 17px tall — under WCAG 2.2's
24px and well under Apple's 44px. `padding-block: 0.4rem` on both foot controls takes it to about
30px, **with no media query**, and the `padding: 0` shorthand on `.prose-card-open` had to become
`padding-inline: 0` or it silently put the 17px back.

Fable arbitrated the sizing, 2026-09-03, and turned the question around:

- `(pointer: coarse)` is the obvious gate and is the one this codebase has already been stopped for
  ([touch.md](../project/touch.md)) — it describes only the *primary* pointer. Everything here decides
  per event from `pointerType`; CSS cannot see that, and a body class set from JS is a second
  mechanism for a 12px problem.
- **On touch the small button already passed.** WCAG 2.5.8 excepts a control with an equivalent
  elsewhere, and tapping the words again is exactly that. So this is comfort, not compliance — which
  is why ~30px is enough and 44px would be paying a primary control's price.
- **The reader who actually had no way through is the one holding a mouse**, for whom clicking the
  words selects text and this button is the only route. That is the argument against gating it behind
  a touch query at all, and it is the opposite of the one that suggested the query.

## How this was checked

- **The four mutations, each made and each watched go red.** Reverting the guard: 2 red. Deleting the
  `pointerleave` listener outright: 4 red. `leave` returning unconditionally: 4 red. Narrowing the
  guard to `mouse` and losing pen: the 2 pen tests red. Before the mouse/pen pair existed, the
  *second* of those left all 26 green — GPT Sol's finding, and the reason there are now 30.
- **In a browser, on the fix.** Card still up 1.6s after a tap; second tap commits to
  `?term=…&mode=glossary` on both a slow and a quick double tap; tap-elsewhere and scroll still
  dismiss; the mouse path opens at 320ms, closes at 220ms, and a `pointerleave` at the document with
  `pointerType: "mouse"` still closes the card in 245ms — the behaviour the listener exists for.
- `npm test`: 11001 passed, 8 failed, all 8 pre-existing on `dev` and unrelated (each re-run alone).
  Typecheck and Biome clean on the changed files.

## What this does not settle

The physical-device list from
[260827ak-touch-glossary-card.md](260827ak-touch-glossary-card.md) is unchanged and still needs a
real phone: whether iOS emits this sequence in this order, whether the callout menu stays away, and
whether two fast taps read as a zoom. What is now known is that the sequence Chrome emits closes the
card, and that it no longer does.
