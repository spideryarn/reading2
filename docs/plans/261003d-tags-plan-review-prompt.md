You are reviewing a plan, read-only, before it is built. The plan is
docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md
in this repo (Spideryarn; CLAUDE.md and docs/project/ explain the project). Read it, then read the code it
touches to check its claims: src/db/schema.ts (articles), src/store/pg.ts (listArticlesQuery,
articleMetadata), src/store/pg-shelf.ts, src/routes.ts (patchShelf, the /api/library routes, AUTH_ROUTES),
src/web/shelf-narrow.ts, src/web/useShelfTerms.ts (useChosenTopics, useShelfTopics), src/web/ShelfTerms.tsx,
src/web/Library.tsx, src/web/ShelfEntry.tsx, src/web/Metadata.tsx, src/public/dto.ts, the export code,
docs/project/sql.md, docs/project/shelf-terms.md, docs/project/chat-llm-help-commands-vision.md.

Find: anything wrong or missing (security/privacy of tags, the pill pruning race, ownership, export,
case-insensitive identity under concurrency, the CHECK constraint, cap enforcement), anything more complex
than v1 needs (Greg asked to keep v1 simple — say if a smaller version gets most of the value), and
anything that will make the later command-bar "add a tag of X" harder. Number each finding P0/P1/P2
with a concrete fix. Also say plainly whether you would approve the plan as is.
