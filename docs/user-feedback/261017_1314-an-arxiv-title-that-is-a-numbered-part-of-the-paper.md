---
reports: spya-mx3wz0
ending: shipped
---

# An arXiv paper shelved under a numbered part of itself

Report `spya-mx3wz0` (#591, `SPIDERYARN-READING2-JD`), from Greg (an admin), filed 2026-10-17
13:14 UTC from Chat on `arxiv-2308-08708-spya-xax6v4`, build `614e42c5`. A problem.

> Why does the title for this article have a "1" at the beginning?

**Ending: Shipped**, on `dev`. Plan
[261017a](../plans/261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md).

**The "1" was the smaller half of it.** The stored title was `1Indicator Properties`, and the paper
is *Consciousness in Artificial Intelligence: Insights from the Science of Consciousness*. That is
arXiv's own `<title>` for the page, byte for byte. The paper sets its title page by hand, with no
`\title`, so LaTeXML had no document title and filled `<title>` with a numbered part of the paper,
its number glued on. One arXiv HTML article in ten on production has it.

Now, a LaTeXML page with no document title of its own does not use its `<title>`. One cheap call
reads the title off the page's opening, and code keeps the answer only if the page prints it word
for word. When there is no answer, the title is `arXiv:<id>`. On the real page and seven harder
variants the model got 8 of 8, against 1 of 8 for "take the first line".

**The article this was filed from keeps its wrong title** until it is extracted again or renamed.
The brief said not to write to it.

Not done here: the same paper also shows no authors, because LaTeXML's author markup is missing too
and nothing else declares them. That is queued for the Overseer as a proposal, `qi-jbgyf5y5`.
