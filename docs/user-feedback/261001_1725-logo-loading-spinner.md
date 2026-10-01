---
reports: spya-ns2v83
ending: shipped
---
# The wordmark as the article's loading spinner

[SPIDERYARN-READING2-8Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-8Y), a suggestion
from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0 — the row, not the Sentry
event, which had no recorded event id), sent from a reading view at
`https://www.spideryarn.com/read/arxiv-2508-spya-wrzxkg?mode=trajectory&…`, build `43be719b`.

> Instead of "Fetching the article and its summaries", show an animated loading spinner.
>
> Perhaps actually it would be fun to make a rich, complex, fun, ever-morphing animation of the logo
> itself as the loading spinner?
>
> Update loading-spinner.md and signpost to it.

**Ending: Shipped.** On `dev` in `7e8f28739`, `809864cad` and `d6cd145f9` (merged at `d7d5dcf2f`), not deployed. Resolve 8Y.

## What we did

After the same 600ms as before, the article page now draws the wordmark large and centred, running
two of its existing hover animations at once — one on the spider, one on the letters — each redrawn
for whole loops of itself and out of step with the other. No new animation: it reuses the thirteen
(nine of them; four are left out with reasons). Reduced motion keeps the old sentence; a screen
reader gets it as hidden text. [`loading-spinner.md`](../project/loading-spinner.md) is new, under
design-css-overview.md, and says which of the app's two spinners a wait gets.
[The plan](../plans/261001q-logo-loading-spinner.md), revised after GPT Sol's review.
