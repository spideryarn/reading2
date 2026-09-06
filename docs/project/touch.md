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
[260826f-ipad-touch-scrolling.md](../research/260826f-ipad-touch-scrolling.md).

## What happens where

| Where the finger goes down | A vertical drag does |
|---|---|
| A gist column at depth *d* — the panel over it, or the cell beside it | steps one item at that level |
| The prose column | nothing of ours: momentum, rubber-banding, stopping on a line |
| A gist column at the last item | moves one screenful on — see below |
| A gist column at the first item, swiping back | the same, upwards; this is how you get the masthead back by touch |
| The spine, the bars, anywhere else | nothing of ours |
| Outline mode, anywhere | nothing of ours — see [§ reading mode only](#reading-mode-only) |

Sideways drags are the browser's **except over the prose column**, which is `touch-action: pan-y` on
any coarse pointer since 2026-08-27 — Greg had asked for a finger drag to go one way or the other
and never diagonally, and `touch-action` is read when the finger goes down, so the axis has to be a
property of the region rather than of the gesture. A table too wide for the window can still be
panned by hand; you do it from a gist column rather than from the middle of a sentence. See
[260827t-mobile-reading-view.md § One axis at a time](../plans/260827t-mobile-reading-view.md).

A tap is still a tap almost everywhere: it jumps to the thing you tapped. **Four places reveal
first and act second**, and all for the same reason: they carry a hover card, and a surface with
no hover has to let the first press mean *show me* or the reader commits blind.

- **The spine**, whose bands are proportional, so most are a few pixels tall and tapping one blind
  is a coin flip. First tap opens the band's card, second goes there (Spine.tsx § bandPress). That
  is also the only reason the rail is usable by finger at all: everything it knows lives in a card.

  **The rail is 12px wide, and that is below every guideline by a factor of four.** It was 24px,
  which was already far below the 44/48px everyone recommends; Greg halved it on 2026-08-28
  ([260828ay-spine-rail.md](../plans/260828ay-spine-rail.md)) and the cost lands entirely here, because a mouse loses
  almost nothing — the rail is flush against the left edge of the viewport, and an edge target is
  the easy case under Fitts's law. A finger has no such help.

  What makes it survivable rather than acceptable is that **a mis-tap costs a card, not a jump**.
  Reveal-then-commit means the first tap on the wrong band shows you the wrong band's name and
  moves nothing; you slide a few pixels and tap again. The failure is a wasted gesture, which is
  the same failure a 44px target has when you miss it — and the second tap is the one that has to
  be accurate, by which point the card is telling you what you are about to press.

  **The obvious fix was considered and not built.** The plan proposed extending the hit targets
  12px to the right of the painted rail under `(pointer: coarse)`, which needs the painted layers
  moved into an inner `overflow: hidden` wrapper so `.spine-track`'s buttons can overhang. GPT Sol
  reviewed it and found enough underneath to stop: the overhang covers the first 12px of the mode
  band whenever one is open (the rail is z-index 45 and the band is 44, so the rail wins), it makes
  `elementFromPoint` return a depth-1 rail button over a strip of the table, and `(pointer: coarse)`
  describes only the *primary* pointer, so a hybrid device gets it wrong in one direction or the
  other — which is the same mistake `bandPress` already had to unlearn once. It is worth doing with
  a browser pass over the hit map behind it, and it is not worth doing blind in the same change
  that moves the width.
- **A glossary term in the prose**, since 2026-08-27 — the dotted underlines
  ([glossary.md](glossary.md)). First tap opens the hover card, second goes to glossary mode with
  that term selected, which is what the card's **in the glossary** button does. Before this the
  underline was a line with nothing behind it on an iPad, because the card was hover-only.
  [260827ak-touch-glossary-card.md](../plans/260827ak-touch-glossary-card.md) has the design and the event sequence,
  which is the whole of the difficulty; the short version is that it is decided at `pointerup`
  rather than at `click`, because the `mouseup` that comes between them is where the prose reads a
  selection and opens a chat thread, and a tap has to get past both.

  **The words a tap armed are marked** (`mark.term[data-hover-tap]`), and **a scroll closes a card
  a finger opened** — the panel follows its anchor for a pointer, which is right, but a finger is
  not resting on the words and the card would ride to the edge of the screen and stay there.

  **None of it worked between 2026-08-27 and 2026-09-03**, and the reason is the one trap on this
  page worth carrying to any other listener: **a lift fires the hover events too.** A touch pointer
  does not hover, so the spec destroys it at `pointerup` and fires `pointerout` and then
  `pointerleave` at every ancestor being left, `document` among them — so the hook's *mouse-left-the-
  window* listener heard every tap and closed the card 220ms after it opened, on every touch device,
  in every mode. Guarding it is one line, the same line `pointerover` has had since the day the touch
  path was built. What is worth reading is why 24 synthetic-event tests were green throughout:
  [260903g-the-touch-card-closed-itself-on-every-tap.md](../postmortems/260903g-the-touch-card-closed-itself-on-every-tap.md).
- **A link that leaves the app**, since 2026-09-04 — first tap shows the card, second opens the new
  tab. Greg had run into it on a home-screen iPad, where a link navigating in place replaces the
  whole app and there is no back button; [links.md](links.md#every-link-that-leaves-the-app-opens-a-new-tab)
  has the report, why the new tab is unconditional, and why it is keyed on `target="_blank"`.

  Note what did **not** change, because it is the interesting half: **a glossary term inside a link
  still goes to the glossary on the second tap.** `closest` returns the innermost match, so the
  term is the hit and the link never is — and reversing a rule a reader has already learnt, for 13%
  of this corpus's links, would have been worse than one case less consistent. The link is still one
  press away at the card's foot.

  It also inherits the trap above rather than avoiding it, so it was checked the only way that
  finding is worth anything: Chrome at 834×1194 with `hasTouch`, driven through CDP
  `Input.dispatchTouchEvent` so the browser generates the pointer stream itself. Synthetic events
  would have agreed with a broken build, and once did.
- **The shelf card's five action buttons**, since 2026-09-05 — first tap reads the control, second
  presses it. They are visible on a touch screen (`hover-none:opacity-100`, so that a control you
  cannot see is not also one you can hit by accident), and once
  [260905h](../plans/260905h-rich-tooltips-on-the-shelf-action-buttons.md) gave each of them a card
  saying what it does, the tap that opens the card was also the tap that archived the article.
  [260905i](../plans/260905i-reveal-then-commit-for-the-shelf-action-row-on-touch.md).

  **The gesture is one `onClickCapture` on the row, not five handlers on five controls**, and that
  is the one thing worth copying. Capture runs before any control's own click, so a reveal cancels
  the press outright — which is what makes a single handler cover controls that are not alike: an
  `<a>` whose default is to navigate, and two `IconButton`s that **refuse their own click** when
  drawn unavailable and so would never run an injected one. The button goes on refusing; the row
  has already stopped the event.

  It also puts five *controlled* tooltips inside one `<TooltipGroup>`, which is the shape
  [260828g](../postmortems/260828g-spine-hover-cards.md) ends by warning about — nine of that
  change's eleven tests go red if the identity guard on the close is removed.

## Why the prose is untouched

This is the load-bearing decision, and it came out of the research rather than out of caution.

**"Untouched" means we never move it for you.** Since 2026-08-27 the prose column does carry
`touch-action: pan-y`, which is a *constraint* on the browser's own scrolling rather than a
substitute for it: momentum, rubber-banding and stopping on a line are all exactly as they were,
and only the sideways axis is refused. Everything below still holds — no gesture of ours reads a
drag over the prose, and nothing alters its rate or duration.

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
repeating, is in [260826f-ipad-touch-scrolling.md](../research/260826f-ipad-touch-scrolling.md).

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

  **This is a rule for every gesture here, and two of them do not follow it.** `swipe.ts` and the
  shelf's action row take `touch` and `pen`; [`Spine.tsx`](../../src/web/Spine.tsx) § `bandPress`
  takes only `touch`, so a Pencil on a spine band jumps on the first press rather than revealing —
  and Floating UI classes `pen` as mouse-like, so no hover card opens for it either. Found by GPT
  Sol reviewing the shelf row on 2026-09-05 and **not fixed then**, because changing what a Pencil
  does in the reading view wants an iPad in front of it rather than a shelf change. Whoever has one:
  it is a two-word edit and the test beside it.
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

## How big a thing has to be to press it

> Also, make our button-bar at the bottom a bit easier to press, e.g. bigger buttons, slightly more
> spaced out.
>
> — Greg, 2026-08-28

The bottom bar's buttons are **52px tall and at least 40px wide on a coarse pointer**, up from
roughly 35 × 30. [`styles/narrow-window.css`](../../src/web/styles/narrow-window.css) § **a coarse pointer** — and three things about it are worth carrying
to anything else that has to be pressed with a thumb:

- **`pointer: coarse`, not `any-pointer: coarse`.** Everything else in this file keys on
  `any-pointer`, correctly: a gesture rule has to apply to a finger on a hybrid machine. A *size*
  rule must not, or an iPad with a trackpad and a laptop with a touchscreen get finger-sized chrome
  they will never touch.
- **Height was the affordable axis, and only because the bar learnt to leave.** The bar now slides
  off the bottom while you scroll forwards, on the same `data-bars="hidden"` switch the top bars have
  used since [260827t-mobile-reading-view.md](../plans/260827t-mobile-reading-view.md). Before that, 12px of bar was
  12px of article at every scroll position, and the same query was *shrinking* the bar on a landscape
  phone for exactly that reason.
- **Eleven buttons do not fit a 390px row at a size worth pressing**, and the row scrolls sideways
  rather than pretending otherwise. Greg chose that over hiding three of them behind a `⋯`. What it
  costs is that Tweets and Metadata are off the right-hand edge on an iPhone until you discover the
  bar scrolls; the two-row bar that would fix it properly is in
  [260828av-mobile-screen-real-estate.md § Open for Greg](../plans/260828av-mobile-screen-real-estate.md).

The rest of that work — the browser's own chrome, which is not ours to hide, and the Add to Home
Screen path that is the only way to be rid of it — is
[260828av-mobile-screen-real-estate.md](../plans/260828av-mobile-screen-real-estate.md).

## What the Enter key promises

> The keyboard on mobile devices should have a Done/Send button where
> appropriate, including this Feedback dialog box.
>
> — Greg, 2026-09-04

`enterKeyHint` is what labels the Enter key on a soft keyboard, and **the
decision is a product one, made box by box**. There are three kinds, and the
rule for a new box is to say which one it is:

| The box | What Enter does | What it carries |
|---|---|---|
| A single-line box whose Enter acts | searches, submits, commits | `search`, `go`, `done` or `send` |
| A multi-line box | inserts a newline | **nothing** |
| Everything else — a slider, a tick-box, a read-only field | — | nothing |

**A textarea must never say Send, even where Enter sends.** Two reasons, and the
second is the one that settles it: ⌘/Ctrl+Enter is what sends in most of this
app's multi-line boxes, and **iOS inserts a newline whatever the key is
labelled** — so the promise would be broken by the platform rather than by us.
[`AnnotateDialog.tsx`](../../src/web/AnnotateDialog.tsx) had already written the
same decision down as a trap worth naming. The two chat composers are the
exception in the other direction: Enter there really does send
([`ChatPanel.tsx`](../../src/web/ChatPanel.tsx)), so they say so.

**A promise with nothing behind it is worse than no promise.** The two boxes
that filter as you type — the shelf's search and the article search in words
mode — had no Enter behaviour at all, so Enter now dismisses the keyboard, which
is what the reader pressed it for and, on a desktop, hands the arrow keys back to
the article ([keyboard.md](keyboard.md)). Same reasoning made the sign-in form's
`next` move focus for real: Enter in a field of a form with a submit button
submits it, so a key labelled *next* would otherwise have fired a sign-in the
browser then refuses for an empty password. **And it moves whatever is in the
password box** — the first version moved only when it was empty, which meant that
with a manager's fill, the ordinary case, the key labelled *next* signed in
instead (GPT Sol, 2026-09-04).

**A key that promises to send has to refuse while the microphone is on.**
Labelling Enter *send* on a box with a microphone beside it creates a race the
box did not have before: press it mid-sentence and the rough live guesses go, or
on Safari and Firefox nothing that was said goes at all, and the microphone keeps
running. Every dictation-backed submitter now guards `dictation.armed` as well as
`readOnly`, and disables its button in both —
[dictation.md § Adding it to a box](dictation.md#adding-a-box-that-takes-dictation-somewhere-else).

Every box in `src/web/` is listed, with its decision, in
[`tests/what-the-enter-key-promises.test.tsx`](../../tests/what-the-enter-key-promises.test.tsx)
— a source sweep rather than twenty render tests, because the failure it guards
against is somebody adding a box and never asking the question. A new text box
fails that test until a line is added saying which of the three it is. The sweep
is an omission guard and **not** evidence that the key works:
[`tests/the-enter-key-really-sends.test.tsx`](../../tests/the-enter-key-really-sends.test.tsx)
mounts the boxes and presses it, including in the busy and recording states,
because a decision table that never touched a key stayed green with the handler
deleted.

**A "Done" key is not the answer to a keyboard covering a button.** That was the
first reading of the report above, and it is wrong: the Feedback dialog's problem
was that Send sat underneath the keys, which is a sizing problem —
[feedback.md § The keyboard, and the button under it](feedback.md#the-keyboard-and-the-button-under-it).
No floating toolbar or keyboard accessory was built, and none should be: it is a
large, fragile, iOS-only thing, and the reader's real need is to reach the button.

## One banner, once, when both will not fit

Past a crossover the mode band stops taking room from the article and is laid **over** it instead —
`bandCoversProse` in [`src/web/layout.ts`](../../src/web/layout.ts), and
[`styles/narrow-window.css`](../../src/web/styles/narrow-window.css) § a band with no room. That is the design ([reading-view-overview.md](reading-view-overview.md)), and from the outside
it reads as the text having disappeared.

> it's really designed for larger screens. It's possible to use it, but it can really only show
> either the mode panel or the text … You could also try it in Landscape, and this is a work in
> progress.
>
> — Greg, 2026-09-05

So a reader on a **coarse pointer**, in a window on the wrong side of that crossover, gets one
sentence at the top of the article saying so and naming **Plain** as the way back to the text.
[`SmallScreenHint.tsx`](../../src/web/SmallScreenHint.tsx), and
[260905e-a-small-screen-banner-on-a-phone.md](../plans/260905e-a-small-screen-banner-on-a-phone.md)
for the four decisions behind it.

**The contract is *until dismissed*, not *once*.** It is on every article and every visit until the
× is pressed, and then never again on that device. Greg's ask said "the 1st time", and this is
deliberately not that: a banner that spent itself on a visit where the reader happened to scroll
straight past would have explained nothing to the one person it is for. Nothing records a *view*;
the one bit in `localStorage` records a *press*.

**It asks the layout rather than a width**, and that is the part worth carrying elsewhere: an iPad in
portrait is 834px, which was *above* `MODE_MIN + PROSE_MIN` and *below* the real crossover with the
12px rail on. A gate written as the sum warned every phone and no iPad — the device it was most
obviously for — by two pixels.

**And the crossover has since moved, which is the better half of that story.** It is
`MODE_MIN + MODE_PROSE_FLOOR` and 700px since 2026-09-06, not 844, so that a phone in landscape gets
the band beside the article rather than over it —
[260906h](../plans/260906h-the-mode-band-beside-the-prose-on-a-phone-in-landscape.md) has why no
iPhone had ever cleared the old number, and [layout.ts](../../src/web/layout.ts)
§ `MODE_PROSE_FLOOR` has the constant. **The iPad is no longer a case at all** — 834px clears 700
with 134px to spare, so it gets the band beside the article and no banner.

The banner's *behaviour* followed the constant with no code change, because the gate is a fact rather
than a width. Its tests did have to move, and that is not the same claim: the two boundary widths
they pin (838 and 844) were chosen as the old crossover's neighbours, so they became 694 and 700 —
coordinates on the thing being tested, not copies of it.

**Landscape is suggested only when there is a landscape to turn to.** `moreRoomSideways` compares the
viewport's two sides; a phone already held sideways gets a different last sentence and not that
advice — and since the crossover moved, the offer is a real one: *"Landscape may have room for
both"*, because on a modern phone it now does. Note the crossover is a window rather than a device,
since `useWindowWidth` takes the safe-area insets out first, so a phone whose screen is 852pt
sideways is handed nearer 734.

**Arriving with a mode already open is the one case it does not cover**, and that is accepted rather
than solved. A covering band is `position: fixed` over the whole article, so there is no stable place
for a sentence underneath it, and left in flow the banner would land beneath the fixed corner logo —
the collision `.shared-notice` already hit in August. So `?mode=chat` on a phone shows the covering
band and no explanation until the reader reaches Plain. The default mode is Plain and a shared link
carries no mode, so the ordinary first arrival does get it.

It is a sibling of the install hint above it (`InstallHint`, [`install-hint.ts`](../../src/web/install-hint.ts)),
which tells an iOS reader how to get the browser's own chrome out of the way, and the two share
`media()` in [`src/web/media.ts`](../../src/web/media.ts). They say different things and sit in
different places: this one is in flow at the top of the article, that one is fixed above the dock.

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
- [260826f-ipad-touch-scrolling.md](../research/260826f-ipad-touch-scrolling.md) — the research, the sources, and
  the mechanisms we rejected
- [browser-testing.md](browser-testing.md) — and why it cannot help you here
