# Does hierarchy's structure pass need to think at `medium`? — `medium` vs `low`

Run 2026-09-03. **Provisionally keep `medium`, on caution rather than on proof.**

On one long article, `low` was 36% cheaper and 47% faster, produced more top-level parts, and
produced more range-repair events — including three successful draws where a proposed section was
dropped, against none in ten `medium` draws. Those mechanical proxies justify staying put. **They do
not establish that `medium` builds better trees**, and nothing here has asked a human.

**Why it was run.** Hierarchy structure is 14% of a long article's ingest, the one paid step every
article pays, and ~80% of its output tokens are reasoning. Both Fable and GPT Sol independently
ranked "is `medium` earning its keep" as the largest unmeasured lever in the pipeline. The `EFFORT`
comment in [`src/hierarchy.ts`](../../src/hierarchy.ts) says the setting "has now been wrong in both
directions twice" and was chosen by a truncation postmortem, never by a quality comparison.

**This run could not have been done before it.** The harness's `incumbent` arm declared
`effort: "high"` while production ran `"medium"`, so `smart-low` — the arm whose whole purpose is to
isolate the single variable `effort` — was answering high-vs-low. Fixed first (commit `eafb8bdc`);
these are the first runs in this harness that compare against what ships.

## The corpus, and why it is one article

`data/` here held three of the manifest's documents and the manifest was stale: `constitution` is 84
blocks and 4,797 words in this tree, not the 360 blocks it claims. None reached the length where
hierarchy costs real money.

So the fixture is [`evals/extraction/fixtures/gwern.html`](../../evals/extraction/fixtures/gwern.html)
through stages 2 and 3 — **184 blocks, 16,846 words, 24 headings** — which is the `long-html` fixture
[the cost report](cost-per-article-2026-09-03.md) measured at 186 blocks and 16,855 words.
`incumbent` priced at $0.21/draw here against $0.2138 median there, so the two agree.

**One article.** Everything below is a fact about this piece at this length.

## The numbers

Ten `medium` draws (`incumbent` and `incumbent-repeat` are the same recipe, so they pool) and eight
`low`. Every paid call reconciled against OpenRouter's own records.

| | `medium` (production) | `low` |
|---|---:|---:|
| produced a tree | 10/10 | 7/8 |
| cost per draw | $0.21 (sd $0.03) | **$0.13** (sd $0.02) |
| seconds | 141 (sd 30) | **74** (sd 18) |
| output tokens | 15,203 | **7,548** |
| top-level parts | 7.30 | 9.29 |
| blocks moved by repair | **2.70** | 7.14 |
| largest single repair | **0.70** | 1.57 |
| draws that dropped a section | **0/10** | 3/7 |
| gist retention | 53.0% | 50.6% |
| gist length, words | 22.4 | 19.0 |
| depth-1 parts starting on an author heading | 96.7% | 95.8% |

## How to read this run, and how not to

`incumbent` and `incumbent-repeat` are byte-identical recipes, so their disagreement is a useful
informal sense of run-to-run variation, and every measure below is shown against it.

**It is not a significance test, and this document previously treated it as one.** GPT Sol's review
is right that `|mean(incumbent) − mean(incumbent-repeat)|` is a single noisy realisation of a
difference whose expected value is zero: it can approach zero by cancellation and produce enormous
ratios, it shrinks as the subgroups grow while per-run noise does not, and it describes only
`medium`'s variability when `low`'s may differ. So "clears the floor" below means **worth a second
look**, never "established".

