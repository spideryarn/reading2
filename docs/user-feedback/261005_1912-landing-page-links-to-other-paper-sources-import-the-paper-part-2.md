---
reports: spya-ayettj
ending: shipped
parts: 2
---

# A landing-page link to a paper imports the paper: the other sources

Report `spya-ayettj`, from Greg (an admin; `scripts/feedback-reporter.ts --report-id spya-ayettj`
exited 0 on the production row and matched the Sentry event), filed 2026-10-05 19:12 UTC; Sentry
SPIDERYARN-READING2-DH; relayed by the Overseer as queue entry `qi-5m89dnxa` to session
`fbayettj-other-paper-sources`. A suggestion.

**This note is part 2 of the report's 2**: the sources other than arXiv. Part 1 is
[261005_1912-an-arxiv-link-imports-the-paper-not-the-abstract-page.md](261005_1912-an-arxiv-link-imports-the-paper-not-the-abstract-page.md),
which quotes the whole report. The half this note answers:

> 2) and use web research to longlist and prioritise and optimise a lot of other common likely sources
> (like Arxiv) for other kinds of papers that we should create import optimisations for.

**Ending (part 2): Shipped**, on `dev`. Plan
[261005m](../plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md); the
longlist, the measurements and the ranking are
[261005e](../research/261005e-where-a-reader-s-paper-link-points-the-other-sources-measured-and-ranked.md).

**What was found.** 45 places a paper link points, each fetched through our own fetcher and
extractor. A landing page imports as a few hundred words under the paper's title, with no error.
Thirteen publishers and preprint servers refuse us whichever address we ask for; four big
open-access publishers need nothing, because their landing page is the paper.

**What happens now.** For seven sources, the ones AI readers paste, the link imports the paper:

- a **Hugging Face paper page** or an **alphaXiv** page is the arXiv paper it is about, the same
  article as the arXiv link;
- an **ACL Anthology**, **PMLR** (ICML, AISTATS), **NeurIPS proceedings**, **CVF Open Access**
  (CVPR, ICCV) or **JMLR** landing page fetches the paper's PDF, and the landing page and the PDF's
  own address are one article.

Where a paper is not where its site usually keeps it, the import fails with a sentence of its own
(`[fetch-paper-missing]`), written without Greg and recorded in the plan as his to change.

**Not built, each with a queue entry** (the plan's § Deferred has the reasons):

- `qi-fbrh4kck`, waiting on Greg: a `doi.org` link or a shortener that ends on a known source, and
  NBER and OSF. They need a new column for the address an article was asked for.
- `qi-azad3wfd`, waiting on Greg: PubMed and PMC. Getting in means telling PMC we are not a browser,
  which is a decision about a bot wall.
- `qi-w49m6b3d`: bioRxiv and medRxiv, after an eval of bioRxiv's free HTML against its PDF.
- `qi-nyd8f2w6`: following a stub landing page's own `citation_pdf_url`, for the long tail.
- `qi-smqhdmcm`: OpenReview, which needs one import from production's network to decide.
- `qi-ptvjnvdm`: a bug found on the way. HAL's bot-check page imports as an article.
