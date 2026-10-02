---
reports: spya-wdfb4h
ending: shipped
---

# Rename the Hierarchy step to Structure

SPIDERYARN-READING2-92 · Greg (admin, confirmed by `scripts/feedback-reporter.ts`) · sent from Summary
on `arxiv-2508-spya-wrzxkg`, 2026-10-01:

> In the past we had a Hierarchy mode, but we've since removed it, and kept Structure mode. My
> understanding is that Structure mode uses the data from Hierarchy mode? If that's right, then
> perhaps we should rename the Hierarchy data/import/variables/database/etc to match Structure mode
> throughout
>
> see rename-or-move.md
>
> And if you notice any other modes/import steps/UI mismatches, update those too. I might have
> already recently suggested doing this in another Feedback report, I can't remember.

**Shipped.** Pipeline stage 4's step is now `structure` in the code, the database and the docs; its
first model call is the *whole-document* pass, so the name does not collide. `?mode=hierarchy` and
the *Hierarchy* Commands keyword still open Structure. The production migration
(`drizzle/20261002140803_structure_step.sql`) needs a drained queue at deploy, which the Overseer
runs. No earlier report asked for this. Two other step names, `simple` and `arc`, are noted for
Greg rather than renamed. Plan, reviews and the full list of what moved:
[261002b](../plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md).
