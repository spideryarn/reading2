# Quick search misses one-word topics: the wording, the floor, and a small LLM that answers with ids

Up: [investigations.md](../project/investigations.md)

Plan: [261003i](../plans/261003i-quick-search-eval-thorough-replaces-quick-colour-key-and-no-wash.md),
Stage A. The earlier measurements are in [261002o](261002o-quick-search-spike.md). The feature is
described in [search.md](../project/search.md), and the code is `src/quick-search.ts`.

## What was asked

> I tried a quick search in this article for Buddhism, and it didn't find anything, even though at
> one point it talks about Buddhist notions of no self. If I did the flesh out for the quick search,
> then it did find it. So it feels like the quick search is not working all that well. Can we do some
> evals on it to see if there's a different way to prompt it or anything like that? Or indeed, perhaps
> we might need to switch out the model. I think we could still do a quick search with an LLM that
> just responds with block IDs, and it won't be as quick as Jev, but it might still be quicker.
>
> — Greg, 2026-10-03, feedback `spya-ats9dk`

Quick search asks Jev one yes/no question per paragraph: *"Does passage X match what the reader is
looking for (query)?"* It keeps paragraphs scoring 0.7 or more, best first, at most 20.

The 261002o spike measured 16 queries. They were phrases and questions. Greg's miss is a different
shape: **one word, naming a topic the article mentions in passing**. That shape had never been
measured.

## The short answer

- **The wording strongly affects short-topic retrieval.** On 18 short-topic queries the old
  wording returned **nothing at all on 56% of runs** and missed 109 of 141 literal-target
  opportunities (47 distinct query/block targets, each measured three times). The exact cause of
  Greg's saved zero-hit run remains unproved.
- **Changing the question substantially improves that measure.** *"Does passage X mention or
  discuss what the reader is looking for (query)?"* misses 17 of 141 opportunities. On the 8
  queries reported as held back, it found 27 of 27 opportunities (9 targets, three runs each).
  Reference recall on the spike's 16 phrases and questions rises from 0.70 to 0.78; this does
  **not** establish that their results are no worse, because known wrong hits also increase and
  many displayed hits are unjudged.
- **Keep the floor at 0.7 as a trade-off.** Floors of 0.6 and 0.65 find no more literal targets
  and keep more known junk; 0.5 recovers three more opportunities with more junk and unjudged hits.
- **Retain Jev for quick search on speed grounds.** The ids-only LLMs generally take longer on
  typical articles and keep more known junk on the short set, though DeepSeek improves recall.
  Costs depend on caching: its measured cached calls were cheaper than Jev. The detailed
  comparison below supports retaining Jev as a product choice, not an unqualified LLM defeat.

## What was measured

Run on 2026-10-03 from the Hetzner box. The scripts are saved as `.txt` beside the results in
[evals/results/quick-search-recall-2026-10-03/](../../evals/results/quick-search-recall-2026-10-03/),
for the reason 261002o gives (a committed `.ts` naming the Decisions endpoint must be declared as
spend). To re-run, copy them into a gitignored folder as `.ts` (they expect `data/qeval/`) and run
each with `npx tsx` from the worktree root. `lib.ts` imports `quickBlocks` and `chunkBlocks` from
`src/quick-search.ts`, so every Jev arm filters and chunks exactly as production does.

**Articles.** The three committed fixtures (Constitution, Noema, Agents), Wikipedia's *Replication
crisis* from the local database (505 askable blocks), and Greg's article (58 askable blocks of 77).
His article was read from production inside `begin read only` and kept in a gitignored folder. None
of its text is in the results: block ids, scores and timings only.

**Queries, 48 in four sets** (`queries.ts.txt`):

| set | n | what | used for |
|---|---|---|---|
| old | 16 | the spike's phrases and questions, with its saved Sonnet answers | does a change hurt what already worked? |
| short | 18 | short topics, mostly passing mentions: "Buddhism", "Freud", "cancer", "doctor", "poverty", "Google", "Twitter", "podcast"… Two have no literal match at all ("religion", "war") | choosing the wording and floor |
| held back | 8 | the same shape ("Heraclitus", "puberty", "lawyer", "coffee", "Mafia"…), written after the short set had run and before these were run | confirming the choice |
| absent | 6 | topics the article does not contain ("football", "cryptocurrency", "Buddhism" on the Constitution…) | false positives |

