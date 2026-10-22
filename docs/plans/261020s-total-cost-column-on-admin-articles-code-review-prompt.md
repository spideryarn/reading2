# Code review: a total-cost column on /admin/articles

You are GPT Sol reviewing the code built from docs/plans/261020s-total-cost-column-on-admin-articles.md (read it, including the "Changed after the plan review" note and your own plan review in docs/plans/261020s-total-cost-column-on-admin-articles-plan-review-sol.md).

The change is uncommitted in this worktree: `git diff HEAD` shows it (src/store/ai-calls-spend-pg.ts spendByArticle; src/store/pg-article-transfer.ts listArticlesAcrossOwners; src/admin-articles.ts AdminArticleCost; src/web/AdminArticlesPage.tsx column + order select; tests/ai-calls-spend-pg.test.ts, tests/admin-articles-page.test.tsx, tests/article-transfer.test.ts, tests/owner-isolation.test.ts comment; docs/project/admin.md, docs/project/cost-tracking.md).

House rule: you FIX what you find inside this stage (edit the files directly), and report anything wider for the author to decide. Do not commit, and run no version-control command that changes state. You may run: `npx vitest run tests/ai-calls-spend-pg.test.ts tests/admin-articles-page.test.tsx tests/article-transfer.test.ts` and `npm run typecheck`.

Look for correctness (money arithmetic, null article ids, unpriced/floor display, sort stability, caption/aria), privacy (anything new crossing owners beyond money + opaque id), consistency with /admin/costs formatting and rules, client-import rules, tests that could pass while the code is wrong, stale comments/docs.

Write findings as a numbered list: severity (P0/P1/P2/nit), evidence (file:line), and what you changed (or "not changed: reason"). End with exactly one line: "VERDICT: ship" or "VERDICT: ship after fixes made" or "VERDICT: do not ship".
