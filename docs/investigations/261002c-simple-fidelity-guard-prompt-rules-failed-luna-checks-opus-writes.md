# Simple's fidelity guard: two prompt rules that failed, Luna against Sonnet as the checker, and Opus as the writer

Written 2026-10-02 from the 2026-10-01 plans [261001h](../plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md),
[261001i](../plans/261001i-simple-fidelity-guard-built.md) and
[261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md); nothing re-run.
The question: Simple's plain-words levels sometimes turn a finding around by borrowing the piece's
own word for a different thing. What stops that, cheaply, and did the thing that stops it earn its
place? Writer-side choices (effort, cost, latency) are in
[261002b](261002b-how-simple-is-written-effort-levels-one-call-or-three-and-opus.md).

## The fault

On the PID paper (`entropy-24-00930-spya-pywwkq`) the paper defines three connection kinds
(`spya-xs5660`): feedforward, **feedback** (target to source, lowers synergy), **recurrent**
(source to source, raises it). Simple writes "more feedback loops between source neurons": right
wiring, wrong name, so the finding looks reversed. 27 of the first 30 faulty paragraphs cite the
finding block `spya-sd9fzd`. Sol's framing: plain-language pressure overwrites a locally defined
distinction with the model's everyday prior. A reader who chose plain words is the least able to spot it.

## Step 1: prompt rules (261001h, `evals/simple/probe.ts`, $5.52, 36 paid generations)

Arms on the same base commit, `high`, no profile, hand-scored by
[`evals/simple/term-swap.ts`](../../evals/simple/term-swap.ts) plus reading every sentence:

| arm | clear "feedback loops" swap |
|---|---:|
| `pidpre1-6`, unchanged prompt | 6 / 18 |
| `pidpost1-12`, v1 rule | 3 / 36 (plus 2 glosses, 1 direction error) |
| `pidv2_1-6`, v2 (four words added) | 7 / 18 (plus 1 gloss) |

Threshold set beforehand: 0-1 of 18. Neither reached it, and a four-word edit made it worse, so
**nothing shipped**. Telling a third wording apart from noise would take about 30 runs an arm.
Passed over: a forbidden-swaps list (a patch for one paper), the rule in the shared
`plainWords()` core, and having the writer list contrasted terms first (a prompt change, same noise).

## Step 2: a checker (261001h § Measuring the guard)

One quick-tier call per level reads each paragraph beside the text of the blocks it cites and
answers `ok` or `contradicts`. Probe: `scripts/probes/261001h-fidelity-guard-probe.ts`; labelled
set `docs/plans/261001h-fidelity-guard-labels.json` (128 PID levels, 150 control levels from Olah
and Gwern); results `261001h-fidelity-guard-{luna,sonnet}.jsonl`. $1.20 in all.

| | Luna (quick tier) | Sonnet 5 (low effort) |
|---|---:|---:|
| PID faults caught, all 30 | **24 / 30** | not run on all (stopped at budget) |
| on the 17-fault subset both saw | 12 / 17 | 11 / 17 |
| alarms on unlabelled paragraphs, PID · controls | 11/461 · 3/567 | 12/237 · 1/134 |
| real faults found among the alarms | 3 | 0 |
| cost per complete press | **$0.0027** | $0.027 |
| press latency median · p90 | 4.4 s · 5.8 s | 4.0 s · 7.0 s |

**Luna chosen**: same detection in this sample, a tenth of the cost. The 12 against 11 gap is not
evidence Luna is more accurate, only that there is no reason to pay for Sonnet. Setup-dev's rule
(a new job may start on the quick tier) agrees. Luna found three real faults no label had (ice
cream "melts rather than freezes" on Gwern; finite samples bias entropy *upward* on PID; Olah's
"exponentially many neurons"). Most other alarms were true claims absent from the cited passages
(mainly "synergy peaks at moderate correlation", `spya-ybmve2`). It misses the 3 faults that do not
cite `spya-sd9fzd` and the subtlest direction error.

**Blind read of the unflagged** ([261001h-fidelity-guard-blind-read.md](../plans/261001h-fidelity-guard-blind-read.md)):
an Opus subagent read 30 passed paragraphs mixed with 6 known faults. It found exactly the 6 and
none of the 30 (7 it called unsupported but true); the missed-fault rate is below about 10% at 95%.

**Built** as 261001i: fail open (a checker that errors stores the writer's text unchecked), one
retry on a flag, store the second attempt whatever its verdict, verdicts recorded on the artefact
(`check`), switch `SIMPLE_CHECK_ENABLED`. Sol's events-table suggestion declined for the beta. One
real press: three checks, $0.0027, 3.1-4.7 s each. Modelled on the PID paper it halves the fault
(a retry's outcome was never run); on 5 of 6 presses it flags a level, adding about $0.05 and 15 s.

## Step 3: a bigger writer (261001p)

Greg asked whether a bigger model does better with or without the check, and said:

> A yes and then make your own judgment about what's best, proceed autonomously
>
> — Greg, 2026-10-01 (Q-simple-opus-test, quoted in 261001p)

Production's path through the probe with `--power high`/`--guard off`; Opus 5.5 12 runs on PID,
Sonnet 6 on today's code, both on Olah and Gwern as controls, every saved level re-checked by the real
checker (156 calls, `docs/plans/261001p-check-saved-levels.jsonl`), and a GPT Sol blind read of 54 levels.

| | Sonnet | Opus |
|---|---:|---:|
| hand-scored term swaps, PID | 5 / 18 | **0 / 36** |
| checker flags: PID · Olah+Gwern | 6/18 · 1/36 | 2/36 (borderline) · 1/36 (**real fault**) |
| blind read, 27 levels each: major · minor · clean | 3 · 2 · 22 | 0 · 1 · 26 |

Options: (a) Sonnet + checker, (b) Opus + checker, (c) Opus alone, (d) pass the checker's reason to
the retry. **(b) chosen.** (c) rejected: the one real Opus fault (Gwern: agency "even in models
trained without human data" against "free of selection or optimization", `spya-msngfz`) was caught
only by the checker, so the checker earned its place by catching a fault the blind read marked
clean. The reverse also happened: neither tool is exhaustive. Opus's 22 mentions of the recurrent
finding were all correct, so the evidence is that Opus sidesteps the trap, not that it names the
contrast. Greg later approved Opus for everyone (quoted in [261002b](261002b-how-simple-is-written-effort-levels-one-call-or-three-and-opus.md)).

## Dead ends and caveats

- No second contrasting-terms paper was available; PID is the only trap article. Controls
  measure faults in general. 0 of 36 is not zero (bound near 10%).
- The "fail closed" idea in the first 261001h draft would have lost about 30% of presses on the
  PID paper; reversed to fail open. Luna had 0 unreadable answers in 278 calls, so fail open is an
  availability call, not a measured one.
- A first Opus count of 8 recurrent mentions was a regex miss; Sol recounted 18, a second pass 22.
- Flag rates are on three articles; the production `check` records (read with
  `scripts/simple-check-report.ts`, read-only) are the way to learn more.

## Re-running

`npx tsx scripts/probes/261001h-fidelity-guard-probe.ts` (checker against saved runs; costs money),
`npx tsx evals/simple/probe.ts run --arm <name> --power high [--guard off] <slug>`,
`npx tsx scripts/probes/261001p-check-saved-levels.ts`. Design: [summaries.md § The fidelity guard](../project/summaries.md#the-fidelity-guard-since-2026-10-01).

Up: [research.md](../project/research.md)
