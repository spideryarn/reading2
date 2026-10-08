# iOS layout and zoom after a rotation, or after the keyboard

**Status:** built, 2026-10-08 — on `dev`, not deployed; the keyboard half deferred to `qi-hzramwrk`. Planned, then revised after GPT Sol's plan review (RETHINK, § The fix). From Greg's report `spya-gxbwug` (#479, SPIDERYARN-READING2-EP, an
iPhone and an iPad, production, build `760f70a2`); Overseer queue item `qi-sd74q8t8`.

> On iPhone and iPad, sometimes the layout and zoom gets a little bit messed up after, for example,
> switching from portrait to landscape, or if the keyboard has appeared and then been dismissed.
> For example, on iPad, afterwards sometimes the bottom bar will be appearing, you know, partway up
> the screen, or the article text won't take up all of the horizontal space...
>
> — Greg, 2026-10-08 07:17 UTC

## Prior work

- [260912b](260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md): after a rotation
  while zoomed in, the layout was computed from `innerWidth`, which on iOS is the zoomed visual
  viewport. Fixed by reading the layout viewport, and now `pageWidth()` (root `clientWidth`). It
  named *"iOS zoomed out to fit overflow"* as a case it did not fix: *"a page that overflows is a
  separate bug"*. This report is that case.
- [260907_1741](../user-feedback/260907_1741-dock-always-visible-in-landscape.md): the dock's
  hide-on-scroll. It is not the cause here: a hidden dock is *below* the screen, not partway up it.
- [260908c](260908c-the-feedback-box-zoom-was-fixed-ten-minutes-before-i-started.md) and
  narrow-windows.md § a field iOS zooms into: the focus zoom on sub-16px fields. Every text field
  is at least 16px on a coarse pointer, and WebKit only does that zoom on an iPhone anyway.

## Diagnosis

**Both symptoms are what a page scale below 1 looks like.** At scale *s* < 1, the layout viewport
is drawn at *s* × its width and *s* × its height. So the article covers only part of the width, and
a `position: fixed; bottom: 0` bar (`.dock`, dock.css) sits at *s* × the height: partway up.

**What sets the scale below 1 on a rotation is our own stale pixel geometry.** `.reader` and its
contents carry an inline `min-width`, `--page-w`, the table and column widths, `--mode-w`, and
Marginalia geometry computed for the *previous* window width. They change only when React re-renders
after `useWindowWidth` (reader/measure.ts) hears the rotation. Until then a wide-to-narrow rotation
leaves the document wider than the screen. The first draft blamed `.reader`'s `min-width` alone;
the review correction and the measured Plain case are in § The fix below.

Measured in Playwright WebKit with iPad Pro 11 and iPhone 15 emulation (`isMobile`, `hasTouch`),
on a real article, with no band, with Structure and with Summary:

| device | rotation | overflow when `orientationchange` fires | how long |
|---|---|---|---|
| iPad | portrait → landscape | none | |
| iPad | landscape → portrait | **360px** (scrollWidth 1194, clientWidth 834) | 230–650ms, until `resize` |
| iPhone | portrait → landscape | none | |
| iPhone | landscape → portrait | **266px** (659 against 393) | about 300ms |

`innerWidth` and `clientWidth` are already the new width at that moment, and `.reader` still has the
old `min-width`. Chromium fires both events together and never overflowed.

**What WebKit does with that overflow on iOS** (GPT Sol, reading WebKit `main`, 2026-10-08):
`WebPage::dynamicViewportSizeUpdate` (WebPageIOS.mm) changes the layout size, **forces a layout
synchronously, reads the content width, and computes the new scale from it**, all before any
script runs. Its own FIXME says that later JavaScript content changes are not included in that
calculation. `ViewportConfiguration::initialScaleFromSize` then gives roughly
`layoutWidth / contentWidth` (834/1194 ≈ 0.70) when the client lets it ignore scaling constraints,
the content is wider than the layout width, and the meta says `width=device-width` or
`initial-scale=1`. Ours says both. Apple describes desktop-class iPad Safari as doing exactly this,
scaling wide pages to avoid sideways scrolling, so the iPad is the strongest match.

WebKit's source says a later layout should put the scale back once the content fits. Greg's
"sometimes" is the case where it does not. That is a WebKit race we cannot fix. We can only stop
handing it a too-wide page in the first place.

