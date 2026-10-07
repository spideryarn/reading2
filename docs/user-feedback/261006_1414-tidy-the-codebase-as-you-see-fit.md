---
reports: spya-p5p3qx
ending: shipped
---
# Tidy up anything in the codebase that will make future development easier

`spya-p5p3qx`, filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row, the Sentry event itself not matched), 2026-10-06 14:14 UTC, from `/admin/costs`.
Sentry `SPIDERYARN-READING2-DT`. Relayed by the Overseer to session `fbdt-improve-the-codebase`.

> When you have spare capacity, kick off some agents to tidy up anything in the codebase that you think will make future development easier as you see fit. see e.g. improve-the-codebase.md

**Ending: Shipped.** It is on `dev` and not deployed.

What we did is the sixth whole-tree sweep, in
[261006j](../plans/261006j-sixth-codebase-sweep-umbrella.md), which is where the reasoning, the
evidence and what was left all live. In short:

- **Eight clusters landed**, each built in its own worktree and reviewed by GPT Sol: the machinery
  the deleted filesystem store left behind (about 2,700 lines); false comments (and three dated
  banners on stale tutorials); dead and misplaced lint suppressions; tests that waited on a clock or
  carried guards a type could delete; a citation-counting defect, a crash on deeply nested quotes in
  a streaming chat answer, and five copies of one database mapping made one; CSS nothing used; the
  deploy's robots.txt check; and a polling bug in the fleet dashboard's readiness panel.
- **Nothing a reader sees was changed on purpose.** The one reader-facing fix is the crash.
- **The deferred half has its queue entries**, so "shipped" is honest: `qi-5n4ecycf` (nine small
  things the run turned up and did not build) and `qi-4jsgp7cn` (the decisions that are Greg's).
  Both are proposals in the Overseer's queue; the umbrella's § For Greg and § After the clusters
  have the detail.

Gates: each cluster ran typecheck and the tests it touched; one full suite ran on the first
cluster's branch and one over all eight together on `dev` (the result is in the umbrella's § Review
status).
