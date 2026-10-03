---
reports: spya-jp5nxn
ending: shipped
---
# Quick search still finds too little: a bare word like "results" found nothing

Report `spya-jp5nxn` (SPIDERYARN-READING2-BG), a problem, from Greg (admin, production row proven),
2026-10-03 18:09 UTC, from Search mode on `/read/arxiv-2610-spya-bfrbaj`, build `d3f34a0f`, relayed
by the Overseer (queue item `qi-6hmbz43m`):

> The quick search still doesn't seem to find enough - see
> https://www.spideryarn.com/read/arxiv-2610-spya-bfrbaj?mode=search&margin=1&summary=fuller&at=spya-ft0zvv&thread=spya-t0jj8v&remember=tutorial&match=quick&runs=spya-uusd5t

**Ending: Shipped**, on `dev`, not deployed.

Plan: [261003o](../plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md).
The measurement: [261003f](../investigations/261003f-quick-search-category-words-score-under-the-floor.md).

This repeats the subject of
[261003_1026](261003_1026-quick-search-misses-thorough-replaces-colour-key-and-no-wash.md). That
morning's fix was in the build this was filed from. It fixed words the article literally mentions
("Buddhism"). It did not fix this.

## What was wrong

The linked search is "results", on a paper. The row in the link is the thorough search that
replaced the quick one, so the quick answer is not stored; sent again, the quick search returns
nothing, five times of five. The model ranked the right paragraphs first and scored them 0.52 to
0.57, under the 0.7 cut-off. "linear algebra" on the same paper did the same.

A bare word that names a kind of passage or a field ("results", "examples", "criticism") scores the
paragraphs that are examples of it low, because they do not say the word. On 37 such searches over
four articles, more than half came back empty.

## What changed

When a quick search finds nothing at 0.7 or more, it now shows the best paragraphs at 0.5 or more,
at most eight, each with its own score. "results" on that paper now shows two to four, all judged
right. A search that already finds something is unchanged. Most tested absent and near-miss searches
still showed nothing; four of 75 showed wrong paragraphs.

What it costs: a word with no clear meaning in a given article, or a neighbouring topic the article
does not cover, can now show a few wrong paragraphs where it showed none. About 7 in 10 of the
paragraphs a fallback shows were judged right.

## Worth knowing now

A question or a phrase works far better than a bare word. "what were the results?" finds 14
paragraphs on that paper where "results" found none.

## Not built, each with a queue entry

- Sending the reader's words inside a phrase (`passages about: …`) for every search. A probe halved
  the empty searches. It needs this morning's eval re-run and judged before it can ship. `qi-8xaejt6k`.
- Letting quick search land on a section heading. For "results" the heading is the best answer.
  `qi-2ymzypwt`.

## Questions for Greg (in the plan)

- Q1: should the fallback cut-off be 0.5 (built: finds more, 7 in 10 right) or 0.55 (finds less,
  8 in 10 right, and "results" stayed empty on two of the five measured runs)?
- Q2: should a fallback list say that it is one? Built: no; its usually lower score is the only
  signal, and a value just under 0.7 can round to 70.
- Q3: should the search box or the help page say that a question works better than a bare word?
