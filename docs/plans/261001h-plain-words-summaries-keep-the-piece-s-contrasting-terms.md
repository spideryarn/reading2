# Simple's "feedback loops" terminology collision: a prompt rule tried, not shipped, and the guard proposed

Research write-up: [docs/research/261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md](../research/261002c-simple-fidelity-guard-prompt-rules-failed-luna-checks-opus-writes.md).

**Status as of 2026-10-01:** the two prompt wordings were measured and backed out; the screen and
probe provenance are built; the guard is a proposal, not built. It was measured the same day
(§ Measuring the guard): Luna catches 24 of the 30 known faults for about $0.0027 per complete
three-level press. The recommendation is to build an instrumented first version, store the retry
after a second flag, and fail open if the checker itself fails. **Built that way the same day:
[261001i](261001i-simple-fidelity-guard-built.md).** Whether a bigger model does better was measured the same evening: Opus made the
fault in none of 36 levels, so Simple is written on Opus and the guard kept —
[261001p](261001p-simple-on-opus-with-and-without-the-fidelity-guard.md).

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

## Measuring the guard (2026-10-01)

**Recommendation: build an instrumented first version.** Use Luna (the quick tier) as the checker,
store the retried level after a second flag, and fail open if the checker itself fails. As originally
proposed, a level flagged twice stores nothing; on this paper that would lose roughly 30–35% of
presses. Nothing was built into the app; the decision is Greg's.

### What was measured

A throwaway probe,
[`scripts/probes/261001h-fidelity-guard-probe.ts`](../../scripts/probes/261001h-fidelity-guard-probe.ts),
sends the checker the guard section describes. There is one call per level. Each paragraph goes with
the text of the blocks it cites, and one verdict per paragraph comes back. A run's levels go in
parallel, as in a press.

