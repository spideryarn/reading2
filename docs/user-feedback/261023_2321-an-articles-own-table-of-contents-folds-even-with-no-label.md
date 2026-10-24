---
reports: spya-jk0xw5
ending: shipped
comment: Shipped to dev: an article's own table of contents now folds to a "Contents" stub even when its heading was lost or never there, if its lines link to the article's later sections. This article gets it when re-read.
---
# An article's own table of contents folds, even with no label

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-23 23:21 UTC, a suggestion filed from
`/read/2025-11-02-what-if-you-dont-need-mcp-spya-ssvya4?mode=structure`. Feedback row #691, Sentry
`SPIDERYARN-READING2-NP`. Session `fbjk0xw5-article-toc`. Re-read before building and before this
note: no addenda either time.

> This is an example where the article includes a table of contents that we don't need. And so I
> feel like our import process should involve an LLM check that says, hang on, you know, either
> ignore it completely or perhaps just sort of default collapse it.

**Ending: Shipped**, on `dev`, not deployed. Plan
[261024h](../plans/261024h-an-unlabelled-contents-list-folds-like-a-labelled-one.md).

- **Folding contents was already built; this one was missed.** The front-and-back-matter step
  (2026-10-18) folds a piece's own contents list, but only from a *Contents* label. This page's
  label, `<h1 class="toc-header">Table of contents</h1>`, was removed at extraction by Readability
  (`header` is in its pattern for page furniture), so thirteen bare lines arrived with nothing to say
  what they were, and the model in the step did not spot them either.
- **Now a free rule catches it, with no model call:** three or more short lines near the top, each
  linking to one of the article's own later headings and naming it. The link is the evidence,
  which a model's guess would not be. A *Key points* list that repeats the headings has no links,
  and stays showing, as front-and-back-matter.md promises.
- **Folded, not dropped**, following your 2026-10-17 call on front matter (*"toooo extreme"* to
  skip). One faint *Contents · 13 lines* stub; press it to open in place. Search, chat and exports
  still read it. Checked in the browser on a local import of the same page.
- **This article gets the fold when re-read** (*Read this again*). The step's version moved to
  `matter/3`, so a re-read runs it again. Folds already stored stay readable meanwhile: a plain
  version bump would have taken every article's folds away until each was re-read. No backfill,
  since that would be a production write.
- **One choice you can overturn:** a contents list with no links (a PDF's, or one that paraphrases
  its headings) still needs a *Contents* label to fold. The model could be prompted to look for
  those, at the cost of a paid eval re-run. Nothing so far has needed it.
- Not this report: the header picture folded with the dateline on this article is `qi-jpj7mmhv`
  (from `fbgapqbt`, filed the same night).
