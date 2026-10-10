---
id: q-vzd2xt
report: spya-nbmce7
status: open
asked: 2026-10-10
title: Skim: should More always have more stops than Gist, even if Gist gets shorter on short articles?
refs: qi-67k544sa · SPIDERYARN-READING2-GC · docs/plans/261010g-skim-deeper-passes-always-longer-and-a-previous-stop-door.md · docs/investigations/261010a-skim-per-pass-targets-and-walked-growth.md · docs/user-feedback/261010_1800-skim-deeper-passes-never-shorter-and-a-previous-stop.md
---
Your report: Most had fewer stops than More. That is fixed: Most now always has more stops than More, and no pass has fewer than the one before. One choice is left. On short articles (about 11 to 13 quotes), More can still have the SAME number of stops as Gist, for example 3 / 3 / 5.

A. Leave it: More may equal Gist, never fewer. Gist keeps 3 stops on short articles. (What is built now.)
B. Make More always longer than Gist too. On short articles Gist drops to 2 stops, e.g. 2 / 4 / 5. Measured, the Gist then covered noticeably fewer of the article's key ideas (20 of 49, against 24 to 25).

Recommendation: A. Your report was about a deeper level having fewer stops, which A already rules out, and B costs the Gist the most.

Details

What you reported (2026-10-09, Skim on Attention Is All You Need): "the most detailed skim submode has fewer steps than the middle one", and a re-run "seemed to have more this time".

Why it happened: a check that the levels grow was written when More used to include all of Gist's stops. Since late September each level shows only its own new stops (plus a few carried over), and the check was still counting the old way. So nothing stopped Most being shorter. 8 of the 29 routes in production had a level no longer than the one before.

What was built (on dev, not deployed): the check now counts each level as you walk it; the AI is asked for per-level numbers that do not shrink; and if its answer still has a deeper level shorter, the route is fixed before it is saved, by dropping a carried-over stop or moving the least important stop one level deeper. Measured on six articles, two runs each: the old version broke the rule in 6 of 12 runs, the new one in 0 of 12.

What each option means in use, for an article with 11 quotes:
A: Gist 3 stops, More 3 new stops (plus any carried over), Most 5.
B: Gist 2 stops, More 4, Most 5. Three levels that each grow do not fit into 11 quotes any other way, so Gist has to give.

What it costs: A means pressing "More detail" can occasionally give you the same number of stops as Gist (different ones). B means a thinner Gist on short pieces. On longer articles (14+ quotes) the two are the same.

Routes planned before this keep their old shape until re-planned (Metadata, re-run Skim).

Reply "A" or "B"; anything else, say so.
