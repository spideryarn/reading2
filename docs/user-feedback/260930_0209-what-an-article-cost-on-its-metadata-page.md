---
reports: spya-szx49j
ending: shipped
---
# What an article cost, on its metadata page

SPIDERYARN-READING2-68, from Greg (admin — `scripts/feedback-reporter.ts` exits 0 for the issue's
user id), in production, on `/read/dongetal25-spya-vfmvmm/metadata`.

> In the metadata mode for admin users, can you include a section that shows cost estimates as best
> as we can calculate them, total for the article and also broken down by modes or whatever. If that
> means that we also need to upgrade our cost tracking machinery somehow, let's try and do that as
> well. Hopefully using kind of reusable machinery and updating our docs so that going forwards all
> new AI processing automatically has its costs tracked, just as hopefully all new modes
> automatically get, you know, tracked in the metadata and added to the commands. So there should be
> a new mode document and also an AI cost tracking document or something like that, so that going
> forwards we're just doing a good job of cost tracking. And maybe that needs tests. I'd be fine to
> have a bunch of tests that don't usually run because they actually do incur costs (using our API
> keys somehow) that then get tracked & checked.

**Ending: Shipped** — on `dev`, not deployed (it carries an additive migration, an index).

What we did:

- **A *What it cost* section on the metadata page**, for the administrator on their own articles:
  the total, a line per mode (step or job), and plain lines saying when the total is only a floor
  (calls with no reported cost, live conversations that never reported, failed calls), and that the
  5.5% cash uplift applies to the OpenRouter-credits part only.
- **Attribution by default.** Every API route now has to say where its article is. Routes with the
  slug in the path get their spend put on that article's figure automatically; the two that had been
  missed (link-preview summaries and dictation) are fixed.
- **`npm run test:paid`**: three tiny real calls, checked through the ledger rows and the admin
  query. About $0.00008 a run; $0.000324 spent in total while building it.
- **[cost-tracking.md](../project/cost-tracking.md)** is the new doc, and
  [new-mode.md § Its cost](../project/new-mode.md#its-cost) says what a new mode needs (nothing, if
  it runs as a step).

**For Greg, one decision:** the section shows only your own articles, because the admin pages
don't follow identifiers into other people's articles. Showing it on anybody's article is a
one-line change, and it widens that boundary.

Plan: [260930f](../plans/260930f-article-cost-on-the-metadata-page.md).
