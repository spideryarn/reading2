Found and fixed six candidate issues; one wider pre-existing issue is reported.

- C1 — P0 — FIXED: `article_revisions.illustrated.note` exposed the prior reader’s exact words and could be copied into generated paintings. Automatic claims now refuse such articles; admin transfers remove the personalized artifact. Evidence: [pg-article-transfer.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-article-transfer.ts:384), tests in [article-transfer.test.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/tests/article-transfer.test.ts:330) and [claim-starter-article.test.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/tests/claim-starter-article.test.ts:253).

- C2 — P0 — FIXED: the old reader’s private upload filename moved to the recipient. Transfers now replace it with `document.pdf`, `document.html`, or `document`, preserving upload provenance without disclosing the original name. Evidence: [pg-article-transfer.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-article-transfer.ts:395).

- C3 — P0 — FIXED: revision `requested_url` and `final_url` could disclose URL credentials or signed query parameters. Transfers now retain only URLs accepted by `publicSourceUrl`; unsafe values become null. Safe URLs and non-personal illustrations remain intact. Evidence: [pg-article-transfer.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-article-transfer.ts:403), [article-transfer.test.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/tests/article-transfer.test.ts:447).

- C4 — P0 — FIXED: after ownership changed while the confirmation was open, `/admin/articles` could still name the old owner while transferring—and deleting state from—the new owner. It now displays the freshly previewed owner and clears a target that became the owner. Evidence: [AdminArticlesPage.tsx](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/web/AdminArticlesPage.tsx:164), [admin-articles-page.test.tsx](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/tests/admin-articles-page.test.tsx:234).

- C5 — P2 — FIXED: a committed claim could be missed after a failed response, a concurrent usage request, or when transfer cleared the private key between the owner and link reads. Eligible pages now perform one bounded owner-first reread regardless of which usage request won. Evidence: [useClaimSharedArticle.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/web/article/useClaimSharedArticle.ts:34), [ArticlePage.tsx](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/web/article/ArticlePage.tsx:121).

- C6 — P2 — FIXED: returning from article B to an earlier article A repeated A’s supposedly once-per-reader/slug billing request. The hook now remembers every pair for the mount. Evidence: [useClaimSharedArticle.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/web/article/useClaimSharedArticle.ts:60), [use-claim-shared-article.test.tsx](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/tests/use-claim-shared-article.test.tsx:116).

- C7 — P2 — REPORTED, wider/pre-existing: Author-gift Send can deadlock with permanent deletion. Send locks `author_gifts` before voucher insertion requests the article FK lock; deletion locks the article before its cascade needs the gift row. Evidence: [pg-author-gifts.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-author-gifts.ts:1201), [pg-vouchers.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-vouchers.ts:664), [pg-shelf.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-shelf.ts:544). Not fixed because it predates this change.

Checks:

- Focused unit/jsdom suites: 29 passed.
- All TypeScript projects passed; 3,702 source files covered.
- Biome: clean on all eight touched files.
- `git diff --check`: clean.
- Full `npm test` could not run because Postgres is inaccessible. Please rerun `tests/article-transfer.test.ts` and `tests/claim-starter-article.test.ts`; both contain new regression cases.
- No commit made.

VERDICT: LAND AFTER FIXES