# Shelf topics that take in more articles: what it gains and what it costs

Up: [investigations.md](../project/investigations.md) · the plan is
[261004j](../plans/261004j-shelf-topic-pills-more-inclusive-and-public-shelf-pills-awaiting-greg.md) ·
the feature is [shelf-terms.md](../project/shelf-terms.md)

**In one paragraph.** Greg said the topic pills were too tight: a *Memory & Learning* pill did not
hold Levin's memory paper (report `spya-d4tp0y`, 2026-10-04). The cause was the shape of the tree:
that pill was made inside *AI & Computing* and could only hold AI & Computing's articles. Prompt
version 2 adds a pass that shows every article every topic as one flat list. On Greg's real shelf
the average article goes from about 2 topics to about 3, and the Levin paper lands in the memory
pill in 7 of 8 tries. The cost is sharpness: on a synthetic shelf, the share of an article's
specific pills that are what it was written about falls from about 0.35 to about 0.25.

All runs are GPT-6 Luna through production's own `rethink` and `fileWorks`
(`src/shelf-terms/model-topics.ts`), 2026-10-04. **v1** is that file at commit `b1d0734a`, kept
beside the evals for the comparison and loaded with `--impl`; **v2** is the file as shipped in
261004j. Total spend about 40 cents.

## The complaint, read from production

`npx tsx evals/shelf-topic-clusters/stored-tree.ts --report spya-d4tp0y --find self-improvis`
(read-only: one `begin read only` transaction, rolled back). Greg's stored tree: 45 articles, 15
topics, prompt v1, 2.24 topics per article, 3 articles in no topic.

- *AI & Computing* (23) holds *Memory & Learning* (5).
- *Cognitive Science* (13) holds *Memory & Self* (3) and *Learning & Control* (4).
- *Self-Improvising Memory: A Perspective on Memories as Agential…* is in *Cognitive Science*,
  *Philosophy* and *Memory & Self*. Its one-sentence summary is plainly about memory.

A finer topic is named by a call shown only its parent's articles, so *Memory & Learning* never
saw the paper.

## Greg's shelf, re-thought from scratch

`replay-shelf.ts --shelf <the shelf as stored-tree.ts --json wrote it> --out <file>`. The shelf file
holds his titles and is not committed.

| | topics | topics per article | in no topic (of 45) | largest broad pill, share of shelf | Levin paper in a memory pill |
|---|---|---|---|---|---|
| v1, run 1 | 13 | 1.76 | 4 | | yes (*Memory*) |
| v1, run 2 | 11 | 1.80 | 6 | | **no**: *Memory & Learning* was inside *AI* again |
| v1, run 3 | 15 | 2.29 | 2 | 0.47 | yes |
| **v2, run 1** | 14 | 2.89 | 2 | 0.60 | yes (*Memory*), but not in *Memory & Learning* inside *AI* |
| **v2, run 2** | 20 | 4.18 | 3 | 0.56 | yes, in both memory pills |

Two samples of one prompt differ a lot (1.76 to 2.29 on v1), because every re-think names a
different tree. v2 is above that spread, on two runs.

## Holding the tree still: the filing prompt on its own

A re-think cannot isolate the filing prompt, since the tree changes each time. So
`widen-stored.ts` files every article into the tree Greg **already has** and reports what each
topic gains. Two runs per row.

| what the filing call was shown | AI & Computing (was 23) | Memory & Learning (was 5) | Levin gains *Memory & Learning* |
|---|---|---|---|
| an indented tree, plus "judge each topic by its own name"; parents added | 28, 28 | 5, 5 | no, no |
| a flat list; parents added | 36, 34 | 10, 11 | yes, yes |
| **a flat list; parents not added (shipped)** | 26, 26 | 10, 9 | yes, yes |

- **The indent is what kept the paper out.** Under *AI* the model read the pill as "memory, in AI",
  and a sentence telling it otherwise changed nothing.
- **Adding the parent swamps the broad pill.** 36 of 45 articles in *AI & Computing* is a pill that
  no longer narrows. Without it, 26.
- Topics per article over the stored tree: 2.24 to 3.33, both runs.

The same on the tree from "v2, run 1" above, where the full re-think had missed: the filing call
added the paper to *Memory & Learning* in 2 of 2. So across eight filing passes the paper reached
the pill in seven. The miss was one sample, with two near-identical pills (*Memory* and *Memory &
Learning*) on offer.

## What it costs: a shelf that knows what each article is about

`hier.ts --shelf greg-wide` (96 synthetic articles over twelve intended areas; the model never sees
the areas). `--tag` keeps each arm's file: `results/hier-greg-wide-v1a.md`, `-v1b.md`, `-v2a.md`,
`-v2b.md`.

| | v1 | v2 |
|---|---|---|
| topics per article | 2.17, 2.26 | 3.17, 3.13 |
| share of an article's intended topics it is in | 0.82, 0.80 | 0.85, 0.89 |
| mean best-topic F1 per intended area | 0.76, 0.82 | 0.82, 0.84 |
| share of an article's **specific** placements that are an intended topic, nothing forgiven | 0.34, 0.37 | 0.22, 0.29 |
| share of placements wrong, forgiving a topic inside a right one (the re-think) | 0.05, 0.05 | 0.13, 0.09 |
| the same, for held-out articles filed afterwards | 0.12, 0.13 | 0.14, 0.17 |

- **More of what should be found is found**: 0.81 to 0.87.
- **Each pill is less pure.** The strict measure is low in both arms, because finer topics are not
  among the twelve intended areas and so always count against it; it is a comparison, not a grade.
  It falls by about a third.
- The broad areas are found as well as before (F1).

## A one-field shelf: where it goes furthest

`hier.ts --shelf expert-150` (150 articles: 138 neuroscience over ten sub-areas, a few Buddhism and
carpentry). One run an arm: `results/hier-expert-150-v1a.md`, `-v2a.md`.

| | v1 | v2 |
|---|---|---|
| topics per article | 4.37 | **7.83** |
| share of an article's intended topics it is in | 0.91 | 0.93 |
| mean best-topic F1 per intended area | 0.88 | 0.90 |
| specific placements that are an intended topic, nothing forgiven | 0.17 | 0.11 |
| share of placements wrong, forgiving (re-think; filed afterwards) | 0.00; 0.00 | 0.00; 0.01 |

**This is the result to watch.** On a shelf that is nearly all one field, with about forty topics,
an article ends up in nearly eight of them, almost twice as many as before, for two points of
recall. The intended areas are still found (F1 holds), so a pill still means something; but each
finer pill is noticeably fuller. If a reader with a large one-field shelf finds the pills too
loose, this is the number that said so first, and the lever is the wording of `BELONGS`.

## What this does not show

- Two runs an arm. Enough to see the direction; not a confidence interval.
- One real shelf, Greg's. The synthetic shelves were written to have clean areas.
- Nobody judged the new memberships by eye beyond the memory pills. *Human Cognition* inside
  *Language Models* took 18 articles in one v2 run: right by its name, and wider than the model
  that named it meant.
- "Largest finer topic as a share of its parent" in `hier.ts` and `replay-shelf.ts` compares two
  sizes. Since v2 a finer topic can be bigger than its parent, so that number can pass 1 and no
  longer means "narrows nothing". The rule the code enforces is on the articles the two share, and
  the unit tests cover it.
- The earlier variant with an indented tree and parents added was also run on `greg-wide` (3.04 and
  2.50 topics per article); those files were not kept.
