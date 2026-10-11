# Code review (write-capable): 261011n — gift link, article transfer, transfer on claim, /admin/articles

Repo root is the current directory (a git worktree of Spideryarn). You may edit files to fix what you find.

**Candidate (committed):** `git diff d3feef8923b610e65a89ea009b3b7a7d0e0da726 af5c6d365` — commits 0bec3ac7c (stage 1: draft-gift URL), 672bdf2ae (plan rev 2), fcd64d042 (stage 2: transferArticle, /admin/articles), af5c6d365 (stage 3: transfer on claim, claimedArticles, reading-view hook, admin labels, docs). Every changed path is listed in `docs/plans/261011n-code-review-paths.txt`. Start with `src/store/pg-article-transfer.ts`, `src/store/pg-vouchers.ts` (claimVouchersFor and its new step), `src/admin-articles.ts`, the new rows in `src/routes.ts` (grep `/api/admin/articles` and the `/api/billing/usage` handler), `src/web/article/useClaimSharedArticle.ts`, `src/web/AdminArticlesPage.tsx` — that list does not limit scope.

**The spec** is `docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md` (revision 2: § Decisions D1–D4, Bounds, and § Plan review, which records your earlier plan review's findings and how each was answered — F1/F7 deliberately left as a recorded residual, F3's migration and F10 overruled after an Opus arbitration; do not re-raise those unless the code makes them worse than recorded).

## Brief

Fix what is inside this change, narrowly, red-first (write or adjust a test that fails, then fix). Report — do not fix — anything wider you notice. Do not edit any file listed in `docs/project/security-map.md` § "Where the defences physically live" other than route rows/handler bodies in `src/routes.ts`; in particular not `src/web/article/access.ts`, `src/auth.ts`, `src/store/owned-slug.ts`, `src/web/AuthCallback.tsx`. No migrations. Do not commit.

What to attack: leaks of one reader's data to another after a transfer (any table the classification map misclasses — verify the map against `src/db/schema.ts`, `drizzle/*.sql`); constraints/triggers a transfer can trip; billing (ingest_events freeze/unlink, High-powered, the allowance of either owner); lock order and deadlocks (the claim now locks starter articles before its voucher UPDATE — check every other path that locks articles, vouchers, author_gifts, billing_accounts); the claim's savepoint really isolating a failure; a non-admin reaching a transfer; the claim moving an article the creator did not intend; the reading-view hook (loops, repeated calls, races with reader changes); `/admin/articles` showing another reader's title or slug; the admin pages after a move; input validation on the new routes.

**Tests that need Postgres you cannot run** (no network in your sandbox). Here is the raw output of the database suites, run by me just before this review against the local database:

```
tests/claim-starter-article.test.ts, tests/article-transfer.test.ts, tests/billing-vouchers.test.ts, tests/author-gifts.test.ts, tests/voucher-starter.test.ts — all passed (part of an 11-file run: 769 passed, 0 failed), private-postgres lane, not skipped.
```

You can run jsdom/unit suites yourself, e.g. `npx vitest run tests/use-claim-shared-article.test.tsx tests/admin-articles-page.test.tsx`. If a DB test should be added for a fix, write it and say so; I will run it.

## Severity scale and output

P0 data loss/leak or security hole; P1 wrong behaviour a user will hit; P2 should fix; P3 nit. Every finding: ID (C1, C2…), severity, evidence (file:line), whether you FIXED it (and which files/tests you changed) or REPORTED it. End with `VERDICT: LAND` / `LAND AFTER FIXES` / `DO NOT LAND`.

## My own suspicions (mine, worth less — spend most of the run elsewhere)

- The claim now takes article locks before vouchers: is there a path (author-gift Send, share-link ensure, voucher revoke/readdress) that holds a voucher or gift row and then asks for the article?
- `transferArticle` deletes `comments` before `referee_criteria` because of a non-cascading FK — is any other ordering dependency missed?
- `useClaimSharedArticle` calls `/api/billing/usage` from the reading view for every signed-in private-link visitor: any cost or behaviour change for readers who are not gift recipients?
