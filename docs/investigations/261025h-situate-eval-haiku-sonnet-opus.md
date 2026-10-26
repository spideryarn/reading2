# Situate on Haiku, Sonnet and Opus: nine ways to read one fixed set of evidence

Owned by [investigations.md](../project/investigations.md). 2026-10-25. Stage 4 of plan 261025h
(Sources becomes three chips, a cost ladder and experiments), and the answer to queue item
`qi-9bc5xnwn`. It follows the spike
[261024b](261024b-situate-spike-searches-into-one-read-cost-and-quality.md) and the six-article trial
[261025a](261025a-sources-trial-situate-reception-cited-by-on-six-articles.md); the step is
[plan 261024o](../plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md)
and `src/situate.ts`.

> Do an eval to see if we can get away with using Haiku more heavily, with maybe Opus for anything
> that we think requires intelligence.
>
> — Greg, 2026-10-25

## What it found, in short

- **Opus reads best, by a margin larger than the noise.** A blind judge ranked the Opus read first
  on four of the six articles. It got the kind of finding wrong once in 79 findings; Sonnet got it
  wrong 16 and 17 times in two runs, mostly by filing older work under *Since*. That is the failure
  the stage-4 hand check found and plan 261025h's stage 1 is adding a code check for.
- **Haiku should not write the notes.** Reading the same evidence, it kept half as many findings.
  Its coverage was about two-thirds of Sonnet's, and it ran out of room on the longest article.
- **Haiku is good at choosing evidence.** Haiku shortlists about 20 of the ~90 sources and a stronger
  model writes from those alone. With Sonnet writing, that matches today's quality for less.
  With Opus writing, it matches the full Opus read for about 80% of its cost.
- **The planner should stay on Sonnet.** A Haiku plan saves two cents. The judges preferred
  Sonnet's plan on all six articles, and Haiku's plan found 20 of the 26 known works where Sonnet's
  found 26.

