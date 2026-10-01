# Probe H4 : admin page, per-reader AI spend this month

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — pointed to security-map, admin.md, cost-tracking.md; helped.
- `docs/project/admin.md` (lines 1-200, headings, 400-460) — helped a lot; its heading list and the spend section show the column already exists.
- `docs/project/cost-tracking.md` — helped; its "Where the figures show up" table says `/admin/users` already has the spend column, and the admin-only rule.
- `src/store/ai-calls-spend-pg.ts` header — helped; `productSpendByOwner`, the money expression, the owner group-by exception.

## 2. Code files you would edit
- Probably none: the column is already built (`src/admin.ts` `AdminUser.spendNanos`, `src/store/pg-admin.ts`, `src/web/admin-columns.tsx` `Spend`).
- If something is missing after checking the live page: `src/web/admin-columns.tsx`, `src/store/pg-admin.ts`, `src/admin.ts`, tests `tests/admin-spend-column.test.tsx`.

## 3. Existing helpers to reuse
- `src/store/ai-calls-spend-pg.ts` § `productSpendByOwner`
- `src/store/pg-admin.ts` § spend map and `spendMonth`
- `src/admin.ts` § `formatSpendNanos`, `AdminUser`
- `src/web/admin-columns.tsx` § `Spend`
No new helper.

## 4. Rules/policies
- Cost shown only to admin; `tests/no-ai-cost-for-readers.test.ts` (cost-tracking.md).
- Do not show articles titles or reading content on admin (admin.md "What it deliberately does not show").
- Only `pg-admin.ts` and the spend file may group by owner (`tests/owner-isolation.test.ts`).
- Test first, `npm test` and `npm run typecheck`, worktree, cross-family review (CLAUDE.md).
- Read admin.md "The spend column, and the two things that keep it honest" before changing anything.

## 5. Where you got lost
- The task asks for something already shipped; I found that only because admin.md and cost-tracking.md mention it. Nothing in the task wording or an index says "already done". I did not read the spend section of admin.md (lines 523-558) in full, nor verify the live page.

## 6. Confidence
7 — that the feature exists and the files are right; unsure what residual gap the task intends.