**The yardstick.** For the short set: the real meaning search (`findPassages`, standard power) once
per query, **plus** every askable block containing the query's stem (`/buddh/i`, `/freud/i`…). The
author reports that stems and target blocks were fixed before any arm ran. A reader who types one
word expects at least what find-in-page would give, so each literal mention an arm fails to return is counted on its
own ("literal missed"). For the held-back set the literal targets are the yardstick. For the old set
it is the saved Sonnet hits, restricted to askable blocks; that number is **reference recall**, not
recall, because Sonnet's list is not complete (261002o § Quality).

**Precision** was judged by hand. Every block any arm kept that was not already in the yardstick was
pooled per query and listed in article order, with no arm name and no score (`pool.ts.txt`), and
marked yes or no: 200 judgements in `judged.json`. On the old set only each arm's top 5 were pooled.

**Retrieval counts are measured after the cap of 20**, three runs per query. Precision excludes
unjudged hits rather than counting them as right or wrong. On the old set this leaves 114 displayed
hit occurrences unjudged for plain and 116 for mention, so it is not full-list precision.

**Spend: about $1.50** of a $5 ceiling. Jev $0.60, the Sonnet reference $0.27 (from the spend
ledger), Gemini $0.30, Luna about $0.17 (its responses report a cost of 0, so this is tokens at list
price), DeepSeek $0.05, probes $0.01.

## Why "Buddhism" missed

What Greg saw, from his saved runs (`greg-saved-runs.json`):

| run | kind | hits |
|---|---|---|
| "Buddhism" | quick | **0** |
| "Buddhism" | meaning (Sonnet) | 1: `spya-p2wrn0`, confidence 95 |
| "Evolution" | quick | 3 (72 to 74) |
| "Evolution" | meaning | 6 |

The quick run is stored with no hits, so nothing on the page hid them: the `?conf=` bar filters what
a run holds and this one held nothing.

The target is `spya-p2wrn0`, the seventh block. Sending exactly what production sends:

| question | answer |
|---|---|
| Was it asked about? | Yes. It is a text block and passes `quickBlocks`. |
| Chunks | **One.** 58 blocks, 13,450 tokens, well under the 26k budget. There is no boundary to blame. |
| Its score for "Buddhism" | **0.70 to 0.75** over 29 identical requests |
| Its rank | **1 of 58**, every time. The next block scored 0.55. |
| The cap | Not involved. At most one block cleared 0.7. |

**The floor is a plausible explanation, not a reproduced cause.** The target sits close to 0.7,
but none of 29 capital-B requests went below it. Greg's saved run stores no rejected scores;
it cannot show whether this target fell below 0.7. Lower-case "buddhism" scored 0.71, 0.69 and 0.71,
so one in three of those returned nothing. Both Greg's saved run and the eval name
`typesafe/jev-1.13-20260917`; the saved evidence does not establish a different model snapshot.
The saved eval probabilities are hundredths: no hidden sub-0.7 score rounded to 70 appears in
these files. Production filters the raw probability before rounding the displayed confidence, so
rounding could matter for an unsaved score, but it is not evidence for what happened in Greg's run.

How sensitive it is, on the shipped wording (three runs each, `out-repro.json`):

| query | target's score | kept |
|---|---|---|
| Buddhism | 0.71–0.73 | 1 |
| buddhism | 0.69–0.71 | 1, 0, 1 |
| Buddhist | 0.78–0.81 | 1 |
| no-self | 0.87–0.88 | 1 |
| Buddhist no-self | 0.87–0.88 | 1 |

The more of the paragraph's own words the query has, the higher it scores. One word of a different
form (Buddh*ism* against Buddh*ist*) is the worst case.

**Is it missing context?** A control, since repeating one request cannot tell (`counterfactual.ts.txt`):
the paragraph scored against "Buddhism" with less of the article beside it.

| what was sent with it | shipped wording | "mention or discuss" |
|---|---|---|
| the whole article (production) | 0.71–0.75 | 0.96 |
| the first half | 0.72–0.73 | 0.96 |
| 3 neighbours each side | 0.72–0.73 | 0.95–0.96 |
| the *other* half, without its neighbours | 0.59–0.62 | 0.93–0.94 |
| alone | 0.54–0.58 | 0.88–0.90 |

