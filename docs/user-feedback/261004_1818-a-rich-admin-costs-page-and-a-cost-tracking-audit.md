---
reports: spya-mykvhz
ending: shipped
---

# A rich `/admin/costs`, a cost analysis an agent can run, and a cost-tracking audit

A suggestion from Greg (admin, proved against its production row by `feedback-reporter.ts`, exit
0), 2026-10-04 18:18 UTC, from `/changelog`. Sentry SPIDERYARN-READING2-CY. Queue item
`qi-mfjmxd8a`.

`spya-mykvhz`:

> Create a rich /admin/costs that breaks down by user (and then within user, by article) or mode or model. Ideally in a couple of forms, e.g. table and pivot table and/or graph.
>
> Think through the kinds of questions I'm likely to want to ask, e.g. which users are spending the most money, why is this article costing so much money, why is this mode costing so much money, etc.
>
> Probably I'm going to occasionally ask you to do the analysis and make suggestions about inefficiencies and improvements re costs, so try and also think about how to make that kind of analysis as easy as possible. And then try running that analysis, and generate a nice HTML report for me and open it in a browser.
>
> see docs/reusable/third-party-library-selection.md for the graphing, tables, etc
>
> Update docs etc.
>
> While you're at it, check that our cost-tracking machinery is accurate and complete, and that we have good docs/reusable machinery so that new modes and functionality will always get cost-tracked.
>
> Get input and review from GPT Sol, use engineering-manager.

**Shipped**, in
[261005a](../plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md):

- **`/admin/costs`** — a ranking table, a pivot and a chart per day over one breakdown of the
  ledger, with drill-down from user to article to mode to model.
  [admin-costs.md](../project/admin-costs.md).
- **`npm run cost:analyse`** — the same figures for an agent, with leads and an HTML report. Run
  once against production, read-only, with suggestions; the report is on the box under
  `logs/cost-reports/`, not in git.
- **The audit** —
  [261005a](../investigations/261005a-cost-tracking-audit-accuracy-and-completeness.md): what the
  ledger records matches OpenRouter to the nano-dollar; it is short by a known $2.11 of $90.80.

Other readers' articles are shown by opaque id, not by slug; that and five smaller questions are
for Greg in the plan's § Questions. Eight deferred parts are queued, listed in the plan's
§ Deferred.
