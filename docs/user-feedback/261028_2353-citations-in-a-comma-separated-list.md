---
reports: spya-d5e2jk
ending: shipped
comment: Code reads comma-separated lists (214 of 243); since 1 Nov Haiku lists every work up to 300 (98-100% on seven test papers, a seventh of the cost), its notes a little worse than Sonnet's. Greg's choice, q-ns76uq.
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

**2026-11-01:** the model half is on `dev` too. Greg chose Haiku in q-ns76uq (`spya-mgvawf`):
[plan 261101c](../plans/261101c-citations-list-on-haiku-and-better-notes.md) built it and measured
it, and [investigation 261101d](../investigations/261101d-citations-notes-from-haiku-three-ways.md)
tried three ways to make Haiku's notes as good as Sonnet's, none yet good enough to ship.

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

**2026-11-01, after Greg's reply** to q-ns76uq (`spya-yyvxm0`: run evals, try Haiku 5.5): measured
in [investigation 261101a](../investigations/261101a-citations-recall-haiku-vs-sonnet-prompt-eval.md)
on seven papers ($2.95). Haiku 5.5 at high effort, with a prompt that asks for every work and shows
the shapes a citation takes, found more than today’s Sonnet on five papers and the same on two already complete, for about a
seventh of the cost. Its one-line notes are a little worse in a blind read, and a long list takes 2–4
minutes. Nothing shipped: that trade-off is Greg's, rewritten into
[q-ns76uq](questions/q-ns76uq.md) (recommended: switch). No addenda (re-read 2026-11-01, before
acting and before writing this).
