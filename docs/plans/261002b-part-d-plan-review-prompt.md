Read-only plan review in the Spideryarn repo (this worktree). Read § Part D of
docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md,
and the code it builds on: src/web/Library.tsx (Passages, NOT_SEARCHING_ARCHIVE, the Include public
section wiring), src/web/useLibrarySearch.ts, src/web/useShelf.ts (loadArchived, archived,
liveArticlesLoaded), src/web/ShelfPublicSection.tsx, src/web/PublicLibraryPage.tsx (usePublicShelf),
src/web/shelf-narrow.ts (filterEntries), and the server search route (grep routes for
/api/library/search) and src/store/pg-shelf.ts searchLibrary.

Tell me: anything wrong about the code; whether the counts are honest (what "match" means in each
half, caps, the passage-search MIN_QUERY of 3 vs the card filter which matches any length, Unread and
topics); whether a second search request per query is acceptable or there is a cheaper honest
route; race/stale-answer risks; whether the archive list being loaded without the chip changes
anything visible (scope, ownSlugs); privacy. Simpler designs I missed. Rank P0/P1/P2 with file:line.
Also check the conclusion: is this the right reading of Greg's words?
