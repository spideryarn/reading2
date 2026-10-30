---
reports: spya-h8cda9
ending: shipped
comment: It was the archive: nagel-bat had been archived since 11 October, and opening it counted the open but left it archived. Now opening an article you own puts it back on your shelf, once this is deployed.
---
# Opening an archived article puts it back on the shelf

Report #743, `spya-h8cda9`, Greg (admin, `feedback-reporter.ts` exit 0), a problem, 2026-10-30
19:23 UTC, from the shelf (`https://www.spideryarn.com/`, no slug), minutes after reports #741 and
#742 from *What Is It Like to Be a Bat?* (`nagel-bat`). Sentry SPIDERYARN-READING2-QD; overseer
queue item qi-r2rdarxs. No addenda when re-read before acting and before this note.

> I open an archived article. It should unarchive it. I just opened What Is It Like to Be a Bat,
> but I'm still not seeing it at the top of my shelf, so I'm assuming that that's the problem. But I
> don't know, maybe it's something else.

**Ending: Shipped** — on `dev`, not deployed.

**It was the archive, not the sort.** Read-only in production: `nagel-bat` had `archived_at`
2026-10-11 09:12 UTC and `last_opened_at` 19:23:19 on the day of the report (36 opens). Greg's most
recently opened article still on the shelf was opened at 08:37 that morning, so on **Last opened**
nagel-bat would have been first had it been on the shelf. Opening it counted the open and, by
design until now, did nothing else.

**What changed.** The open's own database write (`recordOpen`) now also clears `archived_at`. So
it applies only to the owner's page: from the shelf, from Include archived, from a link to your own
article, or from its metadata page. Never to a visitor, *view as*, chat or MCP, none of which record
an open. On the page, an Archive press made while the open is still out waits for it, so the two
cannot race. Plan:
[261030f](../plans/261030f-opening-an-archived-article-puts-it-back-on-the-shelf.md).

**Two consequences, taken as the rule you stated:**

- Archive from the masthead, then reload, and the article is back on the shelf — the reload is a
  fresh open.
- A shared article you archived to take it off `/read/public` goes back on the public list when you
  open it, as Put back already does (its tooltip says so). If you would rather an open leave a public
  article's listing alone, that is a separate switch to add; say so.

**Checks.** Tests written first and watched red: the store (`tests/store-shelf-pg.test.ts`), the
page's half (`tests/open-unarchives.test.tsx`), and the public topics refresh
(`tests/public-shelf-topics-pg.test.ts`, red with the refresh disabled). GPT Sol reviewed the plan
(it found the two races and the public-topics refresh, all fixed before building) and the code.
