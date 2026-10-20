# Plan review: a total-cost column on /admin/articles

You are reviewing a plan, read-only. Do not edit files. Repo: Spideryarn (TypeScript, Postgres via drizzle).

Plan: docs/plans/261020s-total-cost-column-on-admin-articles.md

Read it, then read the code it names: src/store/ai-calls-spend-pg.ts (spendForArticle, belongsTo, spendByRun, spendCube, the CREDITS/BYOK/COMPUTED/UNPRICED_CALLS expressions), src/store/pg-article-transfer.ts (listArticlesAcrossOwners), src/admin-articles.ts, src/web/AdminArticlesPage.tsx, src/web/admin-costs-view.ts (amountWithFloor), src/admin.ts (formatSpendNanos), docs/project/admin.md (What it deliberately does not show; /admin/articles), tests/ai-calls-spend-pg.test.ts, tests/owner-isolation.test.ts, tests/client-imports.test.ts.

Look for: (1) any way the bulk two-query rule disagrees with belongsTo (double counting, missed rows, nulls, deleted articles, transfers); (2) privacy: does a cost per row for another reader's private article reveal anything /admin/costs does not, or trip owner-isolation rules; (3) performance of the two GROUP BYs on a ledger of ~10^5-10^6 rows, and indexes; (4) client-import rules for the page using admin-costs-view.ts / admin.ts; (5) anything simpler; (6) missing tests.

Write your findings as a numbered list, each with severity (P0/P1/P2/nit), the evidence (file:line), and the fix. End with a line "VERDICT: approve" or "VERDICT: approve with changes" or "VERDICT: rework".
