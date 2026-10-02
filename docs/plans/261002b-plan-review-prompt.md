You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Read
docs/plans/261002b-include-public-chip-on-the-shelf-empty-shelf-help-and-a-phone-banner-on-the-shelf.md
and the code it touches: src/web/Library.tsx, src/web/ShelfControls.tsx, src/web/shelf-narrow.ts,
src/web/PublicLibraryPage.tsx, src/web/public-api.ts, src/web/small-screen-hint.ts,
src/web/SmallScreenHint.tsx, src/web/params.ts (libraryArchivedParam), docs/project/library.md,
docs/project/public-shelf.md, docs/project/touch.md § One banner, once.

Tell me: (1) anything in the plan that is wrong about the code; (2) security or privacy problems
(e.g. the signed-in shelf calling the anonymous public listing; anything leaking); (3) whether a
signed-in reader can actually open another reader's public article from /read/<slug> (trace it);
(4) simpler designs I missed; (5) edge cases the tests list misses; (6) whether the phone rule
(coarse pointer AND min(screen.width, screen.height) < 600) is sound. Also check the conclusion:
is a separate section under the list (not merged into the one list) the right v1 for Greg's words?
Rank findings P0/P1/P2, be concrete, cite file:line.
