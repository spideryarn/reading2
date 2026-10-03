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

- **Frequent document-level paint lifecycle work was associated with the spine.** The fixed
  harness found its inline-style write the only tracked style invalidation in ~460 of ~550 Paint
  events per iPad gesture. Paint's layer 0 and cull rectangle do not identify a compositor layer
  or painted area; the investigation uses LayerTree repaint counts instead.
- **Hiding the spine** (a diagnostic, not a fix) took iPad-Summary main-thread busy time from
  32.5–37.5 s to 15.5 s. CSS hiding keeps the component mounted and its React/scroll work running;
  the result is an upper bound for removing its visible rendering cost, not its script.
- Scrolling itself is threaded (compositor) and the recorded scroll listeners are passive. At rest: 0 frames, 0 rAF,
  0 running animations.
- Smaller, confirmed: `OnScreenLinksStyle` rewrites a `<style>` element's text 144 times a scroll in
  Summary, ~16 ms each in rule-set invalidation (7–8% on iPad, ~13% desktop); the scroll-direction
  bar flip restyles ~16,000 elements, ~330 ms per reversal; `:root:has()` / `.reader:has()`
  re-matches ~30 ms each, 29–42 times a run.

**What carries to an iPad, and what does not.** This is headless Chromium with software raster.
WebKit has its own compositing policy; these Chromium software-raster measurements do not establish
which layers an iPad repaints or the size of its gain. A `top` change requires layout and can cause
paint and raster, where a `transform` change on a composited layer can avoid those costs.
Compositing remains a browser hint; how much battery this buys on Greg's iPad is not measured here.

## What we are doing

### Stage 1 — the spine moves its band with `transform` on its own layer

1. **The viewport band moves by `transform`, not `top`** — *revised after Sol's F6*. The band sits
   in a wrapper that is the track's full height (`inset: 0`, `pointer-events: none`), and the
   wrapper moves by `translateY((scrollY − docTop) / docHeight × 100%)` — a percentage of its *own*
   height, which is the track's, so it lands exactly where `top` did. The band inside keeps its
   percentage height, borders and 2 px minimum. No observer: the rail's height changes without a
   scroll (on resize, and while the bar flip animates `.spine`'s `top`), and a percentage of the
   wrapper follows it for free. (The first draft read the track height from a `ResizeObserver`
   and translated in pixels; correct, but one lifecycle more.)
2. **`will-change: transform` on the moving wrapper** asks for its own layer so a move can be a
   compositor update. The browser may decline the hint. **Do not also promote `.spine` unless
   the after-trace shows a need** (Sol F1/F4); stage 1's after-numbers did not. A transform hint
   does establish a containing block for fixed descendants, even on an already fixed element.
   None live inside the moving wrapper; the spine tooltip portals to `body`.
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

**Decided 2026-10-03: deferred, `qi-scsj9ksv`.** After stage 1 it is still ~13% of the iPad-Summary
main thread (144 swaps, ~2.3 s of ~18 s), so it clears the 5% bar; but the reconcile is a
MutationObserver or a re-apply on every band render, plus clearing on disable and checking the
cascade (Sol's plan review lists five obligations). That is the "medium" the plan feared, not a few
lines, and Greg's bar was "won't add too much complexity". Sol's code review agreed.

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

Queued as proposals on 2026-10-03: the bar flip and `:has()` as `qi-nj66xnmb`, reading position as
`qi-dcxazgza`.

## The simpler option passed over

**`.spine { will-change: transform }` alone, one CSS line, keeping `top`.** If the browser promotes
the rail, this may confine its repaint to that layer. Passed over because it leaves the per-frame
layout and rendering cost of moving the band with `top`. Moving the band by transform can avoid
that for a few lines more. Promoting the whole rail was dropped after Sol F1/F4; promote only the
moving wrapper.

**A percentage `translateY`** (percentages of the band's *own* height, which is `viewportH/docHeight`
of the track, so `(scrollY − docTop)/viewportH × 100%` lands exactly where `top` did, with no
measurement at all) was the tempting zero-observer version. Refused: `min-height: 2px` on the band
breaks the proportion for an article past ~400 viewports, and then the band would sit hundreds of
pixels from where the reader is. Wrong position is worse than slow position.

## Done looks like

- The same harness (`scripts/trace-scroll.ts`), same gesture, same article, same build process,
  before and after, two runs each, iPad Summary and Plain, desktop Plain: Paint events and main-thread
  busy time down under iPad emulation, `spine-viewport-track` inline writes still ~480 but no longer
  paired with a paint on every move. Qualify the less-controlled desktop comparison.
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

## Code review, GPT Sol, 2026-10-03

[261003a-ipad-battery-scroll-repaint-code-review-sol.md](261003a-ipad-battery-scroll-repaint-code-review-sol.md),
on `fa8d8f534`, write-capable. *Approve with these fixes*; no P0 or P1. Sol made every fix itself,
and I read the diff and re-ran the gates.

| ID | Finding | Disposition |
|---|---|---|
| R1 | P2: the desktop gain and count repeatability were overstated (desktop wheel input coalesced differently between runs) | Fixed by Sol in the investigation and the harness header. I made the matching fix in performance.md: "desktop runs were too uneven to claim a gain" |
| R2 | P3: the plan still carried claims its own review had rejected | Fixed by Sol |
| R3 | P3: the investigation said "queued" before anything was | The entries were added after Sol's snapshot; the investigation now names them |
| R4 | P3: "every listener is passive", but a `pointerdown` is not | Fixed: the claim is now limited to scroll listeners |
| R5 | P3: an old WebKit launch failure was presented as current | Fixed |

Sol also added four placement tests: after a window resize, a body resize, a font swap and a mode
switch, each with no further scroll. Mutations of the scaling, stale-placement and cleanup logic turn
them red. Separately, I mutated the formula to drop `docTop` and saw the exact-translation test go
red (`expected 'translateY(0%)' to be 'translateY(-15%)'`).

Sol reported that its own browser dispatch failed (sandbox DNS). The browser check below is the one
that counts.

## Log

- 2026-10-03 — measured (Opus subagent; harness `scripts/trace-scroll.ts`, build `4e8fb59ad`).
  Plan written.
- 2026-10-03 — stage 1 built (Opus subagent), switched to Sol's F6 wrapper before landing.
  Baseline re-measured with the fixed harness on a clean build of `40e232dc9` (`before-v2/`), then
  the after from the worktree build (`after/`). iPad: Paint ~550 → 53, raster ~640 → 160, layer
  repaints spine 496 → 17 and page 334 → 26, main-thread CPU per 1000 px 2.0–2.4 s → 1.0–1.3 s.
  The new wrapper owns its layer (`WillChangeTransform`) and was painted once. Committed `fa8d8f534`.
- 2026-10-03 — browser check (Sonnet, Playwright, system Chrome, production build). Run at iPad
  size with touch and DPR 2, and at desktop size. The band's measured top matched the formula to
  0.1 px at load, 25%, 50% and the end, through direction flips sampled 30–830 ms, and after a resize
  with no scroll. `elementFromPoint` inside the band returns `spine-hit`, never the wrapper. Desktop
  hover shows the card and a click jumps; a touch tap reveals as designed. Summary renders and its
  band tracks. Not exercised: the rail's own `top` moving mid-transition (it did not move in these
  samples). A percentage of the wrapper follows it by construction, and Sol's font-swap and resize
  tests cover the same no-scroll path. Print not checked; no print rule touches the spine.
- 2026-10-03 — Sol code review: approve with fixes, folded in. Deferred items queued.
