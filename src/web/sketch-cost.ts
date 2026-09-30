/**
 * **How long a Sketch takes, in exactly one place.**
 *
 * *One model call, 121–194 seconds, about $0.20 — measured over seven draws of
 * five articles* (docs/project/diagram.md § What it costs). A constant rather
 * than prose because three surfaces have to say it: the Sketch panel itself,
 * Illustrated's *"Draw the Sketch, then paint"* button, and the Metadata page's
 * *Generate it again* row — and only one of them is ever on screen at a time,
 * so nothing would show two of them disagreeing.
 *
 * **The price is not exported, and not shown.** It was, as `SKETCH_PRICE`,
 * until 2026-09-30, when Greg ruled that what AI processing costs us reaches
 * the administrator and nobody else:
 *
 * > that cost information should only be available to me (i.e. admin users). i
 * > don't want any regular users to know how much AI processing of their
 * > articles costs
 *
 * So a reader is told what they wait for — one model call, and how long — and
 * the administrator reads the measured figure in the metadata page's *What it
 * cost*. The dollar figure above stays because it is for developers.
 * tests/no-ai-cost-for-readers.test.ts fails on a currency figure in reader copy;
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md § 3.
 *
 * **A module of its own, and it was `SketchView.tsx` until 2026-09-07.** The
 * Metadata page needs the wait and nothing else from that file; importing it
 * from there would have put the whole Sketch panel — its hook, its scene
 * validator, its painter — into the graph of a page that draws no diagram.
 *
 * `SKETCH_WAIT` keeps the wording the panel has always shown rather than the
 * measured range: *about two minutes* is what a reader has been told since the
 * mode shipped, and widening it to *two to three* is a copy change nobody has
 * asked for. The measurement is one link away, above.
 */
/** Measured 121–194 s; the wording is the panel's own. See the header. */
export const SKETCH_WAIT = "about two minutes";
