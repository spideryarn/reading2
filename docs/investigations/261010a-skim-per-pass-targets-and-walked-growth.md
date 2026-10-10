# Skim: per-pass targets and walked growth (`skim/12` against `skim/11`)

Run 2026-10-10 for [plan 261010t](../plans/261010t-skim-deeper-passes-always-longer-and-a-previous-stop-door.md).
Up: [investigations.md](../project/investigations.md). The mode is [skim.md](../project/skim.md).

**Question and answer.** Does `skim/12` (per-pass targets that grow, plus the `growPasses` repair)
make every deeper pass longer than the one before, as the reader walks it, where `skim/11` did not?
Yes: 0 of 12 `skim/12` runs failed to grow against 6 of 12 for `skim/11`, no route threw, and the
repair almost never fired; but Gist (pass 1) covered fewer Ideas on short articles, past the old
arm's own spread. Round 2 (More may equal Gist, the version built) keeps 0 of 12 bad runs and wins
most of Gist back (22 to 23 against the control's 24 to 25), still marginally outside the control's
spread of 1.

## How it was run

Six articles, two runs per arm, `skim/11` run twice as the control
([prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change)).
Production's own `generateSkim` through
[`skim-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts), no profile. Only the `ai_calls`
ledger was written. Two articles were read from production, read-only, with
[`skim-inputs-from-production.ts`](../../scripts/eval/skim-inputs-from-production.ts)
(`arxiv-1706-03762-spya-wyt7j0`, `2608-13566v1-spya-yurten`); four are local
(`entropy-24-00930-spya-pywwkq`, `arxiv-2010-spya-tkm7nm`, `cargocult-spya-rz663q`,
`source-spya-furjgs`). Stored Ideas are `ideas/5`, Quotes `quotes/9`.

```
git show HEAD:src/skim.ts > src/skim-v11-eval-tmp.ts      # deleted afterwards
npx tsx scripts/eval/skim-inputs-from-production.ts <slug> <out.json>   # twice
npx tsx scripts/eval/skim-coverage-eval.ts --runs=2 --old=src/skim-v11-eval-tmp.ts \
  --old-version=skim/11 --new-version=skim/12 --allow-outdated-ideas --tag=-k \
  --file=arxiv-1706-03762-spya-wyt7j0=<attn.json> --file=2608-13566v1-spya-yurten=<yurten.json> \
  <the six slugs>
```

Results: `evals/results/skim-coverage-2026-10-10T17-17-32--k.json`. Module SHA-256 (first 16):
`skim/11` `77ccd75d5774c31d`, `skim/12` `8ba8e0f9301a7214` (the working tree, uncommitted).

## Walked pass sizes (own stops plus carried in), run 1 / run 2

| article (offered) | skim/11 | skim/12 |
|---|---|---|
| arxiv-1706 Attention (26) | 5/10/12 · 5/9/13 | 5/9/13 · 5/9/13 |
| 2608-13566 (33) | 5/12/18 · 5/11/18 | 5/12/18 · 5/11/18 |
| entropy-24 (20) | 4/8/9 · 4/8/9 | 4/8/9 · 4/8/9 |
| arxiv-2010 (11) | **3/3/5 · 3/4/4** | 2/4/5 · 2/4/5 |
| cargocult (11) | **3/3/5 · 3/3/5** | 2/4/5 · 2/4/5 |
| source (13) | **3/5/5 · 3/5/5** | 3/5/6 · 3/5/6 |

Bold: does not strictly grow.

## Rates

| | skim/11 | skim/12 |
|---|---|---|
| runs that fail to grow as walked | 6 of 12 (all on the three articles with 11–13 quotes) | 0 of 12 |
| `shrinkMoved > 0` (bar: at most 2) | n/a | 0 of 12 |
| `shrinkCarried > 0` | n/a | 2 of 12 (cargocult, both runs: 1 carried entry dropped) |
| thrown routes | 0 | 0 |
| cost, 12 calls | $0.333 | $0.350 |

## Ideas coverage ("in", summed over the six articles; 49 Ideas per run)

| pass | skim/11 run 1, run 2 | skim/12 run 1, run 2 |
|---|---|---|
| Gist (1) | 24, 25 | 20, 20 |
| More (2) | 36, 36 | 35, 34 |
| Most (3) | 39, 39 | 39, 39 |

The control's own spread at Gist is 1. `skim/12` is 4 to 5 lower, so the "Gist coverage must not
drop beyond the control spread" bar is **not met**. All of it is on the short articles, where the
Gist target falls from 3 to 2 so that three growing passes fit: arxiv-2010 5/9 to 3/9, cargocult
4/5 to 2/5, 2608-13566 5/10 to 4/10 in both runs (that one is a Gist of 5 in both arms; a different
stop choice). By More the gap is 1 to 2 and by Most it is gone.

## Small Gist (offered 8 to 11), read by eye

- arxiv-2010 (11 quotes). `skim/12` Gist: "We find that large scale training trumps inductive
  bias." and "This simple, yet scalable, strategy works surprisingly well when coupled with
  pre-training". `skim/11` Gist: those two plus "First, Vision Transformers dominate ResNets on the
  performance/compute trade-off."
- cargocult (11 quotes). `skim/12` Gist: "So I call these things Cargo Cult Science, because they
  follow all the apparent precepts..." and "The first principle is that you must not fool yourself".
  `skim/11` Gist: those two plus "All the parapsychologists are looking for some experiment that can
  be repeated...".

Both are sensible two-stop Gists. The stop lost is each time the third, the one that carried an
extra Idea. Whether two stops is too few for an 11-quote piece is a product call for Greg.

## Odd things

- The `skim/11` failures are the bug the plan describes: More equal to Gist (3/3), or Most shorter
  than More (3/4/4).
- The two `skim/12` repairs (cargocult) were the cheap kind, dropping a carried `again` entry; no
  stop was ever moved deeper.
- On the three larger articles the two arms agree almost exactly, so the target change costs nothing
  there.

## Round 2: More may equal Gist

Round 1 cut Gist on short articles. The built `skim/12` was then revised: Gist targets back to the old
`ceil(q/5)` (cap 5), More's own target may equal Gist (never less), Most always more than More, and
the rule is `w1 <= w2 < w3` as walked (for 8 or more quotes). Only the NEW arm was re-run
(`--runs=2 --new-only --new-version=skim/12 --allow-outdated-ideas --tag=-k2`, same six articles and
inputs), compared with round 1's `skim/11` control. Results:
`evals/results/skim-coverage-2026-10-10T17-25-05--k2.json`. Module SHA-256: `36696b551af35e8f`.

| article (offered) | walked, run 1 / run 2 | shrinkMoved |
|---|---|---|
| arxiv-1706 Attention (26) | 5/8/14 · 6/10/12 | 0 |
| 2608-13566 (33) | 6/9/17 · 5/11/18 | 0 |
| entropy-24 (20) | 4/7/10 · 4/8/9 | 0 |
| arxiv-2010 (11) | 3/3/5 · 3/3/5 | 1 · 1 |
| cargocult (11) | 3/4/5 · 3/4/5 | 0 |
| source (13) | 3/4/7 · 3/4/7 | 0 |

- Runs with More < Gist or Most <= More: **0 of 12**. (Two runs have More = Gist, 3/3/5, which the
  rule now allows.)
- `shrinkCarried` 0 of 12; `shrinkMoved` > 0 in 2 of 12 (arxiv-2010, both runs; one stop moved
  deeper each time), at the bar's limit of 2. Thrown routes: 0. Cost $0.342.
- Ideas "in", summed over the six articles (49 per run):

| pass | skim/11 control | skim/12 round 1 | skim/12 round 2 |
|---|---|---|---|
| Gist | 24, 25 | 20, 20 | 22, 23 |
| More | 36, 36 | 35, 34 | 35, 35 |
| Most | 39, 39 | 39, 39 | 39, 39 |

Gist coverage recovered most of the way, to 22 to 23 against the control's 24 to 25: still 1 to 2
below the control's lowest run, so strictly the "within the control's spread" bar (spread 1) is
missed by a small margin, with two runs of 49 Ideas to go on. More and Most are within one.
The small-Gist articles got their third stop back (arxiv-2010 and cargocult both have 3 Gist stops
again). **Round 2 is the one built.**
