# The scripts behind the 2026-10-05 cost-tracking audit

These are the throwaway scripts and queries the audit was done with, kept as evidence and as a starting point for the next audit. They are not maintained tooling: expect to edit one before it fits a new question. What they found is in [the investigation](../../../docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md).

- `prod-read.ts` and the numbered `.sql` files read **production**, read-only: through the repo's verified production client, inside `begin read only`, rolled back at the end. `categories.ts` and `computed-recompute.ts` do the same with a fixed query, then check the rows against `src/cost-categories.ts` and `src/pricing.ts`.
- `accuracy-sample.ts` and `unpriced-census.ts` read production the same way, then ask OpenRouter's free generation lookup (`GET /api/v1/generation`) about each row, using the local `OPENROUTER_API_KEY` from `.env.local`. They buy no inference. Since stage 3 both do it through `scripts/openrouter-generation.ts`, the one copy of that lookup, and `accuracy-sample.ts` no longer reads the key's own usage totals (`GET /api/v1/key`): `npm run cost -- --reconcile` does.
- `break-the-scan.ts` touches neither: it copies the matcher from `tests/no-undeclared-spend.test.ts` into the OS temp directory and feeds it the made-up files in `break-the-scan-cases.json`.
- Run a query file with: `npx tsx evals/cost/audit-261005/prod-read.ts evals/cost/audit-261005/01-schema.sql`
- The two OpenRouter scripts write a result file holding production ids, to the path you give as the last argument or else `logs/cost-audit/` (gitignored). The audit's own result files were not kept for that reason.
- `06-sol.sql` has placeholder run ids where the audit used real ones.
