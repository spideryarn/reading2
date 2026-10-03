# Shelf topics: can they be concepts rather than phrases?

Run 2026-10-03 for report `spya-ntyes8`
([note](../user-feedback/260930_0715-shelf-topics-as-concepts-topic-model-or-clustering.md)). The
options it chose between are in
[research 261003a](../research/261003a-topic-models-and-clustering-for-shelf-topics.md); what we
propose to do with the answer is
[plan 261003f](../plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md).

## The question

> I look at the topics and they don't seem like high-level concepts that I would use to group and
> organize my articles myself if I was coming up with them. Or at least some of them do, like, you
> know, there's one for Buddha, one for AI. […] But there's others like "principles" and "writers"
> that seem a bit generic/arbitrary.
>
> — Greg, 2026-09-30

Today a pill is a phrase the articles literally use, found by a program, and GPT-6 Luna only scores
those phrases ([shelf-terms.md](../project/shelf-terms.md)). Would the topics be better if the
label did not have to be a phrase from the text, and if so, should a program group the articles
first, or should the model do the grouping too?

## What was compared

| arm | how it picks |
|---|---|
| **program-only** | today's list with no model |
| **production** | today's list: the program's phrases, scored by GPT-6 Luna |
| **induce** | one GPT-6 Luna call reads every title and one-sentence gist, proposes about √n topics named "the way this reader would label a shelf", and lists each topic's articles. An article may be in several |
| **cluster** | `voyage-4` embeds each title and gist; Louvain on the nearest-neighbour graph finds the groups, so nobody sets the count; one Luna call names all the groups; an article also joins another topic when it is as close to that topic's label as the topic's median member |

Six synthetic shelves, two runs of each arm. Five are the 12-to-22-article shelves of the
2026-09-29 eval ([261002e](261002e-shelf-topics-which-model-picks-the-pills.md)). The sixth,
**greg-wide**, was written for this: 96 articles across twelve areas (computational neuroscience,
consciousness, Buddhism, AI, AI safety, writing, productivity, philosophy of science, economics,
history of science, education, startups), half of them in two areas, with *principles*, *writers*,
*lessons*, *framework* and four more generic words recurring across all of them. Each article
records the areas it was written for, which the arms never see.

Judging: six fresh Opus subagents, one per shelf, each reading only its own pairs file, with every
topic's full member titles and the arms unnamed and shuffled. **Only run 1 of each arm was judged.**
The brief each judge was given is in the eval's
[README](../../evals/shelf-topic-clusters/README.md).

## The numbers

Source: [`evals/shelf-topic-clusters/results/summary.md`](../../evals/shelf-topic-clusters/results/summary.md)
(`summarise.ts`), the judges' verdicts in `results/judgements/` joined to `results/pairs-key.json`
by `tally.ts`, and `results/file-one.txt` (`file-one.ts`).

**The blind judge, one verdict per shelf:**

| contrast | result |
|---|---|
| induce against production | **induce 6, production 0** |
| induce against cluster | **induce 6, cluster 0** |
| cluster against production | cluster 4, production 2 |

Mean judge scores out of 10 (each arm's six run-1 lists were each rated in two pairs, so twelve
ratings an arm): induce 8.5 meaningful, 8.8 membership, 9.7 coverage; cluster 7.3, 5.8, 9.7;
production 4.7, 4.3, 7.7.

**greg-wide, the first twelve pills, run 1:**

- **production**: cortex 6, neuron 3, agent 3, reward 3, consciousness 3, training 4, prediction 4
- **induce**: Computational neuroscience 13, Consciousness 11, Buddhism 12, Artificial intelligence
  19, AI safety 6, Meditation 9, Writing 14, Learning and memory 10, Philosophy of science 10,
  Economics 9, Productivity 6, History of science 7 (and a thirteenth, *Business* 8, behind
  *All N topics*)
- **cluster**: Philosophy of science 28, Computational neuroscience 20, Artificial intelligence 19,
  Writing and productivity 19, Buddhism 15, Consciousness 9

| greg-wide | topics | articles reached | in two or more | intended areas matched (F1 ≥ 0.6) | run 1 against run 2 | cost | seconds |
|---|---|---|---|---|---|---|---|
| production | 8 | 27% | 8% | 0 of 12 | 1.00 | $0.0006 | 10 |
| induce | 12.5 | 100% | 32% | 12 of 12 | 0.89 | $0.0028 | 44 |
| cluster | 6 | 100% | 13% | 5 of 12 | 0.99 | $0.0007 | 4.5 |

"Intended areas matched" counts every topic, not only the first twelve: induce's first twelve match
11 of the 12 areas and *Business* makes the twelfth. "Run 1 against run 2" is, for each run-1
topic, the best overlap of its articles with any run-2 topic, averaged; it is not a share of
identical groups, and across the six shelves induce's ranged from 0.81 to 1.00. Cluster's seconds
leave out its two embedding calls.

