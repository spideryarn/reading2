- **F11 — P1 — fixed:** [src/cost-cube.ts:518](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/cost-cube.ts:518). Unnumbered failures with a recorded `before_answer` phase showed measured zero deaths as “not measured.” Phase coverage is now independent of retry numbering. Page, HTML and terminal regressions failed first.
- **F12 — P1 — fixed:** [src/cost-cube.ts:615](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/cost-cube.ts:615). Shared explanations incorrectly limited all counts to numbered attempts and claimed part-way failures were never retried. Definitions now distinguish acceptance from answer content, identify the third-attempt give-up rule, allow caller-owned retries, and explain F9’s exception.
- **F13 — P3 — fixed:** [docs/project/admin-costs.md:105](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/docs/project/admin-costs.md:105). Reclassifying `aborted` as `error` does not increase “Failed or stopped calls”; both already count. Recording claims were corrected, with failing tests first.
- **F14 — P3 — not fixed; wider scope:** [docs/project/ai-gateway.md:77](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/docs/project/ai-gateway.md:77). Pre-existing wording still describes the retired JSONL ledger as a current store.

**F10 verified:** removing its acceptance guard made the test settle the malformed response at $0. Restored code passes. Other interrupted-response classes retain the existing whole-step-bound policy.

Validation: **330 tests passed across ten database-free files**; typechecking, touched-file lint and diff checks passed. Removing the failure grouping keys also produced three expected test failures. No money, filter, URL or escaping regression found. Database tests were not rerun.

**Verdict: pass with fixes applied; no unresolved P0/P1.**

Files changed:

- `src/cost-cube.ts`
- `src/web/AdminCostsPage.tsx`
- `scripts/cost-analysis.ts`
- `docs/project/admin-costs.md`
- `docs/project/ai-gateway.md`
- `tests/cost-cube.test.ts`
- `tests/admin-costs-page.test.tsx`
- `tests/cost-analysis-cli.test.ts`
- `tests/cost-analysis-html.test.ts`
- `tests/cost-failure-docs.test.ts`
- `docs/postmortems/261006c-one-measure-borrows-another-measures-coverage.md`