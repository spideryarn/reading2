Review the code for one small stage, and fix what you find inside it.

Plan: docs/plans/261003m-shelf-sorts-by-publication-date.md
The stage is exactly one commit: `git show dcf7d1755` (HEAD of this worktree). Review that diff.

What it does: adds a seventh sort key to the signed-in Shelf, **Published**, the publisher's own
publication date. `LibraryEntry.publishedAt` (src/types.ts) is filled by `describeArticle`
(src/library-scalars.ts) from `meta.publishedAt`; `calendarDay` (src/web/relative-time.ts) turns it
into a sort number and a printed date; `libraryColumns`, `CHIP_ORDER`, `CARD_NOTES` and
`rowCardFacts` (src/web/library-columns.tsx) use it; src/web/lib/cached-shelf.ts accepts it. An
article with no date sorts last in both directions through the existing `sinkLast` in
src/web/Library.tsx. Docs: docs/project/library.md § Sorting the shelf, docs/project/url-state.md,
and one sentence in src/web/help/help-topics.tsx.

You may edit files in this worktree. Rules:
- Fix what is inside this stage, narrowly, and red-first: a failing test before the fix.
- Report, do not fix, anything wider you notice.
- Do not commit. Leave your changes in the working tree for me to read.

Run these yourself (none needs a database or the network):
  npx vitest run tests/library-sorting.test.ts tests/shelf-table-row-card.test.tsx tests/library.test.ts

Already run by me, green: those three plus tests/shelf-cached-paint.test.tsx,
tests/shelf-table-hide-columns.test.tsx, every tests/shelf-*, tests/doc-links.test.ts,
tests/eager-client-graph.test.ts, and `npm run typecheck`. A mutation (accessor reading
`at(e.publishedAt)`, the instant, instead of the day) turned two tests red.

Check, and say plainly where I am wrong:
1. `calendarDay`: any input for which the sort number and the printed label disagree, or for which
   it returns a day the publisher did not state? Is the label really zone-independent?
2. Does any path put `publishedAt` on a response a visitor or another reader can see?
3. The cards view: with Published as the sort, does the card's note say the right thing for dated
   and undated articles (src/web/Library.tsx § `note`, src/web/ShelfEntry.tsx)?
4. Any new test that would still pass with the feature removed or broken.
5. Do the doc and help-page sentences I wrote match the code? In particular library.md's claim
   about which articles have a date (a PDF never; a paper added by DOI never; a web page only when
   its publisher states one and it was extracted on or after 2026-08-31). Check the PDF and
   minimal-paper paths for any writer of `publishedAt`.
6. Anything here more complicated than it needs to be.

My own suspicions, last so they do not lead you: the table gains a column at widths where it was
already tight (a browser check is running separately); and `CHIP_ORDER` now has seven chips.

Findings as P0/P1/P2 with an ID each (C1, C2, …) and file:line; say for each whether you fixed it.
End with a one-line verdict: land, land after fixes, or do not land.
