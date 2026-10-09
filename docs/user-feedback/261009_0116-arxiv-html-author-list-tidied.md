---
reports: spya-xg4jyr
ending: shipped
comment: New arXiv imports show one tidy row per author, and each name's affiliation on hover. Your Attention import is re-imported after the next deploy, as you asked.
---

# An arXiv paper's author list, tidied at import

A suggestion that reads as a bug report, from Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-09 01:16 UTC, on `arxiv-1706-03762-spya-wyt7j0`
(`?mode=structure&margin=1&learn=quiz&stop=spya-t5yvtb`). Sentry SPIDERYARN-READING2-FG. Queue item
`qi-tfx8kg3j`.

> The author import for this paper is still pretty messy. You can read it from production, maybe
> take screenshots and you'll see what I mean. I thought we were fixing this as part of the import
> process with a small model that would tidy it up?

**Ending: shipped**, on `dev`, for new imports —
[261009d](../plans/261009d-arxiv-html-title-block-tidied-at-import.md).

The small model exists but only on the PDF path, and since 2026-10-05 an arXiv link imports the HTML
rendering instead. The mess was layout: arXiv's hover pop-ups (affiliation, email, `\thanks`) drawn
inline as one fused paragraph, and Readability deleting the first short author element it took for
the byline ([postmortem 261009b](../postmortems/261009b-readability-deletes-the-element-it-takes-for-the-byline.md)).
The title block is now rewritten at import into one row per author with the notes numbered
underneath; 16 of 20 live pages, no word lost. Screenshots of a local import:
`261009d-shot-*.png`.

Not done here, each written down:

- **Affiliations on the masthead tooltip by the small model**, and **re-extracting Greg's article**
  (a production write): asked in [q-qjbb9a](questions/q-qjbb9a.md). Greg answered 1A and 2A on
  2026-10-09 (`spya-fb8y50`). 1A shipped on `dev`:
  [261009m](../plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md), about half a cent an
  import (queue item `qi-62h5hz6s`). 2A, the re-extraction of `arxiv-1706-03762-spya-wyt7j0` and
  that article only, waits for the deploy carrying 261009d and 261009m; the Overseer runs it.
- LaTeXML's body footnotes drawn mid-sentence: queued, `qi-d7g2qmze`.
- Readability's byline deletion on the shapes the rewrite refuses, and on any web page:
  queued, `qi-yhkw2ej6`.
- The fold still does not fire on this paper (the licence line comes first): the long-term answer
  is front matter marked at import, 261007d's deferral.
