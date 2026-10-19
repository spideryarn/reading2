---
reports: spya-r6a5s5
ending: shipped
---

# Open the original from the command bar

Report `spya-r6a5s5` (#610, SPIDERYARN-READING2-K1), Greg (admin, provenance proved by
`feedback-reporter.ts`, exit 0), a suggestion, 2026-10-18 23:41 UTC, on an uploaded book:

> I want a way to be able to open the original from the command bar. I tried typing original into
> the command bar and didn't find anything.

**Shipped.** Typing `original` now finds **Open the original**, which opens the article's web
address in a new tab, or the uploaded PDF. What `original` used to find was the Plain mode, which
carried it as a nickname; that has been removed. On the way we also fixed a Metadata-page button
that offered an uploaded web page's file, which the server can only answer with a 404.

Plan and reviews: [261019f](../plans/261019f-open-the-original-from-the-command-bar.md).
