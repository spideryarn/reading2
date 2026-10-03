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

- **The wording is the cause.** "Does passage X *match*…" makes Jev ask whether the paragraph *is
  the thing*. A paragraph that only mentions the topic scores 0.4 to 0.75. On 18 one-word queries
  the shipped search returned **nothing at all on 56% of runs** and missed 109 of 141 literal
  mentions.
- **One changed verb fixes it.** *"Does passage X mention or discuss what the reader is looking for
  (query)?"* scores the same paragraphs 0.81 to 0.97. Literal mentions missed fall from 109 to 17 of
  141. On 8 queries held back until the wording was chosen, it found 27 of 27. It also does
  better on the spike's 16 phrase and question queries (0.78 against 0.70).
- **The floor stays at 0.7.** With the new wording a lower floor finds nothing more and keeps more
  junk. A floor relative to the top score is worse on every count.
- **A small LLM that answers with ids works, and is not better enough to switch.** It takes 1.2 to
  2.2 seconds against Jev's 0.4, costs 2 to 15 times as much, and on the one-word shape it is level
  with Jev plus the new wording while keeping more junk.

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
| short | 18 | one or two words, mostly passing mentions: "Buddhism", "Freud", "cancer", "doctor", "poverty", "Google", "Twitter", "podcast"… Two have no literal match at all ("religion", "war") | choosing the wording and floor |
| held back | 8 | the same shape ("Heraclitus", "puberty", "lawyer", "coffee", "Mafia"…), written after the short set had run and before these were run | confirming the choice |
| absent | 6 | topics the article does not contain ("football", "cryptocurrency", "Buddhism" on the Constitution…) | false positives |

**The yardstick.** For the short set: the real meaning search (`findPassages`, standard power) once
per query, **plus** every askable block containing the query's stem (`/buddh/i`, `/freud/i`…). The
stems and their target blocks were fixed before any arm ran. A reader who types one word expects at
least what find-in-page would give, so each literal mention an arm fails to return is counted on its
own ("literal missed"). For the held-back set the literal targets are the yardstick. For the old set
it is the saved Sonnet hits, restricted to askable blocks; that number is **reference recall**, not
recall, because Sonnet's list is not complete (261002o § Quality).

**Precision** was judged by hand. Every block any arm kept that was not already in the yardstick was
pooled per query and listed in article order, with no arm name and no score (`pool.ts.txt`), and
marked yes or no: 200 judgements in `judged.json`. On the old set only each arm's top 5 were pooled.

**Everything is measured after the cap of 20**, three runs per query.

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

The paragraph is `spya-p2wrn0`, the seventh block. It names "Buddhist and Indic conceptions of the
no-Self" in one clause. Sending exactly what production sends:

| question | answer |
|---|---|
| Was it asked about? | Yes. It is a text block and passes `quickBlocks`. |
| Chunks | **One.** 58 blocks, 13,450 tokens, well under the 26k budget. There is no boundary to blame. |
| Its score for "Buddhism" | **0.70 to 0.75** over 29 identical requests |
| Its rank | **1 of 58**, every time. The next block scored 0.55. |
| The cap | Not involved. At most one block cleared 0.7. |

**So it is the floor.** The best paragraph in the article sits on 0.7, and Jev's score for the same
request moves between runs (by up to 0.11, per the spike). Greg's run landed under; mine landed just
over. I did not reproduce the zero with a capital B in 29 tries. Lower-case "buddhism" scored 0.71,
0.69 and 0.71, so one in three of those returned nothing.

How sensitive it is, on the shipped wording (three runs each, `out-repro.json`):

| query | target's score | kept |
|---|---|---|
| Buddhism | 0.70–0.75 | 1 |
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

Context matters a little: without its neighbours the paragraph loses about 0.1. But with every bit
of context it still only reaches 0.73. The wording moves it by 0.23. **It is a wording problem, with
a small context effect on top.**

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
0.14 at most on "mention" and 0.22 on "relates", the loosest.

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

**With "mention", 0.7 is still the right floor.** Below it, nothing more is found (17 missed at 0.6,
0.65 and 0.7) and more junk is kept. Above it, real mentions drop out.

**A relative floor is the wrong tool.** Rescuing only a top score that falls just short
(`≥ 0.7, or within 0.05 of the top and ≥ 0.6`) changed nothing with the new wording. A floor that is
only relative, with no absolute part, kept **20 blocks on every absent-topic query**, because
something always scores highest (0.04 to 0.14 here). "Within 0.15 of the top" also throws away good
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

