You are reviewing and FIXING code in this repo (Spideryarn), in the worktree you are running in.

Candidate: commit b3ef332c6 (parent 842c552d8). Diff: `git show b3ef332c6` / `git diff 842c552d8 b3ef332c6`. Changed paths:
`git diff --name-only 842c552d8 b3ef332c6`. Start with src/store/pg-author-gifts.ts, src/author-lookup.ts, src/author-lookup-start.ts,
src/routes.ts (search ADMIN_AUTHOR_GIFTS_PATH), src/db/schema.ts (authorGifts, authorLookups), drizzle/20261009220519_author_gifts.sql,
and the three new test files; this does not limit scope.

Plan it implements: docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md (§ Revision 3 wins over earlier sections). Your own
two plan reviews are docs/plans/261009u-plan-review-sol.md and docs/plans/261009u-plan-review-2-sol.md — check each finding there is
actually closed IN THE CODE (especially R2-F1..F7, F9 exact-address matching, F6/R2-F6 cost run_id, F2 lookup concurrency).

Other agents are concurrently editing UI files in this same worktree (src/web/**, src/mcp/tools.ts, tests/admin-*, tests/add-*,
tests/mcp-*). DO NOT touch those. Fix only inside this commit's server files, narrowly, red-first (write or adjust a test that fails, then
fix). Report — do not fix — anything wider. Do not commit.

Attack independently first: correctness of send (freeze, createVoucher replay, unfreeze CAS, email scheduling on replay), ensure
idempotence (no link touched or lookup started for an existing gift), lookup claim/finish CAS and draft-only application, notes cut to
fit, provenance clearing, ownership/published checks, admin-only, prompt injection and hallucinated-address defences, cost attribution, the
migration (additive, constraints right), and anything that reports success while doing nothing.

Tests: you cannot reach Postgres from your sandbox. I ran the DB-backed suites; raw result: `npx vitest run tests/author-gifts.test.ts
tests/author-lookup-start.test.ts tests/author-lookup.test.ts tests/billing-vouchers.test.ts tests/authenticated-api-route-contract.test.ts
tests/store-guarded.test.ts tests/models.test.ts tests/no-undeclared-spend.test.ts` → Test Files 8 passed, Tests 658 passed. You can run
`npx vitest run tests/author-lookup.test.ts` (pure) and `npm run typecheck` yourself. If you change a DB-backed test, say so and I will run it.

My suspicions, worth less (spend most of the run elsewhere): runAsOwner(gift.createdBy) around createVoucher on Send; the cost sum by run_id
with no index on ai_calls.run_id; whether finishLookup's notes append can exceed the DB check; the "nothing" outcome still carrying a
suggested address.

Severity: P0 data loss/exploitable security/incorrect charging/broadly unusable; P1 user-visible wrong behaviour or contract violated;
P2 design risk; P3 prose. Output: verdict line (APPROVE / APPROVE WITH CHANGES / REJECT), then findings with IDs C1, C2…, severity,
file:line evidence, and for each either "FIXED (files, test)" or "REPORTED". List every file you changed at the end.
