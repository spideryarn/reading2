# The bottom bar measures its own fit

**Done, 2026-09-02.** The bar no longer decides what to spell out at a pixel breakpoint. It asks the
row whether it overflows, and drops labels until it does not.

## The bug

Greg, with a browser window about two thirds of the way across a high-res laptop screen:

> the bottom bar isn't compacting (i.e. it should be showing just the icons without the text) at this
> size window. I think this is a problem now because we keep adding new modes (and I have
> "Experimental Features" as true. If I make the window narrower, it does eventually compact them).
> Can we set it up to be more automatic/dynamic (so that we don't have to keep tweaking some
> constant), or is that too much complexity?

Measured in Chrome against the dev server, sixteen buttons and thirteen modes:

| rung | what it drops | the row needs |
|---|---|---|
| 0 | nothing | **1416px** |
| 1 | the mode labels | 808px |
| 2 | every label | 551px |

The old rule dropped the mode labels at `max-width: 1100px`. So **every window between 1101px and
1416px drew a labelled row wider than the screen** — and `.dock` had no `overflow-x` above 731px, so
the last buttons were simply not there. That is the exact failure `.dock-modes` already carried a
long warning about: nothing overflows visibly, nothing scrolls, and a button that is not drawn cannot
be pressed.

The 1100 was not careless. It was measured at 1046 and rounded up for margin — **when there were six
modes**. There are thirteen. Experimental Features turns out to be a red herring: nothing is behind
that switch yet ([experimental-features.md](../project/experimental-features.md)), so every reader
has all thirteen.

## What was built

- [`src/web/dock-fit.ts`](../../src/web/dock-fit.ts) — `chooseDockFit` walks the rungs from widest
  down, applying each and asking the browser, and stops at the first that fits. `useDockFit` runs it
  before paint, on a `ResizeObserver` (coalesced through `requestAnimationFrame`, the pattern
  `Spine.tsx` and `DiagramPanel.tsx` already use), and again when the fonts land.
- `styles.css` § the bar's fit ladder — the two rungs, which are exactly what the two media queries
  used to do. The `max-width: 1100px` query is gone, and § a narrow window keeps only the gutters.
- `.dock`'s `overflow-x: auto` and `flex-shrink: 0` moved **out** of the 731px query and onto the
  bar at every width.
- `.dock-tail`, the bar's trailing gutter as a child rather than as padding — because the
  measurement cannot see padding, and because it doubles as the ladder's font-metric probe.
- `tests/dock-fit.test.ts`.

### The one measurement, and the trap in it

`el.scrollWidth > el.clientWidth`, with **no slack term**. `scrollWidth` is clamped to at least
`clientWidth`, so `scrollWidth <= clientWidth - 8` is *always* false-to-fit and a bar written that
way compacts to its smallest rung at every width. That was the first version of this file, and
`fits with room to spare` in the test is the assertion that catches it coming back.

The same clamp is why the ladder is walked rather than solved: a rung that fits reports exactly
`scrollWidth === clientWidth` and says nothing about the room to spare. It is also why `flex-grow` on
a coarse pointer does not fool it — growth only happens when there *was* slack, and the overflow
question does not care.

The cost is that Chrome leaves `padding-right` out of a flex container's scrollable overflow, so a
gutter spelled as padding is invisible to this question. That is why the bar's trailing gutter is a
child (`.dock-tail`) and not padding — see the second review below, which is where the size of that
mistake was established.

## The simpler options, and why not

- **Bump the constant.** What we did last time, and it is stale again by construction — the thing
  that changes is the content, and no number in the stylesheet can see it.
- **A container query.** Moves the same constant from the viewport's width to the bar's, which on a
  bar spanning `100vw` is the same number. It answers where the constant is written down, not that
  there is one.
- **Always icon-only.** Constant-free, and turns thirteen named modes into thirteen glyphs on a
  30-inch monitor. GPT Sol: *"I would not spend that usability to save this small amount of code."*
- **Wrap to two rows.** The bar has a fixed height that four other rules are written against
  (`--dock-h`, `--dock-space`). A two-row bar is a design change and Greg's to make — it is already
  written up in [260828av](260828av-mobile-screen-real-estate.md) § Open for Greg.

## What GPT Sol found

Reviewed at design stage (`gpt-5.6-sol`, high effort). Verdict: ship the ladder. Four corrections,
three of them taken:

1. **The scroll floor was inside the 731px query** — so a ladder whose last rung can overflow at any
   width had a safety net only on a phone. Taken: it is unconditional now. Verified by adding twenty
   buttons to a 1152px bar in the browser — it overflows honestly and scrolls.
