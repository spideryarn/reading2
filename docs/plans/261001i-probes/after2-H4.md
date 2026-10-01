# Probe H4 (after2): per-reader monthly AI spend column on the admin page

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — pointed at the entry points; no direct admin or cost pointer.
- `docs/project/admin.md` (top 200 lines + greps) — helped: names the page, gate, privacy boundary, and a "spend column" section (line ~523).
- `docs/project/cost-tracking.md` (top 70 lines) — helped a lot: its "Where the figures show up" table says "What has each account cost this month? `/admin/users`, the spend column".
- Not opened, would: `docs/project/ai-gateway.md` (the pricing report), `docs/project/security-map.md`.

## 2. Code files you would edit
**Probably none: the column already exists.** I would verify, and edit only if something is missing:
- `src/web/admin-columns.tsx` (`Spend` cell, `id: "spend"` column, column-order list)
- `src/store/pg-admin.ts` (`spend: Map<string, OwnerSpend>`, `spendMonth`)
- `src/store/ai-calls-spend-pg.ts` (`productSpendByOwner`)
- `src/admin.ts` (`AdminUser` type: `spendNanos`, `spendCalls`, `spendUnpricedCalls`, `spendMonth`; `formatSpendNanos`)
- Tests: `tests/admin-spend-column.test.tsx`, `tests/admin-store.test.ts`

## 3. Existing helpers/components/functions you would reuse
- `src/store/ai-calls-spend-pg.ts` § `productSpendByOwner`
- `src/admin.ts` § `formatSpendNanos`, `AdminUser`
- `src/web/admin-columns.tsx` § `Spend`
- No new helper needed.

## 4. Rules/policies I would follow
- Only the administrator ever sees cost figures; guarded by `tests/no-ai-cost-for-readers.test.ts` (cost-tracking.md).
- The admin page shows counts, dates and metadata only, never reading content (admin.md § What it deliberately does not show).
- Gate is the `/api/admin` namespace check in `src/routes.ts`; do not add a client-only check (admin.md).
- Period named on each cell from the row's `spendMonth`; eval and CLI spend excluded (admin.md § spend column).
- Write a failing test first, then run `npm test` and `npm run typecheck`; commit own files by name and push to `dev`; GPT Sol review before commit (CLAUDE.md).
- No migration is needed; it reads `ai_calls`.

## 5. Where you got lost
- Briefly: the task reads as new work, but the feature is already built. The docs showed this (cost-tracking.md table, admin.md § spend column) once I opened them. admin.md line ~760 ("No model spend per user") is stale and contradicts the spend column section.
- Nothing in CLAUDE.md signposts admin or cost; I found it by grepping.

## 6. Confidence
8/10. The column already exists; I did not read its implementation in detail or check for gaps.
