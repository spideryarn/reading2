# A finger's "Highlight or comment" button docks at the screen edge, away from the iOS menu

Report `spya-bynh22` (SPIDERYARN-READING2-JQ, queue item `qi-83gpbgyg`), from Greg (admin, proven
by `feedback-reporter.ts`), 2026-10-18, on an iPhone:

> I tried to select some text on an iPhone, and I could see the iPhone, like, default standard menu
> for copy and other stuff on top, and I could see there was something underneath it. And if I
> clicked, you know, somewhere on the text, the iPhone menu disappeared, and I could see the
> Spideryarn menu to highlight or comment was still there. […] I guess we could do an offset so that
> both are present. That seems—well, I can't decide if that's elegant or ugly. Alternatively […] we
> add that [copy] to our Spideryarn context menu and then try and override the iOS-specific menu so
> that it doesn't show, if that's not possible. Well, let's look on the web whether there are any
> best practices or suggestions. […] But let's not create too much complexity.

Up: [touch.md § A finger's selection gets a button](../project/touch.md#a-fingers-selection-gets-a-button).

## What is wrong

`TouchSelectionChip.tsx` puts its button 1.25rem below the last line of the selected words, on the
assumption written in touch.md that *"iOS puts its own callout above them"*. That assumption was one
of the six things touch.md listed as unchecked on a real device (item 3: *"whether iOS ever puts its
own callout below the selection … and what the two look like together"*). Greg's report answers it:
iOS put its menu where ours was, and drew over it.

iOS shows its menu above the selection when there is room, and below it when there isn't — near the
top of the screen, or when the selection is tall. On a phone, with the masthead, controls bar or a
mode band taking the top of the screen, that happens often. Our button also appears 300ms *after*
the selection settles, so iOS has already placed its menu and cannot avoid ours.

## What the web says (research, 2026-10-18)

- **There is no supported web API that hides or repositions the selected-text menu while keeping
  native selection and scrolling.** `-webkit-touch-callout: none` is meant for the long-press menu
  over an element; in practice it does not stop the menu on selected text (ProseMirror forum; an
  unanswered Apple Developer Forums report says the same on iOS 26.1). The remaining tricks are
  `user-select: none` (no selection at all), `preventDefault` on `touchstart` (breaks scrolling), or
  removing and re-adding the selection to dismiss the menu (a hack its own author calls
  sub-optimal, and it races iOS on every version). None is worth it.
- **The page cannot steer where the menu goes either.** WebKit has a heuristic that hit-tests
  clickable elements above a selection and moves the callout below them
  (`WebPage::requestEvasionRectsAboveSelection`, added for Medium and Squarespace toolbars in 2019,
  repaired after the iOS 16 regression). It is internal to WebKit, not an author-facing API; reading
  the source, it returns nothing unless an element has focus, i.e. it is for editors, so it does not
  run for our prose, and it only ever looks above the selection.
- So **Greg's second option is not available**: we cannot hide the iOS menu, so we cannot replace
  it with our own Copy. (Copy is already in our box anyway: *Copy, don't highlight*.) Both menus
  stay. The question is only where ours goes.

Sources: WebKit `Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm` (main, read 2026-10-18);
WebKit r241971 and commit `ec3ec336` ("REGRESSION (iOS 16): System controls overlap website
controls"); discuss.prosemirror.net "How to disable the mobile Safari selection menu?";
developer.apple.com/forums/thread/808606.

## The change

**The button stops sitting under the words. It docks at whichever screen edge has more room between
it and them**: at the bottom, above the Dock and its hint strip as today, when there is more room
below the selected words; at the top, just under the top bar (`--bar-bottom`, which falls to the
safe area when the bar has slid away), when there is more room above. Across the screen it still
follows the end of the words, clamped inside the side safe areas, as it does today: the collision is
vertical, and on an iPad or a landscape phone a centred button would sit over another column.

```
 more room below the words          more room above the words
 ┌──────────────────────┐           ┌──────────────────────┐
 │ ════ top bar ═══════ │           │ ════ top bar ═══════ │
 │ [Copy|Look Up|…]  ←iOS│           │      [ Highlight or comment ]
 │ ▓▓▓▓ selected ▓▓▓▓   │           │                      │
 │ [Copy|Look Up|…]  ←or │           │ [Copy|Look Up|…] ←iOS │
 │                      │           │ ▓▓▓▓ selected ▓▓▓▓   │
 │      [ Highlight or comment ]    │ [Copy|Look Up|…] ←or │
 │ ═══════ Dock ═══════ │           │ ═══════ Dock ═══════ │
 └──────────────────────┘           └──────────────────────┘
```

The iOS menu hugs the selection, above or below it, so the edge with the larger gap is clear of it
and of both handles **for any selection that leaves room for the button at one edge**. A selection
tall enough to fill the screen leaves no such room, and nothing can promise clearance there; it gets
the larger of two small gaps. The extent is measured only over the part of the selection that is on
screen, against the layout viewport (`innerHeight`) that the fixed button is drawn in, so the edge
chosen and the edge drawn agree. **Pinch-zoom is a known limit**: zoomed in, the reader sees only
part of the layout viewport and the button can sit off the glass, as it could before this change
(§ Review of the code says why it stays). It also removes touch.md's "one known limit", where a selection
on the last line above the Dock had the button pushed up over its own words.

Everything else is unchanged: when it appears (300ms after the handles stop), touch-only, owners
only, hidden on scroll, a new touch or the handles moving, not shown while the words are off screen,
the 300ms grace, press on `pointerup`, and what the press does (applies a yellow highlight, clears
the selection, opens the box).

**What it gives up**: the button is no longer just under the words. On a phone that distance is
small and the bottom of the screen is where a thumb already is; on an iPad it can be a long way
down. One rule for both is simpler, and the iPad gets the same overlap whenever iOS puts its menu
below, so it needs the fix as much. At the top it sits over the mode band (z-index 50 over 44–46)
while it is shown.

### The simpler options passed over

- **A bigger offset below the words** (Greg's first idea). It works only when iOS's menu is above;
  when iOS puts it below, any offset small enough to look attached to the words still lands under
  it, and a large one is a docked button that wanders. Guessing which side iOS picks means
  re-deriving its layout rules, which are private and change between versions.
- **Hide the iOS menu and add Copy to ours** (his second idea). Not possible from a web page; see
  above.
- **Always the bottom edge.** One rule fewer, but a selection on the last lines above the Dock would
  have the button over its own words and lower handle (the known limit, made permanent).

## Code

- `TouchSelectionChip.tsx`: `endOf` becomes `placeFor`, which takes the clamped range's on-screen
  extent against `innerHeight`, returns `null` off screen as before, and otherwise `{ edge, left }`;
  the button gets `data-edge` and keeps `--chip-x`; `--chip-y` goes.
- `annotations.css` § `.touch-select-chip`: the horizontal clamp unchanged; `data-edge="bottom"`
  keeps today's lowest position (above `max(--dock-bottom, --safe-bottom)` and `--hint-now`);
  `data-edge="top"` sits at `--bar-bottom + 0.5rem`.
- Tests (`tests/touch-selection-chip.test.tsx`): short selections in each half; tall multi-line
  selections, entering from above and leaving below; the CSS rules for both edges. Written first
  and seen red.
- touch.md § A finger's selection gets a button: the "below the words" rule, unchecked item 3 and
  the known limit rewritten.

## Review of this plan

GPT Sol, read-only, 2026-10-18: *changes needed*, five findings, all taken: measure against the
visual viewport and listen to it (taken, then undone at code review, below); choose the edge by the larger on-screen gap rather than the
midpoint, and stop claiming clearance for a selection that fills the screen; keep the horizontal
position following the words rather than centring; dock the top edge under the bar
(`--bar-bottom`), not over it; narrow the platform claim to "no supported web API".

## Review of the code

GPT Sol, workspace-write, 2026-10-18: *approve*, after fixing one thing itself. The edge was being
chosen against the visual viewport while the fixed button is drawn in the layout viewport, so when
zoomed the right edge could be chosen and the button still drawn off the glass. Its fix threaded the
visual viewport's four offsets into the CSS and normalised range rectangles through the root
rectangle, to get round a WebKit coordinate bug (257375).

**Not kept.** It was correct, but it was about 70 lines of coordinate handling for pinch-zoom, which
the button never handled before, against Greg's *"let's not create too much complexity"*. Instead
everything is measured in the layout viewport, so choice and drawing agree, and zoom is written down
as a known limit. If a zoomed reader ever reports it, the approach above (visual-viewport offsets as
CSS variables, rectangles normalised through `document.documentElement.getBoundingClientRect()`) is
the place to start.

## Checks

- `npm test`, `npm run typecheck`, lint on touched files.
- Browser (Sonnet subagent, Playwright on the box, iPhone and iPad profiles): select near the top
  and near the bottom; the button is at the opposite edge, its press still highlights.
  **Playwright draws no iOS menu**, so the overlap itself cannot be reproduced here; Greg's device is
  the only check of that, and the note says so.
- GPT Sol on this plan (read-only) and on the code (workspace-write).

## Results

- Browser check, Playwright WebKit on this worktree's dev server, 2026-10-18 (Sonnet subagent):
  iPhone 13, words at y 83–135 → chip `bottom`, top 612 of 664
  ([shot 1](261018c-shot-1-iphone-words-top-chip-bottom.png)); words at y 420–472 → chip `top`, top
  76, just under the top bar ([shot 2](261018c-shot-2-iphone-words-bottom-chip-top.png)). iPad Pro
  11 the same both ways; 320px wide fully on screen; the press still highlights and opens the box.
