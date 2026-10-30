# The bottom bar floats on an iPad after a rotation, and the probe that can catch it

**Status:** built 2026-10-30, on `dev`, not deployed. Planned, then revised after GPT Sol's plan
review (RETHINK, § What the plan review changed). The bug itself is **not fixed**: this is the
instrument that can narrow the iOS state from its observable signature, and a question to Greg
asking for one trace. From Greg's report `spya-u0vb0a` (#741,
[SPIDERYARN-READING2-QB](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-QB)), an admin's
report (`feedback-reporter.ts` exited 0), filed from an iPad on production build `8352c47a`:

> On an iPad, sometimes after sort of, you know, a bit of rotating and resizing, the bottom bar kind
> of gets detached from the very bottom of the screen, and so it seems to, I think it still hides,
> but then when it reappears, it reappears partway up the screen.

The address was `/read/nagel-bat?structure=expanded&summary=fuller&margin=1&mode=search`. No
screenshot and no diagnostics were attached.

## Prior work

- **The same symptom, 2026-10-08** (`spya-gxbwug`):
  [261008b](261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md) and its
  [note](../user-feedback/261008_0717-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md). One
  cause was found and fixed: a page wider than the screen during a turn lets iOS zoom the page out,
  and at a zoom of 0.7 a `bottom: 0` bar is drawn 30% of the way up. `.reader` now clips sideways
  overflow. The keyboard half was deferred to queue item `qi-hzramwrk`, waiting for a `?probe=1`
  trace from the device. **The build Greg was on carries that fix**, so this report is either that
  fix missing a case or a different cause.
- **Zoom carried across a rotation**:
  [postmortem 260912b](../postmortems/260912b-a-layout-read-from-a-number-that-means-a-different-viewport-on-ios.md).
- **The probe**: [`ViewportProbe.tsx`](../../src/web/ViewportProbe.tsx), since 2026-09-07, which
  already records the visual viewport, the window and the dock's rectangle on every viewport event.

## What was measured here

A real article in Playwright's WebKit (build 2336) with iPad emulation (`isMobile`, `hasTouch`, DPR
2, an iPad user agent), signed in, with the report's address state, put through
834×1194 → 1194×834 → 834×1194 → 700×1194 → 1194×834 → 500×834 → 834×1194, scrolling forward and
back after each step. Every animation frame was sampled, by a throwaway Playwright script that
was not committed.

- The document was **never wider than the screen**, so the 261008b fix holds in emulation. No
  element outside `.reader` stuck out either.
- `visualViewport` was **always at `offsetTop` 0 and scale 1**.
- The dock always ended at `innerHeight`. It hid (moved down 53px) and came back only at 700 and
  500 wide, which is right: the bottom bar hides only in a small window
  (`styles/narrow-window.css` § a small device). So *"I think it still hides"* places Greg in a Split
  View or Stage Manager window under 732px, or a turn through one.

**Nothing reproduces here**, and the 2026-10-08 work found the same: this box's WebKit has neither
iOS's zoom-to-fit nor its soft keyboard. The bug lives in iOS state.

## Diagnosis: three iOS states give this symptom, and JavaScript cannot tell which

GPT Sol was asked while still thinking, reading WebKit's source and bug tracker. Its answer is
[the consult file](261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it-consult-sol.md),
and the essentials are here. Each of these states
draws a `position: fixed; bottom: 0` bar partway up, and keeps it there across hide-and-show:

1. **The page is zoomed out** (scale < 1) after a rotation or a window resize. A Stage Manager
   resize changes the web view's bounds, so it probably takes the same path as a rotation
   (`WebPage::dynamicViewportSizeUpdate` → `shrinkToFitContent`). That is inference, not something
   read in the source. With 261008b in, nothing obvious is left that could make the page too wide.
