You are reviewing built code in the Spideryarn repo (this worktree), and you may FIX what you find
inside this change's scope; report anything wider for me to decide. Do not commit.

This is Part D of plan docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md
(see § Part D and § Part D, as built after the plan review); your own plan review of it is
docs/plans/261002b-part-d-plan-review-sol.md. The diff is docs/plans/261002b-part-d-code-review.diff
(commit 5bae817c5).

Check: that the matchingPassage/currentRevisionOfItsArticle refactor in src/store/pg-shelf.ts leaves
searchLibrary's semantics exactly as before (owner scope, current revision, gistable, archive rule,
excludeSlug, ordering, cap) and that countArchivedMatches is owner-scoped and cannot leak another
owner's count; the route's response shape and that `q` is never logged; that the counts shown in
src/web/ShelfSearchAlso.tsx are honest (archivedTally in Library.tsx: stale answers, query identity,
MIN_QUERY; the public count vs what the section then shows; ownSlugs; liveArticlesLoaded gate);
usePublicShelf's new `enabled` flag (StrictMode, the /read/public page still reading on mount, retry);
the abort check in useLibrarySearch; any test that cannot go red. Run
`npx vitest run tests/shelf-include-public.test.tsx tests/shelf-archived-in-the-list.test.tsx tests/store-shelf-pg.test.ts tests/routes.test.ts tests/public-shelf-page.test.tsx`
and the typecheck after any fix. Report P0/P1/P2 with file:line and exactly what you changed, and
whether it is ready to land on dev.
