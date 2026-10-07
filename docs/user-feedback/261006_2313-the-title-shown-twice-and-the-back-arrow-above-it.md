---
reports: spya-t6cdve, spya-us7e4v
ending: shipped
---

# The title was shown twice, and the back arrow above it

Two reports from Greg (admin; `feedback-reporter.ts` exit 0 on each production row), a minute
apart on `2608-13566v1-spya-yurten`, `?summary=fuller&stop=spya-gs7srt`. Queue item `qi-kprswh5n`.

`spya-t6cdve`, a problem, 2026-10-06 23:13 UTC, Sentry SPIDERYARN-READING2-EF:

> Why does this article seem to show the title twice on the page?

`spya-us7e4v`, a suggestion, 2026-10-06 23:14 UTC, Sentry SPIDERYARN-READING2-EG:

> Don't bother showing back arrow to the Shelf at the top. We have the Spideryarn logo for that.

**Shipped**, both, in
[261007b](../plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md).

- **The title.** It was every article, not this one. Stage 2 wrapped each web article in a page
  with a heading and a `~N min read` line of our own, stage 3 turned that header into the
  article's first two blocks, and the masthead drew the title again above them. New web imports no
  longer get the header. For the articles that already have it, and for a PDF whose first heading
  says exactly what the masthead says, the reading view no longer draws those rows. A renamed
  article keeps the author's heading. The class is in the
  [postmortem](../postmortems/261007b-a-page-wrapped-for-a-person-became-the-next-stage-s-input.md).
- **The arrow.** Gone from the masthead, for an owner and for a visitor. The Spideryarn mark at
  the left of the bottom bar goes to the same place.

**Deferred, as queue entry `qi-tjb2xjmj`:** rebuilding the existing web articles so the header is gone
from their blocks and from what the models read, not only from the page. It is paid model work on
every article and a write to production, so it waits on Greg.