Context matters: without its neighbours the target loses about 0.1. With full context these
control runs score 0.71–0.75 on plain and 0.96 on mention. That supports a large wording effect
on this target, without identifying the cause of the earlier zero-hit run.

## Results

### Jev: five wordings at the 0.7 floor

| | wording of each question |
|---|---|
| plain (shipped) | Does passage X match what the reader is looking for (query)? |
| **mention** | Does passage X mention or discuss what the reader is looking for (query)? |
| brief | Is passage X about, or does it mention (even briefly), what the reader is looking for (query)? |
| want | Would a reader searching the article for the query want to be shown passage X? Yes if it is about the query or mentions it, even in passing. |
| relates | Does passage X contain anything related to the query? |

| wording | short: literal mentions missed (of 141) | short: runs returning nothing | short: yardstick recall | short: wrong blocks kept per search | held back: missed (of 27) | old: reference recall | old: kept (mean / most before the cap) | old: junk in top 5 |
|---|---|---|---|---|---|---|---|---|
| plain | **109** | **56%** | 0.28 | 0 | 15 | 0.70 | 9.8 / 56 | 0.40 |
| **mention** | **17** | 6% | 0.83 | 0.37 | **0** | 0.78 | 11.5 / 94 | 0.50 |
| brief | 16 | 6% | 0.84 | 0.43 | 0 | 0.82 | 12.4 / 130 | 0.50 |
| want | 21 | 6% | 0.80 | 0.33 | 0 | 0.87 | 12.7 / 177 | 0.48 |
| relates | 22 | 6% | 0.86 | 0.52 | not judged | 0.92 | 16.6 / 292 | not judged |

On the 6 absent topics every wording kept **nothing**, at any floor from 0.5 up. The top score was
0.11 at most on "mention" and 0.22 on "relates", the loosest.

The 6% is one query, "war" on the Agents article. Nothing there says "war"; Sonnet offered the
soldiers analogy and "Philip of Macedon". No wording found it (top score 0.34). The 17 literal
mentions still missed are nearly all "Evolution" on Greg's article: 17 paragraphs contain "evol",
and Jev keeps the 12 or 13 that are about it.

Latency and cost do not change. Typical article: 372 ms median, 444 ms p90, $0.0005 (plain: 369 ms,
477 ms). The 505-block article: 557 ms median, $0.0027 (plain: 538 ms). The new question is three
words longer, which adds 1.6% to the input.

### The floor, on the shipped wording and on "mention"

| wording | floor | short: literal missed | short: nothing returned | short: wrong kept per search | old: reference recall | old: most before the cap |
|---|---|---|---|---|---|---|
| plain | 0.5 | 61 | 28% | 0.41 | 0.90 | 152 |
| plain | 0.6 | 84 | 46% | 0.13 | 0.86 | 95 |
| plain | 0.65 | 92 | 54% | 0 | 0.82 | 78 |
| plain | 0.7 (shipped) | 109 | 56% | 0 | 0.70 | 56 |
| plain | within 0.15 of the top, and ≥ 0.5 | 64 | 28% | 0.20 | 0.65 | 53 |
| mention | 0.5 | 14 | 6% | 0.59 | 0.89 | 179 |
| mention | 0.6 | 17 | 6% | 0.48 | 0.85 | 122 |
| mention | 0.65 | 17 | 6% | 0.48 | 0.82 | 108 |
| **mention** | **0.7** | **17** | 6% | **0.37** | 0.78 | 94 |
| mention | 0.75 | 29 | 6% | 0.13 | 0.76 | 78 |
| mention | 0.8 | 43 | 6% | 0 | 0.65 | 65 |
| mention | within 0.15 of the top, and ≥ 0.5 | 31 | 6% | 0.09 | 0.72 | 65 |

**Lowering the floor does not rescue the shipped wording.** Even at 0.5 it misses 61 literal
mentions and returns nothing on 28% of runs. "doctor" tops out at 0.39, "Google" at 0.49.

