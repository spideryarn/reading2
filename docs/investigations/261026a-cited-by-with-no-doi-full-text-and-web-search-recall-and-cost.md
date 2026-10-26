# Cited by with no DOI: OpenAlex's full text, and what a web search adds

2026-10-26, for report `spya-vx23nt` and plan
[261026f](../plans/261026f-cited-by-when-there-is-no-doi-from-the-full-text-and-a-web-search.md).
Local only; nothing was sent to or read from production except one read-only lookup of the
reported article's title and address. The script is
[`scripts/spikes/261026a-cited-by-full-text.ts`](../../scripts/spikes/261026a-cited-by-full-text.ts)
(`gate`, `precision`, `reception`).

## What was asked

Greg wanted the sentence *"…so we cannot list who cites it"* replaced by something that tries:
a web search by title and author, with a model judging each candidate. Before building that, two
questions. Is there a free way that finds citing papers? And does the paid web search we already
run (Reception, *Pages about it*) find them?

## The pieces

Eleven local articles with no DOI and a public address, chosen to span the cases: the reported
piece (transformer-circuits.pub, 2026, no author or year on record), blog posts that papers cite
(Weng, Olah, Steinhardt, Graham), blog posts that blogs cite (Scott Alexander, Somers), and titles
that are everyday phrases (*Simulators*, *How to Do Great Work*, *Normalization of deviance*,
*Fashionable Problems*).

## 1. OpenAlex's full text is a free source of citing papers

`works?filter=fulltext.search:"<the exact title>"` returns works whose indexed full text contains
the phrase (stemmed: OpenAlex's `x_query` says so). No model, no money; about $0.001 of OpenAlex's
daily allowance per query.

**Precision**: for the five pieces with a usable list, the ten most cited hits (works titled as the
piece, and works from before its year, dropped), each one's open copy fetched (arXiv's PDF first,
else OpenAlex's open-access PDF or landing page) and code asked whether the title is in it, with
everything but letters and digits removed so a PDF's *Rep- resentations* matches:

| Piece | Cites it | Copy does not contain it | No open copy |
|---|---|---|---|
| Verbalizable Representations… (the reported piece) | 8 | 1 | 1 |
| LLM Powered Autonomous Agents (Weng), with *Weng* | 9 | 1 | 0 |
| Do Things that Don't Scale (Graham), with *Graham* | 8 | 0 | 2 |
| More Is Different for AI (Steinhardt), with *Steinhardt* | 1 (of 1) | 0 | 0 |
| Understanding LSTM Networks (Olah), with *Olah* | 5 | 1 | 4 |
| **All** | **31 of 34 readable (91%)** | 3 | 7 |

A first pass reported 28 of 34: it kept spaces when matching, so a title broken across a PDF line
with a hyphen read as absent. Opening one of those (arXiv 2610.29129) showed the reference in full,
*Verbalizable Rep- resentations Form a Global Workspace in Language Models, July 2026. URL
https://transformer-circuits.pub/2026/workspace/index.html*. A "copy does not contain it" can still
be a version difference (the IJCAI version of one survey cites Weng, its arXiv version did not).

**A stricter check, and a wider sample.** A title in a copy confirms OpenAlex's index, not a
citation of *this* piece. So a second pass (`precision --top=5`) counts a hit as citing only when
the title stands within 400 characters of the first author's surname or the piece's host, the shape
of a reference entry; added four transformer-circuits.pub pieces like the reported one, gwern's
*The Scaling Hypothesis*, *Meditations on Moloch* and Sutton's *The Bitter Lesson*; and used the
plan's filters (only the piece's own records dropped, a year's tolerance):

| Piece | Cites | Title only | Absent | No open copy |
|---|---|---|---|---|
| Verbalizable Representations… | 2 | 2 | 0 | 1 |
| LLM Powered Autonomous Agents | 5 | 0 | 0 | 0 |
| Do Things that Don't Scale | 2 | 0 | 0 | 3 |
| More Is Different for AI (3 hits in all) | 1 | 0 | 1 | 1 |
| Understanding LSTM Networks | 1 | 0 | 1 | 3 |
| Toy Models of Superposition | 5 | 0 | 0 | 0 |
| A Mathematical Framework for Transformer Circuits | 4 | 0 | 0 | 1 |
| Towards Monosemanticity | 5 | 0 | 0 | 0 |
| In-context Learning and Induction Heads | 4 | 0 | 0 | 1 |
| Meditations on Moloch | 2 | 0 | 0 | 3 |
| *The Scaling Hypothesis* (gated, § 2) | 0 | 0 | 2 | 2 |
| *The Bitter Lesson* (gated, § 2) | 4 | 0 | 1 | 0 |

The reported piece's two *title only* rows cite it by its real authors (Gurnee et al.), which our
record of it does not have: its byline is the word *Authors*. Counting them, **33 of the 35
readable hits cite the piece for the ten pieces whose list the gate lets through (94%)**. The
gate hides *The Scaling Hypothesis*, which is right (its top hits use the phrase), and *The Bitter
Lesson*, which costs four real citers: a safe miss.

**Every row the panel would show** (`shown`), after GPT Sol's plan review asked for it (F1: the top
five are not the list). Run through the shipped code itself (`src/citation-fulltext.ts`: its
question, gate, order, page of 25 and own-record rule), each row's open copy checked as above:

