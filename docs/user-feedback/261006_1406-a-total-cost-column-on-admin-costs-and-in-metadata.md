---
reports: spya-h2dzab
ending: shipped
---

# A total-cost column on `/admin/costs` and in Metadata

A suggestion from Greg (admin, proved against its production row by `feedback-reporter.ts`, exit
0), 2026-10-06 14:06 UTC, from `/admin/costs`, grouped by task and filtered to one article. Sentry
SPIDERYARN-READING2-DS. Queue item `qi-7jxr7pxn`.

`spya-h2dzab`:

> When displaying costs to an admin, you show per-call and number-of-calls - please add a total-cost column, both in /admin/costs and in Metadata, because that's what I care about most! That's what we should sort by, for example.

**Shipped**, in
[261006j](../plans/261006j-total-cost-column-on-admin-costs-and-metadata.md). Both tables already
held the row's total and already rested sorted by it, largest first. What they lacked was a heading
that said so: it was *Recorded amount* on `/admin/costs` and *Cost* in Metadata. Both are now
headed **Total cost**. Nothing is deferred.