**With "mention", retain 0.7 as the measured compromise.** Floors of 0.6 and 0.65 find no more
literal targets (17 missed at all three floors) and keep more known junk. At 0.5, misses fall to 14,
but known wrong hits rise from 20 to 32 across the 54 short-set runs, with 24 further displayed
hits unjudged. Above 0.7, real mentions drop out. This does not prove an optimum for all queries.

**A relative floor is the wrong tool.** Rescuing only a top score that falls just short
(`≥ 0.7, or within 0.05 of the top and ≥ 0.6`) changed nothing with the new wording. A floor that is
only relative, with no absolute part, kept **20 blocks on every absent-topic query**, because
something always scores highest (0.04 to 0.11 here). "Within 0.15 of the top" also throws away good
hits on the old set (0.72 against 0.78).

### A small LLM that answers with block ids

Prompt in `llm-lib.ts.txt`: the same askable blocks as `[id] text` lines, then the query. The
answer is a JSON array of ids, best first, at most 20, nothing else. Reasoning off. Streamed. Three
runs per query. A hit counts from the moment a complete, quoted id of a block we asked about has
arrived, not a fragment.

Candidates came from OpenRouter's live list. `openai/gpt-6-luna` (already `SHELF_TOPICS_MODEL`),
`deepseek/deepseek-v4.1-flash` (already `PAPER_METADATA_MODEL`) and
`google/gemini-3.1-flash-lite` ran the whole set.

| arm | short: literal missed | short: yardstick recall | short: wrong kept per search | short: junk in top 5 | held back: missed / wrong per search | old: reference recall | old: junk in top 5 | hit count moves between runs by up to |
|---|---|---|---|---|---|---|---|---|
| Jev, shipped | 109 | 0.28 | 0 | 0 | 15 / 0 | 0.70 | 0.40 | 2 |
| **Jev, "mention"** | 17 | 0.83 | 0.37 | 0.04 | 0 / 0.08 | 0.78 | 0.50 | 2 |
| Luna | 31 | 0.84 | 1.61 | 0.69 | 0 / 0.17 | 0.80 | 0.42 | 11 |
| DeepSeek flash | 10 | 0.91 | 1.83 | 0.19 | 0 / 0 | **0.91** | 0.33 | 9 |
| Gemini flash-lite | 21 | 0.89 | 0.50 | 0.24 | 0 / 0.42 | 0.82 | 0.50 | 6 |
| literal matches + Jev shipped | 0 | 0.77 | 0 | 0 | 0 / 0 | 0.70 | 0.40 | 2 |
| literal matches + Jev "mention" | 0 | 0.85 | 0.15 | 0.04 | 0 / 0.08 | 0.78 | 0.50 | 2 |

All three kept nothing on the absent topics. None failed: 432 calls, every answer parsed, one
made-up id in total.

| arm | typical article: first usable hit (median / p90) | typical: complete (median / p90) | 505 blocks: first hit | 505 blocks: complete (median / p90) | cost, typical / long, nothing cached |
|---|---|---|---|---|---|
| Jev | – (one body) | **0.37 s / 0.44 s** | – | **0.56 s / 1.1 s** | **$0.0005 / $0.0027** |
| Luna | 0.94 s / 1.5 s | 1.25 s / 2.1 s | 0.92 s | 1.8 s / 2.4 s | $0.0009 / $0.0041 |
| DeepSeek flash | 1.36 s / 1.6 s | 1.45 s / 2.0 s | 0.33 s | 0.72 s / 0.87 s | $0.0026 / $0.012 |
| Gemini flash-lite | 0.90 s / 1.2 s | 1.18 s / 1.8 s | 1.5 s | 2.2 s / 2.6 s | $0.0022 / $0.012 |

**The 505-block article fits in one call** for all three (40k to 47k tokens), so there is no
chunking. The article goes first in the prompt, so a second search of the same article is mostly a
cache read: DeepSeek's measured cost was $0.0002 and $0.0004 with the prefix cached, and its fast
time on the long article is a cached one. Luna and Gemini were no faster warm than cold.

## Read by hand

**What the shipped wording does to one-word queries.** These are the top scores, for a paragraph
that plainly contains the word: "doctor" 0.39, "Google" 0.49, "Twitter" 0.47, "mental health" 0.51,
"cancer" 0.52, "coding" 0.52 (six paragraphs about code, none kept), "poverty" 0.59. The model is
answering the question it was asked. A paragraph listing "a doctor, lawyer, financial advisor" does
not *match* "doctor"; it mentions one.

