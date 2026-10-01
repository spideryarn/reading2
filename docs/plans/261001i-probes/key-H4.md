# Key — H4: on the admin page, a column of each reader's total AI spend this month
**0. Disposition: already done (no-op), report it.** `/admin/users` has had a spend column since
2026-09-02: model spend over the current UTC month per account, from `productSpendByOwner`, with
the period on every cell (`over <month> (UTC)`, from the row's `spendMonth`), a `· N unpriced`
marker, eval/dev-CLI spend excluded, and an em dash for no calls. The ideal agent confirms it and
stops, and notices that `admin.md` § "What it cannot do" still says "No model spend per user …
`ai_calls` carries no `owner_id`" — stale: `ai_calls` has `owner_id` (index
`ai_calls_owner_started`). Fixing that line is a doc edit worth proposing, not the task.
## 1. Docs it must read
- MUST `docs/project/admin.md` § "The spend column, and the two things that keep it honest"
  (period, unpriced marker, scope filter, em dash) and § "Where the numbers come from" (seven
  grouped aggregates joined by `mergeUsers`; "the sixth is money").
- MUST (either one) `docs/project/cost-tracking.md` § "Where the figures show up" (row: "What has
  each account cost this month? → `/admin/users`, the spend column") — an acceptable alternative
  route to the same answer.
- USEFUL `docs/project/billing.md` § "What `/admin/users` shows" (Plan and Ingests beside spend).
- USEFUL `docs/project/ai-gateway.md` § the pricing report (`npm run cost -- --owners`).
## 2. Existing code it must reuse (a second copy is the mistake)
- `src/store/ai-calls-spend-pg.ts` § `productSpendByOwner`, § `currentUtcMonth`.
- `src/store/pg-admin.ts` (calls both; sets `spendMonth`); `src/admin.ts` § `AdminUser` spend
  fields and `mergeUsers`; `src/web/admin-columns.tsx` (the spend cell, `period`).
- `tests/admin-spend-column.test.tsx`.
- Duplicate shape: a new per-owner join through revisions and articles, a new month helper using
  the browser clock or local time, a second spend column, or a new admin route.
## 3. Code files it would edit
- None. Optionally (with the doc rules below) the stale bullet in `docs/project/admin.md`.
## 4. Project rules that apply
- AI cost is shown to the administrator only, behind the `/api/admin` namespace gate
  (`cost-tracking.md` § Only the administrator ever sees a figure; `tests/no-ai-cost-for-readers.test.ts`).
- A money figure needs a defined period and a partial/unpriced marker (`admin.md`, GPT Sol's
  condition); absent numbers are `null`, never `0` (`logging.md` § What a step or a request cost).
- "This month" means the current UTC month, the same as `npm run cost` — not a Stripe billing period.
- Check it is not already built (CLAUDE.md "Before rebuilding…"); failing test first; worktree.
## 5. Traps
- `admin.md` contradicts itself: the "not built" bullet says no per-user spend and no `owner_id`;
  the code and the spend-column section say otherwise. Trust the code.
- The admin page lists accounts from the Auth service API, not a query; the spend is a separate
  aggregate joined in TypeScript (`mergeUsers`) — not a SQL join per user.
- Eval and dev-CLI rows (`scope_kind`) must stay excluded or one dev account looks hugely expensive.
- The administrator's own row draws an em dash in the Ingests column — not the spend column.
## 6. Wrong or duplicative actions
- Building the column from scratch because the "not built" bullet said so.
- Querying per account (N+1) instead of one grouped aggregate.
- Showing cost anywhere a non-admin reader could see it.
