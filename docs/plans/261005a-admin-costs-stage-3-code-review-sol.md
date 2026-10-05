## Verdict

No unfixed P0 or P1 findings. The analysis, database path, privacy boundary, report, page follow-ups, and documentation now agree.

### Findings

- **F1 · P2 · established · fixed** — `assertReadsAgree` compared only grand totals, so different task/article/model populations with identical money and call counts passed. It now compares every cube dimension and monetary pocket by grouped population. Sixteen grouping-dimension cases cover it. [src/cost-analysis.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-analysis.ts:265)

- **F2 · P1 · established · fixed** — incomplete or ambiguous OpenRouter records could become known zeroes; malformed HTTP 200 responses were also called “no record.” Money is accepted only when BYOK status identifies the pocket and every required figure is present; malformed successful responses retry and ultimately fail. [scripts/cost-analysis.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/cost-analysis.ts:407), [scripts/openrouter-generation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/openrouter-generation.ts:75)

- **F3 · P1 · established · fixed** — `npm run cost -- --owners --reconcile` retained the false “before the ledger existed” caveat and omitted the gap percentage, although the ordinary reconciliation path had been corrected. Both now use one builder. [scripts/ai-cost.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/ai-cost.ts:531)

- **F4 · P2 · reasoned · fixed** — one `writeSync` may legally write only a prefix, after which the truncated report would have been renamed as complete. The writer now uses the full-write `writeFileSync` path while retaining same-directory atomic rename and mode `0600`. [scripts/cost-analysis-html.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/cost-analysis-html.ts:557)

- **F5 · P2 · established · fixed** — the server scripts imported their formatter through the client directory. The formatter now lives in import-free `src/admin.ts`, with the client module re-exporting it. [src/admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/admin.ts:448)

- **F6 · P2 · established · fixed** — the chart loader mutated `globalThis.React`. File-local JSX-runtime pragmas remove that shim while preserving real Node/`tsx` loading. [src/web/cost-charts.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/cost-charts.tsx:1)

- **F7 · P2 · established · fixed** — `shadeAlpha` returned `NaN` for non-finite input. Non-finite, zero, and negative values now remain unshaded; values above the maximum still clamp correctly. [src/web/admin-costs-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/admin-costs-view.ts:200)

- **F8 · P3 · established · fixed** — the audit overstated sampled accuracy, owner completeness, reconciliation history, and what a balance check could prove. The admin privacy docs also said “every account” although only owners with ledger rows appear. Those claims, the report-path wording, and the unpriced-lookup scope are corrected without changing audit figures.

- **F9 · P2 · established · reporting** — the spend tripwire’s `ALLOWED` permission remains file-wide; the audit demonstrates that eight of ten evasions pass. The new `openrouter-generation.ts` entry itself is true and minimal: one free generation metadata GET, shared by the report and audit, with no inference. Closing the wider allow-list design requires changes beyond the permitted single entry.

The red-first history of the original stage cannot be established from two finished commits. This review added red-first cases for grouped-read disagreement, ambiguous provider money, malformed 200 responses, stale owner reconciliation, non-finite shading, and global React mutation.

### Independent checks with no finding

- Product scope is exactly `request` plus `job_step`; “all” includes every scope.
- Per-call median/p95/max use priced individual calls and nearest-rank percentiles.
- The article denominator is every article identity with any in-scope call, including zero/unpriced articles and excluding “no article.”
- Cache share is per task-and-wire: Messages uses input + cache read + cache write; chat uses its reported input. The headline amount is explicitly all flagged spend, not savings.
- Zero rows, one row, and all-unpriced populations behave honestly.
- The analysis uses one repeatable-read, read-only transaction and always rolls it back. A non-local effective `DATABASE_URL` is refused without `--prod`.
- `--prod` reads only `DATABASE_URL` from `.env.prod`; production Auth/service-role material is not read.
- `drizzleOver` retains the former `drizzle(connection, { schema })` options.
- `spendDetail` selects only `ai_calls`, shares the cube’s masking helpers, caps at 200,000 plus one detection row, and matches schema nullability.
- All database and commentary values are escaped. The report has no script or external request. `light-dark()` is acceptable for the current browser target.
- Pivot head/body/footer order agrees; the sticky label cells have an opaque background in both themes. The route catches only account-listing failure and logs only the error class.

### Tests and mutations

- Requested non-Postgres suites: passed.
- Main final run plus the two relevant protected suites: **11 files, 262 tests passed**.
- Spend tripwire: **36 passed**. Its Vitest worker could not spawn `git ls-files` under this sandbox, so I injected the exact read-only tracked/untracked file lists without editing the test.
- Typecheck: all four configs passed; all 3,072 source files covered.
- Touched-file lint and `git diff --check`: passed.
- Mutations killed: omitted grouping dimension, ambiguous money → zero, global React shim, non-finite shading.
- Mutation survived: reverting to one `writeSync` left all 26 report tests green; the full-write fix remains on API-contract reasoning.

### Files changed

- [docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md)
- [docs/project/admin-costs.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/admin-costs.md)
- [docs/project/admin.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/admin.md)
- [docs/project/cost-tracking.md](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/docs/project/cost-tracking.md)
- [scripts/ai-cost.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/ai-cost.ts)
- [scripts/cost-analysis-chart.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/cost-analysis-chart.ts)
- [scripts/cost-analysis-html.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/cost-analysis-html.ts)
- [scripts/cost-analysis.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/cost-analysis.ts)
- [scripts/openrouter-generation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/scripts/openrouter-generation.ts)
- [src/admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/admin.ts)
- [src/cost-analysis.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/cost-analysis.ts)
- [src/web/admin-costs-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/admin-costs-view.ts)
- [src/web/cost-charts.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/src/web/cost-charts.tsx)
- [tests/admin-costs-view.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/admin-costs-view.test.ts)
- [tests/ai-cost-cli.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/ai-cost-cli.test.ts)
- [tests/cost-analysis-cli.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/cost-analysis-cli.test.ts)
- [tests/cost-analysis-html.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/cost-analysis-html.test.ts)
- [tests/cost-analysis.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbmykvhz-admin-costs-breakdown/tests/cost-analysis.test.ts)

`VERDICT: approve`