**What "mention" keeps that it should not.** Mostly the wider theme. Across the
26 one-word queries (short and held back) it kept a wrong block on three:
- "Evolution" on Greg's article kept 20, 20 and 18 blocks, of which the saved labels mark 7, 6
  and 5 wrong respectively: 28–35% of the displayed results. The cap bounds the count, not the
  proportion of wrong hits. It found 12, 13 and 12 of the 17 literal targets.
- "Twitter" kept, on two runs of three, a paragraph about what "the general public" knows.
- "kamikaze" kept one paragraph about the agents' secret channel. Its other 8 or 9 are right: the
  two that say the word, and the self-sacrifice episode around them, which is the concept the word
  names.

**What it finds that Sonnet did not.** On Greg's article, "Buddhism" also returned
`spya-nrvjwg`, judged relevant. On the Noema fixture, "immortality" returned the paragraph on
an "undying essence".
"mental health" and "lawyer" both returned the Constitution's line about failing to answer
"medical, legal, financial, psychological" questions.

**What Jev did not find on any wording.** "war", and half of "religion" (2 or 3 of Sonnet's 6: it
kept the soul and the "silicon rapture", and missed the techno-rapture and playing God). These need
the reasoning the meaning search does. They are what *thorough* is for.

**The LLMs flood differently.** They cannot be cut by a score, because they give none. On "coding",
DeepSeek returned 20 blocks on every run and Luna 20, 14 and 13: most of the Constitution's
helpfulness section. On "psychotherapy" Luna returned 5, 6 and 1. Their answers change more between
runs: Luna's hit count moved by up to 11 on one query, where Jev's moved by 2.

**The old set gains reference overlap but is not uniformly better.** Junk in the top 5 went from
0.40 to 0.50 a search. Across all displayed hits, known wrong occurrences went from 35 of 472 to
54 of 550, with 114 and 116 further occurrences unjudged respectively. On "Did any of the agents
blow the whistle?", plain has no known wrong hits in 10 displayed occurrences; mention has 4 in
16, while finding only 3 of the 4 reference targets on each run. Its extra results do not all
help. Three queries lose some reference overlap, and the 505-block article can still fill the cap:
94 blocks clear the floor on one query. Only the top five of each arm were pooled for judging on
this set, so full-list non-regression is untested.

## Recommendation, easiest and most valuable first

1. **Change the question's verb. Ship it.** One line in `questionFor` in `src/quick-search.ts`:

   ```
   Does passage ${id} mention or discuss what the reader is looking for (query)?
   ```

   Keep `QUICK_FLOOR = 0.7` and the cap of 20. This improves the short-topic shape: 3.1 blocks
   kept on average, nothing kept on the six absent-topic controls. That average hides the
   18–20-hit "Evolution" search with 5–7 wrong hits per run. The numbers for
   the constants' comments, all on this wording, 48 queries, 3 runs, 2026-10-03:

   | | measured |
   |---|---|
   | reference recall on the spike's 16, at 0.7, after the cap | 0.78 (the shipped wording, same day: 0.70) |
   | the same at 0.65 / 0.75 / 0.8 | 0.82 / 0.76 / 0.65 |
   | literal mentions missed on 18 one-word queries, at 0.7 | 17 of 141 (shipped wording: 109) |
   | the same at 0.6 / 0.75 / 0.8 | 17 / 29 / 43 |
   | held-back one-word queries | 27 of 27 found, 0.08 wrong blocks a search |
   | blocks over the floor before the cap, worst case | 94 of 505 (shipped wording: 56) |
   | absent topics | 0 kept; top score 0.04–0.11 |
   | latency, typical article | 372 ms median, 444 ms p90 |
   | latency, 505 blocks in 4 chunks | 557 ms median (15 runs; one took 1.1 s) |
   | cost | $0.0005 typical, $0.0027 for 505 blocks |

   Between "mention" and "brief" there is nothing to choose on these numbers. "mention" is shorter
   and floods less (94 against 130 before the cap), so it is the one to ship. "want" has the best
   reference recall on the old set (0.87) but the longest question, the least stable hit count
   (moves by up to 6) and more literal misses.