On the five small shelves induce gave 3 to 6 topics where production gave 7 to 17: *Vegetable
gardening, Fermentation, Soil health, Seasonal cooking* against *soil health, kimchi, sourdough,
seed saving, seasonal cooking, compost, season, beekeeping, kitchen, tomatoes grown, harvest*.

**Filing one new article into existing topics** (twelve greg-wide articles, one call each, shown
only the thirteen labels and that article's title and gist): 10 of 12 landed in exactly the topics
the whole-shelf call had put them in, and the two that differed each added one topic. 212 tokens
in, 62 out, **$0.00005 and 3.4 seconds an article**. This shows the price, and that the model
agrees with itself. It does not show the filing is right: nothing independent judged it, and no
article that fits no topic was tried.

**What the whole-shelf call costs as the shelf grows**, two runs each: 22 articles, 1,124 tokens in
and 2,219 or 1,892 out, $0.0011 and $0.0010, 21 and 17 s; 96 articles, 4,871 in and 4,566 or 5,282
out, $0.0023 and $0.0032, 40 and 48 s. That is about 50 tokens in and 50 out per article, so about
$0.00003 an article each time the whole shelf is asked about.
A thousand articles in one call would be about three cents and, on the same slope, several minutes.
**That last sentence is arithmetic, not a measurement**: nothing here ran above 96.

The whole eval cost about three and a half cents by the ledger lines the runs printed: the new arms, their reruns after the two fixes below, the production arm on all six shelves, and the filing test.

## What it shows

1. **Letting the model write the label is what changes the pills.** Both arms that do it produced
   the level Greg asked for, on every one of these synthetic shelves, with none of the planted
   generic words among the first twelve. Production cannot: it has
   no candidate called *Writing* to score.
2. **The model grouped better than this embedding pipeline did.** That is a finding about one
   pipeline (Louvain on a neighbour graph, then a similarity rule for overlap, which caused some of
   the misfiling), not about clustering as a class; induce was also told roughly how many topics to
   make and clustering was not. It is enough to say embeddings are not worth their extra parts
   yet. The clustering's labels were
   right but its buckets were coarse and misfiled: 28 articles under *Philosophy of science*,
   housing costs and auctions among them, and central banks under *Artificial intelligence*. Its
   bolted-on overlap is weak (13% of articles in two topics against 32%).
3. **Clustering's real advantages are cost and repeatability**, and neither is needed yet. It is a
   quarter of the price and nearly identical between runs. But induce is already a quarter of a
   cent at 96 articles, and its run-to-run overlap was 0.81 to 1.00.
4. **Filing a new article against a fixed list is cheap and agrees with the whole-shelf answer**,
   so it is an affordable way to sort an article the moment it arrives. The plan does not rely on
   it: re-thinking the whole shelf only at each tenth of growth is cheaper still and has one prompt
   rather than two.

## Dead ends, and one thing changed after seeing results

- **The clustering arm's neighbour count was changed after its first run.** A flat ten neighbours
  made a 13-article shelf one near-complete graph and Louvain found one or two groups. It is now
  √n, between 3 and 10. The numbers above are from after the change. Nothing else was tuned.
- **Classical topic models (LDA, HDP, GSDMM)** were not run: no maintained JavaScript
  implementation, unreliable below a few hundred documents, and their output is a word list, which
  is the problem we started with. Research 261003a has the detail.
- `show.ts` at first imported `run.ts`, which ran the paid eval on import. Guarded now.

## Caveats

- **Greg's own shelf was not in it**, nor the local database's real shelf: this session was refused
  both reads. Every shelf here was written by a model, and a real shelf is messier: odd one-offs,
  several languages, long books. **His reading of his own pills is still the decisive check**, and
  the plan's first stage is built so he can make it.
- **greg-wide flatters the new arms against production.** Its articles are 120 to 180 words, so the
  phrase program has far less text to find phrases in than a real article gives it. It reached 27%
  of this shelf; plan 260928a measured 92% on the local database's real shelf. The 6–0 does not rest
  on it: induce also won the five older shelves, whose articles are about 400 words each and which
  production covers fully. They are still much shorter than a real article.
- The judge and the author of the shelves are the same model family. One judge per shelf, one
  verdict per contrast, on run 1 only; no swapped duplicates and no identical-list control this time.
- Luna's cost includes its reasoning tokens, which vary run to run.

## Re-run

```
npx tsx evals/shelf-topics/build-cases.ts --synthetic                    # the shelves
npx tsx evals/shelf-topics/run-arms.ts --arm luna-score                  # PAID: today's production list
npx tsx evals/shelf-topics/run-arms.ts --arm baseline
npx tsx evals/shelf-topic-clusters/run.ts                                # PAID: induce and cluster, two runs
npx tsx evals/shelf-topic-clusters/summarise.ts                          # results/summary.md
npx tsx evals/shelf-topic-clusters/make-pairs.ts                         # what the judge reads
npx tsx evals/shelf-topic-clusters/tally.ts                              # verdicts joined to the key
npx tsx evals/shelf-topic-clusters/file-one.ts                           # PAID: filing one article
```

Up: [investigations.md](../project/investigations.md)
