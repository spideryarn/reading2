---
reports: spya-zw479b, spya-dvdt7y
ending: shipped
---
# Summary opens on Brief

SPIDERYARN-READING2-8N (report `spya-zw479b`), from Greg (admin, verified by
`scripts/feedback-reporter.ts`), in production, build `4de26073`, on
`/read/jco-2005-01-libre-spya-hk9cc7?mode=summary&at=spya-uvzptt&summary=brief`. This session ran on
a pool account and could not read Sentry.

> In summary mode, default to the brief summary when it opens for the first time.

**Ending: Shipped** — on `dev`, not deployed. Resolve 8N (the next feedback sweep does the Sentry
status write).

What we did: Summary's default level is now Brief, so opening it on an article where you have not
picked a level shows Brief. Simple and Fuller are written into the address; Brief is its absence.
That view is remembered with the article, so a later bare visit opens where you left it. One thing
that moves with it: a view remembered before this change that was on Simple stored no level, so it
reopens on Brief once. [261002c](../plans/261002c-summary-opens-on-brief.md).

## A second report of the same thing (spya-dvdt7y)

Greg, 2026-10-02 12:59 UTC, on production, which did not yet have this fix:

> The Summary mode should default to Briefer sub-mode

The fix above covers it (ac466a12e), and it goes out in the next deploy. Added by the Overseer.
