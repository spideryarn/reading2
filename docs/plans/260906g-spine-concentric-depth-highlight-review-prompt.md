# Technical review: drawing the current L2 in the spine

You are reviewing a **plan, not code** — nothing has been built yet. Weight your findings
accordingly: the useful output is "this design will not work / will work but is wrong in this
specific way / has missed this case", not style notes.

## Read these, in this order

1. `docs/plans/260906g-spine-concentric-depth-highlight.md` — the plan under review.
2. `src/web/Spine.tsx` — the whole file. It is heavily commented and the comments are the design
   record; several of them are the results of your own earlier reviews (2026-08-27, 2026-08-28).
3. `src/web/styles.css`, the section starting `/* --------- spine --` at about line 1768 and running
   to about 1990.
4. `tests/spine-scroll.test.ts` — the render budget the change must not move.
5. `docs/project/granularity-zoom.md` § "The spine: a bird's-eye rail" (about line 417).
6. `src/web/tree.ts` § `buildOutline` (about line 405) — where the outline's shape comes from.

## Context you need

Spideryarn is an AI-assisted reading app. The **spine** is a 12px `position: fixed` rail down the
left edge: a *proportional* minimap of the article, sized from measured DOM pixel heights, not from
word counts. It draws top-level sections (L1) as tinted bands, second-level sections (L2) as 1px
hairlines with invisible full-height buttons over them, search matches as coloured lanes in the
right-hand 10px gutter, and the current viewport as an orange-edged band. No labels anywhere — they
are all in a hover card, because most bands are a few pixels tall.

Today the only "you are here" *fill* is the current L1. A reader hit an article where one L1 is 95%
of the document, so that fill says nothing. The plan draws the current **L2** as well, and quiets
the L1 fill so the two nest.

## Specific questions I want answered

1. **The DOM-order claim.** The plan asserts that putting the ring on the hit target
   (`.spine-hit[aria-current="location"] { background: … }`) would hide search marks, because hits
   render after `.spine-matches` and therefore paint above them — and that the ring must instead go
   in the band layer, between the L1 parts and the ticks. Check this against the actual render
   order and the actual CSS (note `.spine-part`, `.spine-tick`, `.spine-match`, `.spine-hit` and
   `.spine-viewport` are all `position: absolute` siblings in one stacking context with no
   `z-index` between them). Is the conclusion right, and is the *proposed* insertion point right —
   in particular, should the ring be above or below the L2 hairlines?

2. **The render budget.** The plan claims a second ring costs **zero** new renders because
   `hereHit` is already state and already re-renders on every L2 crossing. Verify that, including:
   is `hereHitId` genuinely sufficient to locate the band's geometry, or does deriving the ring
   from it need a `useMemo`/lookup that would itself be a new dependency worth naming? Does
   anything about drawing it push work onto the scroll path?

3. **The childless-part case.** `buildOutline` gives a supplement `children: []`, and `measure`
   makes `hits` fall back to the part itself when a part has no children. The plan says: draw no
   ring when the current hit's node id is also an L1. Is "is also a member of `metrics.l1`" the
   right test, or is there a cheaper/safer one that cannot go stale? Are there other cases where a
   hit and a part coincide that the plan has missed?

4. **The stale-measure guard.** `hereHitId` is nulled when `hereHit.metrics !== metrics`. The plan
   says the ring inherits that guard for free. Is that true, and is there any frame in which the
   ring could be painted at geometry from a previous measure?

5. **Anything the plan has missed** in the rail's existing machinery — the `armed` tooltip
   lifecycle, `layoutKey` re-measures, `?spine=0`, the mode band, the supplement dimming, the
   search gutter, keyboard navigation (`data-nav-depth`), accessibility (the rail already carries
   `aria-current="location"` on the current hit — does a visible ring change what should be
   announced?).

6. **Is the product call defensible technically?** Specifically: the plan refuses to go to L3 on the
   grounds that depth-3 nodes are one-per-block leaves and the viewport band already marks the
   current paragraph, and that an L3 ring would need either ~360 renders per article through state
   or a second imperative scroll writer. Check that reasoning against the code. If an L3 ring is
   actually cheap — e.g. as a third imperative element written by the existing scroll effect
   alongside the viewport band — say so, because that changes the answer.

7. **The test plan.** Is the proposed failing-test-first shape (a fixture with one L1 covering ~95%
   of the rows and several L2s inside it) the right reproduction, and would it actually go red
   before the change? What would it fail to catch?

Be concrete. Where you disagree, say what to do instead. Flag anything you are unsure about rather
than asserting it.
