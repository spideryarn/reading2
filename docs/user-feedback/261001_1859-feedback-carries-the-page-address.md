---
reports: spya-y4upzw
ending: shipped
---
# Feedback carries the address of the page it was filed from

From Greg (admin), a suggestion filed 2026-10-01 18:59 UTC on `/admin/vouchers`. Overseer queue
`qi-dykpdksc`.

> Can you ensure that when I provide feedback using this Feedback dialog that it includes the URL
> of the page that I was on as metadata.

**Ending: Shipped**, on `dev`, not deployed. The Sentry status write is left to the next sweep: this
session ran on a pool account with no Sentry sign-in.

**It already did, and has since 2026-09-02** (commit `7a590fe58`, *"A bug report says where you were
by naming the address, not by picking from a list"*). Checked on 2026-10-03 rather than assumed:

- **Production**: 367 of 368 reports hold their address. The one that does not is `spya-us5kzc`, the
  first report ever filed, from before that commit deployed. This report's own row holds
  `https://www.spideryarn.com/admin/vouchers`.
- **Where the address goes**: the database row, the Sentry `url` tag, each card on
  `/admin/feedback`, the *Page:* line of the mail the admin gets for a reader's report, the brief an
  agent is handed, and the copy-to-email text shown when a send fails.
- **Which pages send one**: every page with a Feedback button. They all share one dialog, which
  reads the address bar when it is opened.

**What was missing, and is now built**: nowhere in the dialog showed that the address was recorded,
so there was no way to tell from where the request was written. The **Earlier** tab now says which
page each report was filed from, for example *2 days ago · Suggestion · on /admin/vouchers*.

It shows the page, not the whole address. The Earlier tab left the address out on purpose, because
an address can hold search terms or, on an import, somebody else's URL with a password in it. So
the server sends only the path of a page the app has, with no query string, and an import is just
`/add`. Anything else shows nothing. The full address is still stored, unchanged.

Also added: a test that the address sent is the page you are on when you open the box, not the
first page of the session. It was already true; nothing checked it.

Plan and the surface-by-surface table:
[261003g](../plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md). GPT Sol
reviewed the plan and the code.

Not built, and why (none of these is a missing half of the request):

- The page as a link. The label has lost its query string, so a link would not go back to where
  you were.
- A sentence on the Write tab saying the address is sent. Greg has taken a sentence out of that tab
  twice; the hover card on the button and `/privacy` already say it.

**One thing for Greg, found on the way and not changed**: the server's log line for an accepted
report writes the full address too. Logging addresses was a deliberate choice, recorded in
`src/log-redaction.ts` as fine for "a one-reader beta", and there have been other readers since
2026-09-03. It is in the Overseer's queue as a question for him.
