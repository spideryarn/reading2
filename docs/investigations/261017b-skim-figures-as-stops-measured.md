# Skim `skim/14`: figures as stops of their own, measured

Run 2026-10-17 for [plan 261017d](../plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md).
Up: [investigations.md](../project/investigations.md). The mode is [skim.md](../project/skim.md).

**Question and answer.** Can the route step choose figures as stops of their own — Greg's *"1B …
with some kind of commentary or cue … / 2A"* to [q-z27hq2](../user-feedback/questions/q-z27hq2.md)
— without making the quote route worse? **Yes, in the fourth round, and only after a design change
the first two rounds forced.** With a depth of its own, a figure was anchored to a quote in another
pass half the time and met beside stops it had nothing to do with; a wording asking the model not
to changed nothing. Walking a figure in its quote's pass fixed placement (29 of 29 placed well, by
reading), and then letting the pass-size repair make room for a figure stopped a third of the
figures being trimmed. In the kept round no route failed, no figure was trimmed, no figure cue gave
a finding away, and the quotes held: Gist covered as many Ideas as `skim/13`, and a blind judge
preferred the new Gist walk 8 to 4 against a 3 to 1 control.

## How it was run

Production's own `generateSkim` through
[`skim-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts), which now records the figures
offered and chosen, each figure's pass neighbours, and the passes walked with figures. Eleven
articles, chosen before the run (plan § After GPT Sol's plan review, F8):

- **With figures**, eight: Greg's own `mental-imagery-functional-mechanisms-and-clinica-spya-fw5zrb`
  (the report's article, 3 figures), `pmc13013618-spya-uekgh6` (12) and `bf03197835-spya-qfwsw2`
  (6), read read-only from production with
  [`skim-inputs-from-production.ts`](../../scripts/eval/skim-inputs-from-production.ts), which now
  carries block HTML because `figuresOf` reads the markup; and local `arxiv-2010-spya-tkm7nm` (ViT,
  23), `arxiv-1810-spya-e24vmj` (BERT, 14), `entropy-24-00930-spya-pywwkq` (4),
  `race-human-categorization-spya-rpwc59` (a Wikipedia page, 8, five uncaptioned),
  `axolotl-spya-zj7m0z` (Wikipedia, 15, including an infobox table) and
  `fd-src-s41598-023-33209-9-spya-hxekgz-spya-pwtq9e` (2 figures, 17 quotes).
- **Without figures**, the control for "nothing else moved": `cargocult-spya-rz663q`,
  `source-spya-furjgs`.

```
git show 27d0c289d:src/skim.ts > src/skim-v13-eval-tmp.ts      # skim/13, deleted afterwards
npx tsx scripts/eval/skim-coverage-eval.ts --runs=2 --old=src/skim-v13-eval-tmp.ts \
  --old-version=skim/13 --new-version=skim/14 --allow-outdated-ideas --tag=f1 --file=… <eleven slugs>
# rounds 2–4: the NEW arm only, --new-only --tag=f2|f3|f4
npx tsx scripts/eval/skim-figure-stops.ts <results.json>       # the figures, laid out to read
npx tsx scripts/eval/skim-walked-metrics.ts <f1.json> <f4.json> # the quotes, as walked
npx tsx scripts/eval/skim-walk-pairs.ts --old=<f1.json> --new=<f4.json> --out=evals/results/skim-261017d-blind
```

Results: `evals/results/skim-coverage-2026-10-17T18-06-20-f1.json` (both arms), `…T18-08-21-f2.json`,
`…T18-14-34-f3.json`, `…T18-18-04-f4.json` (kept). Cost: 102 calls, $3.69, and three judge calls.

## Four rounds

| round | what changed | figure stops | beside their quote's section or a naming quote (mechanical) | anchored in their own pass | runs with a figure trimmed |
|---|---|---|---|---|---|
| 1 | as planned: a figure has a depth and an `after` | 35 | 23 | 15 | 0 of 18 |
| 2 | prompt: "give it the depth of a pass that quote is walked in", "never two figures side by side" | 31 | 19 | 18 | 2 |
| 3 | **a figure is walked in its quote's own pass; one figure per quote** (code and prompt) | 22 | 21 | 22 | 6 |
| 4 | **the pass-size repair makes room for the figures** | 29 | 24 | 29 | 0 |

- **Rounds 1 and 2: the depth was the fault, not the pairing.** The model picked the right quote for
  a figure — the paragraph that names it, or the result it draws — and then gave the figure a
  deeper pass than that quote's. Walked in its own pass the figure fell beside whatever came next:
  ViT's transfer-learning figure between a Methods quote and a Related Work one, and BERT's Tables 5
  and 6 stacked together at the start of Most with no quote between them. Asking in words moved
  nothing (15 of 35, then 18 of 31).
- **Round 3: placement fixed, figures lost.** With the depth taken from the quote, every figure is
  met straight after its quote. But the quotes models pick for figures are often Gist quotes, and a
  Gist figure makes Gist as long as More, so `trimFigures` dropped it — on 6 of 18 runs, about a
  third of the chosen figures, among them the papers' main result figures.
- **Round 4: Greg's own rule.** On q-vzd2xt he chose *"the more detailed sub-modes get longer,
  rather than the least detailed one getting shorter"*. Dropping a Gist figure shortens Gist; so
  `growPasses` now plans the pass sizes with the figures counted, and carries a stop into More
  instead (`growCarried` 10 and 13 per run, against 6 for `skim/13`). No figure was trimmed.
- **The mechanical check undercounts.** All five round-4 figures it failed follow the right quote:
  BERT's GLUE table after *"Both BERT_BASE and BERT_LARGE outperform all systems on all tasks"*,
  Greg's Figure 2 after *"activity patterns … begin to resemble one another as early as area V1"*.
  The figure's block sits in a neighbouring section of the tree (a PDF figure floats), so the
  section test misses it. By reading, 29 of 29 are placed well.

## The figures chosen (round 4)

- **Chosen, not sprayed**: every one of the 18 runs on an article with figures chose some, one to
  three of up to 23 offered, within the caps; the two articles with none chose none. What was
  chosen is what a skimmer gains from: study designs (the quiz–lecture alternation, the
  delayed-win-shift task), main results (GLUE, ViT's transfer and compute curves, the optogenetics
  bars), the PID lattice. The axolotl's infobox table and its photographs were never chosen; one
  early-round photograph (*metamorphosed axolotls*) was, and not in the kept round.
- **Cues**: 29 read against section 3's rules. None gives a finding away, none refers to another
  stop, none opens with a claim about the subject (round 1 had one: *"Axolotls can still change
  body form if forced by thyroid hormones."*, which the round-2 wording names as a BAD example). They
  point: *"Read the axes first: accuracy against pre-training compute. Compare ViT, ResNet and hybrid
  curves at the same compute."*
- **Drops**: `overFigureCap` once, `figureShrink` never; nothing unknown, no anchor gone.

## The quotes (round 4 against `skim/13`, round 1)

| | skim/13 #1, #2 | skim/14 round 4 #1, #2 |
|---|---|---|
| routes not growing (walked, quotes only) | 0, 0 | 0, 0 |
| Ideas in Gist (summed) | 41, 40 | 42, 43 |
| Ideas in More | 54, 51 | 46, 50 |
| Gist stops over 60 words | 4/41, 5/42 | 4/41, 4/41 |
| More stops over 60 words | 9/73, 9/72 | 7/67, 6/70 |
| `growCarried` | 6, 6 | 10, 13 |
| `shrinkMoved`, `movedIntro` | 0, 0 | 1, 2 (one run) |

- **Per article**, Ideas in Gist and in More sit within ±1 of the control's two-run spread on 10 of
  11 articles (the criterion was 8 of 10). The one outside is `source`, a no-figure article, whose
  More covered 2 Ideas in one run against the control's 4.
- **More's summed Ideas are lower** (46 and 50 against 54 and 51). The plan's criterion named
  Gist's sum, not More's, so this is reported rather than judged; More now carries more Gist stops
  to make room for Gist's figures, and a carried stop repeats Ideas Gist already met.
- Every walked pass grows, with the figures and without them.

## Blind judge: the Gist walks

GPT Sol (`gpt-5.6-sol`, medium effort, read-only, a different family from the writer) read 33 pairs
of Gist walks (quotes only) and nothing else: 22 test pairs, `skim/13` run *k* against round 4 run
*k*, and 11 control pairs, `skim/13` run 1 against its run 2. Sides by `blindCoin`; the new arm on A
in 11 of 22, control run 1 on A in 5 of 11; the key was moved out of the repository before the judge
ran. Same question as 261011b. The judge picked A 8 times and B 8.

| | new preferred | old preferred | tie |
|---|---|---|---|
| test (22) | **8** | 4 | 10 |
| control (11) | old#1: 1 | old#2: 3 | 7 |

The new Gist is not worse, which is all this change needed of it. Most ties are identical walks.

## Blind judge: the intros, and a control for the judge

The same judge rated round 4's 64 intros: 55 orient clearly, 9 somewhat; **none mentions a figure**
(section 4 now says not to, because a visitor walks no figures); 5 name a topic not in their pass;
and **21 "give a finding away"** — against 0 of 48 for 261011b's judge. Section 4 is unchanged apart
from the figure line, so the same judge then rated `skim/13`'s 66 intros from round 1, as a control:
45 clearly, 21 somewhat, and **30** giving a finding away. So it is this judge reading the rule more
strictly (it counts *"why ViT is weak on mid-sized data"*), not a regression; if anything `skim/14`'s
intros are a little better. Intros that lean towards a result are a standing matter for section 4,
not for this change. Files: `evals/results/skim-261017d-blind/` and
`evals/results/skim-261017d-blind-intros-control/`.

## A confirming round after the code review

GPT Sol's code review ([261017d-figures-code-review-sol.md](../plans/261017d-figures-code-review-sol.md))
reworded the prompt where it still said "stop" of what applies to quote stops only (depth, the
optional cue, the targets), and made `buildSkim` re-plan the pass sizes when a repair moves a
figure's anchor. One more run on all eleven articles (`…T18-40-29-f5.json`, $0.41): no failed route,
no figure trimmed, 17 figure stops on the nine articles with figures, every cue a pointer; Gist Ideas
40 and More 54, inside the control's spread.

## Limits

- Two runs per arm and one judge; the control's spread is the yardstick, and on Gist it is wide.
- Eight articles with figures, three of them from production. Papers dominate; two Wikipedia pages.
- Placement was judged mechanically and then by me, not blind.
- The figures are read from their captions alone; a figure with no caption (the Wikipedia pages'
  photographs) is offered as *"Figure 3 · (no caption)"*, and was rarely chosen.
