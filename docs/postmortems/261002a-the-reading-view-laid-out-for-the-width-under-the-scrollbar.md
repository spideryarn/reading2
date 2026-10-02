# The reading view laid out for the width under the scrollbar

**On any machine with a classic scrollbar, every article in the reading view scrolled sideways by
exactly the scrollbar's width, 15px, and it had probably done so since the first reading view on
2026-08-25.** It reached a reader: Greg, in production, on his Mac. No check saw it, because every
browser we test in draws overlay scrollbars that take no width, and one unit test pinned half the
bug as the intended behaviour. The fix is
[261002a](../plans/261002a-horizontal-scrollbar-wider-band-on-wide-windows-archive-button-on-the-masthead.md),
commit `aec8ff52f`.

> For some reason, there's a horizontal scroll bar permanently visible at the bottom of the page on
> my Mac, even for quite a wide window. I'm fairly sure this is new, and I'd rather it wasn't there.
>
> I wonder if it has anything to do with moving the feedback button to the right-hand side of the
> bottom-bar? Dunno.
>
> — Greg, 2026-10-01, Feedback report spya-y3747g, from
> `/read/s41598-023-33209-9-spya-hxekgz?term=spya-trxfqv&at=spya-pxfyh5`

## What happened

A Sonnet browser agent on the box ran Playwright with classic scrollbars forced on
(`ignoreDefaultArgs: ["--hide-scrollbars"]`) at 1280, 1440 and 1920, plain and with a band open. At
every width and in every mode `documentElement.scrollWidth` was `innerWidth` and `clientWidth` was
15px less. With overlay scrollbars — headless Chrome's default, and a trackpad Mac's — nothing
overflowed.

Two boxes were sized for the window rather than the page:

- **`.reader`'s `min-width`, with a band open.** `useWindowWidth`
  ([`src/web/reader/measure.ts`](../../src/web/reader/measure.ts)) measured
  `layoutViewportWidth()`, which is `max(innerWidth, root clientWidth)`. On a desktop that is
  `innerWidth`, and `innerWidth` includes a classic scrollbar. `fitMode` hands every pixel it is
  given to band and prose, and `.reader` asks for all of them as its `min-width`, so the page needed
  15px more than it had.
- **`.masthead` and `.controls`** in [`shell.css`](../../src/web/styles/shell.css), sticky bars
  sized `calc(100vw - var(--spine-w) - var(--mode-w) - …)`. `100vw` counts the scrollbar too. These
  overflowed in plain mode as well, with no band open.

**Not the Feedback button, though Greg's hunch pointed at the right corner.** `.dock` was
`position: fixed; left: 0; width: 100vw`, so its right 15px ran under the scrollbar, and since
2026-10-01 (`305e8db4c`, plan 261001j) the Feedback button has been pushed to exactly that end by
`margin-inline-start: auto`. But a fixed box does not extend the page's scrollable area: hiding the
dock, or removing the auto margin, left the overflow unchanged. The dock was fixed as well, because a
button half under a scrollbar is its own small bug.

**On "new": we could not confirm it.** Both mechanisms predate 2026-10-01 by weeks (below). The
likeliest explanations are that Greg's Mac started drawing classic scrollbars — a mouse plugged in,
or *Show scroll bars: Always* — or that the Feedback button's move drew his eye to that corner. We
do not know which, and nothing in the code changed on the day to explain it.

## Which commits introduced it

