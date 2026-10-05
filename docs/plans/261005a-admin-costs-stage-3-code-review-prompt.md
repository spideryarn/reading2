# Code review, stages 3–5 of 261005a: the cost analysis, its report, the audit, the docs

You are the reviewer **and the fixer**; your sandbox is write-capable in this worktree. Nobody
else is editing the tree during this run.

- **Fix what is inside these stages**, narrowly, red-first where a test can show it.
- **Report, do not fix, anything wider.**
- **Do not edit**: `tests/owner-isolation.test.ts`, `tests/no-ai-cost-for-readers.test.ts`,
  `tests/client-imports.test.ts`, the `/api/admin` gate. In `tests/no-undeclared-spend.test.ts`
  you may correct the one `ALLOWED` entry this work added and nothing else. Docs: you may correct
  the docs this work touched (listed below) where they disagree with the code; **never write a
  sentence attributed to Greg that is not already quoted in the plan**, and do not change a
  number in the audit unless you can show from the tree that it is wrong (you cannot reach
  production or OpenRouter). Run no git command that changes anything.
- You have no network and no Postgres. Run the suites that need neither:
  `tests/cost-analysis.test.ts`, `tests/cost-analysis-html.test.ts`,
  `tests/cost-analysis-cli.test.ts`, `tests/ai-cost-cli.test.ts`, `tests/no-undeclared-spend.test.ts`,
  `tests/doc-links.test.ts`, the three page suites and `tests/admin-costs-route.test.ts`. The
  Postgres suites (`tests/cost-detail-store.test.ts`, `tests/admin-costs-store.test.ts`) are mine;
  my last run of fourteen files including both was 317 tests passed, at commit `dae38bb9b`.

## The candidate

Two commits on top of `cf95bbaf7`:

- `ee4f0e9fc` — page follow-ups after the browser pass: pivot Total column beside a sticky row
  label, the ranking leading with the amount, one-hue pivot shading (`shadeAlpha`), and the route
  answering with `emailsAvailable: false` when the account listing fails.
- `dae38bb9b` — `src/cost-analysis.ts`, `scripts/cost-analysis.ts`, `scripts/cost-analysis-html.ts`,
  `scripts/cost-analysis-chart.ts`, `scripts/openrouter-generation.ts`; `spendDetail` and the `db`
  parameter in `src/store/ai-calls-spend-pg.ts`; `drizzleOver` in `src/db/client.ts`; the reconcile
  caveat in `scripts/ai-cost.ts`; `evals/cost/audit-261005/**`; the four new test files; and the
  docs: `docs/project/admin-costs.md` (new), `docs/project/cost-tracking.md`, `docs/project/admin.md`,
  `docs/project/mode.md`, `docs/project/architecture.md`, `AGENTS.md` (one signpost line each for
  the last two), and `docs/investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md`.

`git show --stat <sha>` lists every path. The plan is
`docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md`; your
earlier reviews are beside it.

Evidence from the real run (production, read-only, by the implementer; the report files are not
in git because they hold production figures): 2,245 calls; credits 84,793,839,211 nanos; BYOK
4,982,297,420; computed 1,028,351,620 — equal to the audit's independent raw sums to the nano.
Unpriced lookup: 281 asked, 280 matched, 1 no record; known shortfall $2.11, equal to the audit's
census. Leads: cache (suggestive) $48.50 over 8 task-wire pairs; articles ≥5× median, 3 of 60;
a step bought in more than one job, 60 of 405 article-steps, $12.33 on all but the dearest job of
each; single calls ≥10× their task's median, 14.

## What I want

1. **An independent attack on the analysis first.** Is any answer or lead wrong, or worded as more
   than was measured? Check each lead's fold against its sentence. Check the product-scope filter,
   the per-call median/p95/max, the "N× the median article" comparison (which articles are in the
   denominator?), the cache share per wire, and what happens with zero rows, one row, all unpriced.
   Does `assertReadsAgree` compare the same population on both sides?
2. **The database path.** Can `scripts/cost-analysis.ts` write to, or run outside a read-only
   transaction on, any database? Is a non-local `DATABASE_URL` without `--prod` really refused?
   Does `--prod` take anything from `.env.prod` but the database address? (It briefly read the
   service-role key to list emails; that was removed. Confirm nothing of it is left.) Is
   `drizzleOver` identical in options to what `getDb()` used before, so production behaviour of
   the app is unchanged?
3. **`spendDetail`**: the masking shared with `spendCube`; that no other owner's slug can leave;
   the cap; column nullability; that it selects from `ai_calls` only.
4. **The report file**: escaping of every database value and of the commentary (attack the
   Markdown converter), mode `0600` and atomic write, no script, no external request, `light-dark()`
   CSS (acceptable for a file Greg opens in a current browser?), and the chart shim in
   `scripts/cost-analysis-chart.ts` (it sets `globalThis.React` and loads `cost-charts.tsx` by
   computed path — is there a simpler honest way, e.g. a JSX-runtime pragma in that one file?).
5. **`scripts/openrouter-generation.ts`** and its `ALLOWED` entry: is the entry true and minimal;
   can a failed lookup ever be read as a zero cost?
6. **The page follow-ups** (`ee4f0e9fc`): the sticky column's opacity in both themes, column order
   in head, body and totals rows, `shadeAlpha` edge cases, and the route fallback (does it swallow
   anything but the listing failure? is the log line free of anything sensitive?).
7. **The audit and the docs.** Read `docs/investigations/261005a-…md` as a sceptic: is any
   conclusion stronger than its evidence, is "established" used where a premise is inferred, does
   the verdict follow? Check `docs/project/admin-costs.md`, and the edits to `cost-tracking.md`,
   `admin.md` and `mode.md`, sentence by sentence against the code: every claim true, every link
   and anchor resolving, nothing restating what another doc owns. `admin.md`'s privacy rule changed
   in wording because the page widened what the administrator sees; is the new wording exactly
   what the code does, no more?
8. **Tests**: mutate, and say what stayed green.

## Severity and verdict

P0 data loss, exploitable security, incorrect charging, service broadly unusable · P1 user-visible
wrong behaviour or an authoritative contract violated · P2 design or maintainability risk · P3
prose. Every finding: an ID, a severity, **established** or **reasoned**, **fixed** or
**reporting**. End with every file you changed and `VERDICT: approve` or `VERDICT: revise` (revise
only on an established P0 or P1 you did not fix).

## My own suspicions (already mine; spend most of the run elsewhere)

- The cache lead's headline amount ($48.50) is the flagged tasks' whole spend and may read as a saving.
- `scripts/cost-analysis.ts` imports `formatCostNanos` from `src/web/admin-costs-view.ts`, a
  server script reaching into the client directory.
- The implementer did not write most of the stage 3 tests red-first.