The checker prompt names the class of fault (a reversed direction, or a finding told under another
thing's name). It never names this paper or the word "feedback". It was not tuned on the results.
No `ai_calls` rows were written.

**The labelled set** ([labels](261001h-fidelity-guard-labels.json)) covers every saved successful
Simple run:

- **The PID paper:** 51 runs, 128 levels and 493 paragraphs. The 30 faulty paragraphs were labelled
  by hand, and they reproduce this plan's counts: 26 clear swaps, 3 glosses using the other kind's
  name, and 1 direction error.
- **Controls:** 60 runs on Olah and Gwern, 150 levels and 568 paragraphs, with no preselected
  faults. Adjudicating the alarms found two real faults.

The checker measurement is conditional on the writer having produced a usable level. Nine failed
source runs (five PID, four controls) are recorded in the corpus and excluded; none is in the shipped
`pidpre` arm.

Every alarm on an unlabelled paragraph was read by hand against its passages. The presumption that
an unflagged paragraph is faithful was checked by a
[blind read of 30 of them](261001h-fidelity-guard-blind-read.md), which found no fault in any. That
puts the missed-fault rate below about 10%, not at zero.

### The numbers

| | Luna (quick tier) | Sonnet 5 (capable tier, Messages wire, low effort) |
|---|---:|---:|
| levels checked | all 278 | 105 (the pidpre, pidpost and v2 arms and their controls; stopped at budget before `pidv2_6`) |
| PID faults caught, all 30 / subset 17 | **24 / 30 (80%)** · 12 / 17 | — · 11 / 17 |
| clear swaps · glosses · direction | 23/26 · 1/3 · 0/1 | 9/13 · 2/3 · 0/1 |
| caught among faults citing the finding (`spya-sd9fzd`) | 24 / 27 (89%) | 11 / 15 |
| alarms / rate-eligible unlabelled paragraphs, PID · controls | 11/461 · 3/567 | 12/237 · 1/134 |
| … of which, read by hand: real faults found · borderline · true but outside its cited passages · plainly wrong | 3 · 1 · 11 · 0 | 0 · 0 · 12 · 1 |
| unreadable answers | 0 / 278 | 1 / 105 |
| cost per complete three-level press | **$0.0027** | $0.027 |
| latency of one call: median · p90 | 3.5 s · 5.0 s | 1.9 s · 5.5 s |
| latency of a complete press (three calls in parallel): median · p90 · max | 4.4 s · 5.8 s · 12.2 s | 4.0 s · 7.0 s · 14.4 s |

The two borderline PID paragraphs and the one borderline control alarm are outside the rates; their
levels are outside the output-level rates too. The cost and press latency likewise use only saved
runs with all three levels: 44 of Luna's older saved runs contain only one or two levels, which is
why dividing its total cost by all 111 saved runs gave the earlier, wrong $0.0024 figure.

**Why Luna.** setup-dev.md's rule is that a new job *"may be born on the quick tier by judgment"*.
The measurement agrees with that choice:

- On the same 17 labelled faults and 371 other rate-eligible paragraphs, Luna caught 12 against
  Sonnet's 11 and raised 9 alarms against 13. Those small differences do not establish that Luna is
  more accurate; they give no accuracy reason in this sample to pay for Sonnet.
- It cost a tenth as much.
- Luna found all three real faults outside the original labels. Only one of those paragraphs was in
  Sonnet's measured subset, and Sonnet missed it; the other two are not a comparison between models.

Sonnet reached the guard through the request a Sonnet build would send. Luna reached it through
`link-summary`'s route, which is the request a Luna build would send.

**What the alarms were.** Three of the alarms are real faults that no label had: the reason a guard
is worth more than a fix for one term. Two are in the 150 control levels and one is another PID
fault.

- A Gwern brief says understanding is *"knowing ice cream melts rather than freezes"*. The passage
  gives "melt" as the model's error.
- A PID paragraph says finite samples bias entropy *upward*. The passage says the estimator
  underestimates it.
- An Olah paragraph says composition *"needs exponentially many neurons"*. That is the local code.

Every other alarm was a claim that is true about the article but absent from the paragraph's own
passages, mostly *"synergy peaks at moderate correlation"* (`spya-ybmve2`). Those paragraphs cite only
the passage that reports a steady rise (`spya-hkhpex`). The checker read its evidence correctly; the
evidence was too narrow. Only one alarm, one of Sonnet's, was a plain misreading.

The three discoveries show examples of broader reach, not a rate: they were found by reading the
checker's alarms after the fact. The blind sample found no further fault in 30 passed paragraphs,
but three articles and 30 paragraphs cannot establish general recall.

**What it misses.** It caught none of the 3 faults whose paragraph does not cite `spya-sd9fzd`,
which is the price the plan named, and 24 of the 27 that do. It also caught 1 of the 3 glosses and
missed the one direction error (*"feedback connections to the target"*), which is the subtlest kind.

### What it would do to a press

The model below uses the shipped configuration (`pidpre`: the unchanged prompt, no profile, 18
outputs on this paper). It assumes a retry is an independent fresh sample. That assumption was not
measured. The original figures pool Brief, Simple and Fuller; because a retry repeats the same level,
a same-level sensitivity calculation is also shown. There are only six samples per level, so both
are rough projections, not measured retry outcomes.

- **On this paper:**
  - 6 of 18 levels are faulty, and the checker flags 5 of them. It also flags 1 of the 12 clean
    levels (a true-elsewhere alarm). So a third of levels are flagged on the first attempt.
  - **As proposed (a second flag stores nothing):** the pooled model takes faulty requested-level
    slots from 33% to 7%, loses 11% of levels, and therefore loses 30% of presses. Among the levels it
    actually stores, 8% are faulty. Preserving each level's observed rate gives about 7% faulty
    slots, 13% lost levels and 35% lost presses instead; among stored levels, the fault rate is 9%.
  - **With the change (a second flag stores the retry):** the pooled model leaves about 17% of levels
    faulty; the same-level calculation gives 18%. No press is lost under either calculation.
- **On the controls:** after excluding the borderline case, 3 of 149 levels are flagged. The
  fail-closed proposal would lose about 0.1% of presses on a second flag; storing the second attempt
  loses none. There is no measured control fault rate from which to project faults after retries.
- **Spend:**
  - The checker costs about $0.0027 a press against the writer's ~$0.15.
  - On this paper about one level a press is rewritten, adding ~$0.05.
  - On the controls a rewrite adds about $0.003 on average.
- **Wait:** the check runs after each level, so a press waits about 4–5 s longer on top of the
  writer's 10–20 s. A press with a retry waits another ~15 s. The pooled model predicts one on about
  70% of presses on this paper; the observed first attempts flagged at least one level on 5 of 6.

### The recommendation, and why

**Build it as an instrumented first version, with the change.** On the one shipped configuration and
paper measured, the analytical model suggests that it roughly halves the fault; the retry itself was
not run. The checker alone adds about 2% to a ~$0.15 press, but that is not the guard's total cost:
projected retries take the worst paper to roughly 35% extra spend, and the controls to roughly 4%.
The two real control faults show useful reach beyond the labelled PID term collision, but do not
establish a general catch rate. This is enough for a reversible, counted beta trial, not for a claim
that fidelity broadly improved.

Failing closed would instead turn a fidelity fault into a missing summary on exactly the papers where
the fault is common, and a reader cannot read a Simple that was never stored.

So the rule becomes: check, retry once on a flag, and store the second attempt whatever its verdict,
recording that it was flagged. If the checker call fails or answers unreadably, keep the current
writer output unchecked and record the checker failure; do not spend the writer retry. Luna had 0
such failures in 278 calls, so this fail-open behavior is an availability decision, not a result the
probe measured. That reverses this plan's earlier *"must fail closed"*. Say so if you want it back.

The guard and today's validation retry share `LEVEL_ATTEMPTS = 2`. If validation already consumed
the first attempt, a flag on the valid second attempt cannot trigger a third writer call: store that
flagged level and record that the retry budget was exhausted.

Three follow-ups, none of them needed for the first build:

- **Pass the checker's one-sentence reason to the retry.** That may beat a fresh sample. It costs
  only a few lines, but it is a prompt change, so measure it like one.
- **Widen the evidence packet** to cut the true-but-elsewhere alarms. It could include the blocks
  next to each cited one, or the whole article (cached). Neither was measured, and the whole article
  may cost recall.
- **Count the flags in production**, from the record the guard stores, before trusting any of the
  rates above beyond these three articles.

**Spend:** $1.20 in all. Luna was $0.26, including a one-press smoke test. Sonnet was $0.94,
including a one-press pricing call. Both are summed from the spend collector's records in
`261001h-fidelity-guard-{luna,sonnet}.jsonl`.

## Reviews

- Plan: [261001h-contrasting-terms-plan-review-sol.md](261001h-contrasting-terms-plan-review-sol.md).
  Taken: the cause restated as an interaction, the expert-profile claim corrected, a hand rubric over
  every output, the narrower rule wording, and model, article and system-prompt hashes recorded per
  run (`probe.ts`; the `pidpre` arm predates them, on the same base commit, half an hour earlier). The
  version split was built, then backed out with the prompt.
- Code and conclusion: reviewed 2026-10-01; the count, conclusion, guard and harness corrections are
  incorporated above.
- Guard measurement, plan:
  [261001h-fidelity-guard-plan-review-sol.md](261001h-fidelity-guard-plan-review-sol.md). All six
  P1s were taken:
  - hand adjudication scored in categories;
  - an unreadable answer counted once;
  - the controls and a blind read added;
  - shipped-configuration rates reported separately;
  - the retry outcome modelled;
  - Sonnet sent through the Messages request a build would use.
- Guard measurement, probe and conclusion:
  [261001h-fidelity-guard-code-review-sol.md](261001h-fidelity-guard-code-review-sol.md). Sol fixed
  these itself, and they are in the section above:
  - the spend claim, which counted the checker and not the retries it causes;
  - cost and latency over complete presses only;
  - the borderline exclusion in the scorer, and a missed borderline label;
  - the unfair "Sonnet found none" comparison;
  - the same-level sensitivity figures;
  - how the guard shares `LEVEL_ATTEMPTS` with validation.
