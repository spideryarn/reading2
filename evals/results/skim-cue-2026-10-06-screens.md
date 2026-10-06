# skim/9 vs skim/10: screens and routes

## Cues, per arm

| Arm | stops | null cues (`badCue`) | length: median · mean · max | over 140 | over 200 | start "Look for" | ask a question | lean on elsewhere | cost | input tokens / call | output / call |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 (skim/9) | 88 | 0 | 79 · 78 · 99 | 0 | 0 | 25% | 20% | 0 | $0.1603 | 8869 | 1433 |
| A2 (skim/9) | 88 | 0 | 83 · 82 · 103 | 0 | 0 | 17% | 25% | 1 | $0.1860 | 8869 | 1946 |
| B (skim/10) | 88 | 0 | 131 · 131 · 184 | 22 | 0 | 2% | 25% | 2 | $0.2183 | 9505 | 2464 |
| C (skim/10, passages) | 88 | 1 | 136 · 141 · 198 | 37 | 0 | 0% | 11% | 4 | $0.2979 | 17779 | 2403 |
| B2 (skim/10) | 88 | 0 | 94 · 95 · 155 | 1 | 0 | 7% | 23% | 0 | $0.2236 | 9898 | 2493 |

A null cue is one the validator refused: empty, or over the arm's cap (140 for `skim/9`, 200 for `skim/10`). So "over 140" is 0 by construction for A1 and A2, and their over-long cues show as null cues.

## Did the route move? (Sol F7)

For each article and each pair of arms: `stops` = quotes on both routes / quotes on either; `depth` = of the shared quotes, how many sit at the same depth; `again` = how many are carried into the same passes; `order` = of the pairs of shared quotes, how many come in the same order in both routes. **A1 v A2 is the control**: two runs of one prompt.

| Article | sizes A1 · A2 · B · C · B2 (Gist/More/Most) | A1 v A2 | A1 v B | A2 v B | A1 v C | A2 v C | B v C | A1 v B2 | A2 v B2 | B v B2 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2608-13566v1-spya-yurten | 5/7/21 · 5/7/21 · 5/7/21 · 5/7/21 · 5/7/21 | stops 33/33 · depth 24/33 · again 28/33 · order 84% | stops 33/33 · depth 27/33 · again 28/33 · order 84% | stops 33/33 · depth 25/33 · again 27/33 · order 100% | stops 33/33 · depth 25/33 · again 29/33 · order 84% | stops 33/33 · depth 28/33 · again 29/33 · order 99% | stops 33/33 · depth 26/33 · again 25/33 · order 99% | stops 33/33 · depth 28/33 · again 32/33 · order 84% | stops 33/33 · depth 25/33 · again 29/33 · order 100% | stops 33/33 · depth 26/33 · again 27/33 · order 100% |
| entropy-24-00930-spya-pywwkq | 4/6/10 · 4/6/10 · 4/6/10 · 4/6/10 · 4/6/10 | stops 20/20 · depth 18/20 · again 18/20 · order 100% | stops 20/20 · depth 16/20 · again 17/20 · order 93% | stops 20/20 · depth 16/20 · again 17/20 · order 93% | stops 20/20 · depth 16/20 · again 15/20 · order 98% | stops 20/20 · depth 16/20 · again 17/20 · order 98% | stops 20/20 · depth 12/20 · again 16/20 · order 95% | stops 20/20 · depth 18/20 · again 15/20 · order 89% | stops 20/20 · depth 16/20 · again 16/20 · order 89% | stops 20/20 · depth 14/20 · again 15/20 · order 95% |
| source-spya-furjgs | 3/5/5 · 3/4/6 · 3/4/6 · 3/4/6 · 3/4/6 | stops 13/13 · depth 12/13 · again 8/13 · order 86% | stops 13/13 · depth 10/13 · again 9/13 · order 67% | stops 13/13 · depth 11/13 · again 10/13 · order 78% | stops 13/13 · depth 8/13 · again 8/13 · order 88% | stops 13/13 · depth 9/13 · again 11/13 · order 74% | stops 13/13 · depth 11/13 · again 12/13 · order 55% | stops 13/13 · depth 9/13 · again 9/13 · order 62% | stops 13/13 · depth 10/13 · again 9/13 · order 71% | stops 13/13 · depth 9/13 · again 12/13 · order 79% |
| arxiv-2010-spya-tkm7nm | 3/3/5 · 3/3/5 · 3/3/5 · 3/3/5 · 3/3/5 | stops 11/11 · depth 9/11 · again 9/11 · order 98% | stops 11/11 · depth 9/11 · again 9/11 · order 75% | stops 11/11 · depth 9/11 · again 9/11 · order 76% | stops 11/11 · depth 9/11 · again 10/11 · order 95% | stops 11/11 · depth 9/11 · again 8/11 · order 93% | stops 11/11 · depth 11/11 · again 10/11 · order 69% | stops 11/11 · depth 9/11 · again 9/11 · order 91% | stops 11/11 · depth 9/11 · again 9/11 · order 89% | stops 11/11 · depth 11/11 · again 9/11 · order 73% |
| cargocult-spya-rz663q | 3/3/5 · 3/3/5 · 3/3/5 · 3/3/5 · 3/3/5 | stops 11/11 · depth 9/11 · again 10/11 · order 76% | stops 11/11 · depth 9/11 · again 9/11 · order 78% | stops 11/11 · depth 9/11 · again 8/11 · order 84% | stops 11/11 · depth 9/11 · again 7/11 · order 84% | stops 11/11 · depth 11/11 · again 8/11 · order 93% | stops 11/11 · depth 9/11 · again 7/11 · order 91% | stops 11/11 · depth 9/11 · again 9/11 · order 78% | stops 11/11 · depth 11/11 · again 10/11 · order 84% | stops 11/11 · depth 9/11 · again 9/11 · order 100% |
| **all** | | stops 100% · depth 82% · again 83% · order 88% | stops 100% · depth 81% · again 82% · order 84% | stops 100% · depth 80% · again 81% · order 94% | stops 100% · depth 76% · again 78% · order 88% | stops 100% · depth 83% · again 83% · order 96% | stops 100% · depth 78% · again 80% · order 92% | stops 100% · depth 83% · again 84% · order 83% | stops 100% · depth 81% · again 83% · order 94% | stops 100% · depth 78% · again 82% · order 95% |

Dangling quotes by rule: 28 of 88 quotes on any route (opens on a pronoun: 11; the latter / the former: 2; this/these/such + noun: 26).
