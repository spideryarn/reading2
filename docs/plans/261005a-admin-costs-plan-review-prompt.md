# Plan review: `/admin/costs`, a cost analysis an agent can run, and a cost-tracking audit

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

One untracked file in this worktree (base `9a6b51b3e` on `dev`, nothing else changed):

- `docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md`

It quotes the request it answers (an admin's feedback report, trusted input).

## What to read to judge it

Start here; this does not limit scope.

- `docs/project/cost-tracking.md`, `docs/project/admin.md` (§ What it deliberately does not show,
  § The spend column, § One article's cost), `docs/project/security-map.md`
- `src/store/ai-calls-spend-pg.ts` (the existing cross-owner aggregates and their rules),
  `src/cost-categories.ts`, `src/cost-report.ts`, `src/db/schema.ts` § `aiCalls`
- `src/routes.ts` § the `/api/admin` namespace gate and the existing admin rows
- `src/web/ArticleCost.tsx`, `src/web/AdminPage.tsx`, `src/web/lib/DataTable.tsx`
- `tests/owner-isolation.test.ts`, `tests/no-ai-cost-for-readers.test.ts`,
  `tests/no-undeclared-spend.test.ts`
- `scripts/ai-cost.ts`, `scripts/feedback-reporter.ts` § `productionClient`
- `docs/reusable/third-party-library-selection.md`

## What I want from you

1. **An independent attack on the plan first.** Is the cube the right seam? What would be wrong,
   misleading or unsafe in what it would produce? What is missing for the questions Greg says he
   will ask ("which users are spending the most", "why is this article costing so much", "why is
   this mode costing so much"), and for an agent later asked to find inefficiencies?
2. **The arithmetic and the semantics.** Which sums over the cube are meaningless or misleading
   (the two wires count input tokens differently; `duration_ms` has documented traps in
   ai-gateway.md; unpriced and settled are not disjoint; credits are not cash)? Say exactly which
   columns the cube should and should not carry, and what the page must label.
3. **Security and privacy.** Does anything here weaken a listed defence, or put a cost figure or a
   cross-owner fact where a non-admin could reach it? Is the plan's reading of the article-naming
   question ([Q-1]) fair, and is its default defensible?
4. **The audit design.** Is each check really independent of the thing it checks? What would you add
   to establish that the ledger is accurate and complete, and that new work cannot ship untracked?
5. **Scope.** What should be cut from v1, and what is deferred that should not be?
6. **The library choice** for charts and the pivot: is hand-written SVG the right call, given the
   static HTML report?

## Severity, and what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (`F1`, `F2`, …), a severity, and whether it is **established** (direct
evidence in the tree, cite file and line) or **reasoned**. End with one line: `VERDICT: approve` or
`VERDICT: revise`, refusing only on an established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Grouping by `requested_model` may hide that a different model answered.
- `modeOf` for request-scope jobs (chat, explain, dig-deeper, the citation jobs) may not map to
  what a reader would call a mode.
- Production's ledger names only two owners, which is either true or a sign of mis-attribution.