- **Both halves arrived with the first reading view**, `e6eb7e075` (2026-08-25, "Reading view:
  bird's-eye spine, chosen column widths, URL state"): `useWindowWidth` stored `window.innerWidth`,
  `.reader` took `minWidth: fit.minWidth`, and the two sticky bars became
  `width: calc(100vw - var(--spine-w))`. Two days later `676c93716` (2026-08-27) made `fitMode` hand
  out exactly the window's width — `minWidth` equal to `w` — and added the `--mode-w` term to the
  bars. So band modes have overflowed beside a classic scrollbar for about five weeks.
- **`2a1b75940` (2026-09-12, plan and postmortem 260912b) kept it deliberately.** Fixing an iPad zoom
  bug, it replaced bare `innerWidth` with `max(innerWidth, clientWidth)` and wrote down why the larger
  of the two: `clientWidth` *"excludes a desktop's classic scrollbar, which the media queries
  include"*. It then added a test named **"keeps innerWidth where it is the wider one — a desktop's
  classic scrollbar"**, asserting 1280 where the page was 1265. That test was this bug, pinned as
  correct.

## The class: a width that counts the scrollbar, used to size a box that lives beside it

There are two viewports on a desktop page, and they differ by the scrollbar. `innerWidth`, `100vw`
and `@media (max-width)` are measured *including* it; the root's `clientWidth`, and every in-flow box
on the page, live *beside* it. A box sized from the first kind and placed in the second sticks out
by the scrollbar's width. On an overlay-scrollbar machine the two numbers are equal, so the mistake
cannot be seen there at all.

It is the sibling of [260912b](260912b-a-layout-read-from-a-number-that-means-a-different-viewport-on-ios.md)
— there `innerWidth` meant a different viewport on iOS, here a different viewport beside a classic
scrollbar — and of the class
[narrow-windows.md § a band with no room](../project/narrow-windows.md) records: two halves of one
layout computing the same width from two sources. 260912b chose "agree with the media queries" as the
definition of the right width. The right definition is "the width the page is actually laid out in",
and the media queries are the one thing that cannot be made to agree with it.

**The siblings, swept before writing this.** The remaining `100vw` in `src/web/styles` are
`max-width: min(…, calc(100vw - 1.75rem))` clamps on popovers and dialogs. They are not the same bug:
each leaves at least 28px of margin, more than a scrollbar, and none is an in-flow page-wide box. The
covering band in `narrow-window.css` was a `100vw` fixed box and was changed to `left`/`right` along
with the dock.

## Why nothing went red

This is the [silent-success](../reusable/silent-success.md) shape twice over.

- **The check could not fail where we ran it.** [narrow-windows.md](../project/narrow-windows.md)'s
  check — `scrollWidth - clientWidth` must be 0 — is exactly the right question, and on headless
  Chrome, the box's Playwright and a trackpad Mac it answers 0 for this bug, because the scrollbar
  takes no width. Every browser check of the reading view in five weeks asked it there.
- **A test asserted the bug.** The 260912b test did not miss the case; it named the case and chose
  the wrong answer, for a stated reason (agreement with `@media`). A reviewer reading it would have
  seen a deliberate decision with a rationale, not a gap. That is a different failure from nobody
  looking, and it is the harder one to catch: the reasoning was sound, the goal it served was the
  wrong one.
- **jsdom has no scrollbar and no layout.** Unit tests set `innerWidth` and `clientWidth` by hand, so
  they test whichever relationship the author believed in.
- **The CSS half had no test at all.** `100vw` on a sticky bar is invisible to every check we had.

## What would have caught it, ranked by ease against value

1. **Run every browser check with classic scrollbars on.** In Playwright,
   `ignoreDefaultArgs: ["--hide-scrollbars"]`, and confirm `innerWidth - clientWidth` is about 15
   before trusting a width measurement. Costs one launch option, and turns the existing
   `scrollWidth - clientWidth` check from one that cannot fail into one that does. narrow-windows.md
   now says so; **the launch snippet in
   [browser-testing-playwright.md](../project/browser-testing-playwright.md) should carry it by
   default**, so a check gets it without having read this. Not yet done.
2. **One number for "the page's width", shared by the layout and the CSS.** `pageWidth()` in
   `measure.ts` (root `clientWidth`, with `layoutViewportWidth` as jsdom's stand-in) feeds `fitView`,
   and `Reader.tsx` writes the same number to `--page-w` for the sticky bars. **Done, `aec8ff52f`.**
3. **Guards that fail on the original shape.** `tests/layout-viewport-width.test.tsx`: the inverted
   case (1280 window, 1265 page → 1265) and a scrollbar that arrives with no `resize`, both red
   before the fix. `tests/page-wide-bars-beside-the-scrollbar.test.ts`: `.masthead` and `.controls`
   are sized from `--page-w`, and `.dock` and the covering band do not use `100vw`. **Done.**
4. **A lint rule against `100vw` in any width.** Rejected: the popover clamps use it correctly, and
   telling the two apart needs knowing whether the box is in flow and page-wide, which a regex cannot.
   The guard in item 3 covers the boxes that matter by name.
5. **A real Mac with a mouse in the loop.** Rejected: item 1 reproduces the condition exactly, on
   the box, for free.

## The fix that is right for the long term

What shipped is close to it. The layout is computed from the root's `clientWidth`; a
`ResizeObserver` on `documentElement` re-measures when a scrollbar arrives after load, which fires no
`resize`; the sticky bars read that same number as `--page-w` rather than guessing it again in CSS;
and the fixed boxes span the viewport with `left`/`right` instead of `width: 100vw` — the full-screen
Sketch and Illustrated dialogs included.

**And the root keeps the scrollbar's room whether or not the page scrolls** (`html {
scrollbar-gutter: stable }`), which GPT Sol asked for in the plan review: a width that depends on
whether the page scrolls, when the layout decides how tall the page is, can flip — Structure's band
drops from its two columns to 400px near a 1175px window, and a shorter page can lose its scrollbar.
With the gutter reserved the width is fixed; the observer is the fallback where the property is not
supported, coalesced to one read a frame.

**The trade-off it accepts** is a 15px disagreement, beside a classic scrollbar only, with the one
width `@media` query the reading view still has (731px, `narrow-window.css`, which takes the words
off the wordmark and the Feedback button): a window 732–746px wide keeps those words while the layout
is computed for 717–731. Cosmetic. The longer-term version is to have no width media queries in the
reading view at all — drive the last one from the same JavaScript number, as a class on `.reader` —
so there is only one definition of width left to disagree with. Not done, because a 15px band of
slightly-too-long labels is not worth the churn yet.

## The thing I would tell myself

On 2026-09-12 I knew that `clientWidth` excludes the scrollbar, wrote it down, and chose `innerWidth`
anyway so that JavaScript and the media queries would agree. I optimised for two numbers matching
each other instead of for the number matching the page. Then I wrote a test for that choice, which
made it look settled. The question to ask of any width is not "does it agree with the other width"
but "what box will be this wide, and what is it sitting beside".
