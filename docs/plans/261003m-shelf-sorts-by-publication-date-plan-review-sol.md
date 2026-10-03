No P0/P1 found. Three P2 corrections:

- **F1 — Missing column-test updates.** [tests/shelf-table-hide-columns.test.tsx:331](/home/greg/code/spideryarn2/.claude/worktrees/fbt3es7k-shelf-sort-by-publication-date/tests/shelf-table-hide-columns.test.tsx:331) hard-codes all headers; line 343 enumerates the Columns menu. Both need Published. Update library.md’s column counts at lines 737 and 775 too. Run the full `npm test`, as AGENTS.md requires; the plan’s touched-files-only gate could miss these failures.

- **F2 — `Date.UTC` mishandles years 0000–0099.** [plan:45](/home/greg/code/spideryarn2/.claude/worktrees/fbt3es7k-shelf-sort-by-publication-date/docs/plans/261003m-shelf-sorts-by-publication-date.md:45). I verified `publicationDate("0099-01-01")` accepts it, but `Date.UTC(99, 0, 1)` produces 1999. A round-trip guard would instead discard a valid day. Parsing **only** `${day}T00:00:00Z` and comparing the resulting ISO day is simpler and handles this edge. Keep explicit validation for February 31.

- **F3 — The fixture assertion passes without Published.** [plan:83](/home/greg/code/spideryarn2/.claude/worktrees/fbt3es7k-shelf-sort-by-publication-date/docs/plans/261003m-shelf-sorts-by-publication-date.md:83). I reproduced this: TanStack ignores the nonexistent sort column, then the independent fixture sink still puts the fixture last. Assert the column exists and give the fixture a valid publication date. Same-day tie assertions also need the distinct-day ordering test beside them; otherwise ignoring Published entirely can satisfy them.

The remaining checks support the approach:

- **Owner listing:** yes—`META_COLUMNS.publishedAt` enters `REVISION_PROJECTIONS.library`, then `metaFrom`, then `describeArticle`.
- **Other writers:** `metaColumns` writes arbitrary `Meta.publishedAt` verbatim ([artifacts-pg.ts:855](/home/greg/code/spideryarn2/.claude/worktrees/fbt3es7k-shelf-sort-by-publication-date/src/store/artifacts-pg.ts:855)); draft creation copies it, and the metadata step can clear it. `publicationDate` is the only current producer of a new non-null date I found, **not the only column writer**. The database does not enforce the two shapes. “Verbatim” also overlooks its separator/offset normalization.
- **Privacy:** no public/visitor response uses `describeArticle` or spreads `LibraryEntry`; both public projections explicitly assemble their own fields.
- **Helpers and simplicity:** day-only ordering and UTC labels are right. `dayFrame` matches validation but imports the whole Timeline parser and expands the shared client graph; `parseIsoDay` is private, and `yearOf` cannot validate a day. A small local helper is reasonable.
- **Registration:** hidden preferences, Columns menu, chips and URL parsing derive from columns. No additional production registry found. Help does not enumerate the keys, so needs no change.

No files changed by me.