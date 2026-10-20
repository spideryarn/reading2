You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Read
docs/plans/261020j-say-who-owns-an-article-on-its-details-page.md, then the code and docs it names:
src/web/Metadata.tsx (SharingSection), src/web/AccessSharing.tsx, src/web/PublicPages.tsx
(PublicMetadataPage), src/web/PublicChrome.tsx (SharedNotice, sharedSentence), src/web/article/ArticlePage.tsx,
src/routes.ts (the /api/admin/articles routes, the /:slug/cost route, the admin namespace gate),
src/store/public-access.ts, src/store/link-shared-slug.ts, src/store/pg-article-transfer.ts (listArticlesAcrossOwners),
docs/project/admin.md (§ What it deliberately does not show, § One article's cost, § /admin/articles),
docs/project/security-map.md.

Questions, answer each:
1. Is part 3 (an admin-only route returning an article's owner address, visibility and has-a-private-link,
   gated on publicAccessWhere(slug, key)) an edit to a defence or within admin.md's existing rule? If it is a
   widening, say the narrowest version that is not.
2. Correctness holes: e.g. is the owner page truly only drawn for the owner (any fixture/admin/edge case
   where "You own this article" would be false)? Is the visitor page ever drawn for the owner (session
   unconfirmed, or other)? How does the visitor page know the signed-in user id for isAdmin?
3. Is there existing shared code for looking up one account's email from the Auth service?
4. Anything simpler that gives Greg the same answer?
5. Is the deferred link-open tracking framed fairly for Greg to choose?

Write your findings, numbered, most severe first, each with file:line evidence, to the output file.
