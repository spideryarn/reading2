# Simple's "feedback loops" terminology collision: a prompt rule tried, not shipped, and the guard proposed

**Status as of 2026-10-01:** the two prompt wordings were measured and backed out; the screen and
probe provenance are built; the guard is a proposal, not built.

A fidelity bug in Simple (Summary's Brief · Simple · Fuller), dispatched by the Overseer, recorded in
[261001b § Fidelity](261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md):
on the PID paper (`entropy-24-00930-spya-pywwkq`) a summary says synergy *"grows with more feedback
loops"*, borrowing the paper's name for a different connection type whose effect goes the other
way. Part of
[summaries.md § Simple](../project/summaries.md#simple-a-plain-words-orientation).

**The outcome, first.** Neither tested prompt wording made the fault rare enough to ship. v1 reduced
clear swaps, but still gave 5 term swaps in 36 when misleading glosses are included, plus one output
that put feedback connections in the wrong direction. v2 gave 8 term swaps of 18, against 6 of 18
for the unchanged prompt. Nothing in `src/` changed. What lands is the likely mechanism, the evidence,
a screen for the fault, provenance in the probe, and a proposed guard for Greg to decide on (§ The guard).

## The likely mechanism and class

**Not the inputs.** All 99 body blocks go into every call, including the finding (`spya-sd9fzd`). Of
the 30 faulty paragraphs written on this paper so far, **27 cite that very block**.

**The paper defines three kinds of connection side by side** (`spya-xs5660`), and finds two of them
going opposite ways (`spya-sd9fzd`):

| the paper's term | what it is | what it does to synergy |
|---|---|---|
| feedforward | source → target | raises it, most of the variance |
| **feedback** | target → source | **lowers it**: two of them, 10% less |
| **recurrent** | source ↔ source | **raises it**: two of them, 50% more |

The everyday word for a recurrent connection is a "loop", or a "feedback loop". So the model writes
*"more feedback loops between source neurons"*. The phrase describes the right wiring, but the name
belongs to the other kind, the one that lowers synergy. A reader who later meets *"feedback
connections … reduced synergy"* has been given the same label for two findings that point in
opposite directions.

Stated as Sol put it in the plan review: **plain-language pressure makes the model more likely to
overwrite a distinction the piece defines locally with its ordinary-language prior.** It is a
prompt–model interaction, and stochastic:

- **Slips occur at every pitch, most often in Brief in this sample.** The unchanged prompt, no
  profile, six runs: Brief 3 of 6, Simple 1 of 6, Fuller 2 of 6.
- **Existing expert-profile outputs slip less.** Across the successful `high-about-*` runs, 1 of 12
  outputs slips and eleven keep *recurrent*; eight state the contrast unprompted (*"rises with
  recurrent (but not feedback) connections"*). Those runs used earlier 261001b prompt revisions, so
  this is a pattern, not evidence that the profile caused the difference.
- **No other stored stage on this article uses "feedback loop".** A free scan of every JSON column
  of the revision found the phrase only in Simple. That literal scan does not rule out a different
  synonym collision elsewhere. Simple is pitched lowest (12/15/18).

**The likely class: a plain synonym that is already the piece's name for something else.** The same
mechanism could affect any piece that sets sibling terms side by side and finds them different:
incidence and prevalence, weather and climate, precision and recall. This experiment establishes it
on one paper; those examples are plausible exposures, not measured ones. The current rule,
*"plainer means equally specific … keep the direction of a finding"*, cannot catch it, because to the
writer "feedback loop" really does mean recurrent in ordinary English.

## What was tried

One bullet in Simple's **FAITHFUL, NOT JUST SIMPLE** section, its example deliberately from another
field so the measurement was not the prompt reciting its own answer. Its final wording took Sol's
narrowing (*"if you mention one"*), so that Brief was not pushed to introduce every sibling:

> Where the piece names kinds of thing side by side and finds them different, keep that line. If you
> mention one, use the piece's name for it and say in everyday words what it is. Never call it by
> another kind's name, or by an everyday phrase built on that name: a finding pinned to the wrong
> name is a finding turned around. For example, a piece that counts new cases ("incidence") apart
> from everyone who has the illness ("prevalence"): a rise in incidence is not "more people have
> it".

**v2** added *"or explain it"*, after v1 produced a new, milder slip that keeps the term but glosses
it with the other kind's name (*"recurrent (feedback-style) connections"*).

### Passed over

- **A list of forbidden swaps, or a post-check for "feedback loop".** A patch for this paper.
- **The rule in the shared `plainWords()` core.** That would change and re-stamp every prompt that
  carries it, each needing its own measurement, for a fault seen in one stage. Moot now that the
  local rule did not make the fault rare enough to ship.

## Measuring it

Production's own `generateSimpleSummary` through `evals/simple/probe.ts`: `high` effort, no profile
(where the fault is commonest), all three levels a run. The arms were separated in time, on the same
base commit `1944a565`: `high-none-pidpre1…6` (unchanged), `high-none-pidpost1…12` (v1),
`high-none-pidv2_1…6` (v2). Runs 1 and 2 of each also wrote Olah's *A4* and Gwern's *Scaling
Hypothesis* as controls.

**The fault** is an output (one level of one run) that names the source-to-source wiring "feedback".
[`term-swap.ts`](../../evals/simple/term-swap.ts) prints every sentence about feedback, loops or
recurrence. I read every one by hand against `spya-sd9fzd`, because the screen both over-flags and
under-flags. It flagged pidpost12 Fuller, which states the contrast correctly. It also flagged
pidpost9 Fuller: that output does not swap the terms, but it wrongly says feedback connections go
*"to the target"* rather than from the target back to a source. The screen could not see a fault
without the word "feedback", and it does not show an output that dropped the finding. Every run
succeeded (24 of 24 on the paper), so no failures hide in the denominator.

| arm | prompt | clear swap ("feedback loops") | glossed with the other's name | other direction error | none of these, or finding omitted |
|---|---|---:|---:|---:|---:|
| `pidpre1–6` | unchanged | **6 / 18** (5 of 6 runs) | 0 | 0 | 12 |
| `pidpost1–12` | v1 | **3 / 36** | 2 (*"recurrent (feedback-style)"*, *"feedback-loop-like recurrent"*) | 1 (*"feedback connections to the target"*) | 30 |
| `pidv2_1–6` | v2 | **7 / 18** | 1 (*"feedback loops between source neurons called recurrent connections"*) | 0 | 10 |

v1's clear swaps against the unchanged prompt give Fisher's exact p = 0.047 (two-sided), or 0.15 with
the glossed slips counted. With the separate direction error too, it is p = 0.18. At run level the
same comparisons are p = 0.043, p = 0.15 and p = 0.32. So v1 may have a real effect on the clear
phrase; the evidence for fewer semantic slips overall is inconclusive. **v2, which differs by four
words, did not reproduce the improvement**: 8 of 18 in all. Descriptively pooling the distinct
wordings gives 14 related errors in 54 outputs (26%) against 6 of 18 (33%), but they are not one
intervention. The threshold set before measuring was 0–1 of 18. Neither wording reached it.

**The controls** (lengths only, since nothing ships): every run valid, and the Simple level 203–246
words on Olah and 223–280 on Gwern in all three arms (Brief 106–168, Fuller 249–329). The rule cost
neither length nor validation. No blind read was run,
because the change it would have judged is not shipping.

**Cost:** $5.52 for 36 paid article generations (24 on the paper, 12 controls), summed from the
`costUsd` in each result file. The controls were six multi-article probe invocations, which is the
source of the smaller count.

### Why not keep trying wordings

The brief: *"If the honest answer is that the model does this sometimes and no prompt change reliably
stops it, say so with the evidence and propose the cheapest guard, rather than shipping a change you
cannot show helps."* The evidence does not show that no possible prompt can help: it suggests v1
reduced the clear phrase. It does show that neither tested wording met the acceptance threshold, and
that a four-word change produced a much worse result. Telling a third wording apart from noise would
take something like 30 runs an arm, about $5 a wording, with no reason to expect a large enough
effect.

## The guard (proposed, not built — Greg's call)

**In one call per level, check each paragraph against the passages it cites, and re-ask the level if
one contradicts them.** Every paragraph already names one to three ids, and in 27 of 30 faulty
paragraphs seen so far the contradicting passage is one of them. A level-wide structured verdict
keeps each paragraph paired with its own evidence but needs three calls a press, not 9–12 separate
calls. It can sit after `buildLevel` inside `writeLevel` and share that function's two-attempt budget.

```
level written ──► one checker reads each [paragraph + its own cited blocks]
                  ──► returns one verdict per paragraph
                  ──► any "contradicts" ──► the level uses its remaining attempt
```

- **Targets a broader fault:** it could catch bent claims that their cited passages contradict, not
  just this term. It cannot catch a contradiction absent from those passages: even a perfect
  classifier misses 3 of the 30 known faulty paragraphs here. That is the price of checking only the
  small evidence packet rather than the whole article.
- **Costs (estimate, not measurement):** three small checker calls a press. Roughly $0.01 and 2–5 s
  more wait on a quick model is plausible, but concurrency, false alarms and latency must be measured.
  A retry costs the level writer and its checker again. One checker for all three levels would cut
  the call count further, but no longer fits the existing per-level retry path cleanly.
- **Gives up:** a verdict call is not plain words, so it goes in `PLAIN_WORDS_EXEMPT`. It is also a
  second model's opinion: a false "contradicts" costs a retry, and a second failure stores nothing.
  A checker transport failure must fail closed if this is to be a fidelity guard; that availability
  cost is part of the measurement.
- **Measurable before building, plausibly for under $1:** hand-label the raw outputs here and the
  older outputs behind the 30-fault count, then measure recall and false alarms. The result JSON is a
  candidate corpus, not a labelled set: its files contain no gold verdicts yet.
- **Accounting:** checker usage must be included in `SimpleSummaryRun`'s call and token totals, not
  only in the `ai_calls` ledger.
- **The cheaper half-measure:** have the writer list, in an ignored JSON field, any terms the piece
  contrasts before it writes. No extra call, but it is a prompt change of exactly the kind measured
  above, so expect the same noise.

**Not touched:** `SIMPLE_VERSION` stays `simple/2`, because the prompt did not change. Sol's
plan-review point stands for whichever change does ship: a prompt change must bump the stamp, and
for Simple that version is also the shape guard (`isUsableSimpleSummary`). So the bump should split
"which prompt wrote it" from "can we read its shape", or every stored summary reads as absent.

## Reviews

- Plan: [261001h-contrasting-terms-plan-review-sol.md](261001h-contrasting-terms-plan-review-sol.md).
  Taken: the cause restated as an interaction, the expert-profile claim corrected, a hand rubric over
  every output, the narrower rule wording, and model, article and system-prompt hashes recorded per
  run (`probe.ts`; the `pidpre` arm predates them, on the same base commit, half an hour earlier). The
  version split was built, then backed out with the prompt.
- Code and conclusion: reviewed 2026-10-01; the count, conclusion, guard and harness corrections are
  incorporated above.
