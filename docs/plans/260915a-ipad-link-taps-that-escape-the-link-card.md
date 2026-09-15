# 260915a — iPad link taps that escape the link card

Report: SPIDERYARN-READING2-3Y, 2026-09-12, Greg, iPad home-screen app, Structure mode,
`noema-mythology-of-conscious-ai`, build `d358f773`.

> Sometimes when I click on a hyperlink to an article, it opens the external article. I'm on an iPad
> and I've shared the app to the home screen. So this is sort of annoying and disruptive. I thought
> we had a mechanism that when you click on a hyperlink, it opens a little panel and gives you
> options, actions. Why isn't that reliably intercepting the click?
>
> — Greg, 2026-09-12

## What the mechanism is, and where it can be walked past

Since 2026-09-04 ([links.md § On a coarse pointer the first tap reveals and the second
opens](../project/links.md#on-a-coarse-pointer-the-first-tap-reveals-and-the-second-opens)) a
finger's first tap on a link that leaves the app shows the card, and the second opens the tab. The
decision was made in one place: `pointerUp` in [`useHoverCard.ts`](../../src/web/useHoverCard.ts). If
that listener acted, it armed a swallow that cancelled the `click` iOS synthesises afterwards. **If it
did not act, nothing stood between the tap and the anchor's native `target="_blank"` navigation.**

So the interception was only as reliable as the `pointerup` test agreeing with the platform about
whether this was a tap, where it landed, and when its click would come. Every disagreement is an
escape. Six, from reading the code:

| # | The tap | Why `pointerUp` declined, or lost it | What the platform does |
|---|---|---|---|
| 1 | Finger lands on the text just beside a short link | the pointer events target the text; `closest(tapSelector)` is null | touch adjustment dispatches the `click` at the link |
| 2 | Finger drifts sideways more than 10px | `isTap` travel > `TAP_SLOP` | `td.text` is `pan-y`, so a sideways drift scrolls nothing and still clicks |
| 3 | The tap that clears a lingering selection | `hadSelection`, deliberately | the `click` follows the link |
| 4 | An Apple Pencil | the touch path takes `touch` only | a pen tap clicks like a finger |
| 5 | A press held past 600ms with no callout | `isTap` duration | a click |
| 6 | A tap `pointerUp` *did* act on, whose click comes late | the swallow's 400ms has run out | the click navigates, under the card the tap just opened |

Structure mode is not a factor: the prose is the same `.prose` cell in every mode that shows text
(TableView.tsx § `className="prose"`). The report was made there because that is where Greg was
reading. Which of these he hit cannot be read off the report — Sentry does not record the gesture.

## The fix: a tap on anything inside a link is decided at the click

The click is the event that navigates, and it is **the platform telling us it decided this was a
tap, and where** — after touch adjustment, after its own slop, for any pointer, whenever it arrives.
So for every tap target inside an `a[href]` — an external link, a glossary term inside one, a
footnote marker — the decision moves there entirely:

- **`pointerUp` steps aside** for a hit inside a link (it still owns bare glossary terms, below).
- **A capture-phase `click` listener on `document` decides** a click that is from a touch or pen
  (the most recent `pointerdown` was `touch`/`pen`, and `detail ≥ 1`, which a keyboard's Enter is not),
  whose target is inside an `a[href]` and resolves to a tap target outside the card. It cancels the
  click and stops it reaching TableView, then reveals — or, if that target's card is already open,
  commits: `window.open` for an external link, the glossary for a term, the note for a marker.
- **A live selection is left alone**: TableView's click handler already keeps that click from
  following the link, and a card must not commit on a drag. **A tap that cleared an earlier
  selection** (`hadSelection` at its `pointerdown`) is cancelled and opens nothing — it neither
  navigates, as it used to, nor reveals, which is the thing `hadSelection` exists to prevent.

That is possible because the reason the decision was put at `pointerup` in the first place no longer
applies to links. It was `mouseup`: TableView opens a comment or a chat thread from a `<mark>` on
`mouseup`, which comes before `click`. But `onMouseUp` now returns for anything inside `a[href]`
(TableView.tsx § "A link inside a commented passage is a link") after handling a real selection, so a
tap on a link has nothing on `mouseup` to be kept away from.

**Why it closes all six at once**: there is nothing left to agree. No prediction of the click from
the `pointerup`, no window to expire, and no record for grouped clicks to use up — each click is
decided on its own target and on what is open when it arrives.

**Bare glossary terms keep the `pointerup` path**, swallow and all. A term with no link around it
has nothing to escape to, and it *does* still need the `mouseup` kept away from TableView (a
`mark.term.chat` opens a chat thread there).

### The options passed over

- **Loosen `isTap`** — raise `TAP_SLOP`, drop the selection test, add `pen`. Closes some rows and
  never row 1, because no threshold makes a pointer event's target the node touch adjustment picked.
- **A net at the click under the `pointerup` path**, which was this plan's first draft. GPT Sol's
  review refused it: two paths that must agree about one gesture need a per-press state machine that
  survives grouped, late and missing clicks; the net would have committed on a drag inside a link
  whose card was open; and it rejected the simpler design for a reason (`mouseup`) that TableView had
  already removed. Its review is beside this plan.
- **Cancel every touch click on an external link without revealing.** Stops the escape, but the
  reader tapped a link and got nothing — the same complaint in a different shape.

### Scope, stated rather than implied

The promise is **the article's own links, in the prose**. Links a chat answer writes
(`a.cited-link`, `.chat-sources`) get the card on hover but are not tap targets, so on a finger they
still open on the first tap — links.md § The links chat writes decided that for them, and prints the
host inline instead. The lightbox caption and the comment dialog's note preview are the same. An
`<area>` in prose is not a tap target either; there are none in the corpus (links.md). None of those
were reported; they are named here so the promise is not read wider than it is.

## Stages

1. **Reproduce** — `tests/link-tap-escapes.test.tsx`, the hook mounted for real, with clicks landing
   on a different node, later, from a pen: one case per row. Watched red.
2. **Fix** in `useHoverCard.ts`; the comment in `ProseHoverCard.tsx` § `onCommit` that says it runs
   inside `pointerup`. `tests/hover-card-touch.test.tsx`'s harness had its chat-marked term inside a
   link; since the fix that shape goes through the click path, so the harness term comes out of the
   link and the linked-term cases live in the new file.
3. **Docs** — links.md and touch.md; the postmortem; the feedback note.

## Evidence

**Source research, 2026-09-15** (a subagent reading WebKit and Blink):

- **Row 1 is a real mechanism in WebKit, read from source.** `WebPage::attemptSyntheticClick` in
  `Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm` chooses the click's node and point with
  `nodeRespondingToClickEvents(point, adjustedPoint)` — a hit test separate from the raw touch that
  pointer events are dispatched from — and the click carries the adjusted coordinates. The search
  radius was not found.
- **Row 6 is real too.** WebKit holds a tap's click for up to ~350ms to rule out a double-tap zoom
  unless the page opts out (`touch-action: manipulation`, or a viewport at its initial
  `width=device-width` scale — webkit.org/blog/5610). The prose is `pan-y pinch-zoom`, not
  `manipulation`, and a reader who has pinch-zoomed is off the initial scale.
- Not confirmed from any source: WebKit's tap slop, whether a standalone web app shows the long-press
  link preview, and whether a tap that dismisses a selection also clicks. Row 4 (`pointerType:
  "pen"`) is documented by Apple.

**Measured in a real browser, 2026-09-15**: Chrome 152 headless on the box, 834×1194 with touch,
real touch input through CDP `Input.dispatchTouchEvent`, a page with the prose's own
`touch-action: pan-y pinch-zoom` and the old `pointerup` test copied in:

| Gesture | The old `pointerup` test | Native click on the link? |
|---|---|---|
| centred tap | acts | yes, cancelled |
| 4–12px off the link, finger radius 12 | acts (pointer target is the link) | yes, cancelled |
| 20px off the link | no link | no — the click also went to the text |
| **15px sideways drift** | **declines (travel 15 > 10)** | **yes, uncancelled — row 2** |
| 30px sideways drift | declines | no — Chrome's own slop killed it |
| 15px vertical drift | declines | no |
| **700ms hold, no movement** | **declines (707ms > 600)** | **yes, uncancelled — row 5** |
| pen (`pointerType: "pen"`) | not on the path | yes — row 4 |

Every tap's click carried `detail: 1`. Row 1 did **not** reproduce there — the pointer target and
the click target agreed at every offset — so it rests on WebKit's source, the engine Greg was on.

## The code review, and what it changed

GPT Sol reviewed the built code (…-review-code-sol.md, beside this plan) and fixed three findings.
**The one that mattered changed the shape.** The first build kept a single "most recent press"
record and committed when the clicked target was the card open when *that* press began. Sol showed
a first tap could still commit: a hovering Pencil's timer opens link A mid-press, the reader presses
B before A's delayed click arrives, and A's click reads B's record, which saw A open. So each
touch/pen press now leaves its own record in a queue, every touch/pen click consumes one in order,
and a click may commit only from its *own* record — which must be recent (2s), uncancelled, not a
pinch, and not ambiguous (a press that got no click leaves every later record for that stretch
reveal-only). A click with no record to match still reveals; it only loses the right to commit.

Sol also handled WebKit bug 282988, where a tap's click reports `pointerType: "mouse"`: a fresh
touch record outranks that field. **One fix on top of Sol's**, found reading its code: having
decided the click's type was wrong, it still matched the record by the click's `pointerId`, which on
that bug is presumably the mouse's, not the finger's — so the second tap would never have committed
on exactly the iPads the branch exists for. Safe (it only ever re-revealed), but a broken promise.
The id is now ignored whenever the type was corrected.

**The invariant, as it stands**: a click commits only if its own recent, unambiguous, uncancelled
press began with that exact element's card open. The card being open *now* never counts.

**The reproduction before any fix**: against the first draft's tests, 8 red and 5 green; the
rewritten file for this design is red on the same rows.
