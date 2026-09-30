---
reports: spya-tedd58
ending: shipped
---
# The shelf's Re-fetch and rebuild should still rebuild an uploaded article

SPIDERYARN-READING2-6B, from Greg (admin; `feedback-reporter.ts` exits 0 for the issue's user). The
time in the file name is roughly when this session got the report; it could not read Sentry for
First Seen.

> In the logged in homepage shelf, we have a button for refetch and rebuild. It seems to be disabled
> in the case of articles that have been uploaded rather than retrieved from the web, presumably
> because it can't refetch them. It *could* rebuild them though, and so I feel like that button
> should still be active - it should just skip the refetching (and perhaps indicate that in the
> tooltip).

**Ending: Shipped** — on `dev`, not deployed. Resolve 6B (the next feedback sweep does the Sentry
status write).

What we did ([260930d](../plans/260930d-shelf-rebuild-for-articles-with-no-fetchable-address.md) has
the reasoning and both GPT Sol reviews):

- With no web address, the button is now **Rebuild from the stored copy (nothing to fetch)**: the
  same job with `extract` forced instead of `fetch`, so nothing is fetched and the copy we hold is
  processed again. Its tooltip says so.
- The one case it stays unavailable: an article with no web address **and** no stored copy the
  pipeline can reuse (for example, one imported before we kept source documents). That was GPT
  Sol's catch, in both reviews; its card says why.