**What this box cannot show:** Linux WebKit does not do iOS's shrink-to-fit at all (a control page
with a 1500px div stays at scale 1), so the zoom-out itself is reasoned from source, not reproduced.
The precondition is reproduced, and it is ours.

### The keyboard is probably a different thing

Focusing and blurring the chat composer and the Feedback textarea in emulation changed nothing. A
40% height shrink and restore (what `interactive-widget=resizes-content` would do) changed nothing
either: no overflow, scale 1, and the dock followed `innerHeight` both ways. Nothing here is
width-dependent on a keyboard, and iOS does not implement `interactive-widget` (WebKit bug 259770).
The dock partway up after a dismissal matches WebKit bugs 254861 and 297779: iOS leaves the
visual viewport panned (`visualViewport.offsetTop` > 0) after the keyboard closes, so a fixed
element anchored to the layout viewport is drawn above the bottom of the visible strip, until the
reader scrolls. That is not reproducible without a device.

## The fix

### What the plan review changed (GPT Sol, 2026-10-08, RETHINK)

The first draft capped only `.reader`'s inline `min-width`. Sol showed that this was not enough
(P1). For the measured iPad Plain rotation, the stale `minWidth` is 820, which already fits in 834.
The 1194px comes from **`--page-w`**, which sizes the masthead, the controls bar and the stuck
crumbs (shell.css, crumbs.css). The table's inline `width` and its `<col>`s, `--mode-w`, and
Marginalia's `--marg-*` geometry are stale pixels too. Capping each of them is many edits in
three files, and a cap that misses one leaves the bug. The next pixel width somebody adds would
bring it back.

Sol also said (P1) to **leave the keyboard workaround out**. Nothing shows that
`scrollTo(scrollX, scrollY)` at an unchanged position repairs that WebKit state, and one WebKit
report says even `scrollTo(0, 0)` does not. Then (P1) the test must be shaped like production
rather than an empty `.reader`, with a control that overflows. And (P2) `100%` resolves against
`#root`, not against the root's `clientWidth`, so the test has to hold that assumption.

### Stage 1 — nothing inside the reading view can widen the page

Two declarations:

```css
.reader { overflow-x: clip; }                    /* shell.css § shell */
```
```ts
minWidth: `min(${fit.minWidth + horizontalInset(safeAreaInsets())}px, 100%)`   // Reader.tsx
```

**`overflow-x: clip` stops in-flow, absolute and sticky descendants' horizontal overflow from
reaching the document**, whatever stale pixel width they carry now or later: the bars, the table,
and Marginalia's notes. Viewport-fixed descendants (the band, the spine, Marginalia's head, dialogs
and chips) are not clipped by an intervening ancestor; CSS instead makes the viewport their
containing block and says the part outside it cannot be scrolled to. No ancestor establishes a
different fixed containing block. Thus they stay visible and do not widen the document; the clip
contains the descendants that otherwise can.
So WebKit's forced layout after a rotation sees a document exactly as wide as the screen and has
no reason to shrink it. `clip`, not `hidden`, because `clip` makes no scroll container: sticky
descendants still stick to the viewport, and nothing gains a scroll position. `overflow-y`
stays `visible`, which `clip` allows (`hidden` would have forced it to `auto`). The cap on
`.reader`'s own `min-width` is the other half: `.reader`'s own box is not its overflow, so without
the cap a band layout's stale `min-width` would still widen the page.

Measured on a bare fixture in Chrome and in Playwright's WebKit, at 834px with a 1194px sticky
bar, a 1100px fixed-layout table and an absolutely placed box hanging off the right edge, all
inside `.reader`: the document's `scrollWidth` is **834**, `.reader`'s own `scrollWidth` still
reports **1194**, and the sticky bar is still at `top: 0` after a vertical scroll.

**Neither declaration changes the page once it has settled.** A sweep of `fitView` over every
width from 100 to 2600px, both band states, both margin states, the spine on and automatic, all
four band shapes and roots of 12, 16 and 20 found **no** case where `minWidth` exceeds the width it
was given. Sol re-ran the same sweep independently. The notch term Reader.tsx adds is the
difference between that width and `pageWidth()`. `.reader`'s containing block is `#root` inside
a margin-less `body` (shell.css), with no padding, wrapper or transform, so `100%` is that same
page width. And the page never scrolls sideways once it has settled (`fitView`'s contract,
narrow-windows.md § the check), so the clip only ever removes what was off-screen to the right.

