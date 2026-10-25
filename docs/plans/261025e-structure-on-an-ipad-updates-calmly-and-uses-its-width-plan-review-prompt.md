You are reviewing a plan, and the first cut of the code built from it, in the Spideryarn repo (this
checkout). Read-only: do not edit files. Write your findings as your answer.

Read first:
- docs/plans/261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width.md (the plan; Greg's two
  reports are quoted at the top: they are the requirements)
- docs/project/structure.md, and docs/project/narrow-windows.md § "The reading view's narrow window"
- The diff: `git diff HEAD` in this worktree (src/web/useColumnContext.ts,
  src/web/modes/structure/StructureMode.tsx, src/web/styles/mode-band.css,
  src/web/styles/outline-mode.css, src/web/styles/structure-mode.css, tests/structure-focus-row.test.tsx,
  tests/structure-band-css.test.ts, tests/structure-band-width.test.ts) plus the new untracked
  scripts/structure-scroll-trace.ts.
- For context: src/web/OutlinePanel.tsx (its `measure` and follow-along effects),
  src/web/StructurePanel.tsx (capacity measurement around line 660), src/web/scroll.ts (arrival
  anchors: holdAnchor, clearArrivalAnchor, subscribeArrivalAnchor), src/web/keynav.ts,
  src/web/styles/narrow-window.css § a small device (data-bars="hidden", the dock guards),
  src/web/HeadingsCrumbs.tsx (the other user of useColumnContext).

Questions I want answered, each with a verdict and evidence (file:line):

1. The throttle in useColumnContext (`holdMs`): is it correct? Leading + trailing, the timer
   re-measures rather than replaying, jumps (arrival anchor appearing or clearing) bypass it, a new
   effect run (layoutKey/sections change) starts fresh. Look for: a held change that is never
   published (e.g. the reader comes back to the published section and then moves again while a timer
   is pending; the anchor state tracking `anchored` going stale when the anchor changes between
   measures; the effect cleanup). Is `performance.now()` + `window.setTimeout` right here?
2. Is 1000ms the right hold for this list, given Greg's words? Is leading-edge right (a slow reader
   gets no lag) or would you hold the first change too?
3. Keyboard ← / → (keynav.ts) steps by a plain scroll with no arrival anchor, so a second press
   within the second is held. Is that acceptable, or is there a clean existing signal (not a new
   global) that a programmatic step/jump is in progress that the hook should treat as a jump?
4. The `--band-bar-travel` padding: does it really keep the content box (what ResizeObserver
   watches, and what OutlinePanel's `measure` computes as `avail`, and StructurePanel's grid
   clientHeight) constant across `data-bars="hidden"`? Check every term against the band's `bottom`
   and against all the states the dock guards restore (dialogs, focus, covering band, install hint,
   `--safe-bottom`). Any state where travel goes negative or the band's content overlaps the dock?
   Does the Expanded / scrolling list (`[data-outline-scroll="1"] > .outln-list`, flex 1) still end
   at the right place?
5. Removing `.mode-band.outln.has-about { --outln-pad-r: … --band-about-room }`: does the head row's
   negative-margin bleed (`.mode-band.outln > .band-head`) and the (i) corner still sit right? Any
   other element in the list face that sits under the (i) and needed that room (the StructureNotice
   / StructureArriving line lives in the head row)?
6. The prose right-margin half of report 1 is declined with a reason (plan § "The prose's right
   margin"). Do you agree, given narrow-window.css § a no-hover screen?
7. Anything simpler that achieves Greg's goal ("robust, clean, ideally simpler") that I missed?
   Anything in the plan that is wrong or overclaimed?

Answer as a numbered list of findings, most severe first, each tagged BLOCKER / SHOULD / NIT, then
your answers to 1–7 briefly.