| measure | `medium` | `low` | gap | same-recipe gap |
|---|---:|---:|---:|---:|
| draws that dropped a section | 0.00 | 0.43 | 0.43 | 0.00 |
| top-level parts | 7.30 | 9.29 | 1.99 | 0.08 |
| largest single repair | 0.70 | 1.57 | 0.87 | 0.08 |
| blocks moved by repair | 2.70 | 7.14 | 4.44 | 1.17 |
| fan-out within the prompt's 5–9 | 41.0% | 31.8% | 9.2 | 2.9 |
| seconds | 141 | 74 | 66 | 21.8 |
| cost | $0.209 | $0.133 | $0.077 | $0.027 |
| output tokens | 15,203 | 7,548 | 7,655 | 2,722 |
| gist retention | 53.0% | 50.6% | 2.4 | 0.9 |
| gist length, words | 22.4 | 19.0 | 3.40 | 1.56 |
| part size imbalance (cv) | 0.50 | 0.72 | 0.21 | 0.10 |
| — the gap is at or under the same-recipe gap below here — | | | | |
| **depth-1 parts on an author heading** | **96.7%** | **95.8%** | **0.8** | **1.4** |
| title retention | 71.0% | 67.6% | 3.4 | 3.4 |
| boundaries on headings (all depths) | 64.9% | 57.3% | 7.6 | 7.9 |
| gist template repetition | 7.1% | 10.1% | 2.9 | 3.6 |
| dropped heading claims | 6.60 | 1.86 | 4.74 | 8.17 |

That table **collapses exact aliases and omits mediators** (`outputTokens` drives cost and latency;
`fanout.max` moves with `parts.count`). It is a selected view, not the raw sweep, and the raw sweep
is reproducible from the command at the foot of this file.

## What the differences are, and are not

**They are not ten independent votes.** They reduce to about four correlated families, and within
each the measures are views of one underlying behaviour:

- *tree shape* — parts, balance, fan-out
- *repair* — dropped children, repaired ranges, blocks moved, largest repair
- *gists* — length and retention
- *heading metadata* — source-heading share

**Repair is the family that carries the verdict.** `low` needs 2.6× the blocks moved, 2.2× the
largest single repair, and dropped one depth-2 section in 3 of its 7 successful draws — at
`root > child 12 > child 3`, `root > child 7 > child 2` and `root > child 8 > child 2`, in trees of
57, 30 and 33 titles. `medium` dropped none in ten. On a two-tailed Fisher's exact that is p ≈ 0.05,
**exploratory**, and worth saying carefully: what is established is loss relative to *the model's own
proposal*. The prose is still in the tree, absorbed by the neighbours. A dropped landmark may even be
one that deserved dropping. It is not demonstrated harm to a reader.

**A causal story this document told, and got wrong.** An earlier version argued that `low`'s extra
parts were "boundaries of its own invention", from `low` having more parts (9.29 vs 7.30) while
carrying `sourceHeading` on a smaller share of nodes (38.2% vs 48.1%). That reasoning is unsound and
Sol killed it. `sourceHeadingShare` counts metadata across *all* internal nodes, not depth-1 ones,
so the two measure different populations; the absolute count of copied headings barely moved (15.70
against 14.86) and the share fell because the denominator grew (33.8 titles to 38.3). The measure
that actually asks the question is `l1OnHeadings`, and it says **96.7% against 95.8%** — so nearly
every extra top-level part `low` makes *does* begin on an author heading. The innocent reading is the
supported one: **`low` follows more of the author's own top-level divisions and writes its own labels
for them.** The refutation was sitting in this run's own sweep, filed under noise.

**Several directions are judgments, not quality orderings.** More parts is not worse. Lower
`balanceCv` is not better — [`score.ts`](../../evals/hierarchy-structure/score.ts) says so itself:
"Lower is *usually* better, but a preface genuinely shorter than the chapters is not a fault —
compare arms on it, don't gate on it." Gist retention's same-recipe gap of 0.009 sits against
per-draw values spanning 0.48–0.62, so it is an unstable denominator, and the 2.4-point arm gap is
about 1.6 standard errors — a weak directional observation, nothing more.

## The judgment

