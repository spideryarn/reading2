Review this plan before it is built. Read-only: change nothing.

Plan: docs/plans/261003m-shelf-sorts-by-publication-date.md (untracked in this worktree)

Read it, then the code it names: src/web/library-columns.tsx, src/web/lib/table-sort.ts,
src/web/Library.tsx (the two sinkLast passes), src/library-scalars.ts (describeArticle),
src/types.ts (LibraryEntry, Meta.publishedAt), src/store/pg.ts (REVISION_PROJECTIONS publishedAt,
metaFrom, listArticles), src/extract.ts (publicationDate), src/web/lib/cached-shelf.ts,
src/web/shelf-hidden-columns.ts, tests/library-sorting.test.ts, docs/project/library.md § Sorting
the shelf.

Check, and say plainly where I am wrong:
1. "What is already true": is any claim false? In particular, does the owner's shelf listing really
   receive published_at today, and is `publicationDate` the only writer of that column (so the two
   string shapes are the only ones)? Name any other writer.
2. Does adding `publishedAt` to LibraryEntry leak it anywhere it should not go? LibraryEntry is the
   owner's row; check whether any public or visitor response is built from describeArticle or
   spreads a LibraryEntry.
3. The day-only sort value (first ten characters, Date.UTC) and UTC-formatted label: correct, and
   simpler than the alternatives? Any existing helper I should reuse instead of writing
   `publishedDay` (src/timeline-time.ts § dayFrame / parseIsoDay, src/web/debate-order.ts § yearOf)?
   Mind tests/eager-client-graph.test.ts: library-columns.tsx is shared with lazy routes.
4. Every place that must hear about a new sort key or a new hideable column, which the plan does not
   list. Stored hidden-column preferences, the Columns menu, url-state, the help page, any test that
   enumerates the six ids or counts columns or chips.
5. Any test in the list that would pass without the feature.
6. Is anything here more than the simplest version that meets the report?

Findings as P0/P1/P2 with an ID each (F1, F2, …) and file:line. Be brief.
