# Socratic summaries — 2026-09-07T16-05-49

Model: `anthropic/claude-sonnet-5` · corpus root `output/summaries-corpus` · depth 1 · judged by `codex`

**What this eval cannot claim.**
- Every arm is a `bakeoff`, the control included: production asks for structure, titles, gists and questions in ONE long-context response, and this asks only for wording over a fixed tree.
- Nothing here sees an interaction between the new wording and the structure the model proposes in the same breath — that is what the cheap design buys its cheapness with.
- Nothing here touches `EXPAND_SYSTEM` (src/hierarchy-expand.ts), so no result covers the deepening cascade. That prompt gained its own QUESTIONS block on 2026-09-07 (`expand/4`), carrying V4's rules — but nothing in this harness measures it.
- A win is a reason to put a variant in front of Greg RENDERED (the plan's stage 2), never a reason to ship it.
- Depth-2 gists at two sentences are deferred, not measured: they raise TOKENS_PER_NODE and break evals/hierarchy-structure's baseline.

## Coverage

```
  60 of 60 calls came back.
  — every call came back and named the model it was sent to (an upstream swap
    serving the same model would not show here; see the comment at the check)
```

## Shape facts — observations, never scores

| arm | questions kept | never written | dropped by the rule | invented ids | median words | ends "?" | yes/no | bracketed hint | counted hint | hint after "?" | gists with meta-narration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| incumbent | 6 | 0 | 0 | 0 | 19 | 0% | 17% | 100% | 67% | 100% | 0 |
| incumbent-repeat | 6 | 0 | 0 | 0 | 18 | 0% | 17% | 100% | 50% | 100% | 0 |
| gists-toc6 | 6 | 0 | 0 | 0 | 20 | 0% | 17% | 100% | 33% | 100% | 1 |
| questions-toc6 | 6 | 0 | 0 | 0 | 10 | 100% | 17% | 0% | 0% | 0% | 0 |
| v1 | 6 | 0 | 0 | 0 | 16 | 100% | 0% | 100% | 17% | 0% | 0 |

## Calibration — PASSED

Five known-bad lines (#1 fabricated count — the child count (6) where the text says four; #2 a lookup: one fact settles it and no argument need be followed; #3 answer-leaking question; #4 title-only line; #5 the gist with a question mark on it) went into the question lineup for `noema-mythology-of-conscious-ai`/`n0048`. Checked over 2 lineup(s).

## Ranking — questions

Generation noise floor (incumbent vs incumbent-repeat, PAIRED within each lineup): 1.83 ranks over 12 lineups — their mean ranks differ by 0.67, which cancels and is not the floor
Judge instability (same output, fresh shuffle): 0.40 ranks — how far an arm's MEAN rank moves between 2 repeats, which is the unit the gaps below are in. Per-lineup churn, comparable with the generation floor above and NOT the threshold: 0.80 over 30 comparisons.
Separability threshold: 0.40 ranks
Leader in each repeat's own table: repeat 1: incumbent; repeat 3: questions-toc6
1 judging call(s) failed, so the repeats below are fewer than were asked for.

| arm | mean rank | lineups | comparison |
|---|---|---|---|
| questions-toc6 | 0.83 | 12 | bakeoff (one block vs `gists-toc6`) |
| incumbent | 1.42 | 12 | baseline |
| incumbent-repeat | 2.08 | 12 | noise-floor (one block vs `incumbent`) |
| v1 | 2.58 | 12 | bakeoff (one block vs `gists-only`) |
| gists-toc6 | 3.08 | 12 | bakeoff (one block vs `gists-toc5`) |

**No leader is named.** The honest output is that this screen rejected nothing among the arms above:
- `questions-toc6` is not the sole leader of every repeat (repeat 1: incumbent; repeat 3: questions-toc6)
- some judging calls failed, so this table is missing repeats that were asked for and might have moved the leader

## Axes — questions, scored before any preference was asked for

| arm | demand | distinctive | fidelity | leakage | orientation | simplicity | triage | judgements |
|---|---|---|---|---|---|---|---|---|
| anchor-1 | 4.00 | 5.00 | 1.00 | 3.00 | 3.50 | 4.00 | 4.00 | 2 |
| anchor-2 | 1.00 | 3.50 | 5.00 | 1.00 | 3.00 | 5.00 | 2.50 | 2 |
| anchor-3 | 4.00 | 5.00 | 3.50 | 4.50 | 5.00 | 2.50 | 4.00 | 2 |
| anchor-4 | 1.50 | 2.50 | 5.00 | 1.00 | 2.50 | 5.00 | 2.00 | 2 |
| anchor-5 | 3.50 | 5.00 | 5.00 | 5.00 | 5.00 | 2.00 | 4.00 | 2 |
| gists-toc6 | 4.33 | 4.92 | 4.08 | 2.67 | 4.67 | 4.00 | 4.83 | 12 |
| incumbent | 4.42 | 5.00 | 4.67 | 2.42 | 5.00 | 4.08 | 5.00 | 12 |
| incumbent-repeat | 4.25 | 4.75 | 4.75 | 1.92 | 4.75 | 4.00 | 4.92 | 12 |
| questions-toc6 | 4.42 | 4.50 | 5.00 | 1.00 | 4.50 | 5.00 | 4.67 | 12 |
| v1 | 4.42 | 4.92 | 4.83 | 2.75 | 4.92 | 3.75 | 4.92 | 12 |

Non-numeric axes (questions):
- anchor-1/shapeHint: false 2
- anchor-2/shapeHint: none 1, true 1
- anchor-3/shapeHint: true 2
- anchor-4/shapeHint: none 2
- anchor-5/shapeHint: true 2
- gists-toc6/shapeHint: true 10, unverifiable 2
- incumbent-repeat/shapeHint: unverifiable 4, true 8
- incumbent/shapeHint: unverifiable 4, true 8
- questions-toc6/shapeHint: none 12
- v1/shapeHint: true 12

Lower is better for `leakage` alone. "Before" is a request made in the prompt and the schema, not something a text model can be forced into — an axis that AGREES with the ranking is weak evidence; one that disagrees is the interesting one.

**The anchors are in this table and out of the ranking one**, deliberately: excluded from mean ranks because they are a gate rather than a competitor, included here because their axis scores are the diagnostic — anchor 1 should score 1 on fidelity, anchor 3 should score high on leakage, and a judge that gave them threes across the board was not reading.

## Ranking — gists

Generation noise floor (incumbent vs incumbent-repeat, PAIRED within each lineup): 1.83 ranks over 12 lineups — their mean ranks differ by 0.83, which cancels and is not the floor
Judge instability (same output, fresh shuffle): 0.47 ranks — how far an arm's MEAN rank moves between 2 repeats, which is the unit the gaps below are in. Per-lineup churn, comparable with the generation floor above and NOT the threshold: 0.60 over 30 comparisons.
Separability threshold: 0.47 ranks
Leader in each repeat's own table: repeat 1: incumbent; repeat 3: questions-toc6 = incumbent tied
1 judging call(s) failed, so the repeats below are fewer than were asked for.

| arm | mean rank | lineups | comparison |
|---|---|---|---|
| incumbent | 1.50 | 12 | baseline |
| v1 | 1.92 | 12 | bakeoff (one block vs `gists-only`) |
| gists-toc6 | 2.08 | 12 | bakeoff (one block vs `gists-toc5`) |
| questions-toc6 | 2.17 | 12 | bakeoff (one block vs `gists-toc6`) |
| incumbent-repeat | 2.33 | 12 | noise-floor (one block vs `incumbent`) |

**No leader is named.** The honest output is that this screen rejected nothing among the arms above:
- incumbent, v1 sit within 0.47 ranks of each other
- `incumbent` is not the sole leader of every repeat (repeat 1: incumbent; repeat 3: questions-toc6 = incumbent tied)
- some judging calls failed, so this table is missing repeats that were asked for and might have moved the leader

## Axes — gists, scored before any preference was asked for

| arm | distinctive | fidelity | orientation | simplicity | triage | judgements |
|---|---|---|---|---|---|---|
| gists-toc6 | 4.83 | 4.17 | 4.67 | 3.92 | 4.75 | 12 |
| incumbent | 4.92 | 5.00 | 4.83 | 4.17 | 4.92 | 12 |
| incumbent-repeat | 5.00 | 4.00 | 4.50 | 4.00 | 4.83 | 12 |
| questions-toc6 | 4.83 | 4.50 | 4.92 | 4.17 | 4.83 | 12 |
| v1 | 4.58 | 4.58 | 4.67 | 4.83 | 4.67 | 12 |

Non-numeric axes (gists):
- gists-toc6/length: right 9, long 3
- incumbent-repeat/length: long 2, right 10
- incumbent/length: long 4, right 8
- questions-toc6/length: right 10, long 2
- v1/length: right 12

Lower is better for `leakage` alone. "Before" is a request made in the prompt and the schema, not something a text model can be forced into — an axis that AGREES with the ranking is weak evidence; one that disagrees is the interesting one.

**The anchors are in this table and out of the ranking one**, deliberately: excluded from mean ranks because they are a gate rather than a competitor, included here because their axis scores are the diagnostic — anchor 1 should score 1 on fidelity, anchor 3 should score high on leakage, and a judge that gave them threes across the board was not reading.

## Does the row want the gist, the question, or both?

question: 12

This is the plan's open outcome, not a decision: GPT Sol's P1-1 moved "the question replaces the gist" out of § What changes, precisely and into something the eval is allowed to return.

**And it is the weakest thing in this file.** The gist and the question lineups are shuffled independently, so this answer is about the row in the abstract and not about any ARM's gist beside its own question — it cannot see whether one arm's two lines complement each other, duplicate each other or disagree. Settling the rendering needs a second, paired lineup of whole rows, which is not built. ⟨GPT Sol, P1-8.⟩

## 1 judging call(s) failed
- noema-mythology-of-conscious-ai-r2: judge answer for noema-mythology-of-conscious-ai-r2 is not valid JSON: it ends part-way through — cut off after 9225 characters

## Arms needing a change to production code if they win

(none)
(`v4` puts the shape hint after the question mark, and `questionFor` used to turn that into "…? (4 arguments)?". It shipped as `toc/7` on 2026-09-07 and production now carries the patch — variants.md § The code change V4 needs.)
