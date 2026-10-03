# Plan review: 261003a, iPad battery and the spine's per-frame repaint

You are reviewing a PLAN, read-only. Repo: this worktree. Candidate: commit 40e232dc9.
- Plan: docs/plans/261003a-ipad-battery-scroll-repaint.md
- Harness that produced the numbers: scripts/trace-scroll.ts
- Raw printouts of every run, uncommitted: docs/investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view/before/*.txt
- Code: src/web/Spine.tsx (scroll effect, about lines 660-730; band markup about line 1385),
  src/web/styles/spine.css, src/web/styles/shell.css (the `top 0.18s` transitions, about 640-680),
  src/web/OnScreenLinksStyle.tsx, src/web/on-screen.ts, tests/spine-*.test.ts
- Background: docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md,
  docs/project/performance.md

The goal is a fix for an old iPad's battery drain while scrolling. It must look promising and must
not add much complexity (Greg's words are in the plan). Do these first, independently:
1. Does the evidence in the printouts support the plan's attribution? The claim is that the spine's
   inline `top` write causes a root-layer repaint every frame, and that hiding the spine halves the
   iPad main-thread time. Check the harness for ways it could measure the wrong thing.
2. Is stage 1 correct? Consider:
   - transform px from a ResizeObserver on the track
   - will-change on .spine, and anything inside .spine that is position:fixed or relies on .spine
     not being a containing block or stacking context (tooltips, hover cards, armed outline)
   - z-index and stacking changes from adding a layer
   - the bar-flip `top` transition
   - resize, print, and reduced motion
   - what the existing tests assert
3. Is there a simpler or better fix I passed over? Is stage 2 worth it?
4. Is anything deferred that should not be, or built that should be deferred?

Severity scale: P0 = data loss, security, or charging; P1 = user-visible wrong behaviour or a
contract violated; P2 = design or maintainability risk; P3 = prose. Give every finding an ID (F1, F2,
...), a severity, file:line evidence, and the change you propose. End with a verdict: proceed,
proceed with changes, or rethink.

My suspicions, labelled, and worth less than your own pass:
- WebKit already composites position:fixed, so the iPad benefit may be much smaller than Chromium's.
  Is the plan honest about that?
- will-change: transform on a fixed element could change how the spine's tooltip or the armed
  outline position themselves.
