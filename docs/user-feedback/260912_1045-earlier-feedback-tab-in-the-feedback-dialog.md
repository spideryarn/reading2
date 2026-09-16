# A tab in the Feedback dialog listing what you have sent before

[SPIDERYARN-READING2-3R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3R) (2026-09-12
10:45 UTC, `kind=suggestion`), from an admin, on `temporal-context-reinstatement-spya-dhqkf9`, build
`d358f773`.

> In the feedback dialog box, it would be nice to have a tab showing previous feedback that this
> user has provided, just as a kind of list. I mean, it would be amazing if we could indicate which
> ones have been acted on, but I suspect that will involve access to the database that you
> currently don't have. So do the simplest thing first.

**Ending: Shipped** — on `dev`, not deployed. Resolve 3R.

What we did: the Feedback dialog now has two tabs, **Write** and **Earlier**. Earlier lists the
signed-in reader's own reports, newest first: the date, Problem or Suggestion if they picked one, and
what they wrote. It shows the 50 most recent and says so if there are more. It comes from a new
`GET /api/feedback`. That endpoint only returns the reader's own reports, filtered the same way as
every other read of a reader's data, so no security defence changed. It sends only those four
fields, never the email, the page address, the diagnostics or the screenshot. A draft in Write
survives a look at Earlier.
[260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md](../plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md).

**Not built: whether each report was acted on.** Greg named this as the harder later step. The
outcome of each report is recorded today only in these notes and in the Sentry issue's status,
not in the `feedback` table. The plan's § Deferred has the options. The cheapest is a status
column that Greg sets from `/admin/feedback`, which the reader's list would then show. It needs no
agent to hold production access.
