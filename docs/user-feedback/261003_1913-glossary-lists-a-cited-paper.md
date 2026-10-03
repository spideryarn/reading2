---
reports: spya-zn97q5
ending: shipped
---
# Glossary lists a cited paper ("Saha et al.") as a term

Greg's suggestion from the Feedback dialog (he is admin), filed 2026-10-03 19:13 on
`arxiv-2610-spya-bfrbaj`, relayed by the Overseer (queue item `qi-gbcjdnyj`). Sentry:
SPIDERYARN-READING2-BN. Not built before (checked `git log origin/dev`, `docs/plans/`, this
directory and `gjd-remote ls` on 2026-10-03).

> It looks as though there is at least one glossary item in this article that's actually a paper,
> Saha et al. I don't think the glossary should include citations. That's what citations are for.

**Shipped.** The glossary prompt (`glossary/9`) tells the model not to give an entry to a work the
piece only cites, or use a citation as another name for a term; people and works the piece actually
talks about remain eligible. Behind the prompt, code drops any entry or alias of the form "Name et
al.". Measured on a local paper dense with citations: entries named for a cited book went from four
runs in five to none in fifteen; confirmed citation aliases fell from six to two, with five
author-shaped candidates left unclassified. Plan, measurement and GPT Sol's reviews:
[261003o](../plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md),
[261003g](../investigations/261003g-glossary-citation-entries-before-and-after-the-rule.md).

Three things for Greg, all in the plan's questions:

- **The article in the report keeps "Saha et al." until its glossary is made again.** After the
  deploy, press **Find terms again** on it. Production was not touched.
- On a citation-heavy paper the list comes out about two entries shorter, and now and then much
  shorter.
- Works the piece discusses (a book it analyses, GPT-3) still get entries. Say if you want none.

The Sentry status write is left for the next sweep: this session ran on a pool account with no
Sentry sign-in.
