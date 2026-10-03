# Quick search returns nothing for a bare word like "results": the ranking is right and every score is under the floor

Up: [investigations.md](../project/investigations.md)

Plan: [261003o](../plans/261003o-quick-search-falls-back-to-a-lower-floor-when-nothing-clears-it.md),
Stage A. This follows [261003c](261003c-quick-search-recall-eval-jev-wording-floor-and-small-llm.md)
of the same morning, and reads its saved scores again. The feature is described in
[search.md § Quick search](../project/search.md#quick-search-a-meaning-search-in-about-a-second);
the code is `src/quick-search.ts`.

## What was asked

> The quick search still doesn't seem to find enough
>
> — Greg, 2026-10-03, feedback `spya-jp5nxn`, with a link to a search for "results" on an arXiv paper

Quick search asks Jev one yes/no question per paragraph, *"does this passage mention or discuss what
the reader is looking for?"*, and keeps paragraphs scoring 0.7 or more, best first, at most 20. The
wording was changed that morning (261003c) and the change was in the build he filed from.

## The short answer

- **Reproduced, by inference.** The row he links is the thorough search that replaced his quick
  one, so his quick answer is not stored. Sent again as production sends it, "results" on his
  article returns nothing on five runs of five (best score 0.52 to 0.57). "linear algebra", which
  he also searched, returns nothing on five of five. The thorough search found 7 and 12.
- **The shape: a bare label.** One or two words naming a kind of passage ("results", "examples",
  "criticism") or a field ("linear algebra", "statistics"), where the right paragraphs are
  instances and do not say the word. Over 37 such queries on four articles, **62 of 111 searches
  return nothing**. This name describes what was measured; it is not a proven cause.
- **How it is typed matters a great deal.** "results" 0.52 to 0.57. "Results" 0.63 to 0.67.
  "result" 0.41 to 0.45. "what were the results?" **0.93, 14 paragraphs**. All eight requests
  written as a question or phrase found something on every run.
- **The ranking under the floor is good.** Two blind judges. Of what a fallback at 0.5 would show
  on those empty searches, the stricter judge marked 71% right, and the top result right on 36 of
  50. Greg's own two queries: every paragraph shown was marked right by both.
- **Decision: when nothing clears 0.7, show paragraphs at 0.5 or more, the best 8.** It changes
  none of the 150 runs 261003c saved. It fills 50 of the 62 empty searches.
- **Its cost.** 13 of those 50 lists hold nothing right, on four queries where the word has no
  clear referent in the article. Of 25 absent and near-miss topics (75 runs), two show something
  wrong: "human memory" (1 to 4 paragraphs, all three runs) and "government regulation" (1
  paragraph, one run in three).
- **Not fixed by this: 12 of the 62 stay empty** ("result", "example", "Philosophy", "Statistics").
- **A lead, not adopted.** Wrapping every query as `passages about: …` halves the empty searches
  (28% against 56%) without flooding this morning's sets or the absent topics. It is unjudged. It
  has a queue entry.

## What was measured

Run on 2026-10-03 from the Hetzner box. Scripts are saved as `.txt` beside the results in
[evals/results/quick-search-category-words-2026-10-03/](../../evals/results/quick-search-category-words-2026-10-03/),
for the reason 261002o gives. To re-run, copy them into a gitignored `data/qeval/` as `.ts` and
`.mjs` and run from the worktree root. `lib.ts` is 261003c's, and filters and chunks as production
does. No article text is in the results: ids, scores, verdicts.

**Articles.** Greg's (`arxiv-2610-spya-bfrbaj`, 171 blocks, 103 askable), read from production
inside `begin read only` and kept in a gitignored folder, and the three committed fixtures.

**Queries, 90, three runs each on the shipped wording.**

| set | n | what | who wrote it |
|---|---|---|---|
| bare labels | 21 | the three Greg ran, and 18 more ("related work", "method", "examples", "definitions", "criticism", "statistics"…) | me, before any was run, knowing the hypothesis |
| the same, typed differently | 16 | case flipped, singular or plural | me, before any was run |
| the same, as a request | 8 | "what were the results?", "where does it give examples?" | me, before any was run |
| absent | 5 | "dreaming", "sleep", "human memory", "recipes", "gardening" | me; three are Greg's own searches |
| near-miss | 20 | topics in the article's field that it does not cover ("machine unlearning", "panpsychism", "ransomware") | a subagent, from the article text alone, having seen no score |

So "62 of 111" says the shape is common among queries of this kind. It does not say how often
readers type one.

**Judging, blind, twice.** Judge 1: every paragraph that scored 0.45 or more on any run of a query
that came back empty (111), and as many that never scored above 0.3 as decoys (112), in article
order, no score. Judge 2, independent, after the second round: the same for each query and its
case and number variants (140 candidates, 53 decoys), with each paragraph's section heading shown.
Both were Opus subagents that had seen nothing else, asked *would a reader who typed this be glad to
be shown this paragraph?*, and told to choose no when torn. Paragraphs were cut at 1,500 characters.

| | |
|---|---|
| judged by both | 120 |
| agree | 105 (88%) |
| judge 1 yes, judge 2 no | 12 |
| judge 1 no, judge 2 yes | 3 |
| decoys marked right | 2 of 112, and 0 of 53 |

Every number below uses **judge 2**, the stricter and the one that saw the variants.

**The thorough search** (`findPassages`, standard power) was run once per empty fixture query;
Greg's saved production runs serve for his article. It is reported only as *overlap with one
thorough run*, on paragraphs. It is not a yardstick here: it returns headings, which quick search
never asks about, it is not exhaustive, and on the Agents article it returned nothing for "results".

**Spend: $0.85.** Jev $0.66, the Sonnet reference $0.19.

## Results

### The reproduction (`out-repro-jp5nxn.json`, `abstract-raw.json`, `round2-raw.json`)

| typed, on his article | at 0.7 or more | best score | at 0.5 or more | thorough found |
|---|---|---|---|---|
| results | 0 on 5 of 5 | 0.52 to 0.57 | 2 to 4 | 7 (3 are headings) |
| Results | 0 on 5 of 5 | 0.63 to 0.67 | 6 to 9 | |
| result | 0 on 3 of 3 | 0.41 to 0.45 | 0 | |
| what were the results? | 14, 14, 14 | 0.93 | 21 | |
| linear algebra | 0 on 5 of 5 | 0.57 to 0.63 | 5 to 6 | 12 |
| passages that use linear algebra | 10, 8, 11 | 0.86 | 26 | |
| Limitations / limitations / limitation | 8 to 12 | 0.85 to 0.93 | 26 to 38 | 2 |
| dreaming, sleep | 0 | 0.08 to 0.12 | 0 | 0 |
| human memory | 0 | 0.55 to 0.60 | 1 to 4 | 0 |

One request, one chunk, about 410 ms. Nothing in the chunking or the cap is involved.

Across the nine intents that come back empty, the request form found something on 24 runs of 24.
`summary2.json` § `typed` has every form of every query.

### What a fallback list holds (`summary2.json`, `perlist2.ts.txt`)

The 37 bare queries, 111 searches, 62 of them empty today. Rule: *nothing at 0.7 → F or more, best C*.

| F | C | searches still empty | lists | shown | right | wrong | top result right | lists with nothing right |
|---|---|---|---|---|---|---|---|---|
| today | | 62 | 0 | | | | | |
| 0.45 | 8 | 9 | 53 | 287 | 183 | 104 | 37 | 10 |
| 0.5 | 1 | 12 | 50 | 50 | 36 | 14 | 36 | 14 |
| 0.5 | 3 | 12 | 50 | 113 | 83 | 30 | 36 | 13 |
| **0.5** | **8** | **12** | **50** | **202** | **144** | **58** | **36** | **13** |
| 0.5 | 20 | 12 | 50 | 242 | 168 | 74 | 36 | 13 |
| 0.55 | 3 | 28 | 34 | 70 | 59 | 11 | 28 | 5 |
| 0.55 | 8 | 28 | 34 | 96 | 77 | 19 | 28 | 5 |

- **The cap does not buy precision.** At 0.5, three results are 73% right and eight are 71%. A
  smaller cap shows fewer right paragraphs and leaves the bad lists as bad. So 8.
- **The floor is the trade.** 0.55 is 80% right and leaves 28 of 62 searches empty, including
  Greg's own "results" on some runs (its best was 0.52, 0.55, 0.57). 0.5 is 71% right and leaves
  12. 0.45 is 64% right. The complaint is "doesn't find enough", so **0.5**.

Right over shown, per search, at 0.5 and 8:

| query | three runs |
|---|---|
| results (his article) | 4/4, 3/3, 4/4 |
| Results | 6/8, 5/6, 6/8 |
| linear algebra / Linear algebra | 5/5, 6/6, 6/6 / 5/5 each |
| examples / Examples | 2/2 each / 2/2, 1/1, 1/1 |
| definitions | 5/8, 5/8, (one run found its own) |
| criticism / Criticism / criticisms | 3/4, 0/1, 3/4 / 7/8, 6/8, 6/8 / 6/8, 3/4, 6/8 |
| methods / Methods / method | 6/8 (one run) / 6/8, 6/8 / 1/1 each |
| statistics | 1/1 each |
| **philosophy** | **0/1 each** |
| **definition** | **0/1 each** |
| **results, Results (the Agents article)** | **0/4, 0/2, 0/1 and 0/5, 0/7, 0/3** |
| result, example, Philosophy, Statistics | still empty |

The 13 lists with nothing right are the four bold rows. The Agents article is a narrative with no
results section, and both judges said the word has no clear referent there; judge 1 marked 7 of
those paragraphs right and judge 2 marked 4.

### Absent and near-miss topics

| | searches | show something under the fallback |
|---|---|---|
| absent (5 queries) | 15 | 3: "human memory", 4, 1 and 3 paragraphs, all wrong |
| near-miss (20 queries) | 60 | 1: "government regulation", 1 paragraph on one run, wrong |

The other 23 queries have best scores of 0.02 to 0.33. At a floor of 0.55 "human memory" still
shows one paragraph on each run, and "government regulation" shows none.

### Does it change anything that works today (`replay-rules.mjs.txt`)

Replayed over the scores 261003c saved for the shipped wording. That file holds 50 queries, three
runs each: its 48 and two superseded spellings of two of them.

| rule | runs changed, of 150 | paragraphs added: right / wrong / unjudged |
|---|---|---|
| **nothing at 0.7 → 0.5 or more, best 8** | **0** | 0 / 0 / 0 |
| 0.5 for everybody | 74 | 93 / 33 / 174 |
| fewer than 3 → top up to 3 | 28 | 12 / 3 / 16 |
| fewer than 5 → top up to 5 | 37 | 31 / 14 / 36 |
| 0.7, or 0.5 and within 0.15 of the best | 1 | 1 / 0 / 0 |

The 21 runs that are empty there ("war", and six absent topics) have best scores of 0.02 to 0.34.
The fallback never reaches them.

On the new set, "0.7, or 0.5 and within 0.15 of the best" fills the same 50 searches and also
changes 9 that already had results; what it adds to those was not judged. "Top up to 3" changes
14. Neither is chosen: the first is not judged where it differs, the second pads a search that
correctly found one paragraph.

### Stability

Three queries of the 37 cross 0.7 between runs, so one press gives an ordinary list and the next a
fallback one: "definitions" (best 0.67, 0.67, 0.71), "methods" (0.72, 0.67, 0.73) and "Methods"
(0.62, 0.67, 0.70). "methods" shows 4, 0 and 2 results today, and would show 4, 8 and 2. The spread
in list size across a query's three runs averages 0.43 today and 1.32 under the fallback: lists
that were steadily empty are now steadily 1 to 8. Over all 120 queries measured today, 5 runs in
360 have a best score from 0.67 up to 0.7, and 7 from 0.7 to 0.73.

### Other wordings of the question (`abstract-wordings-raw.json`, two runs each; first-round queries)

| wording | bare runs returning nothing | kept per search (mean / most) | absent-topic runs returning something |
|---|---|---|---|
| **mention or discuss** (shipped, three runs) | 24 of 63 | 6.3 / 39 | 0 of 15 |
| match (before this morning) | 23 of 42 | 1.5 / 8 | 0 of 10 |
| brief | 16 of 42 | 7.2 / 40 | 0 of 10 |
| want | 9 of 42 | 7.6 / 53 | 1 of 10 |
| relates | 2 of 42 | 23.5 / 93 | 2 of 10 |
| "mention, discuss, or give an example of" | 12 of 42 | 6.5 / 33 | 0 of 10 |
| "would a search be right to return" | 20 of 42 | 1.5 / 6 | 0 of 10 |

Counts only; what these wordings keep was not judged, so none can be said to win. None removes the
empty lists without keeping far more elsewhere.

### Wrapping the query (`framing-probe.ts.txt`, `framing-raw.json`, two runs each)

The question unchanged; the reader's words sent inside a phrase.

| what is sent as the query | bare: empty | absent and near-miss: return something | this morning's fixture queries, kept per search (old / short / held back) |
|---|---|---|---|
| the words as typed (shipped) | 62 of 111 | 0 of 75 | 11.8 / 2.2 / 2.6 |
| `passages about: …` | 21 of 74 | 0 of 50 | 12.4 / 2.2 / 2.5 |
| `Where does the article mention, discuss or show this: …` | 22 of 74 | 0 of 50 | 9.1 / 2.0 / 1.2 |

`passages about:` halves the empty searches and leaves the other sets' sizes where they were. What
it keeps has not been judged, and this morning's literal-mention counts have not been re-run on
it. It is the most promising next step and is not built here.

## Read by hand

**Headings.** Three of the thorough search's seven hits for "results" are section headings, the top two among them, which quick
search never asks about. With headings left in the request, "5 EXPERIMENTAL RESULTS" scored 0.54
for "results" (fourth) and 0.64 for "Results" (second): under 0.7 either way. For "Limitations"
the heading "Limitations." scored 0.85 and an unrelated appendix heading 0.76. Not adopted; it
needs its own measurement.

**"human memory".** The paper is about a network forgetting what it was trained on. Sonnet returned
nothing and both judges marked every candidate wrong. Jev gives the forgetting paragraphs 0.55 to
0.60. This is the honest cost of the fallback: a neighbouring topic the article does not cover.

## Limits

- The bare and variant queries were written by the person with the hypothesis.
- Two judges, both Opus, each one pass; disagreements were not adjudicated, the stricter was used.
- Only fallback lists were judged. Ordinary lists on these queries, and anything a different
  wording or framing keeps, were not.
- A judge saw a paragraph and its heading, not its neighbours.
