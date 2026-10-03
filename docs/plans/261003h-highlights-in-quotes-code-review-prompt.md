# Code review (reviewer-fixer): 261003h your highlights as rows in Quotes

Review AND fix, in this worktree, commit b8e634928 (`git show b8e634928`). The plan is
docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md; its last
section (your plan review, Q1–Q8, full text in
docs/plans/261003h-highlights-in-quotes-plan-review-sol.md) overrides the design above it.

Check each of Q1–Q8 is met in the code, not merely claimed, and look for anything new:

- src/web/quote-band-rows.ts: block-only interleave, never comparing the two `start`s; reader rows
  = quote + colour + no criterionId; missing-block rows; score orders; `withYours` counts;
  provenance strings (including "on or before" when `addedAt` is absent).
- src/web/QuotesPanel.tsx: everything `Quote[]` is still the model's only (rankQuotes,
  visibleQuotes, markedQuotes, barStops/barNote/barToReveal, steppable, stepper, `?quote=`,
  `data-quote-row`, selection scroll). Reader rows render with no quote list. The row press clears
  `?quote=` and opens the comment in one tick. The ⓘ on every row: keyboard, aria, a tooltip that
  works on touch as the existing one does.
- Owner gating: `QuotesAccess`' visitor arm cannot carry `yours`; Reader derives it from the owner
  capability, not the merged `comments`. Try to find a path where a visitor sees reader rows.
- src/quotes.ts: one completion time per run; append keeps `addedAt` and absence; replace with an
  inherited id keeps both; nothing hashes or compares `addedAt`. src/public/dto.ts +
  public-types.ts: `addedAt` and `generatedAt` cross; does making `generatedAt` required on
  PublicQuotes break an older stored shape or a cached client?
- src/web/ProseHoverCard.tsx provenance; fonts (docs/project/fonts.md): reason in the model's face,
  the note in the reader's, provenance in the app's.
- CSS: quotes.css reader row, tokens.css `--hl-*-solid` (dark and light twins), voices.css.
- docs/project/quotes.md § Your highlights are rows too: is anything in it untrue of the code?

Fix what is inside this change, narrowly and red-first; report anything wider. Run
`npx vitest run tests/quote-band-rows.test.ts tests/quotes-added-at.test.ts
tests/quotes-yours-rows.test.tsx tests/quote-hover-card.test.tsx tests/public-dto.test.ts` and
typecheck via `node --import tsx scripts/typecheck.ts`. Postgres-backed tests are mine to run:
name any you want. Do not commit. IDs R1, R2, …; P0–P3; file:line; fixed or not; the test.
Verdict: land / land after fixes (made) / do not land.
