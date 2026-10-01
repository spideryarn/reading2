# H4 after: spend column on the admin page

## 1. Docs opened, in order
- `AGENTS.md` / `CLAUDE.md` (in context) - signposts to admin.md, cost-tracking.md; helped.
- `docs/project/admin.md` - helped a lot: has a section "The spend column, and the two things that keep it honest" saying the column already exists.
- `docs/project/cost-tracking.md` - helped: "Where the figures show up" table lists `/admin/users` spend column; explains admin-only cost rule.

## 2. Code files you would edit
None needed if the column is already present. Verified (grep only): `src/web/admin-columns.tsx` (`Spend`, column id "spend"), `src/store/pg-admin.ts`, `src/store/ai-calls-spend-pg.ts` (`productSpendByOwner`), `src/admin.ts` (`AdminUser.spendNanos`, `formatSpendNanos`), `tests/admin-spend-column.test.tsx`.
Only if asked to change it would I edit those.

## 3. Existing helpers/components/functions you would reuse
- `src/store/ai-calls-spend-pg.ts` § `productSpendByOwner`
- `src/admin.ts` § `formatSpendNanos`, `AdminUser`
- `src/web/admin-columns.tsx` § `Spend`
No new helper.

## 4. Rules/policies you would follow
- Cost visible to admin only; `tests/no-ai-cost-for-readers.test.ts` guard (cost-tracking.md).
- Admin endpoints live behind the `/api/admin` gate; admin shows only metadata, never reading content (admin.md).
- Test first, `npm test` and `npm run typecheck`; worktree; GPT Sol review (CLAUDE.md).

## 5. Where you got lost
Nothing; the main finding is that the task is already done, which admin.md and cost-tracking.md both state. One stale line remains in admin.md (~line 760, "No model spend per user") contradicting the spend-column section.

## 6. Confidence
9/10 that the feature exists and where; I did not run it.