Recommendation and the costs are in [§ Recommendation](#recommendation).

## How it was run

On the local stack only. [`scripts/spikes/261025h-situate-eval.ts`](../../scripts/spikes/261025h-situate-eval.ts)
refuses a database that is not local. Output is in `output/situate-eval/`, which is gitignored
because it holds article prose.

```
npx tsx scripts/spikes/261025h-situate-eval.ts evidence all            # Sonnet plan + 16 searches + citers, bought once
npx tsx scripts/spikes/261025h-situate-eval.ts evidence all haiku      # the Haiku plan's own searches, same hour
npx tsx scripts/spikes/261025h-situate-eval.ts read <slug> A,A2,B,E,F,C,PH
npx tsx scripts/spikes/261025h-situate-eval.ts read <slug> G,D
npx tsx scripts/spikes/261025h-situate-eval.ts score                    # code checks
npx tsx scripts/spikes/261025h-situate-eval.ts planners                 # planner end to end
npx tsx scripts/spikes/261025h-situate-eval.ts cold                     # ledger rows, cold cost
npx tsx scripts/spikes/261025h-situate-eval.ts blind all                # one shuffled packet per article
npx tsx scripts/spikes/261025h-situate-eval.ts unmask                   # judges' verdicts per arm
```

- **One fixed set of evidence per article.** It was bought once through the real code paths in
  `src/situate.ts`: `SITUATE_PLAN_SYSTEM` on Sonnet, `searchAll` (16 forced Exa searches),
  `situateCiters`, `citedEvidence` and `numberedEvidence`. Every reader arm read the same file.
  The spike's saved evidence could not be reused, because it is for different articles.
- **The real calls.** Each model call goes through `streamMessage`. The spike points
  `MODEL_ENV_VAR.situate` at a variable of its own for one call; that is a change to an exported
  table inside the spike's own process, and `src/models.ts` is unchanged. Each call runs in its own
  `collectSpend`, scope `eval`, with step name `eval-261025h-<arm>`. So every cost below is the
  provider's figure from the local `ai_calls` ledger.
- **Production's prompt, body and budget.** The arms send today's `readInstructions`, schema and
  `max_tokens`, with no reader profile. Every answer goes through the real `checkFindings`, checked
  against all of the evidence, including for the arms that saw only part of it.
- **The six articles** are the trial's: *The Extended Mind*, *Dropout*, *Evaluating AGENTS.md*,
  *The Mythology of Conscious AI*, *Heuristics That Almost Always Work*, *Consciousness in AI*.

### The arms

| Arm | Plan | Evidence the writer sees | Writer |
|---|---|---|---|
| **A** | Sonnet | all (~90 sources) | Sonnet 5.5, today's call |
| **A2** | Sonnet | all | Sonnet again: the noise floor |
| **B** | Sonnet | all | Haiku 5.5 |
| **E** | Sonnet | **compressed**: each page cut to 1,200 characters, repeated passages removed, at most 3 pages a query. No model. | Sonnet |
| **F** | Sonnet | compressed | Haiku |
| **C** | Sonnet | **Haiku's shortlist**: up to 14 candidate findings, each naming 1–5 sources; the union of those sources, at most 40 (13–25 in practice) | Sonnet |
| **D** | Sonnet | Haiku's shortlist (the same one as C) | Opus 5.5 |
| **G** | Sonnet | all | Opus 5.5 |
| **PH** | **Haiku** | all, from the Haiku plan's own searches | Sonnet |

GPT Sol's review of the plan
(F11, F16, F17, in `docs/plans/261025h-sources-plan-review-sol.md` on the coordinator's branch) changed the
first design: it added E/F, G and PH, and it moved the judging from kept counts to scoring each
finding. D was meant to run only if C proved useful. It was run beside G because the budget allowed
both.

### The judge

Each article got one blind Opus subagent. It saw the article's title and the anonymised sets X1…X9
in an order shuffled per article. Each finding came with its whole article passage, its note and
kind, and the full extract of every source it rests on, exactly as the writer saw it. The judge
also had the trial's paragraph on what a careful reader would expect for that article.

It scored **every finding** on five questions:

- *entail*: does the source support the note?
- *unsupported*: does the note claim something material that its sources do not? This is the
  veto metric.
- *kind_ok*: is the kind right? A *Since* must be after the piece.
- *direct*: is it about this piece, not neighbouring background?
- *novel*: does it add more than the article says?

Then it scored each set's coverage from 0 to 5 and ranked the sets. A finding counts as **clean**
when it is entailed, carries nothing unsupported, and has the right kind. The keys are in
`output/situate-eval/<slug>-blind-key.json`, and the unmasking is `unmask`.

**The decision rule, set before unmasking:** Haiku is adopted for a phase only if its arm is
non-inferior to today's on two things: the rate of unsupported findings, and coverage. Opus is
recommended for a phase only if it beats the A–A2 spread on clean findings or kind errors, not on
rank alone.

## Results

### Cost and time per arm

The *cold* cost adds back the cache premium for an arm that read the article from a cache another
arm had just written. A production run is cold, so the cold cost is the one to compare.

| Arm | Read, cold, mean (min–max) | Seconds, mean | Kept (of written) | Unsupported (veto) | Kind wrong | Entailed | Clean / article | Coverage 0–5 | Mean rank | Firsts |
|---|---|---|---|---|---|---|---|---|---|---|
| A Sonnet | $0.201 (0.13–0.34) | 28 | 77 (79) | 8 | 17 | 82% | 8.3 | 3.67 | 4.67 | 1 |
| A2 Sonnet | $0.195 (0.13–0.33) | 26 | 73 (75) | 3 | 16 | 85% | 7.8 | 3.67 | 4.17 | 0 |
| B Haiku | $0.025 (0.006–0.10) | 26 | 38 (43) + 1 failed | 4 | 8 | 66% | 4.0 | 2.40 | 7.00 | 0 |
| E Sonnet, compressed | $0.143 (0.09–0.30) | 20 | 71 (75) | 5 | 17 | 79% | 8.0 | 3.67 | 5.50 | 0 |
| F Haiku, compressed | $0.013 (0.006–0.05) | 26 | 44 (46) | 6 | 3 | 66% | 4.5 | 2.50 | 6.33 | 0 |
| C Haiku triage → Sonnet | $0.159 (0.08–0.40)† | 36 | 66 (69) | 2 | 10 | 89% | 8.7 | 3.50 | 4.17 | 0 |
| D Haiku triage → Opus | $0.378 (0.19–0.74)† | 79 | 62 (64) on 5 | 1 | 1 | 94% | 11.4 | 4.00 | 2.20 | 1 |
| G Opus | $0.465 (0.33–0.78) | 65 | 79 (80) | 2 | 1 | 90% | 11.7 | 4.50 | 1.83 | 4 |
| PH Haiku plan → Sonnet | $0.174 (0.11–0.33) | 20 | 66 (72) | 9 | 15 | 80% | 6.7 | (3.33)‡ | (7.67)‡ | 0 |

† Includes the Haiku triage call: $0.007–0.01, except $0.12 on *Consciousness in AI*, where the
first attempt ran out of room (below). ‡ PH's rank is not trustworthy; see [§ The judging
bug](#the-judging-bug-and-what-was-re-scored).

The evidence, the same for every arm: Sonnet plan **$0.022** a run (Haiku plan $0.0013); 16 searches
**$0.12** (the Haiku plan's 13–14 searches, $0.10).

### Judge rank per article (1 = best; *c* = coverage)

| Article | A | A2 | B | E | F | C | D | G | PH‡ | Better plan |
|---|---|---|---|---|---|---|---|---|---|---|
| *Extended Mind* | 5 c4 | 6 c4 | 4 c3 | 7 c4 | 8 c2 | 3 c3 | 2 c4 | **1 c5** | 9 c3 | Sonnet |
| *Dropout* | 7 c4 | 3 c4 | 8 c2 | 6 c5 | 4 c3 | 9 c4 | 2 c4 | **1 c5** | 5 c3 | Sonnet |
| *AGENTS.md* | 7 c3 | 4 c4 | 9 c3 | 6 c3 | 5 c2 | 3 c4 | 2 c4 | **1 c5** | 8 c4 | Sonnet |
| *Mythology* | 2 c4 | 5 c3 | 6 c2 | 4 c3 | 7 c3 | 3 c3 | — (key limit) | **1 c4** | 8 c4 | Sonnet |
| *Heuristics* | **1 c4** | 2 c4 | 8 c2 | 7 c3 | 6 c3 | 3 c4 | 4 c4 | 5 c4 | 9 c3 | Sonnet |
| *Consciousness in AI* | 6 c3 | 5 c3 | — (failed) | 3 c4 | 8 c2 | 4 c3 | **1 c4** | 2 c4 | 7 c3 | Sonnet |

### Checks in code

`score` runs the two checks that plan 261025h's stage 1 is adding, written here rather than
waiting for that code:

- **a *Since* finding whose sources are all dated at or before the piece.** A source's date comes
  from OpenAlex, an arXiv number or a year in its address. It flagged **1–2 findings per arm** across
  all arms (A 1, A2 2, E 2, G 2, PH 1). But most *Since* findings' sources carry **no date at all**:
  2–7 per arm per article. The judge found 16–17 wrong kinds per Sonnet arm. So **a date-only check
  would catch only a small share of the error.** Most of the misfiled works are web pages with no
  date the code can read.
- **a note naming a work that is not among its sources.** The code looks for an author with a year,
  or "et al.", and checks that the name appears in one of the cited sources' text. It flagged 3–9
  per arm and agreed with the judge on the clear cases (Kirsh in A, Warde-Farley and Zaremba in A
  and G). It is noisy. Venue names and possessives slip through, and *Mowshowitz* was flagged on
  Haiku when the *Rock is Strong* extract did not carry the surname. Usable as a warning, not as a
  filter.

`checkFindings` dropped few findings in any arm: 0–4 per run, mostly `unquoted` and
`sourceUnquoted`. Kept counts measure how many notes a model writes, not how good they are.

### The planner, end to end

Each planner's checked queries were run within the same hour. The same reader, Sonnet, then read
each evidence set: A read the Sonnet plan's, PH the Haiku plan's. The **targets** are named works
taken from the trial's careful-reader paragraphs. They were written down before the Haiku plan's
pages were read. They lean towards what Sonnet found in the trial, which favours the Sonnet plan.

| Article | Sonnet plan: queries, pages, targets | Haiku plan: queries, pages, targets | Missed by Haiku |
|---|---|---|---|
| *Extended Mind* | 16, 76, 5/5 | 14, 63, 4/5 | *Supersizing the Mind* |
| *Dropout* | 16, 76, 5/5 | 14, 70, 4/5 | DropBlock |
| *AGENTS.md* | 16, 66, 3/3 | 13, 46, 3/3 | — |
| *Mythology* | 16, 74, 4/4 | 14, 64, 3/4 | introspection in LLMs |
| *Heuristics* | 16, 72, 4/4 | 13, 59, 3/4 | the fluvoxamine trials |
| *Consciousness in AI* | 16, 68, 5/5 | 14, 67, 3/5 | the IIT "pseudoscience" letter, *Taking AI Welfare Seriously* |

The two plans share only 7–20 pages of their 46–76. Both plans labelled every piece's kind, year and
angle the same way, and correctly. The judge preferred the Sonnet plan on **all six** articles. Its
complaints about the Haiku plan: thinner on the piece's own claims (5–6 claim queries against 7–8);
`citation` used for works the piece never cites; queries that overlap. Both plans had *missing*
queries aimed at work later than the piece.

With the same reader, the Haiku plan's evidence gave somewhat fewer clean findings: PH had 6.7 an
article against A's 8.3 and A2's 7.8. It had about the same errors (9 unsupported, 15 wrong kinds,
against 8 and 17). That fits the plan verdict without proving it on its own.

**Both plans found Zvi Mowshowitz's *Rock is Strong***, the direct reply that the trial's dossier
missed. Every arm cited it: A once, E four times, PH three times. So the trial's miss came from that
run's searches, not from the reader.

### Failures

- **Haiku ran out of room on the longest article.** On *Consciousness in AI* (38,000 words, about
  133k tokens in), Haiku's read used 8,311 of its 10,000 tokens reasoning and was cut off. The
  triage, given 4,000 tokens, used 3,947 reasoning and wrote 53 tokens of answer. Haiku 5.5's
  thinking is adaptive and on by default, and production's `situate` body sends no `thinking` or
  `effort`. So a Haiku arm needs either much more room or a lower effort. The triage was re-run with
  12,000 tokens of room and worked. This prompt also crosses Haiku's 100k-token price step ($0.50 /
  $2.50 above it, [261009a](261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md)): the
  failed read cost $0.10, ten times Haiku's price on the other articles.
- **The OpenRouter key hit its monthly limit** at $8.96 of this eval's spend. Arm D on *Mythology*
  then got `403 Key limit exceeded (monthly limit)` twice. D has five articles, not six.
  **Every other local paid call on this key will fail the same way until the limit is raised.**

### The judging bug, and what was re-scored

The first packets keyed each source's extract by its address alone. A page the Haiku plan's
searches found can carry a different extract from the same page found by the Sonnet plan's. So 16
of PH's 66 findings were shown the other plan's extract. They looked fabricated to the judges: two
of the six called them the worst errors they saw. `blind` now keys by evidence set and address. One
more blind Opus subagent re-scored those 16 findings against the right extracts
(`output/situate-eval/rejudge.json`), and `unmask` merges those scores. PH's finding-level numbers
above are the re-scored ones. **Its ranks and coverage were given with the wrong extracts showing,
so they are biased against PH and are not used.** No other arm was affected: all of them read the
Sonnet plan's evidence, and E/F's extracts are cut-down versions of the same text.

## Recommendation

**Plan on Sonnet; Haiku triages the evidence; Opus writes.** That is arm D. The cheaper version,
with Sonnet writing (arm C), comes second. The decision rule decides each phase:

| Phase | Today | Recommended | Why |
|---|---|---|---|
| Plan | Sonnet, $0.022 | **Sonnet** | Haiku is not non-inferior: judge 0 of 6, targets 20/26 against 26/26. It would save 2 cents. |
| Read | Sonnet, full evidence, ~$0.20 | **Haiku shortlist, then Opus** (~$0.38 cold) | Clean findings 11.4 an article against 8.3 and 7.8; kind errors 1 against 16–17; unsupported 1. Clearly outside the A–A2 spread. Within one judge rank of the full Opus read (2.2 against 1.8) for 80% of its cost. |
| Read, cheaper | — | **Haiku shortlist, then Sonnet** (~$0.16 cold) | Non-inferior to today on both measures in the rule (unsupported 2 against 8 and 3; coverage 3.5 against 3.67), and cheaper. It keeps Sonnet's kind errors (10). |
| Read on Haiku | — | **no** | Fails coverage: 2.4–2.5 against 3.67, and half the findings. Entailment 66%. Cut off on the longest article. |
| Compressed evidence | — | not on its own | E is no worse than A at 70% of the cost. But it still has Sonnet's 17 kind errors, and C is as cheap and cleaner. |

**Expected cost per article, cold**, with the searches at $0.12 throughout:

- today: $0.022 + $0.12 + $0.20 ≈ **$0.34**;
- Haiku triage → Opus: $0.022 + $0.12 + $0.38 ≈ **$0.52**, within $0.33–0.88 on these six;
- Haiku triage → Sonnet: ≈ **$0.30**;
- full Opus: ≈ **$0.61**.

Opus is also slower: 60–90 seconds for the read, against 20–40. That matters because a reader is
watching this step.

### What a mixed pipeline needs

Today the two phases share one `ModelPower` and one generator stamp.
`TASK_TIER["situate-plan"]` and `TASK_TIER.situate` are both `capable`. `generatorFor(power)`
stamps `CAPABLE_MODEL`, and `isOutdated` compares the stored generator against `CAPABLE_MODEL`. So:

- **The triage is a third call**, and needs its own `Task` and ledger job (say `situate-triage`).
  It needs a pinned model (`PINNED_MODEL` in `src/models.ts` is the existing seam), its own
  budget with room for Haiku's thinking (above), and its own prompt version.
- **An Opus writer at standard power** means `situate` moves off the capable tier: pinned to Opus,
  or `ALWAYS_HIGH_POWER`. The stored `generator` then names Opus, and `isOutdated` must compare it
  against that model rather than `CAPABLE_MODEL`, or every artefact goes stale the day it is written.
  Every existing Sonnet artefact would also show as outdated once; that is probably the right answer.
- **The stamp should record each phase's model**, at least the triage's and the writer's. A
  future change to either can then be told apart.
- The allowance in `SITUATE_RATE_POLICY` was sized at about $0.52 a run, so it holds at D's
  expected cost.

## Where the sample is too small to decide

- **Six articles, one run per arm.** The A–A2 pair is the only noise measure. They differ by 5
  unsupported findings and half a rank, so differences of that size between other arms mean
  nothing. The Opus arms' lead in kind errors and clean findings is several times that spread. The
  ordering of C, A, A2 and E is not decided.
- **One judge per article, an Opus model.** It judged Opus's own output, so it is the same family
  as G and D. That bias is untested here. A cross-family judge (GPT Sol) on the same packets would
  settle it, and the packets are on disk.
- **D against G** is one article apart in firsts and 0.4 apart in mean rank, on five articles.
  "D is nearly as good as G" is well supported. "D is as good" is not.
- **The coverage checklist** comes from a Sonnet run in the trial, which may favour Sonnet-like
  findings. The judges were told to credit good items not on it.
- **The cold costs** add back the cache premium arithmetically, from each row's own cache-read
  tokens and list price. They are not a cold run.

## What in the brief turned out not to be so

- The plan named as the source of this stage, `docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md`,
  was not in this branch or the primary checkout when the eval ran.
- "If the spike already holds reusable evidence, reuse it": it does not. The spike's
  `output/situate-spike/` is for production articles, not these six, and is not on this machine.
- "Every arm's output goes through the real `checkFindings`, so the kept/dropped counts are the
  production ones": true. But F11 is right that they say almost nothing about quality (above).
- "Haiku 5.5 reads (same prompt)" is not quite the same call. Production's body leaves Haiku's
  adaptive thinking on at its default effort, and on the longest article that overran production's
  budget.
- The trial's cost of $0.26–0.48 a run included a read with prompt caching written and never read
  back. That is still true of every arm here.
