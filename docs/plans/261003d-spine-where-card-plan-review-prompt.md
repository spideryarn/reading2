# Review request: plan 261003d (spine hover card gets the where-am-I outline)

You are reviewing a PLAN before it is built. Read-only: do not edit any file.

Repo: Spideryarn, a reading app. Read the plan first:
docs/plans/261003d-spine-hover-card-shows-where-the-section-sits-in-the-article.md

Then the code it changes and the history behind it:
- src/web/where.ts (whereRows, the pure fisheye), src/web/WhereCard.tsx, tests/where.test.ts
- src/web/Spine.tsx — `measure` (hits, BandParent), the hit-target Tooltip loop (~line 1290), and BandCard at the bottom
- src/web/tree.ts — OutlineEntry, nodeLabel, titleVoice, navLabelVoice
- src/web/styles/tooltip.css, src/web/styles/skim.css (.where-* rules)
- tests/spine-card.test.tsx, tests/spine-hover.test.tsx
- docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md and its plan review
  docs/plans/260929f-trajectory-plan-review-sol.md — findings F1 and F2 are why the spine was deferred.
- docs/postmortems/260828g-spine-hover-cards.md — the controlled-tooltip trap; the plan must not touch that wiring.

Questions:
1. Does the plan answer F1 and F2 of the 260929f review properly? Is the card bounded enough for a
   tooltip that cannot scroll (count the worst case honestly, including gist, kids, footer, tap hint)?
2. Is the `detail` slot inside WhereCard the right seam, or is there a simpler one? Is `current` right
   about aria-current?
3. Anything in the outline shape (supplement entries, childless L1s, untitled nodes, folded bands,
   L1 children that are themselves leaves) that makes `whereForBand` draw something wrong?
4. Is there a simpler product shape that gives Greg the same thing?

Answer with numbered findings, each with a severity (P0/P1/P2), file:line evidence, and a concrete
change. End with a verdict: approve / approve with changes / rework.
