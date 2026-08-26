# Touch: a swipe in a column steps, the prose scrolls

> We're going to want to read on an iPad a lot.
>
> Can we play with the way touch-scrolling works so that it jumps step-by-step if I scroll within a
> column, kinda like the up/down buttons?
>
> — Greg, 2026-08-26

**A vertical swipe over a gist column moves you exactly one item at that column's level.** The
column you touch says how big a step is; the swipe says which way. It is the finger's version of
what the pointer and the arrow keys already do ([keyboard.md](keyboard.md)), and it runs on the same
arithmetic — `stepTarget` and `scrollToBlock` — so a finger and a key cannot drift apart about where
"the next section" is.

**A finger on the prose column gets ordinary iPad scrolling**, and that is the design rather than a
limitation. See [§ why the prose is untouched](#why-the-prose-is-untouched).

The code is [`src/web/swipe.ts`](../../src/web/swipe.ts) — one pure function and one hook over six
window listeners. The reasoning, the sources and the two mechanisms we rejected are in
[ipad-touch-scrolling.md](../research/ipad-touch-scrolling.md).

## What happens where

| Where the finger goes down | A vertical drag does |
|---|---|
| A gist column at depth *d* — the panel over it, or the cell beside it | steps one item at that level |
| The arc column (L0) | steps one **part**, the same rung ← / → reach |
| The prose column | nothing of ours: momentum, rubber-banding, stopping on a line |
| A gist column at the last item | moves one screenful on — see below |
| A gist column at the first item, swiping back | the same, upwards; this is how you get the masthead back by touch |
| The spine, the bars, anywhere else | nothing of ours |
| Outline mode, anywhere | nothing of ours — see [§ reading mode only](#reading-mode-only) |

Sideways drags are always the browser's, wherever they start, so a table too wide for the window can
still be panned by hand. A tap is still a tap: it jumps to the thing you tapped.

## Why the prose is untouched

This is the load-bearing decision, and it came out of the research rather than out of caution.

NN/g's [Scrolljacking 101](https://www.nngroup.com/articles/scrolljacking-101/) found the most severe
usability damage in one specific case: pages that altered the rate and duration of scrolling **while
also requiring the reader to read text**. Participants were disoriented; some read it as a bug and
tried to reload. That is a precise description of what this feature would be if it applied to the
prose column, so it does not.

The gist columns are not that. They are navigation — a table of contents you look at rather than
read through, where a tap is already a command. And continuous scrolling in one carries almost no
information anyway: item heights vary by orders of magnitude, so dragging through a part-sized cell
shows you the same unchanging gist for several screens. **The column's content only changes at item
boundaries, so the item is that column's natural scroll quantum.** Stepping is not taking a
capability away; it is collapsing travel that showed you nothing.

And the way out is spatial rather than modal: the prose is a few centimetres to the right, and you
find it by doing the obvious thing. There is no setting to discover, which is deliberate — see
[§ what we deliberately did not build](#what-we-deliberately-did-not-build).

## Reading mode only

Outline mode gets nothing. `showText` is false there, so **there is no prose column** — the whole
width is gist columns — and taking their vertical scrolling away would leave the page with no
surface that scrolls continuously at all.

The gate is in two places on purpose, and both are needed. The hook is disabled, but a disabled hook
does not put native scrolling back: `touch-action` is CSS, and it stops the gesture reaching the
scroller whether or not any JavaScript is listening. So [`TableView.tsx`](../../src/web/TableView.tsx)
emits the `data-swipe-step` attribute only in reading mode, and the stylesheet keys off the
attribute.

## Why a gesture, and not `scroll-snap`

CSS scroll snap was the obvious answer and it is not the one we took. On iOS it very nearly comes
free: an [open WebKit bug](https://bugs.webkit.org/show_bug.cgi?id=243582) means turning snapping on
kills native momentum, so a swipe already moves one snap point rather than flinging past many.

Four things ruled it out, and they are worth knowing because "why not just snap?" is the first
question anyone will ask:

- **It would be built on a bug.** That behaviour is an acknowledged WebKit defect, discussed as
  recently as August 2025 and presumably one day fixed. The day it is, stepping silently becomes
  flinging again — a feature that stops working with nothing to show for it
  ([silent-success.md](../reusable/silent-success.md)).
- **Snapping applies to programmatic scrolls**, `scrollTo()` explicitly included
  ([spec](https://www.w3.org/TR/css-scroll-snap-1/)). `glide()` in
  [`scroll.ts`](../../src/web/scroll.ts) calls `scrollTo` once per animation frame, so every frame of
  every jump — arrow keys, gist clicks, spine clicks, deep links — becomes a scroll the browser may
  re-target.
- **Moving the snap points jumps the page, and the spec says it must.** Measured in Chrome:
  rewriting which cells carry `scroll-snap-align` moved the document 184px synchronously, with no
  gesture and no elapsed frame, reproduced twice against a clean control. Changing the aimed level is
  exactly that operation. And [§ Re-snapping After Layout Changes](https://www.w3.org/TR/css-scroll-snap-1/) *requires* the
  re-snap, animating it "the same way as any other scroll-into-view operation" — which defaults to
  instant. So this is conforming behaviour, not a bug to wait out. On a desktop, where the aim
  follows the pointer, it would lurch the page every time the mouse crossed a column boundary.
- **It would not have saved the gesture handler anyway.** Snapping is per-scroller and the page is
  the scroller, so it still has to find out which column the finger landed in and rewrite the CSS
  before the gesture — which is the buggy path, run before every swipe.

The full account, including the two arguments that turned out to be **wrong** and are worth not
repeating, is in [ipad-touch-scrolling.md](../research/ipad-touch-scrolling.md).

## How it is wired

- **The rule goes on the `<td>`, never the `<tr>`.** `touch-action` is defined to apply to "all
  elements except non-replaced inline elements, **table rows**, row groups, table columns, and column
  groups" — so the obvious home for a per-row rule is exactly where the property is ignored, silently
  ([silent-success.md](../reusable/silent-success.md)).
- **`touch-action`, never `preventDefault`.** The browser is told before any listener runs, which
  keeps scrolling off the main thread and avoids the input lag of waiting to see whether a handler
  cancels. It also sidesteps a real trap: Safari does **not** make touch listeners passive by
  default the way Chrome and Firefox do, so the `preventDefault` route would have worked here and
  quietly done nothing elsewhere.
- **The step fires on release, never during the drag.** iOS defers `requestAnimationFrame` callbacks
  while a finger is down, and `glide()` is rAF-driven — a jump started mid-drag would stall and then
  lurch when the finger lifted.
- **A finger on a swipe surface no longer aborts a jump in flight.** `glide()` gives up the moment
  the reader touches the screen, which was right when a touch mid-jump was a rare accident; touch
  stepping makes it the normal case, since every swipe starts with a `touchstart`. Left alone, each
  gesture would truncate the previous one's glide and a rested finger would park the page between two
  items. On the prose, a touch still stops us dead.

  The exception is narrower than it sounds: `touch-action: pan-x` takes away *vertical* scrolling on
  those surfaces and deliberately leaves horizontal panning to the browser, so a touch there can
  still be the reader scrolling — just never on the axis this animation writes. The gap that leaves
  is a sideways pan started from a gist column, and `pointercancel` closes it: the browser fires it
  the moment it claims the gesture for itself. Not *only* for a pan, though — zoom, palm rejection,
  device loss and too many pointers all suppress a pointer stream too. Every one of them means the
  same thing here, so cancelling is right in all of them; what would be wrong is concluding from a
  `pointercancel` that the reader panned, which is why the swipe drops its chain rather than
  assuming.
- **The touch-down column owns the whole gesture.** You aimed when you put your finger down; the
  finger wandering into the next column on the way up is the gesture, not a change of mind.
- **A second finger cancels.** Pinch-zoom has to survive, so anything that is not the primary touch
  pointer drops the gesture.
- **An Apple Pencil counts as a finger.** iPadOS reports it as `pen`, and it drags a page exactly as
  a finger does — and `touch-action` constrains it too. Accepting only `touch` would have left every
  gist column dead under the Pencil: native scrolling gone, and nothing put back. A mouse is still
  excluded, by that check and by the media query on the CSS.
- **The ends of the article move a screenful**, rather than doing nothing. This is the one place the
  swipe cannot copy the keyboard: at the ends, a key simply declines to handle itself and the browser
  scrolls the last screenful into view
  ([keyboard.md](keyboard.md#what-we-gave-up)). A swipe has no such move — `touch-action` refused the
  gesture before any listener ran — so silence would leave every gist column **inert** for the last
  item of the piece, which reads as broken rather than as finished.

  **A screenful and not a run to the end**, which was the first version of it. Going to the bottom of
  the document broke the promise the whole feature rests on — one gesture, one bounded movement. From
  part-way through a part spanning a quarter of the article, one stray swipe threw the reader to the
  very bottom. A screenful is what the keyboard actually degrades to.

  It is **bounded, not reversible**, and the difference is worth stating because an earlier draft of
  this file claimed the stronger thing. Swiping back from the tail of the last item does not return
  you a screen; it goes to that item's *start*, because that is the track-skip rule ↑ follows
  everywhere ([keyboard.md](keyboard.md#-is-not-the-mirror-of-)). So you cannot get lost, and you can
  always get back to a boundary you recognise — but the two directions are not undo and redo here.

  The screenful is measured net of **both** obstructions, the sticky header and the bottom dock.
  Subtracting only the header would land the next screen's top where this one's bottom notionally
  ended — and its bottom 40px was behind the dock the whole time, so a strip of lines would never be
  read at all. Repeated at the end of a long part, that silently skips text.

  Repeated swipes chain in pixels, the same way stepping chains in rows: the second measures from
  where the first was *going*, not from how far it has animated, or two swipes would deliver about
  one and a half screens.
- **The click afterwards is eaten.** A gist and a panel entry are both tap-to-jump, and a swipe that
  ends on one makes the browser synthesise a click — without swallowing it, every swipe would also
  fire `onJump`. One capture-phase listener with a **deadline and a place**, rather than a fresh
  one-shot listener per swipe: a one-shot never fires when the swipe ends on nothing clickable, so it
  sits armed for the reader's next real tap, and two quick swipes stack two of them. A single
  listener cannot stack and expires whether or not a click arrives — but the deadline *alone* has
  that same first fault in bounded form, so the click must also land within 24px of where the finger
  came up. A synthesised click does; a deliberate tap somewhere else gets through however soon it
  comes.

  It covers `mouseup` as well as `click`, because the app acts on both — TableView opens a comment
  from a `mark.cmt` on `mouseup`, so a swipe that drifted sideways over a marked phrase would
  otherwise open a dialog nobody asked for. `mouseup` is only stopped, never cancelled: cancelling it
  suppresses the click we are about to want, and interferes with text selection.

  The window is 120ms, not the 400ms it started at. Once position joined the test the extra
  generosity stopped being free and started eating a natural gesture — swipe a panel entry up to
  bring the level along, then tap the entry now under your finger, same place and well inside 400ms.
  There is no delayed click left to cover: `index.html` sets `width=device-width`, which is what
  removed iOS's old 350ms tap delay.
- **Rapid swipes chain from the last target**, for the same reason and by the same rule the keyboard
  does ([keyboard.md](keyboard.md#rapid-presses-chain-from-the-last-target-not-from-the-page)).
  Touch keeps its own chain, and four things clear it: a finger landing outside a swipe surface,
  which is how the reader grabs the prose; a `wheel` event, which is how an iPad scrolls with a Magic
  Keyboard trackpad attached and no touch pointer involved at all; **a click we did not cause**,
  which means a tap jumped somewhere and our idea of where the reader was heading is now wrong;
  **`pointercancel`**, which means the browser took the gesture and the jump we were part-way through
  never arrived; and the effect being torn down, which is what a rotation or a split-view resize does — clearing the
  timer without clearing what it was going to clear would freeze the chain rather than expire it.
- **Distance, not speed.** There is no velocity term, so a slow deliberate drag and a quick flick of
  the same length mean the same thing. That is what keeps the feature free of a timer and stops it
  behaving differently for a tired hand.

## What we deliberately did not build

- **A setting.** Apple Books and Kindle both ship an explicit continuous-scroll / page-turn toggle,
  which is the precedent — but theirs governs **how the prose paginates**, and this never touches the
  prose. The toggle here is spatial and already exists: finger on prose, or finger on gists. A
  preference costs a thing to find and a thing to be wrong about, on an experiment with one reader.
  If one is ever wanted, the house pattern is a URL parameter ([url-state.md](url-state.md)).
- **Snap-back or settling after a native scroll.** "Wherever you stop, aligned to the nearest
  boundary" is a real third option and is written up in the research doc. It is not what was asked
  for — it gives alignment, not one-gesture-one-step — but it is the fallback if the release-only
  gesture turns out to feel dead under the finger.
- **A visual drag response.** Nothing moves until you let go. This is the most likely thing to feel
  wrong on a real device, and it is the first item on the checklist below.
- **Anything for the spine.** It is a navigation rail with its own tap targets and it is narrow; a
  swipe there would compete with the tap it exists for.

## What only a real iPad can tell us

None of this is testable from a laptop, and the automation browser is worse than useless here — its
tab is hidden, so `requestAnimationFrame` never runs and neither does anything downstream of it
([browser-testing.md](browser-testing.md)). The pure arithmetic is pinned in
[`tests/swipe.test.ts`](../../tests/swipe.test.ts) and
[`tests/scroll.test.ts`](../../tests/scroll.test.ts) — the latter added after a cross-family review
pointed out that both bugs in the screenful step were arithmetic, and neither had needed a browser to
find. Everything below is a hand check.

In rough order of how likely each is to change the design:

1. **Does it feel dead?** Nothing moves until release. If the first instinct is to swipe again,
   harder, the gesture needs to track the finger — which is the one thing snapping gives for free,
   and the reason to reconsider it.
2. **Is one swipe exactly one item**, including a violent flick? This is the guarantee the whole
   mechanism was chosen for.
3. **Does a tap still jump**, and does a swipe never jump? The swallowed click is the seam between
   them — and check the awkward one: a deliberate tap very shortly after a swipe must still land.
4. **Does a swipe at the last item run to the end**, rather than doing nothing?
5. **Does a sideways drag still pan** a table too wide for the window, starting from a gist column?
6. **Does pinch-zoom still work** over a gist column, and over the prose?
7. **Is the prose genuinely untouched** — momentum, rubber-banding at the ends, stopping on a line?
8. **Rapid swipes**, one inside the 200 ms glide, land exactly one item apart rather than two.
9. **Rotate the iPad.** Column auto-fit changes which columns exist; the aim must not survive into a
   column that no longer does.
10. **VoiceOver**, and Switch Control. Both intercept touches before the page sees them, so
    `touch-action` should not be in their path — but no source confirms it for a case like this.
11. **Pinch-zoom over a gist column.** If it does not work, the `pinch-zoom` keyword did not parse
    and the plain `pan-x` fallback is what took effect. The feature still works; zooming those
    columns does not. Low stakes — `pinch-zoom` is a standard value that Safari has supported since
    13, so the fallback is belt-and-braces rather than an expected outcome.
12. **An Apple Pencil**, which should behave exactly as a finger does.

**`prefers-reduced-motion` is honoured**, and inherited rather than re-implemented: every jump goes
through `scrollToBlock`, which routes past the animation to an instant `scrollTo`
([`scroll.ts`](../../src/web/scroll.ts)). Note what that means — a reduced-motion reader still gets
the position *change*, just not the travel.

## See also

- [keyboard.md](keyboard.md) — the same step, taken with keys, and where the stride idea comes from
- [granularity-zoom.md](granularity-zoom.md#the-tabular-view) — the view being scrolled
- [column-context.md](column-context.md) — the fixed panel a finger actually lands on
- [ipad-touch-scrolling.md](../research/ipad-touch-scrolling.md) — the research, the sources, and
  the mechanisms we rejected
- [browser-testing.md](browser-testing.md) — and why it cannot help you here
