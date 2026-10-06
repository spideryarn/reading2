---
reports: spya-mvmpks
ending: shipped
parts: 3
---
# Remember becomes Learn: the code's own names (part 2 of 3)

`spya-mvmpks`, from Greg (admin; `scripts/feedback-reporter.ts --report-id spya-mvmpks` exited 0),
filed 2026-10-05 07:48 UTC. SPIDERYARN-READING2-DG; Overseer queue item `qi-dabpymjd`.

**This note is part 2 of the report's 3.** Part 1,
[261005_0748-remember-becomes-learn-and-explore-covers-critiques.md](261005_0748-remember-becomes-learn-and-explore-covers-critiques.md),
quotes the whole report. The half this note answers:

> So remember mode is learn mode

**Ending (part 2): Shipped**, on `dev`, in `8c36c5caa` and the commits after it. Plan
[261006a](../plans/261006a-remember-identifiers-become-learn-all-the-way-down.md).

Part 1 changed the words a reader sees and left the code saying `remember`. Greg approved the
deeper rename on 2026-10-06, and it is now the rule in
[rename-or-move.md](../reusable/rename-or-move.md). The mode id, `?mode=learn`, `?learn=`, the
stored thread kind (by a migration) and the identifiers all say `learn`. `?mode=remember` still
opens the mode; an old `?remember=quiz` opens it at Recall.

This note was written on 2026-10-06 by the session that did part 3, because the session that built
this part wrote none, and a report in three parts reads as unfinished until it has three notes
(`scripts/feedback-endings.ts` § `combineEndings`).
