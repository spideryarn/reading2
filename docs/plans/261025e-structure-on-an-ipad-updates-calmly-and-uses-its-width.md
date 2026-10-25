# Structure on an iPad: it updates calmly, and uses its width

Two of Greg's reports from 2026-10-25, both about Structure on a portrait iPad, on
`arxiv-2308-08708-spya-xax6v4`, done as one job because they touch the same band:
`spya-tj0vqa` (#704, SPIDERYARN-READING2-P3) and `spya-m5gxk9` (#705, SPIDERYARN-READING2-P4). Both
are an admin's (`feedback-reporter.ts` exit 0), with no addenda.

> We improved the way we're using horizontal space here, especially in the structure mode. So this
> is a portrait iPad, and it feels like there's just a gap in the right of the structure mode that's,
> yeah, that's being wasted. And I'm not just talking about this particular arrangement. I'm just
> saying in general, we want to be taking screenshots at multiple screen sizes to try and make sure
> that there aren't areas of the page that are wasted.
>
> I think we could also have the text go closer to the right margin, not much, but just slightly
> […] If we've already got 65, fine, but if we've got less than that, if we've only got 50 or 55,
> then I think let's use a bit more of the margin, even if that means the text bumps up against the
> right-hand side of the screen.
>
> As always though, use your judgment. If you think I've misunderstood or this is inconsistent with
> other more important principles or it's going to add an almost complexity, then maybe this doesn't
> make sense to do.
>
> — Greg, 2026-10-25 (`spya-tj0vqa`)

> I'm noticing that as I scroll around on an iPad in structure fish-eye mode, that there seems to be
> some flickering in the structure mode. So the very top area that shows the submodes, fish-eye,
> expanded and hover, occasionally disappears, and then the structure mode itself flickers. […] if
> it's going to add a lot of complexity to try and fix or improve it, then it's not worth it. But
> I'm hoping there might be a way that actually simplifies the code and makes it work better. I
> think it's nice that the structure mode updates as we scroll. It probably only needs to update
> every second or two. […] maybe every second might be fine, or sub-second, I suppose. If we were
> scrolling fast, would be good, but not […] We don't want to use too much CPU. We don't want to
> distract the reader too much. […] The goal is to try and get to a robust, clean implementation
> that works generally in most situations pretty well. Get input from GPT Sol.
>
> — Greg, 2026-10-25 (`spya-m5gxk9`)

## What is on Greg's screen

A portrait iPad at 725 × 967 CSS px (his iPad, from `spya-e5t77w`'s diagnostics; the screenshot on
`spya-tj0vqa` is 1200 × 1600, the same 3:4). The band is ordinary-width (~300px), so Structure
draws its **list face** (`OutlinePanel`), never the two columns — narrow-windows.md: portrait is the
list at every iPad size.

## Report 1: the gap on the right of the list

**Cause.** `outline-mode.css` widens the list face's right inset by the room the band's (i) needs:

```css
.mode-band.outln.has-about { --outln-pad-r: calc(0.5rem + var(--band-about-room)); }
```

added with the (i) on 2026-10-01 (68816cd65). But the (i) sits in the band's top-right corner, in
the head row, and the head row already keeps clear of it on its own (mode-band.css §
`.has-about > .band-head`). Every row of the list below gives up the same strip to a button that is
not beside it. On a touch screen the corner button is raised for a finger (narrow-window.css § a
coarse pointer), so the strip is wider exactly where Greg reads: about 55px of a 300px band in his
screenshot, measured off it, which is the gap he saw.

**Fix.** Drop that rule. The list keeps its own `--outln-pad-r` (0.5rem). The head row's bleed
(`.mode-band.outln > .band-head`'s negative margin, which reads `--outln-pad-r`) then needs no
change, since the head row's own padding already adds `--band-about-room`. The hidden measuring
copies read the same token, so the fit still measures what is drawn (outline-mode.css §
`.outln-measure`).

### The wider survey Greg asked for

A Sonnet subagent shot the reading view at 725 × 967, 820 × 1180, 1180 × 820 and 1024 × 768 (WebKit,
iPad user agent, touch), 1440 × 900 (Chrome) and 390 × 844, in Structure (Fisheye and Expanded),
Summary, Glossary and no mode, and measured every edge with `getBoundingClientRect` (shots and
script kept outside the repo). In px:

| window | Structure's band: text to its right border | band border to prose | last glyph to window edge |
|---|---|---|---|
| 725, Structure list | **62** (Expanded: 18) | 10 | 20 |
| 725, other modes | ~1 | 10 | 20–23 |
| 820, Structure list | **62** | 14 | 39 |
| 1024, Structure list | **43** | 60 | 85 |
| 1180, Structure columns | ~1 | 26 | 51 |
| 1180, other modes | ~1 | 102 | 127 |
| 1440, Structure columns | ~1 | 101 | 141 |
| 1440, other modes | ~1 | 181 | 222 |
| 390, Structure (covering) | **69** | — | — |

- **The list face's strip is the one waste found at every narrow width**, touch or not (34px of it
  with a mouse, 46px under a finger, plus the list's own 8px). The fix above takes it.
- **The wide margins at 1180 and 1440 are the measure, not waste.** The prose column holds about
  60 characters by rule (typography.md § The measure) and the cap on how wide the reading column may
  grow was set by Greg on 2026-10-23 from screenshots (q-z3j0ep, plan 261023a). Bands grow into
  part of that room already (narrow-windows.md § `spareBeyondTheMeasure`). Not reopened here.
- **Seen and not settled: a figure's light sheet wider than the window.** At 725 (and 1180, 1440) one
  figure's white sheet (typography.md § the light sheet under a figure) ran past the right edge in
  the local copy. Greg's production screenshot does not show it, and the local copy's images may not
  be the stored ones, so it is not claimed as a bug here. The Overseer was asked to queue a check
  against production (2026-10-25); the queue takes entries only from it or Greg.

**The prose's right margin: not changed.** At 725 a line of prose in this layout holds about 48
characters, so by Greg's own test (*"if we've only got 50 or 55, then … use a bit more of the
margin"*) it qualifies. But the touch-screen right pad was brought down to its floor six days ago,
at his request on this same iPad (`spya-eebnxu`, plan 261019d): `max(1.25rem, 19px)`, which is what
a paragraph's 15px mark, its 4px end inset and the reading-time hairline need to sit beside the text
rather than on it (narrow-window.css § a no-hover screen). What is left to take is a pixel or two,
well under one character. Going further puts the marks over the last letters of a line, which is
worse than the character it buys. The width a line could actually gain at 725 is the gap in report 1,
which goes to the band, not the prose: the band is the one with nothing in it. This is the judgment
Greg invited, recorded in the note.

## Report 2: the flicker

### Reproduced

`scripts/structure-scroll-trace.ts` (new, committed): WebKit, 725 × 967, iPad user agent, touch,
signed in as the dev admin, on the local copy of the same paper (`arxiv-2308-08708-spya-w598t3`). It
scrolls the page 9,000px down and 4,000px back and records, through a MutationObserver, every state
the list is committed in, with the room the fit measures against. On `dev` (a9b65cd37), and with this
change:

| | before | after |
|---|---|---|
| redraws of the list in the scroll | 6 | 5 |
| …of them with **no change of section** | 1 (rung 4 → 3 as the bar came back) | 0 |
| the room the fit measured | 846 ↔ 955px, with the bar | 846px throughout |
| the list at rung 4, at the first section | 624px | 519px (titles wrap less) |

A first, frame-sampled run of the same scroll counted 10 redraws, 2 with no change of section, and
332 DOM mutations in the band. **What the trace cannot show is the once-a-second hold**: a headless
WebKit steps the scroll so slowly that two crossings rarely land in one second, so the hold is held
by the unit test instead (§ Tests).

Two causes, both mechanical:

1. **Every section crossing redraws the list at once.** `useColumnContext` publishes the focus row
   the frame it changes. Each publish rebuilds all five rung candidates (`outlineProjection` × 5),
   lays them out as hidden lists to measure them, and redraws the visible list. In a fast scroll
   that is several full redraws a second of a `position: fixed` band. WebKit has a long history of
   fixed-position layers flickering when their content changes during a scroll (WebKit bugs
   [173887](https://bugs.webkit.org/show_bug.cgi?id=173887),
   [154399](https://bugs.webkit.org/show_bug.cgi?id=154399); the common workaround is a compositing
   hack, which treats the symptom).
2. **The band's height follows the bottom bar.** On a touch screen the Dock slides away when the
   reader scrolls down and back when they scroll up (`data-bars="hidden"` → `--dock-bottom: 0`),
   and `.mode-band`'s `bottom` reads `--dock-bottom`. The band grows ~109px and shrinks again; the
   list face's fit (and the columns' capacity) is re-measured against the new height, so rows
   appear and disappear because a bar moved, not because the reader did. In the trace the rung went
   4 → 3 the moment the bar came back.

The sub-mode row vanishing is not reproduced in headless WebKit, which never drops a frame the way
iOS does during momentum scrolling. It is the same band repainting under the finger, so it is
judged by the counts above rather than by a screenshot of the vanish.

### What other implementations do

A scroll-spy (the "you are here" in a table of contents) is near-universally throttled rather than
run per frame: 100–300ms windows in the libraries surveyed (react-ui-scrollspy defaults to 300ms,
nav-scroll-spy to 100ms, a widely copied TOC component to 200ms via lodash `throttle`), or driven by
`IntersectionObserver`. None of them redraws a fitted tree on each update; they move a highlight.
Ours redraws a fitted tree, which is why Greg's "every second or so" is the right order of
magnitude here rather than their 200ms.

### The change

**A. Structure hears where the reader is at most once a second while they scroll.** A throttle,
leading and trailing, in `useColumnContext`, behind an option only Structure's band passes
(`holdMs: 1000`):

- the first change after a quiet second is published at once, so a reader moving slowly through
  the text sees the list follow without lag;
- further changes within the second are held, and the latest is published when the second is up,
  so a fast scroll updates about once a second and always ends on the right section;
- a jump (`subscribeArrivalAnchor`: a click on a row, ← / →, a link) and a layout change publish
  at once, unthrottled, because a reader who pressed something is waiting for it.

Inside a hold the sampler reads nothing either: a scroll frame arms the one trailing measure and
stops (after Sol's F3, below). The breadcrumb (`HeadingsCrumbs`) passes
no `holdMs` and is unchanged.

**B. Structure's band does not change size when the bottom bar slides.** Its `padding-bottom`
grows by exactly what the bar gives back, so the band's box still runs to the bar (no strip of the
page showing under it) while its content box stays the height it has with the bar at rest:

```css
.mode-band:is(.outln, .struct) {
  padding-bottom: calc(
    max(var(--dock-space), var(--safe-bottom)) + var(--hint-h)
    - max(var(--dock-bottom), var(--safe-bottom)) - var(--hint-now)
    + <the face's own bottom padding>
  );
}
```

A `ResizeObserver` watches the content box by default, so neither face's observer fires when the
bar moves, and both measurements read `padding-bottom` from the computed style already
(OutlinePanel § `measure`; StructurePanel § `roomBelow` to be checked), so the room they compute is
the resting room. **What it gives up**: while the bar is away, the bottom ~109px of Structure's
band is empty rather than showing one or two more rows. That is the trade Greg asked for: the list
should change when the reader moves, not when a bar does.

### Not done, and why

- **No compositing hack** (`translate3d`, `will-change`) on the band. It is the workaround the web
  offers for the symptom, cannot be checked here without an iPad, and A and B remove most of the
  changes it would be hiding.
- **No estimation in place of the five measured candidates.** Measuring is what keeps the fit
  honest (OutlinePanel § "Measure, do not estimate"); with A it happens at most once a second.
- **No "settle only when scrolling stops"**: Greg wants to see where he is during a fast scroll.
- **Keyboard ← / → is held like a scroll.** A row click, a link and a Hover glance land centred and
  leave an arrival anchor, so they are jumps and never wait. ← / → step by a plain scroll
  (keynav.ts), so a second press inside the same second shows in the list up to a second later. The
  article moves at once; only the band lags. Left as it is unless the review says otherwise.

## Tests

- **Red first, unit:** `tests/structure-focus-row.test.tsx` gains a case: with `holdMs: 1000` and
  fake timers, three crossings inside one second publish the first at once and the last after the
  second, and none between; a jump publishes at once. Red on the current hook (which publishes all
  three).
- **Red first, CSS:** a test that reads `outline-mode.css` and fails while the list's right inset
  adds `--band-about-room` (jsdom has no layout, so the rule itself is what can be checked), and one
  that holds Structure's band's padding-bottom to the bar's travel.
- **The browser trace**, before and after, in this doc: `scripts/structure-scroll-trace.ts` prints
  the counts above, committed so the next change to this band can be measured the same way.
- `npm test`, `npm run typecheck`, lint on touched files.

## Where it is written down

- structure.md: a short § on the band updating at most once a second, and not following the bar.
- narrow-windows.md, the paragraph on the dock: Structure's band is the one band whose content box
  does not follow it.
- One note per report in `docs/user-feedback/`.

## GPT Sol's plan review, and what was done with it

[261025e-…-plan-review-sol.md](261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width-plan-review-sol.md),
against the plan and the first cut of the code. It agreed with 1000ms, the leading edge, leaving
← / → held, removing the list-wide (i) room, and declining the prose margin. Its four findings:

- **F1, the top bar** (SHOULD, taken): the band's top is `--bar-bottom`, and a present top bar
  sliding away grows the band just as the Dock does. It only reaches a reader with a bar in a band
  mode, which is a visitor's read-only chip. A padding cannot follow `top`'s 180ms transition, so
  the bar is **held home** while Structure's band is open: one more argument in shell.css's
  existing guard, specificity unchanged. Test in `tests/structure-band-css.test.ts`.
- **F2, a jump sampled rather than heard** (SHOULD, taken): the hook compared "was there an anchor"
  between measures, so a glide that cleared one anchor and set the next before a frame looked like
  no jump and could be held. Now the anchor subscription sets `jumpPending` when it fires. A test
  for exactly that case went red with anchor changes treated as scrolls, and green with the fix.
- **F3, the scan still ran every frame** (SHOULD, taken): during a hold, a scroll frame now arms
  the one trailing measure and reads nothing, so a fast scroll scans the rows about once a second.
  The test counts the rect reads.
- **F4, `holdMs` missing from the effect's dependencies** (NIT, taken).

Its point that the trace runs as the owner only: true, and the claims above are limited to what
the trace and the tests show. The visitor's top bar is covered by F1's rule and its test, not by a
trace.

## GPT Sol's code review

[261025e-…-code-review-sol.md](261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width-code-review-sol.md).
It fixed three things in place, each read and kept:

- **A duplicate scan** (SHOULD): the trailing hold timer and an arrival's frame could both read
  every row; each now cancels the other. Test added.
- **The bar arriving over Structure's band** (SHOULD): it confirmed the new top-bar guard matches
  (`.mode-band` is inside `.reader`), and added Structure to the companion rule that stops the bar
  sliding in on the frame a band opens. Test added.
- **Coverage** (NIT): tests for `holdMs` 0, an effect re-run, a stale timer and a stale `last`.

Gates after its fixes: `npm run typecheck` clean, the touched suites green, lint clean on the
touched files.
