---
reports: spya-a4xsg3
ending: shipped
---
# A spinner while the shelf's topics load

[SPIDERYARN-READING2-76](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-76), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), sent from the signed-in shelf
at `https://www.spideryarn.com/`, build `a522ba8c`; overseer queue entry `qi-ysm9jwc6`. The time in
the file name is when this session picked the report up. It ran on a pool account with no Sentry
access, so the next feedback sweep does the Sentry write from this note.

> On the logged in homepage, there's a delay while the topic-pills load. That's fine, but let's show
> some kind of loading spinner in their place while they're loading.

**Ending: Shipped.** On `dev`, not deployed. Resolve 76.

## What we did

Until the topics answer arrives, the row's place now holds the "Topics" label, the app's one spinner
and the words *"Loading topics…"*, followed by faint outline pills in the shape of the row to come,
which wrap as the real pills will, so the cards move much less when the pills land. Before the
answer the client cannot know which article rows are exact copies or how many topics will survive,
so the reserve is deliberately approximate. A failed request draws nothing rather than spinning
for ever, and while the archive list is still loading its own *"Loading archived…"* line says the
wait instead of a second row.

The plan and both GPT Sol reviews:
[260930j](../plans/260930j-shelf-topics-loading-spinner.md).
