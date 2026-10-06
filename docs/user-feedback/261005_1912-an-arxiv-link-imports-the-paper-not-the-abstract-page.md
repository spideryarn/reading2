---
reports: spya-ayettj
ending: shipped
parts: 2
---

# An arXiv link imports the paper, not the abstract page

Report `spya-ayettj`, from Greg (an admin; `scripts/feedback-reporter.ts --report-id spya-ayettj`
exited 0 on the production row and matched the Sentry event), filed 2026-10-05 19:12 UTC from
`2605-20355v1-spya-ygtwkz`; Sentry SPIDERYARN-READING2-DH; relayed by the Overseer as queue entry
`qi-jqtexyzq` to session `fbayettj-arxiv-link-imports-paper`. A suggestion.

**This note is part 1 of the report's 2**: arXiv. Part 2, the other paper sources, is queue entry
`qi-5m89dnxa` and session `fbayettj-other-paper-sources`, and writes its own note.

> If I include a link like this, the right move is to grab either the html or the pdf, rather than
> reading in this exact link.
>
> https://arxiv.org/abs/2608.13566?utm_campaign=ai-tinkerers__paperclub__join-our-paper-club-with-jetbrains-research-the-benchmark-trap-does-coding-benchmark-performance-generalize&utm_content=link1&utm_medium=ai-tinkerers&utm_source=paperclub
>
> 1) run evals to figure out whether html or pdf is better. Then even if someone gives us a link like
> this, automatically download the actual paper (either html or pdf as you decide). Arxiv is a common
> source, so it would be nice to optimise the import for it to be correct. And ideally to make it
> cost-efficient/quick.
>
> 2) and use web research to longlist and prioritise and optimise a lot of other common likely sources
> (like Arxiv) for other kinds of papers that we should create import optimisations for.

**Ending (part 1): Shipped**, on `dev`. Plan
[261005l](../plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md);
the eval is
[261005e](../investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md).

**What was wrong.** That link imported arXiv's abstract page: 304 words under the paper's title.

**What happens now.** An arXiv link of any shape (abstract page, PDF, HTML, an old-style id, with
or without a version, with tracking parameters, or arXiv's own DOI) imports the paper. It takes
arXiv's HTML rendering when there is one and the PDF when there is not, and every shape of the link
is one article on the shelf.

**What the eval said.** Six real papers through both of our extractors, judged against the paper.
HTML costs nothing to read and takes seconds; the PDF costs about ten cents and two minutes. On
correctness the first run split three to two for HTML, and both PDF wins came from faults in our
own web extractor: aligned equations in fragments, plots with no picture, the wrong byline. Those
were fixed, and on the re-run all five papers that have an HTML version were preferred as HTML.
The eval spent $0.62.

**Known and left**, all in 261005e: arXiv's own converter sometimes drops a figure and nothing in
its HTML says so (one of 18 in the sample); five equation groups in one paper still read as
fragments; the author block under the title is one long paragraph.

**Waiting on Greg, not blocking**, in the plan's § Questions and decisions: the source link on an
arXiv article opens arXiv's HTML (or PDF), not the abstract page. Showing the abstract page needs
a new column on the article's revision.

**Also fixed on the way**, found by GPT Sol reviewing this work and older than it: a race in the
import queue that could make two articles for one address and charge for both (plan § Reviews,
F14).

An article already imported from an abstract-page link stays an abstract until it is refreshed.
