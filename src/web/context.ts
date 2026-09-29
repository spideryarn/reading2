/**
 * **The four fisheye tiers**, all that is left of column context.
 *
 * Column context was what a gist column showed *around* the item you were in —
 * Greg, 2026-08-25: "each column could somehow be a fisheye that shows what
 * came before and what after". The gist columns went with the Hierarchy mode
 * on 2026-09-29 (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md),
 * and with them the lists, the panels and the landmark arithmetic that drew
 * them; docs/project/column-context.md keeps the design and its history.
 *
 * The tiers outlived them because Structure's list face (outline.ts) reads by
 * the same rule: **discrete tiers, never a gradient.** Continuous fisheye
 * scaling puts prose in a just-legible dead zone, and eye-tracking says nobody
 * reads the shrunk periphery anyway — it is a landmark, so it only needs to be
 * *distinguishable*, not smoothly scaled.
 */

/** How far an entry is from the one the reader is in. Four steps, no gradient. */
export type Tier = "cur" | "near" | "mid" | "far";