**What "mention" keeps that it should not.** Little, and of one kind: the wider theme. Across the
26 one-word queries (short and held back) it kept a wrong block on three:
- "Evolution" on Greg's article kept 18 to 20 blocks. Six or seven a run were paragraphs on
  metamorphosis, regeneration and embryos that never speak of evolution. This is the flood the
  spike warned about, on an article half about the query. The cap holds it at 20.
- "Twitter" kept, on two runs of three, a paragraph about what "the general public" knows.
- "kamikaze" kept one paragraph about the agents' secret channel. Its other 8 or 9 are right: the
  two that say the word, and the self-sacrifice episode around them, which is the concept the word
  names.

**What it finds that Sonnet did not.** "Buddhism" also returned the closing paragraph, which calls
the paradox a "Zen-like riddle". "immortality" returned the paragraph on an "undying essence".
"mental health" and "lawyer" both returned the Constitution's line about failing to answer
"medical, legal, financial, psychological" questions.

**What Jev did not find on any wording.** "war", and half of "religion" (2 or 3 of Sonnet's 6: it
kept the soul and the "silicon rapture", and missed the techno-rapture and playing God). These need
the reasoning the meaning search does. They are what *thorough* is for.

**The LLMs flood differently.** They cannot be cut by a score, because they give none. On "coding",
DeepSeek returned 20 blocks on every run and Luna 20, 14 and 13: most of the Constitution's
helpfulness section. On "psychotherapy" Luna returned 5, 6 and 1. Their answers change more between
runs: Luna's hit count moved by up to 11 on one query, where Jev's moved by 2.

**The old set is not hurt.** Junk in the top 5 went from 0.40 to 0.50 a search, which is one extra
wrong block every ten searches. The kinds are the ones 261002o lists: bibliography entries on the
Wikipedia article, and polarity ("things Claude should never do" still returns the list of ways it
is over-cautious).

## Recommendation, easiest and most valuable first

1. **Change the question's verb. Ship it.** One line in `questionFor` in `src/quick-search.ts`:

   ```
   Does passage ${id} mention or discuss what the reader is looking for (query)?
   ```

   Keep `QUICK_FLOOR = 0.7` and the cap of 20. This alone fixes the shape Greg hit, without
   flooding: 3.1 blocks kept on a one-word search, nothing kept on an absent topic. The numbers for
   the constants' comments, all on this wording, 48 queries, 3 runs, 2026-10-03:

   | | measured |
   |---|---|
   | reference recall on the spike's 16, at 0.7, after the cap | 0.78 (the shipped wording, same day: 0.70) |
   | the same at 0.65 / 0.75 / 0.8 | 0.82 / 0.76 / 0.65 |
   | literal mentions missed on 18 one-word queries, at 0.7 | 17 of 141 (shipped wording: 109) |
   | the same at 0.6 / 0.75 / 0.8 | 17 / 29 / 43 |
   | held-back one-word queries | 27 of 27 found, 0.08 wrong blocks a search |
   | blocks over the floor before the cap, worst case | 94 of 505 (shipped wording: 56) |
   | absent topics | 0 kept; top score 0.04–0.14 |
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

3. **Do not switch to an ids-only LLM now.** On the shape that failed it is level with the fixed
   Jev, keeps more junk, is three to five times slower, and its answers vary more. Its real
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

- **The judging was one reader's**, mine, and the yes/no line for "is this about Evolution" is a
  judgement. The literal counts and the reference recall do not depend on it.
- **The held-back set has no meaning-search reference**, only literal targets. It confirms that
  mentions are found, not that concept matches are.
- **Greg's zero was not reproduced exactly.** 29 requests scored the paragraph 0.70 to 0.75. His
  saved run has no hits. The explanation (a score sitting on the floor, which moves between runs)
  fits, and lower-case did go under once, but I did not see a capital-B run under 0.7.
- **Long-article latency is 15 runs per wording.** The 1.1 s p90 for "mention" is one slow request.
- **LLM costs for Luna are estimates** at list price, because its responses report a cost of 0.
- **Only one long article.** A 505-block article entirely about a one-word query would fill the cap
  on any wording; the "mention" wording gets there sooner.
