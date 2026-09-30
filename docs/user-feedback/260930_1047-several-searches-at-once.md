---
reports: spya-xxt0z5
ending: shipped
---
# Several searches at once

SPIDERYARN-READING2-5V (report `spya-xxt0z5`), a suggestion from Greg (admin), in production, build
`6d09e3cc`, on `/read/dongetal25-spya-vfmvmm?mode=search`. The time in the file name is when this
session received the report; it runs on a pool account and could not read Sentry's First Seen.

> In the search mode, I want to be able to kick off multiple searches in parallel.

**Ending: Shipped** — on `dev`, not deployed. Resolve 5V (the next feedback sweep does the Sentry
status write).

What we did: the server, the client hook and `?runs=` already coped with several searches at once.
The only thing stopping a second was the Find button, which was switched off while a search ran. It
now stays on, and each search streams into its own row. One refusal is kept: asking the *same*
question again while it is still running, because the text stays in the box after Find and a second
press would pay for the same search twice.

Plan: [260930f](../plans/260930f-parallel-searches.md).
