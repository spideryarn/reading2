---
id: q-ns76uq
report: spya-d5e2jk
status: open
asked: 2026-10-29
title: Should citations get more model calls on long papers, to catch footnotes and describe every work?
refs: qi-mf9r5hjk · q-knkbsk · docs/plans/261029b-citations-in-a-comma-separated-list-are-all-read.md · docs/user-feedback/261028_2353-citations-in-a-comma-separated-list.md · docs/investigations/261027a-how-often-citations-are-missed.md
---
Citations are found by a model first and code second, not by a regex alone. The model's one call stops early on a long paper (here it listed 70 of about 243 works). Code now catches most of the rest on author-year papers like this one, but not footnoted or numbered ones, and the works code adds have no description or scores. Should long papers get more model calls to fix that?

A. Yes, after 1 November (recommended). A long paper is read in parts, one call per part, and each call is also handed code's list so it describes those works too. First measured on six test articles (a one-off of a few dollars), and kept only if it finds more. Then: no change on a paper citing under about 70 works; about 30 cents instead of 20 for a 100-work paper; about 60 to 65 cents instead of 30 for one like this, up to about a dollar at worst. About 1 list in 3 is that long.

B. Not now. Keep code's fill and the single call: free, but footnoted and numbered papers (Wikipedia, most biomedical papers) stay incomplete past about 70 works, and code's rows stay undescribed ("found in the text").

(Describing code's works without splitting is not a cheaper middle way: the cost is the model writing a row per work, and one call stops before it has written them all, which is the fault we started from.)

I recommend A: what drops works today is one call trying to write hundreds of rows, and splitting is the only lever for footnotes, which is what you asked about. On 27 October you said "use your judgment" when this was named as the next step (q-knkbsk), but that was about where code's rows sort, not about a cost on every long paper, so I am asking.

Details

What you reported (28 October, on Butlin and Long's Consciousness in AI paper): "A lot of citations in this paragraph are getting missed somehow. How are we doing citations? Are we trying to do it with a regex? ... I think it's going to need an LLM to pick them out. And then that might do a better job with footnotes as well."

How it works today. When an article is imported, one Sonnet call reads the whole article and lists every work it cites, with a quote showing where. Code checks each quote really is in the article and drops anything it cannot find, so the model cannot invent a citation. Since 27 October (your Levine 2021 report on LeCun's paper), code also reads author-year citations like "(Craik, 1943)" itself, with patterns, and adds a row for each one the model left out. Those rows say "found in the text" and have no description or relevance score, because no model has read them.

Why that paragraph was missed. Three things stacked. First, this article's list was made on 17 October by one call that stopped at 70 of about 243 works (it said it was capped), and none of the paragraph's three works was among them. Second, code's fill arrived ten days later, and an old list is not re-made by itself. Third, even today's code would have missed Rosenthal 2005: it expected items separated by semicolons, "(Craik, 1943; Levine, 2021)", and this paper uses commas, "(Carruthers & Gennaro 2020, Rosenthal 2005)". That third part is fixed on dev: on this paper code now finds 214 of the 243 works in its reference list (up from 178), with no false ones.

What option A would do. Reading in parts means each call lists the works its part cites, and code merges them; it is the only way past the ceiling of about 70 works for footnotes and numbered citations, which code cannot read alone. Handing over code's list means every row gets a one-line note and scores. The costs come from production's own bibliography calls: a list costs 14 cents on average today, and the most expensive so far was 30 cents. The estimates assume the parts together send the article about once; the dollar is the case where each part writes more per work, or repeats the whole article.

Your article. Nothing is re-made without you (we improve forwards). "Find them again" on the article's Metadata page would re-make its list with code's fill, about 30 cents, once this is deployed. Only a re-import brings back Boxes 1 to 4 (the empty "diagram" you also reported) and the citations inside them.
