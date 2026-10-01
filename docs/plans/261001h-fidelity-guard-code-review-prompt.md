# Code and conclusion review: measuring the proposed Simple fidelity guard (261001h)

You reviewed this measurement's design before it ran
(`docs/plans/261001h-fidelity-guard-plan-review-sol.md`). It has now run. Review the probe **and
the conclusion**. You may fix what you find inside these files: the probe, the labels, and the new
plan section. Report anything wider for me to decide. Do not touch `src/`. Do not make paid model
calls: the results are in the JSONL files, and `score` is free. Run it with
`npx tsx scripts/probes/261001h-fidelity-guard-probe.ts score`. It needs
`data/probes/261001h-fidelity-guard-corpus.json`, which exists in this worktree. `corpus` rebuilds it
from the local database for free.

## What to read

- The candidate conclusion:
  `docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md`
  § Measuring the guard (2026-10-01), and the Status line at the top.
- The probe: `scripts/probes/261001h-fidelity-guard-probe.ts`.
- Labels and hand adjudication: `docs/plans/261001h-fidelity-guard-labels.json`.
- Raw verdicts: `docs/plans/261001h-fidelity-guard-luna.jsonl` and `docs/plans/261001h-fidelity-guard-sonnet.jsonl`.
- Blind read: `docs/plans/261001h-fidelity-guard-blind-read.md`.
- Production code the guard would sit in: `src/simple-summary.ts` (`writeLevel`, `LEVEL_ATTEMPTS`).

## How your plan review was taken

- **Adjudication is structured.** Alarms are scored as real, borderline, true-elsewhere (a claim
  true in the article but not in its cited passages) or false. Borderline paragraphs are excluded
  from every rate.
- **An unreadable answer is counted once, as availability.** The first line per level wins, and a
  level already in the file is never called again.
- **Controls were added**, and a blind read of 30 unflagged paragraphs was run.
- **Results are reported separately** for the shipped configuration (`pidpre`) and the whole
  challenge set.
- **The retry outcome is modelled analytically, not measured.** That is stated as an assumption.
- **Sonnet went through `streamMessage("simple", …)`**, the Messages wire with adaptive thinking at
  effort low.

## The questions

1. **Are the numbers in the plan section what the files say?** Check the arithmetic in "What it
   would do to a press": about 33%, 7%, 17%, 11% and 30%, and about 0.2% on the controls.
2. **Is any hand adjudication wrong?** Spot-check the true-elsewhere calls against the corpus
   passages, and the three "real" ones.
3. **Does the conclusion follow from the evidence?** That means three things: recommending Luna over
   Sonnet; "build it with the change: store the retry on a second flag, and fail open on checker
   failure"; and the claims about what it catches outside the labelled set. Is anything overstated,
   given three articles, one prompt, and 18 outputs on the shipped configuration? I may have
   explained away an inconvenient result. Please look for that specifically.
4. **Any bug in the probe** that would move a reported number.
