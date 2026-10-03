# Plan review: 261003h your highlights as rows in Quotes, and who and when on every row

Read-only review of a PLAN: docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md
in this worktree. It follows docs/plans/261003e-span-highlights-with-a-colour.md (built; a
highlight is a comment with a `colour`). Read the plan, then:

- docs/project/quotes.md (§ The orders and the bar, § Every visible quote is marked, § In the
  spine, on a card, and one at a time, § Find more appends, § Freshness, § Five ways to break this
  quietly), docs/project/comments.md § Anchoring, docs/project/fonts.md, docs/project/url-state.md
- src/web/QuotesPanel.tsx (rankQuotes, visibleQuotes, barNote, stepQuote, QuoteRow, the count),
  src/web/useQuotes.ts, src/web/reader/useQuoteMarks.ts, src/web/ProseHoverCard.tsx (the quote half)
- src/quotes.ts (the run that builds the list: existingFor, mergeInDocumentOrder, the hash and
  freshness inputs), src/types.ts Quote and Quotes, the public projection of quotes
  (src/store/public-reader.ts, src/public/dto.ts)
- src/web/reader/Reader.tsx where QuotesPanel is mounted and where `jumpToComment` is used;
  src/web/comment-jump.ts; src/web/comment-nav.ts

Answer:
1. Is "a highlight with a note shows in both, because it is one row" right, and is anything about
   it wrong in the code as it stands (e.g. the margin, the drawer, the kinds)?
2. The row union and ordering: does interleaving reader rows break anything that assumes the
   band's list is `Quote[]` (the stepper, `?quote=`, selection scroll-into-view, `steppable`,
   the bar's stops, the count, `barToReveal`, the spine strip, Skim which routes through quotes)?
   Name each seam and say what the plan must state.
3. `Quote.addedAt`: does adding it disturb any hash, freshness check, equality, dedupe, "kept its
   id" logic, export, or the public DTO? Is "on or before generatedAt" honest for old quotes?
4. Pressing a reader's row → jumpToComment (`?note=`): any conflict with Quotes' own selection
   state or with Escape/surface rules?
5. A simpler version that gets most of the value; anything that should be deferred or must not be.

My suspicions, last: a document-order sort needs the highlight's position within its block, and
`Comment.start` is in rendered-text offsets while `Quote.start` is in `block.text` offsets (two
offset spaces, see comments.md § The offset space), so same-block ordering between the two kinds
may be subtly wrong; and the panel may be mounted for visitors with no comments source at all.

Severity P0–P3, an ID on each finding (Q1, Q2, …), file:line evidence, a concrete change to the
plan. Verdict: build as planned / build with changes / rethink.
