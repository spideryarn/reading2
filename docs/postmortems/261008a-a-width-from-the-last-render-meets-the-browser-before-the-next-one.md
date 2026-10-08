# A width from the last render meets the browser before the next one

**Report:** Greg, an iPhone and an iPad, production, 2026-10-08 (`spya-gxbwug`, SPIDERYARN-READING2-EP).
**Plan:** [261008b](../plans/261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md).

> On iPhone and iPad, sometimes the layout and zoom gets a little bit messed up after, for example,
> switching from portrait to landscape […] on iPad, afterwards sometimes the bottom bar will be
> appearing, you know, partway up the screen, or the article text won't take up all of the
> horizontal space...
>
> — Greg, 2026-10-08

## What happened

Both symptoms are one state: a page scale below 1. At scale 0.7 the layout viewport is drawn at 70%
of the screen's width and 70% of its height, so the prose stops short of the right edge, and a
`position: fixed; bottom: 0` bar sits 30% of the way up.

The reading view's widths are pixels computed in JavaScript for the window React last rendered for:
`.reader`'s inline `min-width`, `--page-w` (the masthead, the controls bar, the stuck crumbs), the
table's `width` and its `<col>`s, `--mode-w` and Marginalia's `--marg-*`. A rotation narrows the
window first. React hears of it from `resize`, which in Playwright's WebKit arrived **230–650ms**
after `orientationchange` on an iPad. In between, the page was **360px wider than the screen**
(1194 against 834), and 266px on an iPhone.

On iOS that gap is not merely a flash. `WebPage::dynamicViewportSizeUpdate` (WebPageIOS.mm) sets
the new layout size, **forces a layout synchronously, reads the content width, and chooses the new
page scale from it**, all before any script runs. Its own FIXME says that later JavaScript changes
are not included. With content wider than the layout and a `width=device-width` /
`initial-scale=1` meta, `ViewportConfiguration` computes about `layoutWidth / contentWidth`. That is
desktop-class iPad Safari's shrink-to-fit. When the content fits again, the source says the scale
should be recomputed, and "sometimes" is when it is not. (GPT Sol read the WebKit source; no iOS
device or simulator was available here, so the zoom itself is reasoned rather than reproduced. The
precondition, the stale overflow, is reproduced.)

## The root cause

**A width that JavaScript computed for one window was handed to the browser as a hard pixel
constraint, and the browser makes a decision of its own on a frame where that constraint belongs to
the previous window.** Our code was correct at every state React ever rendered. The bug lives
between two renders, where none of our checks look.

## The class: a width from the last render meets the browser before the next one

Any layout value derived in script from the viewport and written back as an absolute length is
wrong from the moment the viewport changes until the next commit. That is harmless when nothing
reads it in between. It is a bug when the browser does: iOS choosing a scale on rotation, scroll
anchoring, `position: sticky` clamping, a `ResizeObserver` loop, a screenshot. The test for the
class is "what does this frame look like if no script has run since the resize?"

## Which commits

- `e6eb7e075` (2026-08-25) put the inline `min-width` on the reader, for the sticky bars' range
  ([css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md)).
- `aec8ff52f` (2026-10-02, 261002a) moved the masthead and controls bar from `100vw`, which follows
  the live viewport, to `--page-w`, which is the last render's. That fixed a real 15px sideways
  scroll beside a classic scrollbar ([261002a](261002a-the-reading-view-laid-out-for-the-width-under-the-scrollbar.md)).
  It also made a Plain article's bars the largest stale width, because Plain's own `min-width` caps
  at about 820px and fits in a portrait iPad anyway. The report came six days later.

Neither was a mistake on its own terms. Each was right at rest, and rest is all anybody measured.

## The fix shipped, and the one that is right for the long term

**Shipped:** `.reader { overflow-x: clip }` and `min-width: min(<px>, 100%)`. One declaration stops
every stale width inside the reading view from reaching the document, including ones not yet
written, and the cap stops `.reader`'s own box. Both are inert at rest: a sweep shows `fitView`
never asks for more than the width it was given, and the page never scrolls sideways once
settled. The cost is that a future overflow bug is cut off instead of scrolling. It also no
longer shows in `documentElement.scrollWidth`. narrow-windows.md § the check now measures
`.reader`'s `scrollWidth` as well, which still reports it.

**Long term:** widths expressed in CSS against the live viewport (`100%`, container units, a grid)
rather than pixels pushed down from script, so there is no "last render" to be stale. That is a
rework of `fitView`'s output into constraints, not numbers, and it is not justified by this bug
alone. The clip makes the stale frame harmless in the meantime.

## What would have caught it, ranked by ease against value

1. **A browser test that lays out at one width and narrows without re-rendering.**
   `tests/reader-after-a-rotation-in-a-browser.test.ts`, in Chrome and WebKit, with a control on
   today's styles that must overflow. Done. It is the "no script has run since the resize" question
   asked mechanically.
2. **Asking that question in review of any change that writes a viewport-derived length.** It costs
   one sentence in a review prompt, and it would have flagged `aec8ff52f`'s `--page-w`.
3. **An iOS simulator in CI** — rejected for now. It is the only thing that shows the zoom itself, but
   there is no macOS runner, and the precondition test catches the part that is ours.
