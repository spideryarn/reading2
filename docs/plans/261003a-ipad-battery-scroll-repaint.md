# iPad battery: the spine's "you are here" band repaints the page on every scroll frame

*Started 2026-10-03 by the Overseer's brief. Feedback report `spya-m0mcqb`
([SPIDERYARN-READING2-36](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-36)); note
[260912_0814-ipad-battery-still-drains-fast.md](../user-feedback/260912_0814-ipad-battery-still-drains-fast.md);
the earlier half is [260912a](260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md).
Measurement: [261003a investigation](../investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view.md).*

> It's a bit hard to be sure because my iPad's getting quite old. It definitely feels like it drains
> a bit faster than I'd like, but it's not as big a problem. So I think if there's a fix that you can
> make that looks promising, but won't add too much complexity, then definitely go for it.
>
> — Greg, 2026-10-02

## What the measurement found

On 2026-09-12 scrolling cost 55–60% of a desktop core, and about 40 points of that could not be
attributed to script, style or layout. A Chrome trace over a fixed gesture (production build,
`replication-crisis-spya-hrjamq`, 551 rows; desktop and iPad emulation; Plain and Summary; two runs
each) now attributes it. Full numbers in the investigation; the headline:

- **Every paint is the whole root layer** — layer 0, `#document`, a cull rect of 11–15 viewports —
  and in 463–465 of ~600 painted frames per iPad run the *only* invalidation was an inline-style
  write from the spine. The biggest is [`Spine.tsx`](../../src/web/Spine.tsx) § the scroll effect,
  `band.style.top = …%` on the viewport band, 482 times per run, once per scroll frame.
- **Hiding the spine** (a diagnostic, not a fix) took iPad-Summary main-thread busy time from
  32.5–37.5 s to 15.5 s, Paint events from ~580 to 34, raster tasks from ~750 to 250. Desktop Plain:
  ~10 s to 7.7 s. That is an upper bound for what fixing the spine can buy: hiding it also removes
  its React work.
- Scrolling itself is threaded (compositor) and every listener is passive. At rest: 0 frames, 0 rAF,
  0 running animations.
- Smaller, confirmed: `OnScreenLinksStyle` rewrites a `<style>` element's text 144 times a scroll in
  Summary, ~16 ms each in rule-set invalidation (7–8% on iPad, ~13% desktop); the scroll-direction
  bar flip restyles ~16,000 elements, ~330 ms per reversal; `:root:has()` / `.reader:has()`
  re-matches ~30 ms each, 29–42 times a run.

**What carries to an iPad, and what does not.** This is headless Chromium with software raster.
WebKit composites `position: fixed` elements on its own, so on the device the spine's repaint is
probably confined to the rail's own layer rather than the whole page — the iPad's cost from this is
likely smaller than Chromium's 50%. What does carry is the shape: a `top` change is layout + paint +
raster of that layer on every frame of every scroll, where a `transform` change on a composited layer
is none of those. The fix is right on both engines; how much battery it buys on Greg's iPad is not
measured and cannot be from here.

## What we are doing

### Stage 1 — the spine moves its band with `transform`, and the rail is its own layer

