# A rotation lays the reading view out for the new width

**Status:** in progress, 2026-09-12. From SPIDERYARN-READING2-33 and -34 (Greg, an iPad, production,
build `607b57a0`) — the queue entry `qi-jamh3n2h`.

> On this landscape iPad I think there's room to show two columns in Structure mode
>
> — Greg, 2026-09-12 08:08Z (SPIDERYARN-READING2-33)

> Ah weird. It IS now showing two columns in Structure mode on iPad in landscape mode (even though it
> wasn't before). This is great now. Somehow switching between portrait and landscape often messes up
> the rendering
>
> — Greg, 2026-09-12 08:10Z (SPIDERYARN-READING2-34)

So the ask is not "add two columns" — Structure already draws them on a band that wide
([StructureMode.tsx § `structureFace`](../../src/web/modes/structure/StructureMode.tsx)) — but "the
layout a width deserves, after a rotation, every time".

## Diagnosis

**The reading view's whole layout is computed from `window.innerWidth`, and on iPad Safari
`innerWidth` is the *visual* viewport: it shrinks when the page is zoomed in.** Everything else on
the page — every `@media (max-width)`, every `100vw`, the root's `clientWidth` — is the *layout*
viewport, which zoom does not touch.

The chain, each link from WebKit's own source (read on `main`, 2026-09-12, by a research subagent;
its downloads are not kept):

1. `LocalDOMWindow::innerWidth()` returns `unobscuredContentRectIncludingScrollbars().width()`, which
   on `PLATFORM(IOS_FAMILY)` is the unobscured content rect converted into page coordinates
   (`WKWebViewIOS.mm` `_createVisibleContentRectUpdate`). At zoom ×1.5 it is two thirds of the
   screen. MDN's "the layout viewport" is not true of iOS.
2. `Element::clientWidth()` for the root returns `frameView()->layoutWidth()`, and
   `MediaQueryFeatures.cpp` asks the same `layoutWidth()`. Zoom-independent.
3. **Zoom is kept across a rotation** (`WebPage::dynamicViewportSizeUpdate`: the scale is carried
   when the reader has changed it), and **a zoom change fires no window `resize`** — iOS's
   `sizeForResizeEvent()` is in screen points, so only `visualViewport` hears it. quirksmode agrees.

Put together: rotate a zoomed-in iPad and the rotation's `resize` stores a width two-thirds of the
real one in `useWindowWidth`'s state; `fitMode` sizes the band for that window; `structureFace`
measures a narrow band and draws the list. Zooming back out fires nothing, so it stays wrong **until
some unrelated window `resize`** — Safari's toolbar collapsing on a scroll is the everyday one — and
then two columns appear "unprompted". That is report 34 in one sentence.

**Where the zoom came from is not established** and does not change the fix: a pinch, or a
double-tap zoom on iPad Safari. (The sub-16px focus zoom is gated to the small-screen idiom per
narrow-windows.md, so probably not that on an iPad.)

**What this box cannot do is reproduce it on an iPad.** Chromium's `innerWidth` has been the layout
viewport since Chrome 61 and does not move with pinch zoom, and there is no iOS device here. So the
reproduction is at the mechanism: a jsdom test that holds `innerWidth` at a zoomed visual width and
`clientWidth` at the layout width, and fires a `resize`. It goes red on the current code. Stage 2
gives Greg the instrument that confirms it on the device.

Also considered and ruled out: `orientationchange` firing with stale values (WebKit bug 170595 is
WKWebView-only; in Safari, `setDeviceOrientation` dispatches after the new layout size is set), and
iOS 18's live-resize transient during rotation (bug 276661, fixed by skipping live resize on an
orientation change, and self-correcting within 500ms anyway).

## The fix

**One function, `layoutViewportWidth()`, and every layout reader uses it:**

```ts
Math.max(window.innerWidth, document.documentElement.clientWidth)
```

Why the larger of the two, case by case:

| where                              | `innerWidth`            | `clientWidth`        | max gives        |
| ---------------------------------- | ----------------------- | -------------------- | ---------------- |
| iOS, zoomed in                     | visual (too small)      | layout               | layout ✓ (fixed) |
| iOS, scale 1                       | layout                  | layout               | same as today    |
| desktop, classic scrollbar         | incl. scrollbar = CSS's | 15px narrower        | same as today    |
| desktop Chrome, trackpad pinch     | layout                  | layout − scrollbar   | same as today    |
| iOS zoomed *out* to fit overflow   | wider than layout       | layout               | same as today    |

