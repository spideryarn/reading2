# Code review, stage 1 of 261005a: the cost cube and `GET /api/admin/costs`

You are the reviewer **and the fixer**. Your sandbox is write-capable in this worktree.

- **Fix what is inside this stage**, narrowly, red-first (a failing test before the fix where a test
  can show it). Stay on the files listed below and their tests.
- **Report, do not fix, anything wider** — so I can decide.
- **Do not edit**: `tests/owner-isolation.test.ts`, `tests/no-ai-cost-for-readers.test.ts`,
  `tests/no-undeclared-spend.test.ts`, the `/api/admin` namespace gate in `src/routes.ts`, anything
  under `src/web/` other than `ArticleCost.tsx` (another agent is building the page there right
  now, in files named `AdminCosts*`, `cost-charts*`, `useAdminCosts*`), or any doc under
  `docs/project/`. Run no git command that changes anything. Do not write a sentence attributed to
  Greg that is not already in the plan.
- You have no network and no Postgres. Run `npx vitest run tests/cost-cube.test.ts` and
  `tests/admin-costs-route.test.ts` yourself (they need neither). The Postgres suite
  `tests/admin-costs-store.test.ts` is mine to run; my last run of it, with eleven other files, was
  12 files / 606 tests passed at commit `aabcde9a7`.

## The candidate

Commit `aabcde9a7` (one commit on top of `61a7135a7`). `git show --stat aabcde9a7` lists the paths:

- `src/store/ai-calls-spend-pg.ts` — `spendCube`, `SpendCubeTooLarge`, the restated header
- `src/cost-cube.ts` — new, pure, browser-safe: types, `taskOf`, `modelOf`, `articleKeyOf`,
  `dimensionValue`, `filterRows`, `groupRows`, `pivotRows`, `amountPerPricedCall`,
  `parseCostWindow`, `costWindowLabel`, the credit-fee arithmetic
- `src/routes.ts` — the `GET /api/admin/costs` row only
- `src/cost-report.ts`, `src/web/ArticleCost.tsx` — now use the shared copies
- `tests/cost-cube.test.ts`, `tests/admin-costs-store.test.ts`, `tests/admin-costs-route.test.ts`
- `tests/client-imports.test.ts`, `tests/authenticated-api-route-contract.test.ts`,
  `tests/store-migration-registry.ts` — one entry each, for the new module, route and suite

Context: the plan `docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md`
(read § "What GPT Sol's plan review changed" — your earlier review, and what was done with each
finding), and `docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md`, an
audit written by another agent that is in the same commit but is **not** under review here (it
gets its own review later; mention anything in it that is plainly wrong).

## What I want

1. An independent attack first. Is any figure the cube or its folds can produce wrong or
   misleading? Can another owner's slug, title or prose leave the database or reach the response by
   any path (including error messages, the hash, the `owners` list, logs)? Is the route correctly
   behind the gate, `no-store`, and strict about its window?
2. SQL correctness: the UTC day, the grouping against the two `case` expressions, the `limit` cap,
   `.mapWith`, nullability of each dimension, and whether the existing index serves the window.
3. The pure module: are `groupRows`/`pivotRows` totals exact, are keys collision-free (two different
   things with one key, or one thing with two keys — note the reported case of a renamed article
   yielding two rows identical in every dimension), does `dimensionValue` leak an email or slug
   into a key meant for the address bar?
4. Tests: which would stay green if the code were wrong? Mutate and say what you saw.
5. The three inventory-test edits: is each the minimal honest entry?

## Severity and verdict

P0 data loss, exploitable security, incorrect charging, service broadly unusable · P1 user-visible
wrong behaviour or an authoritative contract violated · P2 design or maintainability risk · P3
prose. Every finding gets an ID (`F1`…), a severity, **established** (direct evidence, cite file
and line, or a test you ran) or **reasoned**, and whether you **fixed** it or are **reporting** it.
End with a list of every file you changed, and `VERDICT: approve` or `VERDICT: revise` (revise
only on an established P0 or P1 you did not fix).

## My own suspicions (already mine; spend most of the run elsewhere)

- `owners` is built from an Auth-service listing; a failure there fails the whole page.
- An absent `since` and `until` returns the whole ledger.
- `category` is typed `string` on the wire.