1. **The viewport band moves by `transform`, not `top`** — *revised after Sol's F6*. The band sits
   in a wrapper that is the track's full height (`inset: 0`, `pointer-events: none`), and the
   wrapper moves by `translateY((scrollY − docTop) / docHeight × 100%)` — a percentage of its *own*
   height, which is the track's, so it lands exactly where `top` did. The band inside keeps its
   percentage height, borders and 2 px minimum. No observer: the rail's height changes without a
   scroll (on resize, and while the bar flip animates `.spine`'s `top`), and a percentage of the
   wrapper follows it for free. (The first draft read the track height from a `ResizeObserver`
   and translated in pixels; correct, but one lifecycle more.)
2. **`will-change: transform` on the moving wrapper** so the band has its own layer and a move is a
   compositor update, not a paint. **`.spine { … }` gets its own compositing layer too**
   (`will-change: transform` on a fixed element is the standard way; it is already fixed, so it
   creates no new containing block for its fixed-position descendants — check none exist), so the
   React updates that remain — `spine-hit` / `spine-tick` / `spine-here` at section boundaries, ~150
   a run — repaint a 12 px strip instead of eleven viewports of page.
3. **Tests.** The spine tests (`tests/spine-*.test.ts`) that read the band's `top` move to its
   transform. A red-first test that the scroll effect writes `transform` and never `top` — written
   before the change, watched red. jsdom cannot see paint, so the real evidence is the after-trace.

### Stage 2 — only if stage 1 leaves it worth it: `OnScreenLinksStyle` stops rewriting a stylesheet

Today the component keeps the on-screen block ids as one CSS rule string in a `<style>` element, and
every change re-parses that sheet and schedules invalidation across ~22,000 nodes. The alternative:
keep the previous id set, and set/remove a `data-on-screen` attribute on just the
`[data-block-link]` elements whose id entered or left — invalidation on a handful of elements. The
rule becomes one static selector in the stylesheet. Cost: an attribute the band's links do not own
(React re-rendering a link would not clear it, because React does not manage that attribute — but a
link *remounted* while on screen would lose it until the next change; the effect must re-apply on
the band's own DOM changes, which is what makes this "medium" rather than "small"). Decide after
stage 1's after-numbers: build it only if it is still ≥ 5% of iPad-Summary main-thread time and the
re-apply turns out to be a few lines. Otherwise defer it with a queue entry.

### Not doing, named, each with a queue entry if not built

- **The bar flip and the `:has()` rules** (~6% iPad, ~25% of desktop busy time, mostly as jank at a
  reversal). Narrowing `--bar-bottom` off `:root` onto its five consumers and replacing
  `:root:has()` with JS-set classes touches the specificity reasoning across `shell.css` and
  `narrow-window.css`; that is not "won't add too much complexity". Deferred.
- **Per-frame `getBoundingClientRect` in `useReadingPosition`** (2.75 s inclusive per iPad run, much
  of it forced style after a flip). The arithmetic replacement is already ranked and caveated in
  [performance.md § Still open](../project/performance.md#still-open-ranked-with-citations) item 4.
  Unchanged.
- **One HitTest per touch move** (~10%): structural; any touch listener, React's own included, makes
  Chromium do it. Not ours to remove.

## The simpler option passed over

**`.spine { will-change: transform }` alone, one CSS line, keeping `top`.** That stops the band's
move repainting the page — the repaint shrinks to the rail's layer — and on WebKit it is probably
what already happens. Passed over because it leaves layout + paint + raster of the rail on every
frame, which is the cost that *does* carry to the iPad; the transform removes all three for a few
lines more. It is part of stage 1 anyway, for the boundary updates.

**A percentage `translateY`** (percentages of the band's *own* height, which is `viewportH/docHeight`
of the track, so `(scrollY − docTop)/viewportH × 100%` lands exactly where `top` did, with no
measurement at all) was the tempting zero-observer version. Refused: `min-height: 2px` on the band
breaks the proportion for an article past ~400 viewports, and then the band would sit hundreds of
pixels from where the reader is. Wrong position is worse than slow position.

## Done looks like

- The same harness (`scripts/trace-scroll.ts`), same gesture, same article, same build process,
  before and after, two runs each, iPad Summary and Plain, desktop Plain: Paint events and main-thread
  busy time down, `spine-viewport` inline writes still ~480 but no longer paired with a paint.
- `npm test`, `npm run typecheck` green; lint on touched files.
- A browser check on a real (non-headless-diagnostic) page at iPad size with touch: the band tracks
  the scroll, sits right after a bar flip and after a resize, and the spine's hover/press still work.
- GPT Sol on this plan, and on the code.
- The investigation doc, performance.md's dated section, the feedback note, and a queue entry for
  each deferred item before the note says *shipped*.

## Plan review, GPT Sol, 2026-10-03

[261003a-ipad-battery-scroll-repaint-review-sol.md](261003a-ipad-battery-scroll-repaint-review-sol.md)
(prompt beside it). *Proceed with changes*; no P0 or P1.

| ID | Finding | Disposition |
|---|---|---|
| F1 | P2: Paint's `layerId` is hard-coded to 0 in this Chrome and its `clip` is a cull rect, so "repaints the whole root layer" and "eleven viewports painted" overclaim | Taken. Worded as document-level paint lifecycle work associated with the spine; cull rects labelled as such; the harness asks LayerTree for layer identities |
| F2 | P2: the analysis window was wider than the gesture, and touch pacing stretched under load | Taken. Harness clips to explicit marks and reports CPU per 1000 px; baseline re-measured (`before-v2/`) |
| F3 | P2: "inline style writes only" was not exclusive | Taken: exclusive classes, mixed reported. Sol's own reclassification found 462–464 exclusive, which narrows the attribution to `.spine-viewport` rather than weakening it |
| F4 | P2: `will-change: transform` *does* make a containing block for fixed descendants | Taken. Nothing fixed lives in `.spine` (the tooltip portals to `body`; `.spine` already stacks at `z-index: 45`), but only the moving element is promoted unless the after-trace shows `.spine` itself needs it. Compositing is a hint a browser may decline |
| F5 | P2: replacing `top` with `transform` in the old test checks only that a string changed | Taken: exact translation with a nonzero `docTop`, preserved across a boundary render, no inline `top`, cleanup |
| F6 | P2: an observer-free transform was missed — translate a *track-height wrapper* by `(scrollY − docTop)/docHeight × 100%` of its own height, the band inside it unchanged | **Taken; replaces the ResizeObserver design.** One element instead of an observer lifecycle, and it follows a resize and the bar-flip transition for free |
| F7 | P3: `display: none` does not unmount the spine, so its React work stays in the diagnostic | Taken: the diagnostic removes the rendering cost and keeps the script, so it is an upper bound for a rendering fix |

## Log

- 2026-10-03 — measured (Opus subagent; harness `scripts/trace-scroll.ts`, build `4e8fb59ad`).
  Plan written.
