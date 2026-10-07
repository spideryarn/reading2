# Code review, stage 2 of 261005a: the `/admin/costs` page

You are the reviewer **and the fixer**; your sandbox is write-capable in this worktree.

- **Fix what is inside this stage**, narrowly, red-first where a test can show it.
- **Report, do not fix, anything wider.**
- **Do not edit**: `tests/no-ai-cost-for-readers.test.ts`, `tests/owner-isolation.test.ts`,
  `tests/no-undeclared-spend.test.ts`, `tests/client-imports.test.ts`, the `/api/admin` gate, any
  doc under `docs/project/`, or these files, which **another agent is editing right now** for stage
  3: `scripts/cost-analysis.ts`, `scripts/openrouter-generation.ts`, `scripts/ai-cost.ts`,
  `src/cost-analysis.ts`, `src/store/ai-calls-spend-pg.ts`, `evals/cost/**`, `package.json`,
  `tests/cost-analysis*.test.ts`, `tests/store-migration-registry.ts`. If `src/cost-cube.ts` needs
  a change, make it small and additive and say so first in your answer. Run no git command that
  changes anything. Do not write a sentence attributed to Greg that is not already in the plan.
- You have no network and no Postgres. Run the three page suites yourself:
  `tests/admin-costs-page.test.tsx`, `tests/cost-charts.test.tsx`, `tests/admin-costs-view.test.ts`.

## The candidate

Commit `82c287fac` (on top of `6963e7cb2`); `git show --stat 82c287fac` lists the paths. Start with
`src/web/AdminCostsPage.tsx`, `src/web/admin-costs-view.ts`, `src/web/cost-charts.tsx`,
`src/web/useAdminCosts.ts`, then the router, loader and index edits. Context: the plan
`docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md` (§ "What GPT
Sol's plan review changed" is what the page must honour) and your stage 1 review
`docs/plans/261005a-admin-costs-stage-1-code-review-sol.md`.

The implementer's own report of where it departed from the brief: the money formatter lives in
`admin-costs-view.ts` and is built on `formatSpendNanos` because the reader-cost guard pins
`src/admin.ts`'s currency literals; the "questions" are buttons, not links; `?then=` in the address
is `thenBy` in state; the ranking uses the shared `DataTable`, the pivot is a plain table; chart
colours are assigned by alphabetical position among the keys of the whole fetched cube and repeat
past eight; the pivot keeps 8 columns plus Other and the chart 7 series plus Other; "All" draws one
bar per day with no cap; a Refresh button was added; an upstream filter reads `upstream=value:X`.
It also says one assertion (the address bar holds no `@`) was never seen red on its own.

## What I want

1. An independent attack first. Can the page show a figure that is wrong, or that reads as
   something it is not? Check every number against F6 of the plan review (recorded amount vs
   estimated cash; amount per **priced** call; settled, computed and unpriced not drawn as a
   partition; a floor when calls are unpriced). Do the pivot, the "Other" folds and the chart each
   add up to the headline under every combination of filter, scope switch and period?
2. Privacy: can an email, a slug or anything title-derived reach the address bar, the document
   title, a log line, an error message or `localStorage`? Is another owner's article ever linked?
3. State: filters, grouping, sort and period in the URL; Back and Forward; a stale response for a
   previous period landing after a newer one; a filter whose value is absent from the new period's
   data; the same dimension chosen for "group by" and "then by".
4. The chart: every day of the window present; heights proportional; colour assignment stable when
   a filter removes a series; text never in a series colour; the legend rule; accessible names;
   what a screen reader gets. It must contain no Tailwind class and reference only `CHART_TOKENS`.
5. The lazy boundary and the admin-only list: is the page absent from every reader's first
   download, and does a reader who types the address get the shelf?
6. Tests: mutate, and say which mutations stayed green. Make the "no `@` in the address" assertion
   go red on its own, or fix the test so it can.
7. Is anything in `admin-costs-view.ts` a second copy of something in `cost-cube.ts`, or better
   placed there because the analysis script will need it (`foldedPivot`, `dayPivot`, `daySeries`,
   `colourOrder`, `daysInWindow`, `scopedRows`)? Report this; move only what is plainly a duplicate.

## Severity and verdict

P0 data loss, exploitable security, incorrect charging, service broadly unusable · P1 user-visible
wrong behaviour or an authoritative contract violated · P2 design or maintainability risk · P3
prose. Every finding: an ID, a severity, **established** or **reasoned**, **fixed** or
**reporting**. End with every file you changed and `VERDICT: approve` or `VERDICT: revise` (revise
only on an established P0 or P1 you did not fix).

## My own suspicions (already mine; spend most of the run elsewhere)

- At 390px the chart's axis text may be too small to read.
- 910 lines in one page component.