2. **The visual viewport is left panned** (`offsetTop` > 0), or its height left stale, after the
   soft keyboard. [WebKit bug 218983](https://bugs.webkit.org/show_bug.cgi?id=218983) is almost
   Greg's sequence: focus a field and dismiss the keyboard in landscape, then rotate to portrait, and
   a bottom-fixed footer sits partway up with `visualViewport.height` stale. Bug 297779 is a
   persistent 24px `offsetTop` after a dismissal. **Search focuses its field when it opens**
   (`SearchPanel.tsx`), and the report's address has `mode=search`.
3. **The layout viewport used for fixed positioning is stale** after a resize
   (`RenderView::clientLogicalHeightForFixedPosition` reads `FrameView::layoutViewportRect()`; bug
   171140 was an earlier case of it differing from what script sees).

Sol's point that settles the fix: **WebKit can be wrong at layout, at painting or at hit-testing**,
and in some of these states (bugs 218983, 254861, 312149) the numbers script can read are
themselves the stale ones. So "where `bottom: 0` lands, against the bottom of the visible area" is
evidence, not a detector we can trust.

## The fix that was passed over: move the bar down by the measured gap

The obvious fix measures that gap after the viewport settles, clamps it so it only ever moves
chrome down, and subtracts it from every bottom-anchored element. **Passed over for now, for one
reason that is enough on its own:** on iOS 26, WebKit deliberately keeps `bottom: 0` *above*
Safari's floating toolbar (bug 297779, comment 23). There, screen pixels exist below WebKit's CSS
floor for fixed elements, so a measured gap can be positive on a perfectly healthy iPhone. A
re-anchor shipped blind would push the bar under Safari's own controls on the affected iPhones, to
fix an iPad state we have never seen a number from. Gating it to iPads avoids that case but not the
others: stale measurements, faults in painting only, and iPad browser-chrome variants. It would also touch about a dozen rules (the dock, its drawer, the
band, the spine, the install hint, the Feedback circle, the dialogs), and it cannot repair a
hit-testing offset.

**The viewport-meta zoom reset** (briefly setting `maximum-scale=1`) is passed over too. WebKit does
not promise that it resets the current scale or that it restores the reader's own zoom afterwards,
and iOS overrides author zoom limits for accessibility.

## Why the trace never arrived, and what changes

The keyboard half has waited three weeks for a trace. **The probe could not have taken one.** It
switches on only from `?probe=1` in the address, read once when the page loads. Greg's bug is
intermittent, and a reload very probably clears it. Editing the address reloads the page, so the
moment the bar is floating, there is no way to start recording without destroying what should be
recorded. That is the [postmortem](../postmortems/261030b-an-instrument-switched-on-by-reloading-cannot-catch-a-fault-that-reloading-clears.md).

### What the plan review changed (GPT Sol, 2026-10-30, RETHINK)

[The review](261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it-plan-review-sol.md).

- **P1, the trigger could destroy the evidence.** The first draft started the probe from the
  command bar and took its `start` sample then. But opening the command bar focuses its text field,
  which on an iPad brings up the soft keyboard, and the keyboard is one of the suspects: bug 218983
  reports that another focus and dismissal can put the geometry right. So **the administrator's
  reading view now records silently from page load**, and the row only *shows* the panel. Silent,
  the newest 200 samples are kept, so a long session does not fill up on its first minutes; once
  shown, the probe's old rule (keep the oldest, stop at 600) applies again.
- **P1, the trace classifies; it does not separate.** A stale `visualViewport.height` and a stale
  fixed-position layout can share one stale internal geometry, and a fault in painting only can
  leave every number consistent. So the wording here is "the signatures script can observe", and
  **the screenshot is part of the ask, not an extra**.
- **P1, `hit` compares hit-testing with the CSSOM**, not with where pixels are painted, and
  something covering the dock fails it too. Recorded with its point and signature, and described
  that way.
- **P1, settled samples coalesce, and `mark` is always admitted.** One pair of bookings at a time,
  moved by each new event; a `mark` is taken into a full trace. `start` is recorded once under
  Strict Mode.
- **P2, the floor stays inside `.reader`**, beside the dock, so a containing block a later
  ancestor makes would move both. Root and body rectangles were added beside `clientHeight`.
- **P2, the row only where a probe is drawn.** The command bar is on Metadata too. The row asks
  the switch, which knows whether a probe is mounted, and says so instead of seeming to work.

### Stage 1: the probe records ahead, starts without a reload, and records the states' observable signatures

1. **The administrator's reading view records silently from page load** (`ViewportProbe.tsx`; the
   silent path is never for a reader and never under *view as*), and **an admin row in the command bar, *Viewport
   probe*,** shows the panel over that recording on the page as it stands. Typed-only, like the
   other admin rows (`admin-commands.ts`). A small switch module (`probe-switch.ts`) sits beside
   the read-once flag: `?probe=1` still turns the panel on at load, and the row reveals the silent
   recording later. For a reader with no flag it still renders nothing and listens to no viewport.