**Provisionally keep `medium`.** The case for `low` is real and should not be understated: $0.076 a
draw — 36% of the structure call, ~23% of hierarchy end to end — and **latency is the better half**,
141 seconds down to 74, halving the step that is 88% of the ingest wait, on the one stage a reader
sits through.

Against it: `low`'s trees need substantially more mending to be legal, and three times in seven a
section the model proposed did not survive that mending. That is enough to justify caution and not
enough to call a quality difference. Every measure here is mechanical; the blind comparison in
[`blind.ts`](../../evals/hierarchy-structure/blind.ts) was not run, and no person has looked at a
single tree from either arm.

So the honest position is: **the default holds because it is the default and nothing here dislodged
it** — not because this run showed `medium` is better.

**What would settle it**, roughly in order of value:

1. **A blind human comparison** on the trees already on disk. They are saved under each run's
   `trees/`, it costs nothing but attention, and it is the only thing that can convert repair counts
   into a statement about quality.
2. **Replication on two or three more long articles.** One article cannot separate "`low` is worse"
   from "`low` is worse on Gwern's scaling-hypothesis essay".
3. **Re-run after the repair work.** Fable's proposal to make an unresolvable *end* non-fatal, and
   Sol's to repair the smallest subtree rather than redraw, both raise `low`'s floor more than
   `medium`'s, because `low` produces more of the faults they forgive. If either lands, this
   comparison changes shape and $0.076 plus 67 seconds a reader is worth asking twice.

## Appendix: the short/mid corpus, and why it proves nothing about length

The first run (12 calls, $0.7225) used `constitution` (84 blocks), `noema` (141) and `writes` (19).
There `low` matched `medium` on every proxy at 40% less cost, and the two `medium` draws differed
from each other by more than `medium` differed from `low` — title retention 52% against 31% on the
same recipe.

**An earlier version of this document concluded from that pair that `low` is "defensible below
~9,000 words and not defensible at 17,000". That was wrong and is withdrawn.** The short and long
runs use *different articles*, so length and article identity are completely confounded, and no
crossover has been measured or can be from this data. Testing a length effect means running both
efforts on several articles at several lengths.

Two failures did land in that run, one of them `incumbent` on `noema` with a backwards range, so the
shipping recipe is not failure-free at any length.

## What this run does not say

- **Nothing about `high`.** Not run. The 2026-08-30 results in this directory used `high` as their
  incumbent and are not one series with anything here.
- **Nothing about the quick model.** The `cheap-high` arm ran once and reported $0.00 because that
  tier is BYOK — routed by OpenRouter, invoiced by OpenAI, invisible to every ledger in this repo.
  It now fails loudly (commit `2568d142`), but **no Luna arm in this harness has ever been priced**,
  and Sol's recommendation to move the label pass to it is still unmeasured.
- **Nothing a person would recognise as quality.** Every measure is mechanical.

## Reproduction

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-low data/gwern-scaling-long
npx tsx evals/hierarchy-structure/verify-costs.ts evals/results/hierarchy-structure/<run-dir>
```

Run directories: `2026-09-03-09-25-21`, `-09-38-43`, `-09-46-32`, `-09-53-25`, `-10-00-35`,
`-10-06-17`; the short/mid run is `-09-08-50`. Total: **$3.8798 over 31 paid calls**, every one
reconciled against the provider's own records.

**That total is credits only and understates by about $0.07.** Four `cheap-high` calls booked real
tokens and reported $0.00 for the BYOK reason above; priced from
[`src/models.ts`](../../src/models.ts) they come to roughly $0.018 each. No `medium`-vs-`low` figure
touches that arm, but the distinction is the one
[cost-per-article-2026-09-03.md](cost-per-article-2026-09-03.md) makes when it says every figure in
it is credits + BYOK.

The box sat at load average 106–155 throughout and two background runs were killed part-way, so the
draws were taken in foreground batches of three. Nothing about the numbers depends on that; it is
why they are spread across six directories.
