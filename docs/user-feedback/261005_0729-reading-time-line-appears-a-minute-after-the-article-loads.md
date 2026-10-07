---
reports: spya-dxufdw
ending: shipped
comment: You chose A on 2026-10-05: reading time came out from behind Experimental features, for every owner. A switch to turn it off and a way to erase it are not built yet.
---
# The reading-time line appears about a minute after the article loads

Report `spya-dxufdw` (SPIDERYARN-READING2-DB, Sentry confirmed), filed as a suggestion, from Greg
(admin), 2026-10-05 07:29 UTC, from the home page, relayed by the Overseer (`qi-73z36z3g`):

> For some reason, it didn't show the reading level line in the spine until about a minute after I
> loaded the article. It would be useful to see it immediately after I've loaded the article,
> because when I first load it, I want to be able to jump to where I haven't read.

"Reading level line" was taken to mean the reading-time chart down the spine, and the investigation
found nothing to say otherwise.

**Ending: Shipped.** Greg chose A on 2026-10-05, and reading time now appears for every owner
without Experimental features. A control to turn it off and a way to erase stored totals remain
unbuilt. Plan:
[261005g](../plans/261005g-reading-time-line-waits-on-the-experimental-switch-not-on-a-timer.md).

## What we found

No timer or drawing delay that matches. Production's request log for that session shows the article
loading at 07:24:48 without asking for reading time at all, which is what Experimental features
being **off** looks like; a settings write at 07:26:46 with the first reading-time request 25 ms
behind it, which is what switching it on looks like; and a second write at 07:37:26, after which
the row says off, as it does now. The log does not record what a write said, so this is a strong
inference rather than a reading; the plan says what it does not exclude. On a local server with
the switch on, the line is drawn within a second and a half of the page asking for it, on every
way of arriving we tried.

So, most likely, the line was not late. It is an Experimental feature, and it arrived with the
switch. While the switch is off nothing is recorded either.

## What Greg decided

Greg chose A: all of reading time came out from behind the switch, so the line is there on every
owner's load and the record has no holes from times the switch was off. The four options and the
change that landed are in
[the plan](../plans/261005g-reading-time-line-waits-on-the-experimental-switch-not-on-a-timer.md#questions-for-greg).
