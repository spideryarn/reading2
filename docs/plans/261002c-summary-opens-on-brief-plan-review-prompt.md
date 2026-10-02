You are reviewing a small plan in the Spideryarn repo (this checkout). Read-only.

Plan: docs/plans/261002c-summary-opens-on-brief.md — make Summary mode's plain-words level default to `brief` instead of `simple` (src/web/params.ts § summaryParam, src/web/sub-modes.ts § subModeParams).

Please check, by reading the code rather than trusting the plan:
1. Every place that assumes `simple` is the default/absent level for `?summary=` (client, server-rendered or public/visitor pages, last-view restore, command bar sub-mode rows, link builders, tests, docs). List each with file:line and whether the plan covers it.
2. Whether "opens for the first time" is really satisfied by last-view restoring `?summary=` — trace last-view.ts and confirm a chosen level survives and that an article with no remembered level shows the default.
3. Anything about armActivation / useAutoRun / the `simple` job (src/simple-summary.ts FIRST_LEVEL = fuller) that would make Brief a worse first view (e.g. Brief stored or streamed later than the others, a loading state keyed to `simple`).
4. Anything simpler, or any risk the plan names wrongly.
Give findings as P0/P1/P2 with file:line evidence, then a one-line verdict.
