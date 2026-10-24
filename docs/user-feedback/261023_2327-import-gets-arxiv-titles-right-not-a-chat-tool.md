---
reports: spya-whpceg
addenda: spya-rpuerj
ending: shipped
comment: No chat tool, as your addendum said. This paper's title is already right on a fresh import (fix deployed 10-18); it needs re-extracting. Also fixed: arXiv titles with a line break lost a space or their part before the colon.
---

# The import gets arXiv titles right, rather than chat editing them

Report `spya-whpceg` (#693), from Greg (an admin), filed 2026-10-23 23:27 UTC on
`arxiv-2308-08708-spya-xax6v4`, build `db758ed8`. A suggestion.

> I want to be able to ask the guide chat or similar to update the title and potentially other
> metadata. I think this should be something they can support, perhaps by adding special tool(s).

Addendum `spya-rpuerj`, a minute later:

> Actually, on second thoughts, maybe this isn't worth doing because every tool uses up context and
> creates complexity. Maybe we just need to slightly improve the import process so that we get the
> titles right.

**Ending: Shipped**, on `dev`. Plan
[261024b](../plans/261024b-an-arxiv-title-keeps-the-space-its-line-break-stood-for.md). No chat
tool, per the addendum.

**This paper.** It is still shelved as `1Indicator Properties`, with no authors, year or DOI. That
was report `spya-mx3wz0`, fixed by
[261017a](../plans/261017a-an-arxiv-paper-with-no-title-takes-its-title-from-its-own-opening.md)
and deployed on 2026-10-18; every revision of this article in production is from 2026-10-17,
before that deploy. Imported today on `dev`, the same page gets *Consciousness in Artificial
Intelligence: Insights from the Science of Consciousness*, all 19 authors, 2023 and its DOI (the
authors from its arXiv registry record, 261018a). So it needs only re-extracting, which is a
production write and was not done here.

**What was built.** A sweep of 25 arXiv HTML papers found one more title fault, live in production:
an author's line break in the title (`\\`) loses the space it stood for in arXiv's `<title>`
(*Evaluating AGENTS.md:Are …*, *instructionswith*), or the page's `<title>` is right and our
article reader cuts everything before its colon as if it were a site's name (*Tree of Thoughts:*
gone). The import now reads the title the paper's heading draws, the break as a space, when it
agrees with `<title>`. Three of the 25 fixed, none of the others changed.
`arxiv-2602-11988-spya-sudvzx` in production gets its space on its next extract.

The Overseer's proposal `qi-jbgyf5y5` (this paper's missing authors, from `spya-mx3wz0`) is
superseded by 261018a and can be dropped; only Greg or the Overseer may drop it.
