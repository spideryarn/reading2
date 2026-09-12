# The iPad battery still drains fast

**[SPIDERYARN-READING2-36](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-36)** · reported
2026-09-12 08:14 UTC · kind: problem · *shipped* — one cause fixed, the rest named and unconfirmed

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
