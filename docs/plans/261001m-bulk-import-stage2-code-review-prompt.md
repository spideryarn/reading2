# Code review: bulk import, Stage 2 — billing in points, the minimal kind, Read this (261001m)

You are reviewing, and you may fix what you find. **Billing is a security defence**: the quota is
the abuse boundary against model spend (`docs/project/billing.md` § *The quota, and the one thing it
has to survive*, and the new § *A minimal paper costs a hundredth*; `docs/project/security-map.md`).

The plan: `docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md` — § Greg's answers
(point 1), § Billing, § *What Opus changed in the billing design* and § *What Sol's plan review
changed* (those two control), § Stages item 2. The scoped diff is
`docs/plans/261001m-bulk-import-stage2.diff` (`src/billing/half-units.ts` → `src/billing/points.ts`
and `tests/billing-half-units.test.ts` → `tests/billing-points.test.ts` are renames). Stage 2 is the
arithmetic, the ledger schema and the admission primitives only; Stage 3 (not built yet) adds
`articles.processing`, the minimal job, the publication that calls `supersedeMinimal`, and the
routes. So judge the seams Stage 3 will call (`withMinimalSlot`'s `inLock`, `withUpgradeSlot`,
`supersedeMinimal`, `reservationShapeOf`, retry), not their absence from routes.

Greg's rule: a minimally processed paper costs 0.01 of a slot (1,000 = 10 slots); Read this costs
the remaining 0.99, so a paper never costs more than one slot. Units: points, 200 per slot; private
ingest 200, public 100, minimal 2 (never priced by visibility), high power like an ingest.

Hunt above all for a way to get more than your share:
1. Concurrency: twenty concurrent minimal reservations; a minimal reservation racing an ingest; two
   Read-this presses; a Read this racing a share/unshare; retry racing anything. Is every admission
   insert-then-lock-for-update, with usage including every unsettled reservation of every kind, and
   nothing networked or transaction-opening inside the lock (`inLock` included)?
2. The predicates in `src/billing/points.ts`: is `admitsIngest` exactly today's rule when usage is
   a multiple of 100? Is every wall (atTheWall/atLimit, headroom, High-powered AI, vouchers,
   sharingWouldMakeRoom, the admin cell, describePlan's ratio) on the right predicate?
3. The credit: 2 only for this article's charged, in-window, unsuperseded minimal row. Can it be
   taken twice, or taken for a row outside the window, or for a row of a different article/owner?
4. Supersession: the trigger, the check, the unique index. Can any path supersede without a charged
   ingest of the same paper paying, or charge the ingest without the minimal row ever being
   superseded (a paper costing 1.01 for ever is the fail-safe direction, but say if it is reachable
   in normal use)? Does the delete trigger (`drizzle/20260907200800_…`) interact correctly with
   `superseded_by` and the new trigger?
5. `usageSql`: minimal charged-in-period and not superseded; in-flight split by kind; the period
   filter applied to every counted column (billing.md has a story about one copy of it being wrong).
6. The migration: additive, idempotent where the house migrations are, sorted after
   `20261001163445_billing_vouchers`, snapshot/journal consistent; safe on production rows.
7. Tests: would they go red on the obvious mistakes? The builder admits they were written alongside
   the code and proved by mutation; check a few mutations yourself.
8. `docs/project/billing.md`: does the new section and every reworded half-unit sentence match the
   code?

Do not touch Stage 1 files (`src/paper-metadata.ts`, evals/). No git commands that change the index
or discard work; no commits. The shared local database is behind (a peer's migration blocks
`db:migrate`); the repo's private-postgres test lane builds its own database from `drizzle/`. Run
`npm run typecheck` (or `node --import tsx scripts/typecheck.ts` if tsx IPC is blocked) and
`npx vitest run tests/billing-*.test.ts tests/admin-page.test.tsx tests/high-power-routes.test.ts tests/db-schema.test.ts tests/messages.test.ts`.

Report: numbered findings (P0/P1/P2) with file:line and what you changed for each, the test
results, anything wider left unfixed, and a one-line verdict.
