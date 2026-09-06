# Code review: the spine now draws the current section

You reviewed the **plan** for this earlier today and found three things wrong with it (a supplement
ring that could never render, an overstated stale-measure guarantee, and a false performance
argument against L3). The plan was corrected against all three. **This is the second review, of the
built code**, and it is the one that matters more — a plan-stage review cannot see what the code
actually does.

## Read these

1. The scoped diff: run `git diff HEAD -- src/web/Spine.tsx src/web/styles.css` from
   `/home/greg/code/spideryarn2/.claude/worktrees/spine-concentric` — that is the whole change.
2. `tests/spine-here.test.ts` — the new test file, 9 cases, all green.
3. `src/web/Spine.tsx` in full, for the surroundings.
4. `src/web/styles.css` § spine (search for `--------- spine --`).
5. `docs/plans/260906g-spine-concentric-depth-highlight.md` — the corrected plan.
6. `docs/plans/260906g-spine-concentric-depth-highlight-review-sol.md` — your own plan review.

Work in that worktree. **Do not edit anything**; report findings.

## What was built

- `hereRing` in `Spine.tsx`: a plain `.find` over `metrics.hits` for the band whose node id is
  `hereHitId`, kept only when `band.parent && band.parent.total > 1` — your suggested
  discriminator, in place of the plan's original "is the id also in `metrics.l1`".
- One `<div className="spine-here" aria-hidden="true">` rendered between the L1 parts and the L2
  ticks, positioned with the same `pct()` helper as everything else in the track.
- `.spine-part.active` lost its `--highlight-wash` background; its tint went 0.75 → 0.45.
- New `.spine-here`: `--depth-1` at `opacity: 0.8`, `left: 2px`, `min-height: 2px`,
  `pointer-events: none`.

## Verification status, stated honestly

- `tests/spine-here.test.ts`: 9/9 green. It was watched **red first** — 5 of the 9 failed before the
  change; the other 4 are the "draws nothing" cases, which pass trivially against a rail that draws
  no ring at all and are there to catch a wrong implementation, not a missing one.
- All six pre-existing spine test files: 72/72 green.
- `npm run typecheck`: two errors in `tests/dock-corner-controls.test.tsx` about a missing
  `navLabelStatus` property. **Pre-existing on `dev`** from another agent's work (commit `9e348d34`);
  my diff touches only `Spine.tsx` and `styles.css`. Please sanity-check that claim.
- Full `npm test`: **OOM-killed by the box** (`EXIT=137`), not a test failure. A re-run with limited
  concurrency is in flight; I do not yet have a clean full-suite result.
- Browser screenshots: in flight in a separate agent, not yet back. **So nothing visual is verified
  yet** — treat every opacity number below as unvalidated.

## Questions

1. **Is the `parent.total > 1` discriminator right in the code as written?** In particular
   `hereBand?.parent && hereBand.parent.total > 1 ? hereBand : null` — check the narrowing, check it
   cannot be `undefined` where a `Band` is expected, and check there is no case where a genuine L2
   is wrongly skipped. Is there an article shape where a part has several children but the reader is
   in one that happens to span the parent?

2. **Render order.** Confirm the element is in the right place in the JSX, and that the test's
   `.spine-track > *` className-order assertion actually pins what it claims — note it reads
   `el.className.split(" ")[0]`, so a class list that grows a modifier first would silently change
   what is compared. Is that assertion fragile in a way worth fixing now?

3. **Did the render budget actually stay flat?** `tests/spine-scroll.test.ts` still passes, but it
   uses its own fixture. Is there any path by which the new `.find` or the new element adds a render,
   a layout read, or scroll-path work? The `.find` runs on every render of a memoised component —
   confirm that is what I think it is.

4. **The CSS.** `.spine-here` has no `border-top`, unlike `.spine-part`. It sits under `.spine-tick`,
   which is `left: 2px` — the same inset as the ring. Does the ring's own top edge get the hairline
   it needs, or does the tick for the *following* section land at the ring's bottom edge and leave
   the top unmarked when the ring is the first child? Also: is `min-height: 2px` on an element whose
   `height` is a percentage going to behave the way I expect at the bottom of the track?

5. **`opacity: 0.8` on the element vs. the parts' `opacity` on a `::before`.** `.spine-part` puts its
   tint on a pseudo-element and keeps the band itself opaque; `.spine-here` is a single element with
   opacity. Is that inconsistency going to bite — stacking contexts, the supplement dimming, the
   `transition: background 0.15s` on `.spine-part`?

6. **Anything the tests do not cover that a reviewer would want covered**, given jsdom cannot see
   paint. Be specific about which of those a browser screenshot can settle and which it cannot.

7. **Anything else wrong.** Prose in the comments included — this repo keeps intent in comments and
   a comment that misstates the mechanism is a real defect here.

Be concrete, say what to do instead where you disagree, and flag what you are unsure of rather than
asserting it.
