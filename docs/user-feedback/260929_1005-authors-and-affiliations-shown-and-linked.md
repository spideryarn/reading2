# Authors and affiliations: extracted at import, cleaned, shown and linked

SPIDERYARN-READING2-4J, from Greg (admin), in production, build `cba650a3`, on
`/read/arxiv-2212-spya-u5293w?mode=glossary`. Overseer queue `qi-pvvfjq67`. The time in the file name
is roughly when this session received the report; it could not read Sentry.

> When we import, try and extract out author names and other metadata (e.g. affiliations). At the
> very least, display them in the Metadata section. If you can also see a good way to display them at
> the top of the article, that would be nice. Note: they often seem to get mis-transcribed (e.g. the
> footnotes get shown as numbers after the name (e.g. "Smith1") - it would be great if we could clean
> this up at the same time. And for extra points, we'd add rich tooltips (as per tooltips.md) to the
> author name, and clicking it would somehow take us to a list (e.g. a filtered list on the
> homepage-shelf) of other stuff by that article.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4J (the next feedback sweep does the Sentry
status write).

What we did: every newly imported or reset article now keeps its authors as a list, each with the affiliations the source
declares — a web page's `citation_author_institution` tags, or, for a PDF, the names and affiliations
on the front page with the footnote markers cut off (which is the "Smith1" fix). The masthead shows
the names one at a time, each with a card of its affiliations, and a click opens the shelf searched
for that author. The Metadata page has an Authors section. Existing articles pick this up when they
are reset from the Metadata page; visitors to a shared article still see the byline string, for a
reason the plan gives. A PDF's own first page, in the body of the article, still shows its byline
as printed, markers and all — that is the transcription of the page, and hiding it is named in the
plan as the next step.

Plan: [260929d](../plans/260929d-authors-and-affiliations-at-import-shown-and-linked.md).
