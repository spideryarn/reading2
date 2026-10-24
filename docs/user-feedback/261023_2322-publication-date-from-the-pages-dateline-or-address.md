---
reports: spya-gapqbt
addenda: spya-hdxhsx
ending: shipped
comment: Shipped to dev: a page with no date tag now takes its date from the line under its title, or else its address, and the masthead shows it after a re-read. The fold hiding the header image is queued.
---
# Publication date from the page's dateline or its address

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-23 23:22 UTC, a suggestion filed from
`/read/2025-11-02-what-if-you-dont-need-mcp-spya-ssvya4`, build db758ed8. Feedback row #692.
Session `fbgapqbt-publication-date-from-the-page`. Re-read before building and before this note:
one addendum, the same both times.

> Why doesn't this show an estimated publication date? You know, as part of the import process, I
> thought we had an LLM that does this kind of thing, and it should be obvious from the publication
> slug in the URL, for example, what the publication date is. So that should be part of our import
> process.

Addendum `spya-hdxhsx`, a minute later:

> Hmm, hang on. So there does look to be some kind of collapsed title and publication details thing
> at the top of the article, which I hadn't seen. I can't really tell what that is or where it's
> coming from, and it has an image inside it. But it does seem to have some kind of date. So I was
> expecting the date, though, to be more prominently at the top with the other metadata. So maybe
> this is partly just a UI issue. I'm not really sure what's happening.

**Ending: Shipped**, on `dev`, not deployed. Plan
[261024a](../plans/261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address.md).

- **It was the import, not the masthead.** The masthead already prints *Published …* when a date is
  stored; nothing was stored, because this page has no date tag and no model estimates one. Stage 2
  now reads the line printed under the page's `<h1>` when it is a date and nothing else, and
  failing that, after the Crossref/DataCite lookup, the day at the start of an address segment
  (`/2025-11-02-…`, `/2025/11/02/`). No model, no cost.
- **This article gets *Published 2 Nov 2025* when it is re-read** (*Read this again*). There is no
  backfill of articles already imported; that would be a production write.
- **The fold** is the front-matter step, which read the dateline and the header picture as title
  paperwork. Folding a captioned picture is a bug in its evidence check, and fixing it means
  re-running the three-set eval, so it is queued as `qi-jpj7mmhv` rather than done here. Until
  then this article's header image stays folded with its dateline.
- **Two choices you can overturn:** a day read off the address shows as plain *Published*, not
  *Estimated* (a separate label would need a new stored field); and a Medium-style
  `Author · date · 8 min read` line is not read yet, to keep the dateline rule strict.