| Piece | Shown | Cites | Title only | Absent | No open copy |
|---|---|---|---|---|---|
| Verbalizable Representations… (no year, newest first) | 25 | 12 | 12 | 1 | 0 |
| LLM Powered Autonomous Agents | 25 | 17 | 3 | 3 | 2 |
| Do Things that Don't Scale | 25 | 8 | 2 | 3 | 12 |
| More Is Different for AI | 3 | 1 | 0 | 1 | 1 |
| Understanding LSTM Networks | 25 | 10 | 0 | 2 | 13 |
| Toy Models of Superposition | 25 | 23 | 0 | 0 | 2 |
| A Mathematical Framework for Transformer Circuits | 25 | 22 | 0 | 1 | 2 |
| Towards Monosemanticity | 25 | 19 | 0 | 2 | 4 |
| In-context Learning and Induction Heads | 24 | 21 | 0 | 1 | 2 |
| Meditations on Moloch | 18 | 10 | 0 | 1 | 7 |
| *The Scaling Hypothesis*, *The Bitter Lesson* | — | gated as phrases | | | |
| **All** | | **143 of 175 readable (82%)** | 17 | 15 | 45 |

Counting the reported piece's twelve *title only* rows as citers (they name its real authors, which
our record lacks) gives 155 of 175, 89%. **Either way it is below the 95% Sol set for showing the
list by default**, and the tail is where it falls: a title that is also a phrase of its field
(*LLM-powered autonomous agent*, *things that don't scale*) is matched by papers using the phrase.
The transformer-circuits.pub pieces, the closest to the reported one, are 85 of 90 readable (94%).

**A bug the run found.** The first `shown` run sent *do things that dont scale*: `titleQueryOf`,
written for the title search, drops an apostrophe inside a word, and the full-text index then
matches nothing (31 works with *don't*, none without, 2 with *don t*). The shipped phrase keeps it
(`fulltextPhraseOf`); the row above is from the corrected run.

**What would raise it, not tried here**: requiring the first author's surname in the full text as
well (`fulltext.search:<surname>` beside the phrase) took Weng's top ten to 9 of 10 in the first
pass, but sends the author to OpenAlex, which the privacy page says we do not, and cuts recall.

**Recall** is not measured against a ground truth, which does not exist for a piece with no DOI.
What there is: 129 works for the reported piece, 278 for Weng, 31 for Graham, against nothing today.

## 2. It fails on an everyday phrase, and the failure can be detected for free

A work published before the piece cannot cite it. So the number of hits in the ten years before the
piece's year, per year, against the number per year since, says whether the phrase is the piece's
or the language's (`gate`):

| Piece | Hits, 10 years before | Since | Per-year ratio |
|---|---|---|---|
| Verbalizable Representations… | 0 | 129 | 0 |
| LLM Powered Autonomous Agents | 0 | 278 | 0 |
| Do Things that Don't Scale | 0 | 31 | 0 |
| More Is Different for AI | 1 | 3 | 0.17 |
| Understanding LSTM Networks | 4 | 1,462 | 0.003 |
| Simulators | 374,250 | 327,679 | 0.57 |
| How to Do Great Work | 3 | 3 | 0.40 |
| Normalization of deviance | 176 | 1,031 | 0.21 |
| Fashionable Problems | 23 | 0 | — |
| Heuristics That Almost Always Work; Why working quickly… | 0 | 0 | — |

A rule of *at least three hits before, and a per-year rate above 5% of the rate since* hides
*Simulators*, *How to Do Great Work* and *Normalization of deviance*, and keeps the rest; *Fashionable
Problems* (23 before, none since) is a phrase by the same rule, and would have listed nothing anyway.
The shipped gate's windows are exact (plan decision 3: Y-10 to Y-2, then Y-1 to now), so its counts
differ slightly from these, which used Y-10 to Y-1. It needs
the piece's year; the reported piece has none on record (§ 4).

## 3. Reception does not find citers, by design

Reception's search looks for pages that say something about the piece. Its stored searches
(`debate/5`–`debate/7`) on the local stack, eleven of them on pieces with no DOI or a DOI it could
not use (`reception`):

| Piece | Results read | Searches | Rows kept |
|---|---|---|---|
| The extended mind | 12 | 4 | 0 |
| Dropout | 9 | 4 | 0 |
| Heuristics That Almost Always Work | 9 | 3 | 1 (Zvi's reply) |
| The Scaling Hypothesis | 8 | 3 | 1 |
| The others | 5–10 | 1–6 | 0–1 |

*The Extended Mind* and *Dropout* are each cited tens of thousands of times. A citer list wants every
page that cites the piece; Reception keeps the one or two that discuss it. They are different
filters, so pointing *After it* at Reception would not answer Greg's report.

What Reception's stored rows do show is that Exa's extracts carry the citing line: Zvi's extract
begins *"Response to (Scott Alexander): Heuristics That Almost Always Work"*, and code checked that
line. That is the evidence a paid citer search would keep.

## 4. What could not be measured, and why

**The paid web search.** The box's OpenRouter key is past its monthly limit ($602.41 of $600, until
2026-11-01), and every local model call fails with 403
([ai-gateway.md § The box's key has a monthly limit](../project/ai-gateway.md#the-boxs-key-has-a-monthly-limit-and-it-runs-out)).
That section says to wait rather than use another key, and not to ship a prompt unmeasured, so its
yield and cost are still to be measured. The estimate is Bibliography's web note, one Haiku call
and one Exa search of five results: 0.8 cents and 6 seconds a press
([bibliography.md § A note from one web search](../project/bibliography.md#a-note-from-one-web-search)).

**The reported piece's year.** It has no `publishedAt` and its byline is the word *Authors*, so
neither the gate nor an author check can run on it. It is the case the plan has to handle without
either.

**The production OpenAlex key.** `.env.prod` on the box has no `OPENALEX_API_KEY`; production reads
its keys from Vercel's environment, which this run did not inspect. Without one, every OpenAlex call
from production shares an anonymous $0.10 a day with everyone on the same outbound address
(OpenAlex's own notice, on every keyless answer).

## What was decided

In [261026f](../plans/261026f-cited-by-when-there-is-no-doi-from-the-full-text-and-a-web-search.md):
the full-text list is shown when Sources opens, **behind the experimental switch** (82–89% over the
rows shown, against a 95% bar), as *Possible citations*, never as *Cited by*, with the phrase gate
and the filters measured here; a check of each row's open copy is not made on open
(arXiv's rate request, and a half-checked list); the paid web search is a citer search of its own,
because Reception's does not find citers, and it waits to be measured until the box's key resets.
