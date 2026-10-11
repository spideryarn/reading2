---
reports: none
ending: shipped
comment: Referee's Claims chip is now Promises, all the way down. Criteria's starters now wait until you have written a criterion of your own, and there is a new group, Worth a second look.
---
# Referee's Claims become Promises, and the starter criteria wait for the referee's own

Not from a reader, so there is no Sentry id. Built from Greg's answer to
[q-fkq30v](questions/q-fkq30v.md) parts 1 and 4 (reply `spya-dbfeqh`, 2026-10-10), Overseer queue
item `qi-2dxtedww`, session `fbh5aypq-referee-promises-starters`:

> 1B
> 2A
> 3B
> 4 all? Use your judgment based on that combination of ease and value.

This entry is 1B and 4A. 2A and 3B needed no work. 4D shipped separately as Referee › Notes
([261011_0253](261011_0253-referee-notes-sorted-major-and-minor.md)); 4B and 4C have their own queue
entries.

**Ending: Shipped**, to `dev`, not deployed. Plan
[261011g](../plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md).
GPT Sol reviewed the plan (BUILD WITH CHANGES: six findings, five taken, one overruled) and then the
code (LAND AFTER FIXES, which it made).

- **1B, Claims → Promises.** The chip, `?referee=promises` (an old `?referee=claims` link, Back and a
  remembered last view all land on it), files, types, the route, the model job (old cost rows still
  count under it), the CSS, the export file, help and docs. The table is renamed `referee_promises`
  in place, and a `referee_claims` view keeps the old code working during the deploy. The
  view's removal is drafted for the Overseer to file once the deploy is live
  ([261011g-contract-queue-item.md](../plans/261011g-contract-queue-item.md)). Sources' Claims, and
  the model prompt's own word "claims", are unchanged.
- **4A, starters after the referee's own.** Criteria already had six presets from referee forms, and
  they showed from the first visit, which is the anchoring the research warned about. Now no starter
  shows until the referee has pressed Run on a criterion of their own words. After that the starters
  stay, even if that criterion is deleted. They come in two labelled groups: the existing *From
  referee forms*, and a new *Worth a second look* (Conclusions, Abstract and results, Numbers,
  Sample size, Limitations). A starter fills the box; nothing runs without a press.
- **What could not be checked.** The planted-error study's own table of the nine errors could not be
  read (PMC served a captcha; bmj.com and SAGE refused). So the new group cites the study only for
  the overall finding (reviewers found fewer than three of nine), not as the source of these five.
  An "Allocation" starter was dropped, because the same research says biased randomisation was one
  of the errors reviewers caught *best*.
- **Accepted on purpose.** A Referee tab left open across the deploy shows a load error on Promises
  until it is reloaded. Nothing stored is lost. Referee is behind the experimental switch, and
  keeping the old route alive for one deploy would have meant translating every streamed frame.
