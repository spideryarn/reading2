---
reports: spya-vfk2zh
ending: shipped
comment: Replaced. Affiliations now come from one cheap Haiku call on any site, held to the page's words: same as before on 9 of 13 arXiv papers, better on 2, wrong on none, ~$0.0005.
---

# Authors' affiliations by a general pass, not an arXiv one

An admin's report from Greg (`feedback-reporter.ts` exit 0), 2026-10-09 20:41 UTC, on `/changelog`,
release 1.4.8, followed the same evening by "use your judgment re replacing the arXiv code … if the
LLM author post-processing costs well under $0.01".

> In release 1.4.8, you have a bunch of stuff that's specific to archive about how we deal with
> authors. I guess I don't think we should be building things that are specific to a particular site
> unless we really have to. […] this kind of thing is the sort of thing I'd hope we could do with an
> LLM in a general way rather than deterministic scripts that are specific to particular sites.

**Ending: shipped**, on `dev` —
[261009u](../plans/261009u-a-general-authors-pass-for-every-web-page.md).

- **The honest answer first.** The affiliations were already read by a model in 1.4.8, but through
  arXiv-only plumbing and on Sonnet. Two arXiv pieces were deterministic: reading the names out of
  arXiv's markup, and rewriting the title block so Readability stops deleting an author and fusing
  the rest. Both stay, and the plan's § 1 says why: the first is arXiv's equivalent of
  `citation_author` tags, and the second mends the article's own text, which a model cannot do.
- **Built:** one Haiku 5.5 call on any web page whose metadata names its authors without their
  institutions. It reads the page's visible opening before Readability, and code holds the answer
  to the page: the names come back exactly, the words are the page's own, and each institution is
  provably that author's. The arXiv affiliations code is deleted. Measured on 13 arXiv papers × 3
  draws, plus journals, blogs and PDFs: same on 9, better on 2, wrong on none, about $0.0005 against
  Sonnet's $0.005.
- **Every site-specific extraction rule** is inventoried in the plan's § 2. Front matter had exactly
  one site-specific path, arXiv's.
- **Not built, and why:** finding authors on pages that declare none, because a model could put a
  quoted person over a correct byline. Noticing and folding the abstract and acknowledgements, which
  is a separate decision about hiding the author's text; the Overseer was asked to queue it, with
  Greg's quote.
- GPT Sol reviewed the plan (*revise before build*: all four findings fixed, among them a swap of
  institutions and hidden text) and the code (see the plan).
- No Sentry sign-in in this session: the next feedback sweep marks the issue resolved.
