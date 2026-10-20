# Code review — say who owns an article on its details page

Final findings:

1. **P1 — A reader change could make a categorical ownership claim for the wrong account and start the admin request from a non-admin session** (`src/web/PublicPages.tsx:161-165,228-236`; `src/web/Ownership.tsx:93-115`). The page checked that the access result was signed-in and confirmed, but when `useSession()` had already moved to another account it withheld only the email: it still said *You don't own this article* and handed the old administrator id to `AdminOwnerLine`. That line called `apiFetch` without its `madeFor` argument, so a change between render and token lookup could send `/api/admin/articles` with the new non-admin credential (the server would refuse it, but the client should not ask). **Changed:** the whole Access section now requires the live session id to equal the reader for whom access was resolved, and the admin request is bound to that reader id through `apiFetch`'s cross-account guard. `tests/article-ownership.test.tsx:295-301` proves a non-admin live session paired with the stale admin reader id draws no claim and makes no request. The existing signed-out, unconfirmed, ordinary-reader and private-link negative controls remain.

2. **P2 — The owner line's account address came from a second unbound session hook** (`src/web/article/ArticlePage.tsx:268-269,302-312,486-496`; `src/web/Metadata.tsx:493-505,1337-1345,1541-1570`). The owned access result establishes that the `readerId` passed to `ArticlePage` owns the article, but `SharingCard` independently read whatever account `useSession()` reported at that moment. During a reader transition it could therefore put B's address beside A's *You own this article*. **Changed:** the owned branch carries its access reader id into `Metadata`, `Metadata` reuses its existing session read, and the address is passed to the card only when the ids match. `tests/article-ownership.test.tsx:228-247` supplies a mismatched session and proves its address is absent.

3. **P2 — The test suite did not exercise the stale-response guard when the article slug changes** (`src/web/Ownership.tsx:95-115`; `tests/article-ownership.test.tsx:347-401`). The implementation has both an effect cleanup and a caller key, but every admin test mounted one slug once, so the protection could regress while all tests stayed green and an earlier article's owner could appear on a later article. **Changed:** the new test holds the first request open, moves the same page to another slug, lets the second owner render, then resolves the first request and proves its stale owner cannot land.

4. **P3 — Help promised the visitor Access section to signed-out readers even though the UI deliberately omits it** (`src/web/help/pages/sharing.md:16-18`; `src/web/PublicPages.tsx:228-236`). *On an article somebody else shared with you* included a signed-out private-link visitor, for whom ownership is unknown and no Access section is rendered. **Changed:** Help now says *When you're signed in*, its generated chatbot corpus was regenerated, and `tests/article-ownership.test.tsx:403-406` pins the qualification.

The server-side privacy boundary remains intact: `listArticlesAcrossOwners` still sends no slug or title for another reader's private article, `AdminOwnerLine` makes no admin request for `sharedBy: "link"`, and its public-article lookup can therefore match only a slug the admin list deliberately disclosed. No production data was read or changed.

Checks:

- `npx vitest run tests/article-ownership.test.tsx` — 13 passed.
- `WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts` — 7 passed; regenerated `src/help-corpus.generated.json`.
- `npx vitest run tests/public-network-trace.test.tsx` — 98 passed.
- `node --import tsx scripts/typecheck.ts` — all four TypeScript projects passed; all 3,859 source files covered. The requested `npm run typecheck` wrapper itself could not start `tsx`'s IPC socket in the review sandbox (`listen EPERM /tmp/tsx-1000/*.pipe`), before it checked code.
- `npx biome lint` on the five touched TypeScript/TSX files — no errors; one pre-existing advisory that `Metadata` has cognitive complexity 29 against 25.
- `git diff --check` — passed.
- `npm test` could not start its private database lane because sandbox policy refused the local Supabase/Docker connection (`connect EPERM 127.0.0.1:54362`); it ran no tests, so it is not evidence.

Nothing wider remains for a decision inside this stage. Whether an administrator may learn the owner of another reader's private-link article remains the already-deferred `q-agbc89`; this review preserves the current answer of no.
