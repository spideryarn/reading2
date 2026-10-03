# What a scroll frame costs in the reading view

Up: [investigations.md](../project/investigations.md)

*2026-10-03. For an iPad battery report, `spya-m0mcqb`
([note](../user-feedback/260912_0814-ipad-battery-still-drains-fast.md)). The plan it informed is
[261003a-ipad-battery-scroll-repaint.md](../plans/261003a-ipad-battery-scroll-repaint.md). Raw
printouts, one per run, each opening with its exact command, commit and box load, are in
[`261003a-what-a-scroll-frame-costs-in-the-reading-view/`](261003a-what-a-scroll-frame-costs-in-the-reading-view/):
`before/` (first harness), `before-v2/` (fixed harness, the baseline; its `README.md` is the
recipe), `after/`.*

## What was asked

On 2026-09-12 scrolling the reading view cost 55–60% of a desktop core, and about 40 points of that
were neither script, style nor layout
([performance.md § What is left, and it is not script](../project/performance.md#what-is-left-and-it-is-not-script)).
Nobody knew what that was. Greg's iPad still felt like it drained faster than it should. The
question: what does the reading view do per scroll frame today, and is there a cheap fix?

## How it was measured

[`scripts/trace-scroll.ts`](../../scripts/trace-scroll.ts), new: its own headless Chrome, signed in
locally, a production build (`vite build` + `vite preview`), a Chrome trace over a fixed gesture,
clipped to marks the page writes itself, plus `/proc` CPU for the renderer, plus the LayerTree
(which elements own a composited layer, and how often each was repainted).

- Article `replication-crisis-spya-hrjamq`: 551 rows, ~22,800 nodes, 81,000 px tall.
- **iPad**: 1194×834, DPR 2, mobile + touch emulation, iPad UA. 24 raw touch swipes of 600 px,
  8 down / 4 up / 8 down / 4 up, held before lifting (no fling): 14,040 px delivered.
  `Input.synthesizeScrollGesture` does not scroll the page under headless mobile emulation — it
  produces frames and moves nothing; the harness prints `movedPx` for that reason.
- **Desktop**: 1280×800, wheel 120 px every 60 ms, three reversals.
- Summary (`?mode=summary`, the reported state) and Plain, two runs each.

**Compare per 1000 px, and trust counts over seconds.** The touch gesture waits for each input to be
acknowledged, so it stretches when the box is loaded; the baseline ran at load 16–28 and the after at
9–12. Counts of paints, raster tasks and style recalcs do not depend on load and repeated to within a
few between runs.

## What it found

1. **Scrolling is threaded and every listener is passive** — `ScrollTree::ScrollBy` runs on the
   compositor, no main-thread scrolling reasons. But the main thread is woken every frame by the
   rAF samplers (`useReadingPosition`, `Spine`, `scroll.ts`'s bar watcher, and in Summary
   `OnScreenLinksStyle`).
2. **The spine's viewport band was the largest single cost.** `Spine.tsx` moved it with
   `band.style.top = …%` on every frame. That write was the only tracked style invalidation in
   ~460 of ~550 paints per iPad gesture. The spine already had its own composited layer — by
   accident, reason `Overlap` — repainted ~500 times a gesture; the page's root layer was repainted
   ~330 times as well. A diagnostic with the spine hidden by CSS (components still mounted, so its
   script still ran) took iPad-Summary main-thread busy time from ~33–37 s to 15.5 s.
3. **`OnScreenLinksStyle` rewrites a `<style>` element's text 144 times a gesture in Summary**,
   ~16 ms each in `StyleEngine::scheduleInvalidationsForRuleSets` — about 2.3 s, which survives
   hiding the spine.
4. **The scroll-direction bar flip** (`data-bars` on `<html>`) changes custom properties every
   element inherits, so each reversal restyles ~16,000 elements, ~330 ms. `:root:has()` /
   `.reader:has()` re-match on React commits, ~30 ms each, 29–42 times a gesture.
5. **One HitTest per touch move**, ~6 ms each — structural.
6. **At rest, nothing**: 0 frames, 0 rAF, 0 running animations, ~0.3% of a core over 30 s.
7. **Ruled out**: `useVisualViewport` (listens only while a dialog is open), `ViewportProbe`
   (`?probe=1` only), `useColumnContext` (never ran in these modes); no `backdrop-filter`, `filter`
   or `will-change` in the reader's chrome.

## What was changed, and what it bought

The band now sits in a track-height wrapper with `will-change: transform`, and the wrapper moves by
`translateY(%)` of its own height (GPT Sol's design, plan review F6). Same harness, same gesture:

| per gesture | iPad Summary before → after | iPad Plain before → after | desktop Plain before → after |
|---|---|---|---|
| Paint events | 552, 554 → **53, 53** | 552, 547 → **53, 53** | 159, 103 → 123, 86 |
| raster tasks | 644, 644 → **166, 166** | 637, 636 → **159, 159** | 463, 432 → 374, 376 |
| spine layer repaints | 496 → **17** | — | — |
| page (root) layer repaints | 334 → **26** | — | — |
| main-thread CPU s per 1000 px (`/proc`) | 2.37, 2.26 → **1.27, 1.28** | 2.09, 2.02 → **0.99, 0.99** | 0.45, 0.39 → 0.36, 0.38 |
| renderer CPU s per 1000 px (`/proc`) | 2.71, 2.60 → **1.65, 1.67** | 2.47, 2.31 → **1.34, 1.35** | 0.52, 0.45 → 0.46, 0.48 |
| style recalcs | 662, 663 → 661, 663 | 520, 521 → 521, 521 | 179, 143 → 208, 204 |

Paints fell by 90% and raster by 75% under iPad emulation, and the main thread's CPU per scrolled
pixel roughly halved; on desktop the gain is ~10–15%, because at DPR 1 there is far less to raster.
Style recalcs did not move, which is right: the fix removes paint and raster, not style.

## What this does not show

- **This is Chromium, not Safari, and software raster, not a GPU.** WebKit composites fixed elements
  on its own policy, so the iPad may already have confined the spine's repaint to a small layer; what
  carries is that a `top` write is layout + paint + raster of *some* layer every frame and a
  transform on a composited layer is none of them. How much battery this buys on Greg's iPad is not
  measured and cannot be from here — WebKit will not launch on the box
  ([260912a](../plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md)).
- **Chrome 152 does not report paint damage** (`LayerTree.layerPainted` never fires, Paint's
  `layerId` is always 0, its `clip` is a cull rect), so "what was repainted" is by layer repaint
  counts and by elimination, not by area.
- The local Summary band was in its empty state; a populated one may cost more.
- The gesture does not fling; a real momentum scroll produces more frames per swipe.

## Not done, and where it went

Items 3 and 4 above, and the per-frame `getBoundingClientRect` in `useReadingPosition`, are queued
in [overseer-queue.md](../project/overseer-queue.md) with these numbers. Item 3 is ~13% of the
iPad-Summary main thread after the fix and needs the band's links reconciled when they remount;
item 4 is mostly jank at a reversal and touches delicate specificity in `shell.css` and
`narrow-window.css`. Neither met "a fix that looks promising and won't add too much complexity".
