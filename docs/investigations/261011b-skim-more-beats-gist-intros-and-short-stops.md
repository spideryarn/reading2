# Skim `skim/13`: More beats Gist, pass intros, and shorter stops

Run 2026-10-11 for [plan 261011r](../plans/261011r-skim-more-always-longer-than-gist-a-pass-intro-shorter-quotes-skim-for-box.md).
Up: [investigations.md](../project/investigations.md). The mode is [skim.md](../project/skim.md).

**Question and answer.** Does `skim/13` make More walk more stops than Gist without shortening
Gist (Greg's answer B to q-vzd2xt), make the stops shorter (report `spya-wu83xh`), and write intros
that orient the reader without giving findings away? **Yes on all three, with one wording that
failed first.** Every route of eight or more quotes grew strictly, and no stop had to leave Gist.
Gist covered as many key Ideas as the control did, and a blind judge preferred the new Gist walk 10
to 3 where the control split 3 to 2. The first length wording moved nothing; the second, which marks
long quotes and limits them per pass, cut the long stops in Gist and More by about half. No intro
gave a finding away or mentioned the reader. 4 of 48 named a topic that was not in their pass.

## How it was run

Production's own `generateSkim` through
[`skim-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts), on eight articles. Four were read
read-only from production with
[`skim-inputs-from-production.ts`](../../scripts/eval/skim-inputs-from-production.ts):
`arxiv-1706-03762-spya-wyt7j0` and `2608-13566v1-spya-yurten` (from 261010a), plus
`pmc13013618-spya-uekgh6` and `bf03197835-spya-qfwsw2`, the production articles with the most
quotes over 75 words. Four are local: `arxiv-2010-spya-tkm7nm` and `cargocult-spya-rz663q`
(11 offered, the size where More used to tie Gist), `source-spya-furjgs`, and
`cephalometry-spya-tafdaf` (6 offered, below the strict rule). Only the `ai_calls` ledger was written.

The metrics are over the passes **as walked** (own stops plus carried, `passRoute`'s rule), by
[`skim-walked-metrics.ts`](../../scripts/eval/skim-walked-metrics.ts). The coverage script's own
`rows` are cumulative, a walk nobody takes since 260929e (GPT Sol, plan review F4).

```
git show HEAD:src/skim.ts > src/skim-v12-eval-tmp.ts      # deleted afterwards
npx tsx scripts/eval/skim-coverage-eval.ts --runs=2 --old=src/skim-v12-eval-tmp.ts \
  --old-version=skim/12 --new-version=skim/13 --allow-outdated-ideas --tag=r --file=… <eight slugs>
# round 2: the second length wording, NEW arm only
npx tsx scripts/eval/skim-coverage-eval.ts --runs=2 --new-only --new-version=skim/13 … --tag=r2 …
# two runs with a profile, NEW arm only (--purpose= / --about=)
npx tsx scripts/eval/skim-walked-metrics.ts <results.json>
npx tsx scripts/eval/skim-walk-pairs.ts --old=<r.json> --new=<r2.json> --out=evals/results/skim-261011r-blind
```

Results: `evals/results/skim-coverage-2026-10-11T10-42-22-r.json` (old ×2, round 1 ×2),
`…T10-43-56-r2.json` (round 2 ×2), `…T10-44-54-p1.json` and `…T10-45-06-p2.json` (profiled).
Module SHA-256 (first 16): `skim/12` `a9282e2ca820954e`, round 1 `117741071104de7f`, round 2
`49e3833ebff21d00`. Cost: 50 calls, $1.45, plus one judge call.

## Walked pass sizes (Gist/More/Most), run 1 · run 2

| article (offered) | skim/12 | skim/13 round 1 | skim/13 round 2 (kept) |
|---|---|---|---|
| arxiv-1706 Attention (26) | 5/9/14 · 5/9/13 | 4/8/15 · 4/8/11 | 5/8/11 · 5/8/13 |
| 2608-13566 (33) | 4/11/18 · 5/13/18 | 5/12/19 · 4/10/16 | 4/8/14 · 5/11/19 |
| pmc13013618 (18) | 4/6/8 · 4/6/8 | 4/7/8 · 4/8/9 | 4/6/9 · 4/7/8 |
| bf03197835 (13) | 3/5/6 · 3/5/6 | 3/5/6 · 3/5/6 | 3/6/7 · 3/6/7 |
| arxiv-2010 (11) | 3/4/5 · 3/4/5 | 3/5/6 · 3/4/5 | 3/4/5 · 3/5/6 |
| cargocult (11) | 3/4/5 · 3/4/5 | 3/5/6 · 3/5/6 | 3/5/6 · 3/5/6 |
| source (13) | 3/5/6 · 3/4/7 | 3/4/7 · 3/4/6 | 3/5/6 · 3/5/6 |
| cephalometry (6) | 2/2/2 · 2/2/2 | 2/2/2 · 2/2/2 | 2/2/2 · 2/3/3 |

Every route of eight or more offered quotes grows strictly in every arm here, the old one
included. The two 11-quote articles, where `skim/12` at its targets would tie More with Gist, had
been rescued by the model carrying a stop. So this sample does not show the old prompt breaking the
new rule; 261010a did (3/3/5 on both). Cephalometry, at six quotes, is under the non-strict rule
in both prompts.

## The repair, the coverage and the length

| | skim/12 #1, #2 | round 1 #1, #2 | round 2 #1, #2 |
|---|---|---|---|
| Ideas in Gist (as walked, summed) | 29, 30 | 31, 27 | 29, 30 |
| Ideas in More | 38, 36 | 37, 37 | 35, 41 |
| Gist quote words, median | 50, 50 | 50, 45.5 | 42, 38.5 |
| Gist stops over 60 words | 7/27, 7/28 | 7/27, 5/26 | 3/27, 5/28 |
| More stops over 60 words | 13/46, 14/47 | 12/48, 14/46 | 5/44, 8/50 |
| `growCarried` | 0, 0 | 4, 5 | 4, 6 |
| `shrinkMoved` (runs with a move) | 1 (1), 1 (1) | 0, 0 | 0, 0 |
| `badIntro`, `movedIntro` | n/a | 0, 0 | 0, 0 |

- **Gist coverage is unchanged in round 2** (29 and 30, against the control's 29 and 30). In round 1
  one run fell to 27, two below the control's lower edge.
- **Round 1's length rule did nothing.** It stated each quote's length and asked for a quote over 90
  words in Gist or More only when no shorter one carried its idea. In production 90 words is very
  rare (19 of 940 quotes; median 34, 90th percentile 63, longest 114). A paragraph-long quote is
  more like 60 to 90 words. **Round 2** marks a quote over 60 words `LONG`, and allows Gist one and
  More two. Gist's median fell from 50 words to 42 and 38.5. Long stops roughly halved in Gist and
  More, both outside the control's spread.
- **The repair lengthened, never shortened.** It added 4 to 6 carried stops per eight routes and
  moved no stop out of a pass. The old repair moved one stop in each of its runs.

## Blind judge: the Gist walks

GPT Sol (`gpt-5.6-sol`, medium effort, read-only, a different model family from the writer) read
24 pairs of Gist walks and nothing else. There were 16 test pairs, `skim/12` run *k* against round 2
run *k*, and 8 control pairs, `skim/12` run 1 against its run 2. Sides were set by `blindCoin(261011)`,
and the key was moved out of the repository before the judge ran. The new arm was on side A in 7 of
16. The judge asked which walk gives a skimming reader the gist better, weighing coverage and reading
time, and whether either missed a central point the other had.

| | new preferred | old preferred | tie |
|---|---|---|---|
| test (16) | **10** | 3 | 3 |
| control (8) | old#1: 2 | old#2: 3 | 3 |

- **Missing a central point**: the old walk 3 times, the new 1, both 3, neither 9.
- **A side preference**: the judge picked B 12 times and A 6. The new arm sat on B in 9 of 16, so
  side alone cannot give 10 to 3.
- Three of the ties are identical walks (cargocult both runs, source run 2).
- The reasons the judge gave for the new walk were mostly economy: *"covers a fundamental imaging
  limitation and a practical application in nearly half the words"*.

## Blind judge: the intros

The same call rated each of round 2's 48 intros against the quotes of the pass it introduces:

- **Orients**: 37 clearly, 11 somewhat, none not at all.
- **Gives a finding away**: 0. Round 1, read by eye, had two that did (*"the finding on how reliable
  cues dominate"*, *"the weakness on mid-sized data"*). Round 2 added the rule to name what a passage
  is about, never which way it comes out.
- **Mentions the reader**: 0, and none in the two profiled runs either. The profiled cues did not
  mention the reader either.
- **Names something not in its pass**: 4. Each was a list in a More or Most intro naming one topic
  the pass does not walk (*"the Millikan oil-drop history"* twice in cargocult; observer names in
  source; *"frontier model profiles"* in 2608). It looks like the model listing from stops it placed
  elsewhere. One intro in twelve, a topic too many, and never a claim. Left as it is, and a reason to
  read the intros again if Greg reports one.

## What this does not show

- Two runs per arm on eight articles, one judge. The control's spread is wide (3 to 2 with 3 ties
  in 8 pairs), and 10 to 3 in 16 is clear of it but not by much.
- No old arm has intros, so they are rated, not compared.
- How often More tied Gist in practice: production's routes were measured for 261010a (7 of 29), and
  none in this sample tied.