2. **Rung 1 only knew one of the bar's two shapes.** Off the reading view the modes are thirteen
   loose `DockLink`s rather than one `.dock-modes` segment, so rung 1 did nothing there and the
   ladder skipped to rung 2, taking every label. Taken: the loose links carry `dock-mode`, and
   `keepLabel` is passed through so Plain keeps its word on those pages too — which it never had.
3. **A dependency-free layout effect is wasteful**, since `Dock` re-renders with its page. Taken:
   the effect is keyed on a `fitSignature` string built from the three things that change the row's
   width.

   **And there is no backstop for content**, which the browser pass established rather than assumed:
   the `ResizeObserver` watches the bar's own box, which is `100vw` and does not move when the row
   inside it grows, so pushing a three-digit count into the bar by hand leaves 26px of overflow until
   something else re-measures. Observing the buttons instead would catch it and would never settle —
   probing a rung changes their widths, which fires the observer, which probes again. Sol's own
   review says not to observe them, for that reason.

   So the floor is what carries this, and it is why finding 1 above mattered more than it looked: the
   worst case of a missed term is a row you can drag, not a button nobody can press. One real case is
   left standing — a reader who changes their browser's *default font size* while the page is open
   moves `rem` without moving the viewport, and the bar keeps its rung until the next resize or
   render. Browser zoom is fine; it changes the viewport.
4. **Measure the last child's right edge instead of `scrollWidth`**, to defend the gutter. *Not*
   taken: seeing the room to spare is exactly what `flex-grow` destroys, so that version needs a
   second measurement-only class to zero the growth first — two more moving parts to buy back six
   pixels of padding.

### And on the built code

The second review is the one that matters, and it found the thing the first could not.

1. **The gutter I had waved through as cosmetic is `--safe-right` on a phone.** `.dock`'s
   `padding-right` was `calc(0.4rem + var(--safe-right))`, and Chrome leaves a flex container's
   trailing *padding* out of its scrollable overflow — so the measurement could not see it, and the
   last button was free to sit in it. Six pixels on a laptop; on a phone held landscape it is the
   cutout the inset exists to keep clear. Taken: the gutter is a real child now (`.dock-tail`) and
   the bar has no right padding, so the measurement counts it. Verified by forcing `--safe-right`
   to 44px at 1440px — the bar drops to rung 1 where it used to stay spelled out.

   That element does a second job for free. It is `rem`-sized and rung-independent, so the
   `ResizeObserver` watches it as the ladder's **font-metric probe** — which closes the one hole
   left over from the first review. Measured: root font-size 16px → 20px now compacts, and back to
   16px spells the bar out again. Before the tail it stuck on the narrow rung.

2. **The unit test could not catch the integration regression.** True, and Sol listed exactly what
   would stay green while the bar was broken. The stylesheet and render checks in
   `tests/dock-fit.test.ts` go after four of them, and **each one is fed the broken stylesheet it
   exists to catch**, because three of the five checks in that file passed the moment they were
   written. Two of those broken sheets are ones this change actually shipped for a while.

3. **Sub-pixel rounding**, since `scrollWidth` and `clientWidth` are integers: real, bounded below
   one CSS pixel, and left alone.

4. A stale comment calling `title` the accessible name where an explicit `aria-label` sits beside
   it. Fixed.

Everything else he checked came back clean, and two of those were worth having asked: the drawer is
a sibling of the bar rather than a child, and the mode tooltips are portaled to `<body>`, so
`overflow-y: hidden` on a now-always-scrolling `.dock` clips nothing that matters.

## Evidence

Browser pass on the box (Playwright, system Chrome), reading view and metadata page, 1600 → 390px:
every rung transition happens with `scrollWidth - clientWidth === 0` on both sides, the same on both
page shapes, `Plain` keeps its word on every rung, no flapping across four widen/narrow cycles, a
coarse-pointer context at 1600px keeps all sixteen labels, and at 390px focusing the last button
scrolls it into view.

**The ladder adds no lag.** Measured by polling both facts at 25ms: the frame in which the new
viewport width is first observable is the same frame in which the bar is already on its new rung —
a delta of 0ms on all four transitions tried. The 250–360ms the naive timing showed is Playwright's
`setViewportSize` round-trip, not this code. Worth measuring rather than assuming, because an
earlier reading appeared to show a 220ms lag; that was the dev server reloading the page under a
neighbouring agent's test suite writing into `output/`.

A specificity bug was caught in that pass and not by the tests: `.dock-btn.dock-mode
.dock-btn-label` out-specified the `.always` exception, so Plain lost its word at rung 1 on the
metadata page while keeping it at rung 2. The selector is one class shorter now, and the comment
beside it says why it must stay that way.
