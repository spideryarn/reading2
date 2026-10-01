# Code-and-conclusion review: Simple's "feedback loops" reversal (261001h)

You reviewed the plan for this (docs/plans/261001h-contrasting-terms-plan-review-sol.md). Since then the
prompt rule was measured, did not reliably help, and was backed out. `src/` is unchanged from the base.
What would land:

- docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md — rewritten with results
  and a proposed guard
- evals/simple/term-swap.ts (new screen), evals/simple/probe.ts (three provenance fields)
- evals/results/simple/high-none-pidpre1..6, high-none-pidpost1..12, high-none-pidv2_1..6 (raw outputs)
- a pointer line in docs/plans/261001b-…md § Fidelity and docs/project/summaries.md § What is still open

You may edit to fix what you find, within these files. Report anything wider.

**Above all, check the conclusion, not just the code.** Re-derive the counts in the plan's table yourself
from the result files, against blocks spya-xs5660 / spya-sd9fzd as quoted in the plan. (`npx tsx
evals/simple/term-swap.ts high-none-pidpre high-none-pidpost high-none-pidv2_` prints every relevant
sentence.) Questions:

1. Are the hand counts right (pre 6/18, v1 3 clear + 2 glossed of 36, v2 7 clear + 1 glossed of 18)? Is
   any "right" output actually wrong, or any "swap" actually right?
2. Is "no prompt change reliably helps" the honest reading of this evidence, or am I explaining away a
   real v1 effect (p=0.047 on clear swaps)? Would you ship v1? Say why.
3. Is the proposed guard (per-paragraph check against its own cited blocks, failing into the existing
   one-retry path) the cheapest sound guard? Is the cost/latency estimate plausible given
   src/simple-summary.ts? Anything cheaper I missed?
4. Code: term-swap.ts and the probe.ts fields — bugs, misleading output?
5. Anything in the docs that overclaims.

Findings ranked P0/P1/P2 with evidence (file:line or result path), and a list of any edits you made.
