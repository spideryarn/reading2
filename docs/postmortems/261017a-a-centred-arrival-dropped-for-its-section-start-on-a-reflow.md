# A centred arrival dropped for its section's start on a reflow

Up: [postmortems.md](../project/postmortems.md). Found 2026-10-17 by the browser check of
[plan 261017d](../plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md) (figure stops in
Skim's route); fixed in the same work.

## What happened

A `?stop=` link to a Skim figure stop opened with the band on the figure and the prose somewhere
else. Instrumented in the browser on `entropy-24-00930`: the arrival centred the figure (scrollY
7014) and took the arrival hold; the position spy then wrote `?at=` as the figure's **section
start**, as it should; then the controls bar appeared, which changes `layoutKey` with the address
unchanged; and the layout re-anchor in `useReadingPosition` **ended the hold and scrolled the
section start to the top** (scrollY 5866). The figure was left 1,200px below the window. A quote's
deep link on the same article landed, because its section starts close above it.

## The root cause

The re-anchor answers *"the layout changed under a reader who has not moved: put them back"*, and
it put them back at the precision of `?at=`, a section. That is right for a reader who scrolled
there; it is wrong for one who was **put** there by a centred jump, whose position is finer than a
section and is already recorded as the arrival anchor (scroll.ts § `anchor`). `positionToWrite`
already treated the anchor as the finer truth; the re-anchor threw it away instead
(`clearArrivalAnchor()` first, then `scrollToBlock(at)`).

**The class: a finer fact discarded for a coarser one on a path that rarely runs.** The two
answers agree whenever the target sits near its section's start — most quotes, every heading — so
the coarser one looked correct in every case anyone looked at.

## The commit that introduced it

`30b5eac34` (2026-09-29, plan 260929a, *"the anchor is cleared on … a re-flow"*), which added the
hold and, on a reflow, ended it: *"the page can reflow without emitting a scroll event, and the old
block must not stay current."* True, and the right concern; ending the hold was one way to honour
it, and re-centring the block is another that keeps the reader where they are.

## The fix

`useReadingPosition`'s layout re-anchor: when the address did not move and a centred arrival still
holds, re-centre that block (instantly) and keep the hold; only without one does `?at=`'s section go
back to the top. When the address moved in the same commit the restore effect still owns the move,
and the hold ends as before. Tests in
[`reading-position-holds-across-a-reflow.test.tsx`](../../tests/reading-position-holds-across-a-reflow.test.tsx):
the deep-in-a-section case (red before: the page landed at the section start), the no-`?at=` case
(which used to assert the hold ended, now asserts it is re-centred), and the address-moved case.

## What would have caught the class

A test whose target is **not** at its section's start. Every reflow test placed the reader on a
section's first block, where *the section* and *the block* are the same answer, so the test could not
tell which one the code was keeping. When a value is stored at two precisions, test where they
differ.
