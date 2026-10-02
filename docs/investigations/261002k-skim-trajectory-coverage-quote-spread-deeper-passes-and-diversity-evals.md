# Skim (then Trajectory): five measurements of how a skim route covers a piece

Written 2026-10-02, from plans written 2026-09-28 and 2026-09-29, none of which had a research write-up.
Skim was called Trajectory until 2026-10-01, and the plans, scripts and result files still use the old
name. Plans: [260928a stage 6 baseline](../plans/260928a-trajectory-mode-stage6-coverage-baseline.md) and
[after](../plans/260928a-trajectory-mode-stage6-coverage-after.md),
[260928a stage 6a](../plans/260928a-trajectory-mode-stage6a-quotes-spread-eval.md),
[260929b stage 2](../plans/260929b-trajectory-stage2-deeper-passes-eval.md),
[260929e](../plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md).

## The question

A skim is a route of stops (each stop is a Quote) at three depths: Gist, More, Most. Four questions
came up in turn:

1. How much of a piece does the route touch? (baseline)
2. Does showing the route prompt the Ideas, not only the quotes, make the route cover more Ideas? (`trajectory/6` against `/7`)
3. Does a "cover the main parts" nudge in the **Quotes** prompt spread quotes across sections better? (6a)
4. Greg wanted deeper levels to add detail rather than repeat the coarser ones. Can the route prompt do that (`/8`), and if not, where do the repeats come from? (260929b, 260929e)

All runs used `claude-sonnet-5`, effort `low` for the route calls (stage 1 of 260928a chose "capable
tier, low effort" because the input is small), on the same three local articles: the essay *Life is
Short* (`vb-spya-vu3xen`), a normal paper (`entropy-24-00930-spya-pywwkq`) and a long paper
(`source-spya-furjgs`).

## Numbers

**1. Baseline, `trajectory/6`, 2026-09-28** (`npx tsx scripts/trajectory-coverage.ts <slug>…`, reads
only). Most reaches only 19–48% of a piece's words; at Gist only 1–2 of 8 Ideas have a stop nearby on
the two papers. Table: the [baseline plan](../plans/260928a-trajectory-mode-stage6-coverage-baseline.md).
Setup cost to bring the articles up to date: $0.299.

**2. `trajectory/6` vs `/7`, 2026-09-28** (`npx tsx scripts/eval/trajectory-coverage-eval.ts`; 2 runs
per arm per article, 12 calls). Ideas with a stop on their block, summed over 21 Ideas:

| | OLD `/6` | NEW `/7` |
|---|---|---|
| Gist | 5, 5 | 7, 7 |
| More | 13, 9 | 14, 13 |

Cost $0.0998 vs $0.1318 per six calls; input tokens +37-43%. Most is identical in every run, because
Most is every offered quote. Results: `evals/results/trajectory-coverage-2026-09-28T14-38-13.json`.

**3. Quotes spread nudge (6a), 2026-09-28** (`scripts/eval/quotes-spread-eval.ts`; 12 calls, $0.7045).
Content sections left with no quote, summed over the three articles: control 3 and 3, nudge 3 and 5.
Ideas "in": control 15 and 14 of 19, nudge 13 and 11. One nudge run dropped 5 non-verbatim quotes
(control runs: 0). The blind read of three pairs split 2-1 for the nudge. Results:
`evals/results/quotes-spread-2026-09-28T14-19-04.json` (with `-pairs.md` and `-key.json`).

**4. Deeper passes (`/8`), 2026-09-29** (`scripts/eval/trajectory-coverage-eval.ts --runs=2 --old=… --new-version=trajectory/8`,
12 calls, $0.294). Idea coverage held. The blind read of six pairs was 2-2 with 2 ties; the control,
old against old, was 3-2 with 1 tie. Per added stop, detail/framing/repeat was 25/5/3 (new) against
26/5/2 (old). Results: `evals/results/trajectory-coverage-2026-09-29T02-48-07*.json`.

**5. Diversity read, 2026-09-29** (`scripts/eval/trajectory-diversity.ts`, no model call, six stored
routes; plus an Opus subagent reading every stop). With the old nested walk, 43% of More's stops and
46% of Most's were already walked at a shallower pass. Walking only each pass's own stops takes that
to 0 by construction. Within a pass, the semantic read found 0 same-point pairs at Gist and More and
3 in 56 at Most; 4 and 5 stops restating a shallower pass. A word-overlap measure found nothing, so it
is not evidence of variety. Results: `evals/results/trajectory-diversity-2026-09-29T13-11-37-091Z.json`
and `…-semantic-read.json`.

## Decisions

- **`trajectory/7` kept** (route given the Ideas through code-computed quote-Idea links and the outline).
  The plans' own words: it "makes Gist reliably carry more of the key points and makes More steadier,
  for ~$0.005-0.008 more per route". It did not fix the long paper's Gist missing the claim its title
  makes.
- **The Quotes nudge was not landed.** `quotes/7` stays; a route-side fix, not the Quotes prompt, is
  the lever if Future Directions-type gaps matter.
- **`trajectory/8` was not kept.** Most is every offered quote, so a route prompt can only move quotes
  between More and Most, not add detail. The repeats live in the Quotes themselves.
- **Each deeper pass walks only its own new stops** (260929e): a client change in the walk arithmetic,
  no model call, no stored route out of date. Where it lives now: `docs/project/skim.md`.

Greg's request behind 4 (SPIDERYARN-READING2-51, quoted in 260929b):

> For Trajectory mode, let's assume the reader has read the coarser levels already, so the
> more-detailed levels should be adding extra detail/subtlety/complexity.

## Dead ends

- Telling the route prompt that deeper passes must differ (`/8`): inside the noise.
- Longer snippets at deeper levels, and coarser levels built from Summary/Glossary: deferred
  (260929e options 3 and 4); snippet length does not follow depth today, and Quotes owns it.
- Letting the route drop a restating quote from Most: untested, judged a small problem (3 in 56).
- Section stops: declined in stage 6 on the evidence of one missed section in three papers.

## Caveats

- Three articles, two runs per arm; 6a had three blind pairs and 4 had six.
- In 4 the judge was the author of the candidate prompt (the plan says so) and had seen one line of
  run log. In 5 the judge was an Opus subagent.
- Greg's own article is on production only and was not in the set.
- Sources disagree on one thing: the plan text for the baseline links the script as
  `scripts/trajectory-coverage.ts`, but the repo file is `scripts/skim-coverage.ts` after the rename.

## How to re-run

Commands are given under *Numbers*; all read the local database and the eval scripts spend model
money (the plans record $0.3-0.7 per run). Run through `scripts/tmux-job.ts`. After the 2026-10-01
rename the scripts are `scripts/skim-coverage.ts`, `scripts/eval/skim-coverage-eval.ts`,
`scripts/eval/skim-diversity.ts` and `scripts/eval/skim-depth-blind.ts`; check before running.

Up: [research.md](../project/research.md)
