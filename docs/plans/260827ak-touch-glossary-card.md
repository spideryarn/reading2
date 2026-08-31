# Tapping a glossary term on an iPad

**Status:** built 2026-08-27. Reviewed by GPT Sol twice — nine findings at plan stage, five more on
the code — and both verdicts were *not ready*. § What the reviews changed says which landed.

> On an iPad, I want to be able to tap a dotted-underlined-glossary-entry in the text to see a
> preview, and maybe tap again or something else in the preview-panel to take me to Glossary mode.
>
> — Greg, 2026-08-27

## What is there today, and why a finger gets nothing

Every glossary term is dotted-underlined in the prose in every mode
([glossary.md](../project/glossary.md)), and resting a pointer on one opens the hover card
([`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx)), whose foot carries an **in the glossary**
button. On a touch device none of that happens, and deliberately —
[`useHoverCard.ts`](../../src/web/useHoverCard.ts) opens with:

```ts
if (event.pointerType === "touch") return;
```

with the reason written beside it: a touch fires `pointerover` on the tap and never fires the
leaving one, so the hover machine would open a card that stays until something else is tapped, and
the tap that opened it was probably the start of a selection.

That reasoning is about *hover*, and it is still right. What it leaves is a feature with no finger
affordance at all: on an iPad the underline is a line with nothing behind it.

## The shape

**The spine already solved this exact problem**, and the answer should not be invented twice.
Its bands are unreadable and un-hoverable, so `bandPress` in [`Spine.tsx`](../../src/web/Spine.tsx)
makes the first tap **reveal** the card and the second tap **commit** to the jump
([touch.md](../project/touch.md)). Same here:

| Finger does | Result |
|---|---|
| taps a `mark.term` | the hover card opens against those words, at once |
| taps the same words again | glossary mode, with that term selected — what **in the glossary** does |
| taps **in the glossary** in the card | the same thing; the card is interactive already |
| taps a different `mark.term` | that term's card, rather than committing to the first |
| taps anywhere else | the card closes, and that tap does whatever it always did |
| drags from a term | nothing of ours — a scroll is a scroll |

A **mouse is completely untouched**: every branch below is gated on `pointerType === "touch"`, which
is a fact about the press rather than about the device, so an iPad with a Magic Keyboard trackpad
keeps hovering and a touchscreen laptop gets both.

### Only `mark.term`, not `a[href]`

`ProseHoverCard` serves two selectors — glossary marks and the article's own hyperlinks. Only the
marks become tap targets. A bare link already does something under a finger (it navigates, or
`TableView`'s click handler jumps to the fragment), and taking that over to show a preview would be
replacing a working affordance with a worse one.

The overlap case is the interesting one: **13% of the links in this corpus have a glossary term as
their link text**, which is the whole reason the card is one card. A tap there hits `mark.term`, so
it opens the card and the navigation is swallowed (below) — and that is the right answer rather than
a regression, because the card carries *both* halves and its foot has **open in a new tab**. The
link is one further tap away instead of zero, and what the author means by the word is now zero taps
away instead of unreachable.

## The event sequence, which is where this will actually go wrong

This is the part a pure-function test cannot reach, and the part
[spine-tap.test.ts](../../tests/spine-tap.test.ts) says in as many words was missed last time: the
rule was right and the events never got to it.

**Handled on `pointerup`, not on `click`.** Three reasons, in order of how badly each bites:

1. **We have to swallow what follows.** A term inside an `<a>` must not navigate, and a `<mark>`
   carrying both `term` and `chat` (one element, two classes — [annotate.ts](../../src/web/annotate.ts)
   § MarkKind) must not also open a chat thread from `TableView`'s `onMouseUp`. `mouseup` comes
   *before* `click` in the compatibility sequence, so a decision made at `click` is already too
   late for one of the two things it needs to stop.
2. **iOS's click-bubbling quirk.** Taps on elements that are not clickable have a long history of
   not reaching `document`-level click listeners in Safari. Pointer events carry no such legacy.
3. It is where tap-versus-scroll is actually decidable, from `pointerdown` to `pointerup`.

So, all delegated on `document`:

- `pointerdown` (touch) — remember the pointer id and where it went down, and **disarm the last
  tap's swallow**. A second finger while one is already down drops the gesture: a pinch is not a
  tap, and zoom has to survive.
- `pointermove` — keep the **running maximum** distance from where the finger went down. Endpoint
  distance alone reads a drag that comes back as a tap, and a scroll that overshoots and settles is
  exactly that.
- `pointerup` (touch) — `isTap` first: the press has to be the primary one we started, to have
  travelled under **10px**, to have lasted under **600ms**, and to have had no live selection at
  *either* end. Then: inside `.hover-card` → do nothing (the reader is reaching for one of its
  controls); on a `mark.term` → open or commit, and arm the swallow; anywhere else → close, and
  **do not** swallow, because that tap is somebody else's.
- `pointercancel` — drop the gesture. This is what the browser sends when it claims the touch for a
  scroll, which is the common case, not an exotic one. It is not *sufficient*, which is why
  `pointermove` is tracked as well: a disallowed-axis drag, an edge gesture and at least one live
  WebKit defect all end in a plain `pointerup` instead.
- `contextmenu` — **undo**, not merely cancel. A long press on the prose is how a reader selects a
  phrase to ask about, and the spec declines to say whether `contextmenu` comes before or after
  `pointerup` — so it may arrive with the card already open and the swallow already armed. It takes
  back all three. The 600ms ceiling above is the guard for the case where it never comes at all.
- `focusin` — ignored within **700ms** of a finger. A touch browser focuses the `<a>` a tap lands
  in, and the keyboard path opens with no delay against whatever was focused, which would move the
  card from the mark to its enclosing link mid-gesture.
- `scroll` (capture) and `resize` — **close a card a finger opened**, and only one a finger opened.
  `autoUpdate` keeping the panel glued to its anchor is right for a pointer, because the pointer is
  on the words; a finger is not resting anywhere, so the card would ride to the viewport edge
  `shift` pins it to and sit over the prose with nothing to dismiss it.

**The swallow is a deadline, a place, *and* the next press**, which is the swipe's click-eater plus
the one thing it does that the first draft of this left out. [touch.md](../project/touch.md) has the
reason for the first two: a one-shot armed listener that never fires sits waiting for the reader's
next real tap. The third is the belt to that pair of braces — `swipe.ts` clears its arm on every new
`pointerdown`, so staleness is bounded by the next *gesture* rather than by a timer, and Safari not
synthesising a click cannot leave anything armed. So: eaten within **400ms** and **24px** of the
tap, disarmed by the `click` itself and by the next press. `click` gets `preventDefault` (it is the
one that navigates); `mouseup` gets `stopPropagation` only, because cancelling a `mouseup`
interferes with selection.

**Both are capture-phase on `document`, and that is load-bearing rather than tidy.** React delegates
at its root container, which is *below* `document` and therefore sees a bubbling `mouseup` before
any document-level bubble listener would. A swallower in the bubble phase stops nothing that
matters.

**A selection wins over everything.** A drag that ends inside a term is the reader choosing a
phrase, and `TableView`'s `onMouseUp` turns that into a question. Opening a card there would be bad
on its own; swallowing the `mouseup` that reads the selection would take a working feature away.

## Why not the obvious cheaper versions

- **Reuse `pointerover` with a tap-to-close.** That is the thing the existing comment refuses, and
  it refuses it correctly: `pointerover` fires on the tap *before* `pointerdown`, so a scroll that
  merely began on a term would open a card.
- **Make the card `role="tooltip"` and let a long-press do it.** iOS reserves long-press for
  selection and the callout menu, and fighting that is how you get a text selection and a card at
  the same time.
- **`cursor: pointer` on the mark so click bubbles on iOS.** A workaround for a mechanism we are not
  using, and it would change the desktop cursor, which `styles.css` argues for at length (`help`
  rather than `pointer`, because a pointer cursor promising a click is "the small lie that makes
  people click twice").

## What gets built

- `src/web/useHoverCard.ts` — two new options, `tapSelector` (which targets a finger opens) and
  `onCommit` (what a second tap on the open target does), plus the four listeners above. The hook
  stays generic; nothing in it learns what a glossary term is.
- `src/web/ProseHoverCard.tsx` — passes `tapSelector: "mark.term"` and an `onCommit` that closes
  the card and calls `onOpenTerm`, which is exactly what the **in the glossary** button already
  does. **Only when the mark carries one term**: where two overlap the same phrase the card draws
  both and says why picking one would be picking for the reader, so a second tap there does nothing
  and leaves the two named buttons to answer.
- `mark.term[data-hover-tap]` in `styles.css` — which words are armed for the second tap. Not
  `[data-term-open]`, which already means "pressed in the glossary panel", and not `:hover`, which
  iOS makes sticky.
- `tests/hover-card-touch.test.tsx` — the hook mounted for real, driven by synthetic pointer
  events, asserting the sequence rather than a rule. Written red first, and both of its two
  load-bearing assertions were then checked against a deliberately broken build: moving the
  swallower out of the capture phase, and removing the selection guard, each turn exactly one test
  red. The harness is a `mark.term.chat` inside an `<a>` inside a React ancestor carrying
  TableView's own `onMouseUp` and `onClick`, so "the click was cancelled" is not the whole of what
  is proved.
- `docs/project/touch.md` and `docs/project/glossary.md` get the behaviour; `tooltips.md` gets the
  pointer to it.

## What a desktop browser did confirm

**The reading view is behind the sign-in gate and a harness driving Chrome cannot get past it**, so
this was checked on a throwaway `touch-glossary-preview.html` at the repo root, mounting the real
`ProseHoverCard` over real injected marks with the real stylesheet, and carrying TableView's own
`onMouseUp`/`onClick` on the container so a swallow that did not happen shows up in a log rather
than having to be reasoned about. Chrome has a real `PointerEvent` constructor, so synthesised
`pointerType: "touch"` events are genuine ones — which is the half jsdom cannot give.

Confirmed 2026-08-27, and then re-confirmed against the finished code after the second review
changed it: mouse hover unchanged; one tap opens the card with `data-hover-tap` set and the tooltip
painted (`oklch(0.26 0 0)`, not transparent) and inside the viewport; neither of the ancestor's
handlers fires; a second tap logs `OPEN TERM`; a two-term mark draws both entries and refuses to
commit; a tap on a term inside a link cancels the click and does not navigate; a tap elsewhere
closes the card *and* reaches the ancestor; a real wheel scroll closes it; a 150px drag does not
open it; a live selection blocks the tap and the ancestor sees the `mouseup`; a tap held 428ms still
counts. No console errors.

The preview page was deleted afterwards, as the two before it were. It is worth rebuilding rather
than reinventing: the auth gate is not going away, and the file is thirty lines.

## What only a real iPad can tell us

The harness browser is a desktop Chrome, so `pointerType` is never `"touch"` unless we synthesise
it, and `@media (any-pointer: coarse)` never matches
([260827t-mobile-reading-view.md](260827t-mobile-reading-view.md) § How it was measured). The checks that need a
device:

1. Does the first tap open the card **without** selecting the word or showing the callout menu?
2. Does a scroll that starts on a term scroll, every time, rather than opening a card?
3. Does the second tap reach glossary mode — and does a *double*-tap (two fast taps) do that rather
   than zooming the page?
4. Does a tap on a term **inside a link** stay on the page, and does **open in a new tab** in the
   card still work?
5. Does the card land somewhere readable in portrait, where the words may be near the top or the
   bottom edge?
6. Does a tap elsewhere both close the card and do its own job — tapping a gist cell should jump.

## What the reviews changed

### The plan review

GPT Sol reviewed the plan above and returned nine findings and the verdict **not ready to build**.
Seven were taken; the answers to the other two are here because a decision that went against the
advice is the one worth writing down.

**Taken.** A long press selects without moving, so it needed catching by `contextmenu` and by the
live-selection test rather than by distance (1). The test had to mount a React ancestor with
TableView's own handlers, because `click.defaultPrevented` passes while a chat thread opens behind
it (2). A touch-opened card had to close on scroll and on rotation, which `pointercancel` does not
do (3). A second tap on a mark carrying two terms had to do nothing rather than pick the first (4).
The swallow had to disarm on the next `pointerdown`, as `swipe.ts` already does (5). `pointercancel`
alone is not enough to spot a scroll, so `pointermove` tracks the running maximum (6). The tapped
words needed a visible state of their own, and it could not be `[data-term-open]` (7, in part).

**Not taken, and why.**

- **"Prefer card-only commit"** — drop the second tap and make the card's button the only way
  through. The argument is that the spine analogy is weak, since a spine band is unreadable and a
  term is right there in the sentence. That is true and it is not the reason the spine reveals
  first; the reason is that a surface with no hover has to let the first press mean *show me*. Greg
  asked for both routes by name, the button is a line of 10px text and the words are a whole
  phrase, and the overlap case that motivated most of the objection is now handled by doing
  nothing. Kept, with the visible state the finding also asked for.
- **A shared swallower across `swipe.ts` and this hook.** The review says in the same breath that
  the two cannot normally arm each other — their surfaces are disjoint and neither arms from mouse
  events — and that the real risk is a stale arm, which disarming on `pointerdown` fixes in both.
  One mechanism in two files, each a dozen lines, beats a third file both must import; the 400ms
  here is not drift from the swipe's 120ms but a different measurement, from `pointerup` to the
  compatibility click rather than from the end of a gesture to a synthesised one.
- **`touch-action: manipulation`** was never in the plan and stays out: it does not apply to inline
  elements, and on the cell it would give back the horizontal panning `pan-y` deliberately refuses.

### The code review, which is the one that mattered

It found a hole the plan review had asked about and the code had answered badly, and four ways the
test file was proving its own setup. All of it was taken.

- **The long press could still get through, three ways.** `contextmenu` merely cancelled a *pending*
  press — but the Pointer Events spec declines to fix where `contextmenu` sits relative to
  `pointerup`, so it can arrive after the card is already open and the swallow already armed. It now
  **undoes** all three. A tap whose whole job was to *dismiss* a selection had already collapsed it
  by `pointerup`, so asking then said "no selection": the selection is read at `pointerdown`
  instead. And a press simply held, with no movement, no selection and no `contextmenu`, passed
  everything: `isTap` now has a 600ms ceiling. `isPrimary` joined the second-finger check.
- **A touch could leak through the keyboard path.** `focusin` opens with no delay and marks the card
  as pointer-opened; a touch browser focuses the `<a>` a tap lands in. That would move the anchor
  from the mark to its enclosing link, drop the tapped styling, and turn the next tap into a second
  reveal. `focusin` now ignores anything within 700ms of a finger.
- **`currentRef` was cleared on two closing paths and not the other two.** The effect teardown and
  the anchor-replacement observer both closed by `setShown(null)` alone, so after a `selector`
  change the next tap on that mark read as a *second* tap and committed. And the duplicated
  `byTouch` local is gone: one flag, in the ref, because two of them could disagree — a pointer
  coming to rest on a touch-opened card now takes ownership of it, or a scroll would dismiss a card
  the reader is pointing at.
- **Four tests were checking the harness.** The drag test only dragged *away*, so replacing the
  running maximum with the endpoint distance left everything green — there is now a drag that comes
  back to where it started. The scroll test dispatched on `document`, which passes without the
  capture flag — it now dispatches a non-bubbling `scroll` from a nested scroller. The unmount test
  fired at a detached node, which a leaked listener never sees — it now taps a freshly connected
  mark, and deleting every `removeEventListener` turns it red. Six mutations were run against the
  finished code and five turn exactly one test red each; the sixth (leaking `pointerup` alone) is
  inert, because React drops a state update on an unmounted root and nothing else is left to
  observe.
- **Noted, not changed:** `onCommit` leaves the card open and arms the swallow before calling the
  consumer, so a consumer that acts without closing makes every later tap a swallowed no-op. That is
  the price of letting a consumer decline, and it is now written on the option.

**VoiceOver has no path to this, and that is stated rather than solved.** A `<mark>` is not
focusable — making several hundred of them into tab stops is the thing `focusable` refuses in as
many words — so a reader using VoiceOver reaches a term through **glossary mode**, where every term
is a real button in a real list. That is a worse route, not no route, and it is the honest position
until someone asks for better.

## Deliberately not done

- **No touch affordance on the card beyond what is there.** No close button, no "tap again" hint.
  The foot already says **in the glossary**, and a hint that only appears on touch is a second
  thing to keep true.
- **Nothing for the links.** See above.
- **No long-press anything.**
