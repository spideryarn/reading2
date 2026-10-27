---
id: q-knkbsk
report: spya-ez2vus
status: answered
asked: 2026-10-27
title: Citations rows code found in the text: mixed in with the model's, or listed after them?
refs: qi-mf9r5hjk · docs/plans/261027b-citations-missed-in-the-text-filled-by-code.md · docs/investigations/261027a-how-often-citations-are-missed.md · docs/user-feedback/261026_2154-citations-missed-in-long-articles.md
---
On a long article, the Sources list now holds many rows that code found in the text and no model described (no scores, no note, just "Levine (2021)"). Where should they go in the default "prioritised" order?

A. Mixed in, in reading order, as now. Nothing to build. The prioritised view of LeCun's paper becomes 23 described rows and 78 bare ones interleaved, and the bar cannot hide the bare ones because they have no score.

B. After the model's rows in the prioritised and influence orders, still in reading order in "first cited" order. A small change. The described works lead, and the bare ones follow as a tail.

C. Hidden from the list unless you pick "first cited" order, but still marked in the prose with their card. Hides most of the noise, but a work you can see marked in the text would be missing from the list.

Recommendation: A for now. From 1 November, when model calls work again, the next step gives the model code's list to describe, and most of these rows then get scores and sort themselves. If the interleaving bothers you before then, B.

Details

You asked on 26 October, on LeCun's "A Path Towards Autonomous Machine Intelligence": "Why didn't it notice the citation for Levine 2021 in this paragraph? I feel like citations often seem to miss stuff."

What I found: the model that writes the list returned only 23 of the 105 works the paper cites, and said it had not left any out. Nothing in our code dropped Levine; the model never named it, and nothing checked. Counting by hand across six articles, a list is close to complete up to about 70 cited works and falls to about a quarter past 100. A second fault on the same paper: a table in its appendix was read as the reference list and shown to the model as one. That is fixed.

What shipped (to dev, not yet deployed): code now reads author-year citations like "(Levine, 2021)" itself, and adds a row for every one the model left out. On LeCun's paper that recovers 79 of the 82 missing works, with no false ones. Those rows say "found in the text" and have no scores, because no model has read them. Your article changes only when its list is made again (Metadata, then make again), which needs model calls, so after 1 November.

The question is only where those bare rows sit in the list. In the prose they are marked like any other citation whatever you choose.

## Greg's answer, 2026-10-27 (in the Overseer's terminal)

> Use your judgment on the rest

So **A**: the rows code found stay mixed in, in reading order, and nothing is built. Once model calls
work again (from 1 November), the model is given code's list to describe and most of these rows get
scores and sort themselves (qi-mf9r5hjk). If the interleaving still bothers you after that, B is
the small change.