2. **Per sample, the numbers that narrow the three states as far as script can** (Sol's list, cut
   to what answers this question):
   - `floor`: the rectangle of an untransformed, invisible `position: fixed; bottom: 0` sentinel.
     This is where `bottom: 0` really lands, apart from the dock's own transform. Against
     `vv.offsetTop + vv.height` it says "stale pan or height" or "the bar's own movement".
   - `root`: `documentElement.clientHeight` beside `innerHeight`. The layout viewport against the
     visual one.
   - `vv.pageTop`, so a pan is visible in page coordinates too.
   - the dock's computed `transform`, so a bar mid-slide is not mistaken for a misplaced one.
   - `hit`: what `elementFromPoint` finds at the middle of the dock's rectangle, with the point.
     If it is not inside `.dock`, hit-testing and the CSSOM disagree, or something covers the dock.
3. **A settled sample**, taken again 300ms and 1000ms after each window resize, orientation change
   and visual-viewport resize. Bug 237851 shows viewport values correcting only after a delay, and
   without this the trace ends on the transitional frame.

**Tests.** `tests/viewport-probe.test.tsx` § the probe started on the page as it stands: the row
shows the panel on a page loaded without `?probe`; it says so where no probe is drawn; a reader gets
nothing; the administrator's silent recording draws nothing and keeps the newest 200; `start` once
under Strict Mode; one coalesced pair of `settled` rows after a burst of resizes; a `mark` into a
full trace. Each was watched red with the switch, the silent recording, the coalescing or the
once-only `start` disabled.

**In a real browser.** jsdom has no layout, and a probe that records zeros looks exactly like a
healthy iPad. So the real app was driven in Playwright's WebKit with iPad emulation, signed in as
the administrator, with no `?probe` in the address: rotate to portrait, narrow to 700, open the
command bar, run *Viewport probe*, *mark*, *show*. The panel came up holding ten samples recorded
before the command bar was opened (`start`, `orientationchange`, two `window-resize`, two `resize`,
two `laid-out`, two `settled`), and the `mark` row read `floor` at y 1193 with height 1, so its
bottom was at 1194, matching `innerHeight` and `root`'s `clientHeight` 1194. `hit` landed inside
the dock, and `dockT` was the identity matrix with the bar shown.

### Stage 2: Greg takes one trace (a question to him)

A question file asks him, the next time the bar floats, to take a screenshot first, then type
*probe* in the command bar, press *mark* and then *copy*, and paste the trace into Feedback. It also gives him the
other option, the blind re-anchor and its iPhone cost, with the recommendation to wait for the
trace. The re-anchor's design is in § The fix that was passed over, ready to evaluate once the trace
and screenshot support a safe correction; the evidence may still leave two stale-geometry states
indistinguishable.

`qi-hzramwrk` is folded into this one ask: this is the device evidence that deferred item was waiting
for too.

**Reading the trace when it arrives.** `scripts/read-viewport-trace.ts` answers the band's keyboard
question and accepts the new `settled` event; this question is read by hand from the `mark` row and
the `settled` rows before it:

| what the `mark` row shows | the state |
|---|---|
| `vv` scale well below 1 | the page zoomed out (state 1) |
| scale 1, `vv` offsetTop or `vvp` pageTop above 0, `floor` bottom near `root`'s `clientHeight` | script reports a visual viewport left panned (state 2) |
| scale 1, no pan, `floor` bottom above the bar's place on the screenshot | stale geometry: a stale visual-viewport height and a stale fixed-position layout can be indistinguishable (states 2 or 3) |
| every number consistent, the screenshot wrong | painting only: no script fix will see it |

## Done when

The silent recording, the switch, the admin row, the new fields and the settled samples are on
`dev`. `npm test` and `npm run typecheck` are green. GPT Sol has reviewed the plan and the code. The note is written with
ending `awaiting`, and the question is published.
