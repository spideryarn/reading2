# The spine shows clearly which stretch of the article is on screen

Report `spya-wzssyu` (#672), Greg's, filed 2026-10-21 on the Rovelli article with Summary open:

> Make it a bit clearer in the spine which bits are visible on the screen.

Up: [reading-view-overview.md](../project/reading-view-overview.md) · the rail is
[`src/web/Spine.tsx`](../../src/web/Spine.tsx), its look
[`src/web/styles/spine.css`](../../src/web/styles/spine.css).

## The problem

The rail is 12px wide and nearly all one colour family. The parts are a tint of `--depth-1`
(orange-brown, hue ~52), the section you are in is the same tint at 0.8, and the on-screen band
(`.spine-viewport`) is the brand orange (`--highlight`, hue ~58): two 1px lines and a 12% wash.
The section fill is usually *inside* the band and brighter than the band's wash, so the only thing
that says "this is on screen" is two hairlines of a colour very close to everything around them.
The before screenshots below show it.

## What changes

**A lens.** The rail outside the on-screen stretch is veiled toward the panel colour; the stretch
that is on screen keeps its full strength. The orange edges stay where they are (on top of
everything — `--highlight` still means *where you are looking*). The 12% orange wash goes, because
the lit stretch is now the signal and the change adds no colour next to the prose: it takes some
away from the rest of the rail instead. That is how it stays quiet.

- **The veil is a second moving element, below the marks.** A veil on the band itself (the band
  is the last child of the track) would dim the search marks, the quote strip and the jump-origin
  mark everywhere off screen — and "where else in the article" is exactly what those are for.
  So a new `.spine-veil-track` sits in the track after the parts, the reading chart,
  the section fill and the hairlines, and before `.spine-from`, the quotes, the search marks and
  the hit targets. The scroll effect writes the same `translateY(%)` to both wrappers in the same
  frame. Two compositor-only transform writes instead of one; no layout, no paint, no re-render
  (Spine.tsx § scroll position still holds).
- **The veil is the wrapper's two pseudo-elements**, each a track-height rectangle of
  `color-mix(in oklab, var(--panel) N%, transparent)`: `::before` ends where the band starts,
  `::after` starts where it ends (`max(var(--view-h), var(--spine-view-floor))`, the band's own
  height and shared floor, set inline as a custom property). The floor is 2px normally and 4px
  around the two 2px borders under increased contrast. The overhang is clipped by
  `.spine { overflow: hidden }`. N was set
  by eye on the browser pass: **50% dark, 40% light** (the light panel swallows more of a tint).
  *Changed on GPT Sol's plan review:* the first version was a `box-shadow` with a 200vh spread,
  whose layer cost was a claim rather than a measurement; two bounded rectangles make the layer
  three rails tall and no more, and are no harder to read.
- **High-contrast settings.** Under `forced-colors: active` the veil is `display: none` (a forced
  palette would repaint it as an opaque system colour) and the band's edges, and the card key's,
  are drawn in `Highlight`. `prefers-contrast: more` gets a stronger veil (65% / 60%) and 2px edges.
- **The key on the spine's card** (`.tip-key-screen`, plan 261020e) is redrawn to match: no orange
  wash, orange top and bottom edges round an unveiled part's tint.
- **Help says it**: `/help/spine`'s line about the band now describes the lit stretch. The
  `spine-walk.gif` on that page was not re-recorded: it is about the hover card following the
  pointer, and the band in it is incidental and a few pixels tall.

## A bug found on the way: the rail ran under the bottom bar

The browser pass at the very end of an article found no band at all. `.spine` ended at
`bottom: var(--safe-bottom)`, and the dock (z-index 96, over the rail's 45) covered its last ~40px
— on every page, the end of every article, and the on-screen band whenever the reader was there.
Fixed by giving the rail the bottom edge the mode band already has,
`calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-now))`, which follows the bar down
when it slides away on a small device; everything inside the track is a percentage of its height,
so nothing has to be re-measured. Measured after: rail 44–860 on a 900px window (was 44–900, with
860–900 under the bar), and the band visible at the foot at the end of the article.
`tests/spine-bottom.test.ts`, seen red against the old rule.

## The simpler option passed over

**Just turn the band up** — 2px edges, a 20–25% wash. One line of CSS, but it fights orange with
more orange, on a rail beside the prose, and the result is louder without being much clearer: the
section fill under it is still the brightest thing in the stretch. Contrast in lightness does the
job with no added colour. Second opinion from Opus, which also proposed the veil-under-the-marks
layering.

**One moving element instead of two** (put the whole band below the marks): simpler by one div,
but then the orange edges disappear under any search lane that crosses them, and the jump-origin
mark — usually off screen — would be veiled. Rejected for that.

## What it costs

- Off screen, the part tints and the reading-time chart are dimmed by the veil. The chart is
  already faint; the browser pass checks it is still legible off screen in both themes, and the
  strength is chosen with that in view.

## Verification

- Before and after screenshots at desktop (1440×900), iPad portrait (820×1180) and phone
  (390×844), light and dark, with a crop of the rail — below.
- `npm test`, `npm run typecheck`. The paint-order tests pin the veil's slot: over the parts, the
  section fill and the hairlines (`spine-here.test.ts`), over the reading chart
  (`spine-reading.test.ts`), under the origin mark (`spine-jump-origin.test.ts`), the quotes
  (`spine-quote-strip.test.ts`), the search marks and the hits. `spine-scroll.test.ts` checks the
  two wrappers carry the same transform, and the veil's gap the band's height, at first placement,
  across a section boundary, within a section, and after a window resize, body resize, font swap
  and mode switch — seen red with the veil's write disabled. `spine-card.test.tsx` pins the key's
  swatch (no orange wash; `Highlight` under forced colours).

## Review

GPT Sol on the plan: [261022c-spine-on-screen-plan-review-sol.md](261022c-spine-on-screen-plan-review-sol.md)
(approve with changes). Taken: bounded rectangles instead of the spread shadow (1), one floor
shared with the band, including its 4px increased-contrast used height (2), equality checked on
every placement path (3), forced colours explicit
and the key included (5), the owning tests, Help, the corpus and this doc's line in
granularity-zoom.md (6). Its point 2 also asks what happens at the article's very end, where the
band's 2px floor can overhang the rail's foot: the veil uses the same floor, so they overhang
together, as the band alone already did; the browser pass checks it.

## Screenshots

The article is `noema-mythology-of-conscious-ai`, scrolled 35% in (a chat panel happened to be
open; it does not touch the rail).

[261022c-before-after-rail-zoom.png](261022c-before-after-rail-zoom.png) is the rail around the
band, 4× and nearest-neighbour, twelve strips in pairs (before, after): desktop light, desktop
dark, iPad light, iPad dark, phone light, phone dark. Before, the band is a slightly darker patch
inside the equally orange section fill; after, the stretch on screen is the one bright piece of
the rail, and the reading chart (teal) and the hairlines still read through the veil off screen.

The full-height rail crops are `261022c-{before,after}-{desktop,ipad,phone}-{light,dark}-spine.png`,
and one whole window each side for context: `261022c-before-desktop-light.png`,
`261022c-after-desktop-light.png`.
