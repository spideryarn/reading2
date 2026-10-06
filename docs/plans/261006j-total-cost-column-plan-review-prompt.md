# Plan review: a total-cost column on `/admin/costs` and in Metadata

You are reviewing a plan before it is built. Read-only: change no file.

Read, in this order:

1. `docs/plans/261006j-total-cost-column-on-admin-costs-and-metadata.md` — the plan.
2. `docs/project/admin-costs.md` — what the page is for and the rules its figures keep.
3. `src/web/AdminCostsPage.tsx` § `rankingColumns`, `Ranking`, and the headline `Figure`s above it.
4. `src/web/ArticleCost.tsx` — the Metadata section.
5. `tests/admin-costs-page.test.tsx` and `tests/article-cost-section.test.tsx` — two assertions are
   already written for this plan and are red on purpose.

The request, from the administrator (Greg), verbatim:

> When displaying costs to an admin, you show per-call and number-of-calls - please add a total-cost
> column, both in /admin/costs and in Metadata, because that's what I care about most! That's what
> we should sort by, for example.

The plan's claim is that both tables already hold a per-row total and already sort by it, and that
what is missing is a heading that says so. Please check that claim against the code rather than
taking it from the plan, and then answer:

1. **Is the claim true?** Is there any table or view on `/admin/costs` (ranking, pivot, over time,
   failures) or in the Metadata page's cost section where a reader sees calls and a per-call figure
   and no total for the row? Is there any state (a filter, a grouping, `then=`, a narrow window, a
   column-hiding control) in which the ranking's amount column is absent, blank or not the sort?
2. **Is renaming the heading the right fix**, against the passed-over options in the plan? In
   particular: does heading the column *Total cost* while the headline figure stays *Recorded
   amount* break a rule in `admin-costs.md` (for example "recorded amount is not cash"), or mislead?
   Is the proposed hint wording accurate?
3. **What else names this column** and would go stale: sort chips, the Columns menu, captions,
   aria labels, docs, the help page, browser tests under `tests/`, the cost-analysis script. Name
   files and lines.
4. **Anything the plan should do and does not**, kept to what this small request needs. Say plainly
   if you think the plan is too small for what was asked.

Write your findings as a numbered list, each with a severity (P1 blocks, P2 should fix, P3 note),
the file and line, and what you would do. End with one line that is exactly one of:

`VERDICT: approve` · `VERDICT: approve with changes` · `VERDICT: rework`
