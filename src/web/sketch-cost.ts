/**
 * **What a Sketch costs and how long it takes, in exactly one place each.**
 *
 * *One model call, 121–194 seconds, about $0.20 — measured over seven draws of
 * five articles* (docs/project/diagram.md § What it costs). Constants rather
 * than prose because three surfaces now have to say it: the Sketch panel
 * itself, Illustrated's *"Draw the Sketch, then paint"* button, and the
 * Metadata page's *Generate it again* row — and only one of them is ever on
 * screen at a time, so nothing would show two of them disagreeing.
 *
 * **A module of its own, and it was `SketchView.tsx` until 2026-09-07.** The
 * Metadata page needs both numbers and needs nothing else from that file;
 * importing them from it would have put the whole Sketch panel — its hook, its
 * scene validator, its painter — into the graph of a page that draws no
 * diagram. Two exported strings do not justify that, and the fix that keeps one
 * copy of each number is a leaf both files import.
 *
 * `SKETCH_WAIT` keeps the wording the panel has always shown rather than the
 * measured range: *about two minutes* is what a reader has been told since the
 * mode shipped, and widening it to *two to three* is a copy change nobody has
 * asked for. The measurement is one link away, above.
 */
export const SKETCH_PRICE = "about $0.20";
/** Measured 121–194 s; the wording is the panel's own. See `SKETCH_PRICE`. */
export const SKETCH_WAIT = "about two minutes";