2. **Optional, cheap, no model: add literal matches.** Put blocks containing the query's words at
   the top, then Jev's hits. It takes literal misses to zero and costs nothing. It needs a decision
   about what "contains" means for two-word queries and word forms (I matched hand-written stems,
   which code cannot do), so it is a small design job rather than a constant. With the new wording
   the gain is small: 17 missed becomes 0, nearly all of it on one broad query.

3. **Do not switch to an ids-only LLM now.** On the short set, DeepSeek misses 10 literal-target
   opportunities against Jev's 17, but keeps 1.83 known wrong blocks per search against 0.37.
   The LLMs complete typical-article searches in 1.18–1.45 s against Jev's 0.37 s, and their hit
   counts vary more. DeepSeek's cached long-article result completes in 0.72 s against 0.56 s;
   its first usable hit arrives sooner, and its measured cached calls cost less than Jev's.
   No uncached long-article DeepSeek timing was measured. Its real
   advantage is on phrases and questions, where DeepSeek flash reached 0.91 reference recall against
   0.78. That is a reason to consider it later as a middle tier between quick and thorough, not a
   reason to replace quick. It would need a new prompt, a model constant, a spend declaration and
   streaming. This is Greg's call; the numbers are above.

## Dead ends

- **Lowering the floor on the shipped wording.** At 0.5 it still returns nothing on 28% of one-word
  searches, and lets 152 blocks over the floor on the long article.
- **A floor relative to the top score.** With an absolute part it changed nothing once the wording
  was fixed. Without one it returns 20 blocks for a topic the article does not contain.
- **"Contain anything related to".** Best recall, and it floods: 292 of 505 blocks over the floor,
  16.6 kept on an average old-set search.
- **`inception/mercury-2.5`.** It reasons whether asked to or not, spent its whole output budget
  doing so, and returned no answer in 4.5 s and 6.8 s.
- **`google/gemini-3.5-flash-lite`.** Refuses a request with reasoning turned off (HTTP 400,
  "Reasoning is mandatory for this endpoint").
- **`qwen/qwen3.7-flash`.** For "Buddhism" it returned the keywords line, not the paragraph.
- **Luna with `reasoning.effort: "minimal"`.** It still reasoned on the long article (248 tokens)
  and took 4.2 s against 2.3 s with `"none"`.

## What this does not show

- **The literal yardstick measures mention coverage, not semantic relevance.** It deliberately
  favours finding stems and counts those hits as good without separate relevance judging. The
  improvement supports that intended use; it cannot establish general semantic precision.
- **Predeclaration and the held-back choice are author reports.** The saved scripts describe
  targets frozen before running and a wording chosen before confirmation, but the committed
  artifacts contain no timestamped target manifest or choice record. There is no affirmative
  evidence of leakage, and the chronology cannot be independently verified from these files.
- **Three runs do not establish broad non-regression.** Old-set mean reference recall ranges
  0.677–0.716 across plain's repeats and 0.774–0.790 across mention's: the aggregate gain exceeds
  that observed noise. Some per-query changes amount to one target on one repeat. Neither this
  small sample nor the single judge establishes equivalence or significance on unseen queries.
- **The judging was one reader's**, mine, and the yes/no line for "is this about Evolution" is a
  judgement. The literal counts and the reference recall do not depend on it.
- **The held-back set has no meaning-search reference**, only literal targets. It confirms that
  mentions are found, not that concept matches are.
- **Greg's zero was not reproduced exactly.** 29 requests scored the paragraph 0.70 to 0.75. His
  saved run has no hits. The explanation (a score sitting on the floor, which moves between runs)
  fits, and lower-case did go under once, but I did not see a capital-B run under 0.7.
- **Long-article latency is 15 runs per wording.** The 1.1 s p90 is the second-highest duration
  (nearest-rank percentile), so the upper tail is based on only two runs. Typical-article timing
  includes six runs on two superseded query strings in addition to the declared query set.
- **LLM costs for Luna are estimates** at list price, because its responses report a cost of 0.
- **Only one long article.** A 505-block article entirely about a one-word query would fill the cap
  on any wording; the "mention" wording gets there sooner.
