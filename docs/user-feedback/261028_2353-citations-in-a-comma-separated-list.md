---
reports: spya-d5e2jk
ending: shipped
comment: A model lists them first, then code adds what it missed; here the call stopped at 70 of 243. Code now reads comma-separated lists too (214 of 243). More model calls for footnotes: question for you.
---
# Citations in a comma-separated list

Report spya-d5e2jk (#730), 2026-10-28 23:53 UTC, kind problem, from an admin (Greg;
`feedback-reporter.ts` exit 0), on Butlin, Long et al., *Consciousness in Artificial Intelligence*
(`arxiv-2308-08708-spya-xax6v4`, from arxiv.org/html/2308.08708), at `spya-n7zjq0` (the heading
*2.3 Higher-Order Theories*; the paragraph is `spya-bwe935`). No addenda (re-read 2026-10-29,
before acting and before writing this).

> A lot of citations in this paragraph are getting missed somehow. How are we doing citations? Are we
> trying to do it with a regex? Because I don't think that'll work. I think it's going to need an LLM
> to pick them out. And then that might do a better job with footnotes as well.

**Ending: shipped** on `dev` (the code half), with the model half put to Greg as
[q-ns76uq](questions/q-ns76uq.md) and queued as `qi-mf9r5hjk`.

**How it works, plainly:** one Sonnet call reads the article and lists the works it cites, with a
quote of each place; code checks the quotes are real. Since 2026-10-27 code also reads author–year
citations itself and adds the ones the model left out.

**Why these were missed:** this article's list was made on 2026-10-17 by one call that stopped at
70 of about 243 works (`capped: true`); code's fill came ten days later and old lists are not
re-made; and even today's code read only the first item of a list separated by commas,
*(Carruthers & Gennaro 2020, Rosenthal 2005)*, so it would still have missed Rosenthal. Now it
reads every item: on this article's blocks,
214 of the reference list's 243 works found, up from 178, no false ones.

Plan, production reads, measurement and both GPT Sol reviews:
[261029b](../plans/261029b-citations-in-a-comma-separated-list-are-all-read.md). Nothing in
production is re-made (principles.md § 1); *Find them again* on the article's Metadata page would
give it code's fill (about $0.30) after the next deploy. Waiting for the 2026-11-01 OpenRouter reset:
everything in `qi-mf9r5hjk`, which needs model calls from the box to build and measure.