It never gives a narrower answer than today's. In this standards-mode top-level document the root's
`clientWidth` is the layout viewport (CSSOM View's special case for the root, pinned by the WPT
`client-props-root.html`), never inflated by the root's styled width or by overflow — so it wins only
where `innerWidth` has fallen below the layout, and the known cause of that on the browsers we support
is iOS pinch zoom. The last row keeps today's behaviour rather than fixing it; a page that overflows
is a separate bug with its own guard (narrow-windows.md § the check).

**One reader changes: `useWindowWidth`** ([reader/measure.ts](../../src/web/reader/measure.ts)), the
width the whole reading view is laid out from.

**And a guard, because this is a class, not a line.** `tests/layout-viewport-width.test.tsx` parses
`src/web` and fails on an `innerWidth` read outside an allowlist that gives each file's reason for
wanting the browser's own answer; it pins the reviewed number of reads in each allowed file too, so a
new read cannot hide beside an old one. Parsing matters here: comment markers inside strings must not
hide code, and a URL or template that mentions the property is not a read. The next person to write
`window.innerWidth` into a layout decision is told why at test time.

### What the plan review changed (GPT Sol, 2026-09-12, BUILD WITH CHANGES)

The first draft also moved two other readers and policed `innerHeight`. All three came out:

- **F1 (P1) — width only.** The client's `innerHeight` reads (`useColumnContext`, `scroll.ts`,
  `Spine.tsx`, `PageContents.tsx`) want the *visible* height — browser chrome, the focus line,
  scrolling — and are right to. No `layoutViewportHeight()`.
- **F2 (P1) — `OutlinePanel`'s covers test stays.** It pairs `getBoundingClientRect().right` with
  `innerWidth`, and whether that rect is in visual or layout coordinates under iOS zoom is itself a
  WebKit bug (170981, 257375). Swapping one side for the layout width could create the very mismatch
  this removes. Allowlisted in the guard with that reason, pending a device trace.
- **F3 (P2) — `SmallScreenHint` stays.** Pinch zoom scales both visual dimensions equally, so its
  `height > width` cannot flip. Allowlisted with that reason.
- **F4 (P2)** — stage 2's events get distinct names (below).
- **F5 (P3)** — the "only ever zoom" claim is scoped as above.

## Stages

1. **The fix.** `layoutViewportWidth` in `measure.ts`, used by `useWindowWidth`; a red-first test
   of the hook and the guard (`tests/layout-viewport-width.test.tsx`); narrow-windows.md gains a
   paragraph; a postmortem in `docs/postmortems/`. Sol code review.
2. **The probe hears a rotation.** `?probe=1` records only visual-viewport events today, so a
   rotation is invisible to it. Give the window's events names of their own — `window-resize`,
   `orientationchange`, and `laid-out` for the reader re-rendering (Sol F4: one `resize` for both
   would make "zoom fired one and not the other" unprovable) — install the window listeners even
   where there is no `visualViewport`, and add a `lay` field: `[root clientWidth, the width the
   reader laid out for]`. **The plan first said to rename `resize`/`scroll` to `vv-resize`/
   `vv-scroll`; that was not done**, because `scripts/viewport-trace.ts` validates `ev` against a
   fixed list and every trace already taken uses the old names. They keep their meaning — the
   visual viewport's — and the reader's list learns the three new ones.
   The helper's answer is not recorded, because it is `max` of two numbers the trace already has; the
   reader's stored state is not reconstructable, so it is. A trace off Greg's iPad then shows the
   zoomed `innerWidth` beside the layout width, or shows that something else is going on. Sol code
   review.

**Done:** both stages on `dev`, `npm test` and `npm run typecheck` green; the note in
`docs/user-feedback/` names the ending.

## Passed over

- **`matchMedia` for the breakpoints** (the research agent's first recommendation). The reading
  view's layout is arithmetic over a continuous width, not a handful of breakpoints, so there is no
  query to ask.
- **`clientWidth` alone.** Correct on iOS, but 15px narrower than every media query on a desktop with
  classic scrollbars, which would open a 15px band where layout.ts and narrow-window.css disagree —
  the exact failure narrow-windows.md § a band with no room records.
- **`innerWidth × visualViewport.scale`.** Right on iOS, wrong on desktop Chrome, whose `innerWidth`
  does not shrink under a trackpad pinch while its `scale` grows.
- **A `ResizeObserver` on `<html>` as another trigger.** The rotation's own events already carry the
  new values in Safari, and the root's box changes height with every image that loads.
- **Adding the layout width to feedback diagnostics.** `viewportW` is `innerWidth`, so a report sent
  while zoomed misreports the window. Worth doing, but it changes the wire shape the server
  validates (`feedback-payload.ts`); left for a separate change. Named, not built.

## Deferred

- The feedback diagnostics field above.
- Confirmation on the device: Greg, on the iPad, after the next deploy — open a Structure article
  with `?probe=1`, zoom in, rotate, and copy the trace.
