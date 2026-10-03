---
reports: spya-m0mcqb
ending: shipped
---
# The iPad battery still drains fast

**[SPIDERYARN-READING2-36](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-36)** · reported
2026-09-12 08:14 UTC · kind: problem · *shipped* — the job-queue poll fixed 2026-09-12, the scroll repaint fixed 2026-10-03 (below); neither confirmed on the device

## What the reader said

> It is still draining the battery on my iPad really fast for  some reason

Filed from
`/read/entropy-24-00930-spya-bmvfyb?at=spya-hnr33h&mode=summary&remember=quiz&deep=2` on an iPad,
production build `607b57a0`. "Still" points back at
[260905_0741](260905_0741-sluggish-mode-switching-on-a-long-article.md).

## What we did

**Found and fixed one certain cost: every owner's open article asked the server for the job list
every eight seconds, for ever**, about 450 requests an hour on screen, with nothing running. The arc
had been holding the job queue on its idle cadence since 2026-08-29. It now watches its own job
without buying that cadence; at rest the page asks once and then nothing. A test over the owner's
whole reading view now fails if anything at the top of it starts polling again.

**Not proven to be the whole drain.** An iPad's battery cannot be measured from the box, and Safari's
engine will not run there. Scrolling costs 55–60% of a desktop core, mostly paint and compositing
rather than our code, and is the next suspect; it is named, not built.

**A minute on the device would settle it:** open an article with `?perf=1` on the end, leave it on
screen for a minute, and run `__perf.report()` in Web Inspector — no `/api/jobs` after the first.

The measurements, the dead ends and what is deferred are in
[the plan](../plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md);
the class of bug is in
[the postmortem](../postmortems/260912a-a-budget-a-comment-keeps-is-spent-by-the-next-call-site.md).

## 2026-10-03: the scrolling half

Greg, asked on 2026-10-02:

> It's a bit hard to be sure because my iPad's getting quite old. It definitely feels like it drains
> a bit faster than I'd like, but it's not as big a problem. So I think if there's a fix that you can
> make that looks promising, but won't add too much complexity, then definitely go for it.

**Shipped: the scroll cost named above is mostly found and fixed.** The rail down the left edge moved
its "you are here" band with a `top` write on every frame of every scroll, so every frame paid for
layout, a repaint and a re-raster. It now slides by `transform`, which the compositor can do alone.
Under iPad emulation in Chrome, the same scroll before and after: paints ~550 → 53, raster tasks
~640 → 160, the main thread's CPU per scrolled pixel about halved. How much battery that buys on the
iPad itself is not measured; Safari was not run. The numbers are in
[the investigation](../investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view.md), and
the work and both GPT Sol reviews are in [the plan](../plans/261003a-ipad-battery-scroll-repaint.md).

**Three smaller costs were left, each queued as a proposal for Greg** because none met "won't add too
much complexity":
- Summary's on-screen link highlight rewrites a stylesheet ~144 times a scroll, ~13% of what is left
  (`qi-scsj9ksv`).
- Each scroll reversal restyles the whole page (`qi-nj66xnmb`).
- The reading position measures every section on every frame (`qi-dcxazgza`).
