# Code review: plan 261003d (spine hover card gets the where-am-I outline)

You reviewed this plan already (docs/plans/261003d-spine-where-card-plan-review-sol.md); all four
findings were taken, and how is recorded in the plan's Progress section:
docs/plans/261003d-spine-hover-card-shows-where-the-section-sits-in-the-article.md

Now review the code. The change is uncommitted in this worktree; the full diff is in
docs/plans/261003d-spine-where-card-code-review-diff.patch (also `git diff HEAD`). Files:
src/web/where.ts, src/web/WhereCard.tsx, src/web/Spine.tsx (BandCard, bandLabel, BandParent,
whereByBand), src/web/styles/tooltip.css and skim.css, src/web/help/help-topics.tsx, tests/where.test.ts,
tests/spine-card.test.tsx, tests/skim-panel.test.tsx, two docs.

**You may fix what you find**, inside this change's scope: edit the files, keep tests passing
(`npx vitest run tests/where.test.ts tests/spine-card.test.tsx tests/skim-panel.test.tsx tests/spine-hover.test.tsx tests/spine-tap.test.ts`
and `npm run typecheck`). Report anything wider than this change instead of fixing it. Do not commit,
do not touch git state, and do not delete the .patch file.

Look especially at:
1. Is the card truly bounded as the plan's budget says (≤ 3 rows per level, no more-rows on the
   spine, gist clamp 3 lines)? Any outline shape where `whereForBand` draws more, draws the wrong
   band, or returns `[]` for a real hit (the hits are in `measure`: L2s, or an L1 with no children)?
2. Labels: does the outline's row for a band always say the same thing as `bandLabel`/`ariaFor`
   (untitled bands, nav-label bands, a top-level untitled part)?
3. The controlled-tooltip wiring around the hit buttons must be unchanged
   (docs/postmortems/260828g-spine-hover-cards.md). Is it?
4. `whereByBand` useMemo keyed on `outline`: correct and cheap enough?
5. The CSS: does moving `.where-*` from skim.css to tooltip.css change Skim's look (stylesheet order,
   specificity)? Is the `-webkit-line-clamp` on `.tip-band .where-detail > .tip-gist` going to apply
   (is `tip-band` on an ancestor of the card's content)?
6. Tests: does each new test fail against the old code for the right reason, and is any of them
   vacuous? (Known: "is not the reader's location" passes against the old card too, as a guard.)
7. The help text and the two docs: accurate now?

Answer with numbered findings (P0/P1/P2, file:line, what you changed or what you recommend), then a
list of the files you edited, then a verdict.
