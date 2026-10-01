# Review: Simple on Opus, with the fidelity guard kept (plan 261001p)

You are reviewing a measurement and a product/engineering decision before it is built. Read-only.

**Read first:** `docs/plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md` (the
plan, with the numbers and the decision). Background: `docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md`
(the original fault and its measurement), `docs/plans/261001i-simple-fidelity-guard-built.md` (the
checker as built), `docs/project/summaries.md` § The fidelity guard, `docs/project/high-powered-ai.md`,
`src/models.ts` (`ModelPower`, `generationKey`), `src/simple-summary.ts`, the `simple` step in
`src/pipeline.ts` (search `generateSimpleSummary(`).

**The evidence, so you can check the numbers rather than trust the prose:**

- Result files: `evals/results/simple/high-none-opus{1..12}/`, `high-none-sonnetnow{1..6}/` (PID
  paper), `high-none-opusctl{1..6}/`, `high-none-sonnetctl{1..6}/` (Olah, Gwern). Each has `costUsd`,
  `wallMs`, `model`, `power`, `guard`, and the three levels' paragraphs (`brief`, `paragraphs` =
  the Simple level, `fuller`).
- The probe diff: `git diff HEAD -- evals/simple/probe.ts`.
- Checker verdicts on every level: `docs/plans/261001p-check-saved-levels.jsonl`, from
  `scripts/probes/261001p-check-saved-levels.ts`.
- Your own blind read: `docs/plans/261001p-blind-read-prompt.md` and `docs/plans/261001p-blind-read-sol.md`.
  The unblinding key (L-number → writer) is:
  L19 sonnetnow2 PID simple; L29 sonnetnow3 PID brief; L36 sonnetnow2 PID fuller; L46 opus2 PID
  brief; L53 sonnetnow3 PID fuller; L54 sonnetctl1 Gwern simple. 27 levels each writer. The Opus
  Gwern fault the checker caught is `high-none-opusctl1/scaling-hypothesis.json`, fuller paragraph 5
  (index 4); your read marked that level clean.
- `evals/simple/term-swap.ts high-none-opus high-none-sonnetnow` reprints the screen (free).

**What I want from you:**

1. **Is the decision right?** Opus + checker for every article's Simple, against (a) Sonnet +
   checker as now, (c) Opus with no checker, or anything better. Weigh the fault rates, cost per
   press, latency, the omission confound (Opus mentions the trapped finding far less often), the
   single trap paper, and that this hands every article part of what the paid High-powered AI switch
   sells. Say plainly if you would choose differently, and why.
2. **Are the numbers and the claims built on them right?** Recount anything you doubt from the
   files: the 0/36 and 5/18 hand scores, the checker tallies, cost and latency medians, the Fisher
   p-values and the upper bound, the "about 1 in 9" residual for (a).
3. **Is the build right and complete?** `SIMPLE_POWER = "high"` passed by the pipeline step instead
   of `ctx.power`; stamp unchanged because `generationKey` treats both models as one generation.
   Anything else that reads Simple's power or model and would now be wrong: a cost estimate, the
   stored `generator` stamp, the owner's GET, the High-powered AI copy on /metadata or /pricing, the
   `simple-check-report`, tests that assert Sonnet for Simple? What test proves it?
4. Anything the plan claims that the evidence does not support.

Answer with findings ranked P0/P1/P2, each with the file and line or the number it concerns, then a
one-paragraph verdict on the decision.