**What it gives up, and how that is paid back.** Clipping moves a future overflow bug from "the page
scrolls sideways" to "the end of a row is cut off", and it blinds the check that looks at the
document's `scrollWidth`. On iOS the first of those was never harmless, because a page that
overflows is exactly what makes Safari zoom out. The check stays useful because a clipped
`.reader` still reports the overflow in its own `scrollWidth`. narrow-windows.md § the check gains
`.reader`'s `scrollWidth - clientWidth` beside the document's. The masthead test, whose control
asserts that its fixture *does* overflow, measures both, so that control would go red rather than
pass for nothing.

**Red first:** `tests/reader-after-a-rotation-in-a-browser.test.ts`. The real reader stylesheets
(`readerCss()` and the token sheet), with production-shaped markup: `#root > .reader` with the
inline style Reader writes (from a small exported helper, so the test and the component cannot
drift), the masthead and controls bars, a `TableView`-shaped table with `<col>`s, and a band.
Every number comes from a real `fitView()` at the old width. The page is narrowed without
updating any of them, and the test asserts `documentElement.scrollWidth <= clientWidth` (Chrome's
root can reserve a scrollbar gutter) and that `.reader`'s own `scrollWidth` still sees the
overflow. It covers an iPad going 1194 → 834 in Plain, Structure, Tweets, Marginalia,
band-plus-Marginalia and rail-off arrangements, and an iPhone going 852 → 393 in Plain and with a
covering band. Every row first proves the old rule overflows and the same layout does not overflow
at rest. The stale Marginalia rows prove their note and fixed head still carry old geometry; after
the rotation the test scrolls vertically to prove the controls still stick and fixed bands remain
visible through the clip. It runs in Chrome, as the sibling `*-in-chrome` tests do, and in
Playwright's WebKit where that is installed.

### Deferred — the keyboard

Not built. If it recurs after this ships, a `?probe=1` trace from the device (ViewportProbe.tsx)
around a keyboard dismissal settles it: a non-zero `offsetTop` at scale 1 means WebKit's panned
viewport (bugs 254861, 297779, 311821), and a scale below 1 means this bug by another route. Only
then is a workaround designed, with the trigger and tests Sol set out: once per confirmed
keyboard-visible → hidden transition, after a frame, requiring scale ≈ 1 and `offsetTop` > 1,
routed through `scroll.ts`'s bookkeeping. It has its own Overseer queue entry.

## Passed over

- **`minimum-scale=1` in the viewport meta.** WebKit's shrink path ignores the author's scaling
  constraints and takes its minimum from the default configuration, so on an iPad it may be
  bypassed. It would do nothing for the keyboard.
- **Re-measuring on `orientationchange` too, or in a layout effect.** Too late, as above: WebKit's
  scale is chosen before any script.
- **Removing the inline `min-width`.** The sticky bars need it (shell.css § shell).
- **Capping each stale width instead of clipping** (the first draft's direction). It is complete only
  if it finds every pixel width: `--page-w`, the table and its `<col>`s, `--mode-w`, `--marg-*`,
  and whatever is added next. Sol's review found four the draft had missed.
- **`overflow-x: clip` on the root rather than on `.reader`.** The root's overflow propagates to the
  viewport, where `clip` is treated as `hidden`. The content is still as wide in WebKit's
  measurement; it just cannot be scrolled to.
- **An unconditional scroll nudge after every blur or rotation.** It moves the reader and fights
  hide-on-scroll.

## Stages and done

1. The clip and the cap, the red-first browser test, the masthead test measuring both widths,
   narrow-windows.md § the check, and the postmortem
   `docs/postmortems/261008a-a-width-from-the-last-render-meets-the-browser-before-the-next-one.md`.
2. The keyboard: deferred, as above, to its own queue entry.

Done when both are on `dev` with `npm test` and `npm run typecheck` green, GPT Sol has reviewed the
plan and the code, and `docs/user-feedback/` has the note naming the ending.
