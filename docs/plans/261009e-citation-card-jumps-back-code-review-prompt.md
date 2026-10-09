Code review, with fixes in place, of the change for plan
docs/plans/261009e-citation-card-jumps-back-to-every-passage-that-cites-the-work.md (read it,
including § Review, which says how your plan-review findings were handled:
docs/plans/261009e-citation-card-jumps-back-plan-review-sol.md).

The diff is the uncommitted working tree of this worktree: run `git diff HEAD` (files:
src/web/ProseHoverCard.tsx, src/web/useHoverCard.ts, src/web/styles/prose-hover-card.css,
src/types.ts, src/citations.ts, tests/citation-hover-card.test.tsx, docs/project/citations.md).

What it does: the citation hover card's "cited in N paragraphs" is followed by numbered BlockRef
jumps to each `citedAt` block, aimed with `citePassageKey`; current block unlinked; cap 20; "at
least" when a work has MAX_MENTIONS mentions; and useHoverCard's focusIn no longer closes the card
when focus moves inside it.

Look especially for:
- correctness of the focusIn change for every useHoverCard consumer (grep for useHoverCard), and
  whether focus leaving the card (Tab out of it) still closes it, or whether the card can now get
  stuck open;
- whether `MAX_MENTIONS` moving to src/types.ts broke any importer;
- the "at least" rule: is `mentions.length >= MAX_MENTIONS` the right signal (mentions in one block,
  notes, reference place);
- whether the jump closes the card and calls jumpTo exactly once on mouse and on touch (first tap
  on the mark opens the card, then a tap on a number);
- a11y names and the CSS.

Fix what you find inside these files (keep to the repo's comment density and style), run
`npx vitest run tests/citation-hover-card.test.tsx tests/hover-card-touch.test.tsx
tests/quote-hover-card.test.tsx` and `npm run typecheck`, and report: each finding, severity,
what you changed, and anything wider you did not change. End with a one-line verdict.
