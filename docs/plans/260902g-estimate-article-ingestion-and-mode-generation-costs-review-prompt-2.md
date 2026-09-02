# Review round 2: reworked cost-eval plan

You previously reviewed `docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md`
and returned **rework** with three blockers (your review is committed at
`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs-review-sol.md`). The plan
has been reworked; every blocker was independently verified against the ledger/code and confirmed
before being folded in. Separately, an Opus agent has been dispatched to root-cause the duplicate
job execution itself (that fix is not part of this plan).

This round is focused: **does the reworked plan resolve your findings, and is anything newly
wrong?** Specifically:

1. Blocker 1 — the duplicate-execution rediagnosis, the split into "historical anomaly (handled
   elsewhere)" vs "stochastic hierarchy cost under current code with 3–5 interleaved cold
   draws". Adequate?
2. Blocker 2 — the new no-spend feasibility stage: the three couplings (attribution given
   collector shadowing, fixture ingress given HTTP(S)-only fetchDocument, shared-DB safety), and
   the suggestion to evaluate slug-based attribution over `job_step` rows before building any
   seam. Is that evaluation order right?
3. Blocker 3 — model arms deferred to a follow-up plan. Anything still overpromised?
4. The rewritten appendix: observed named cases + labelled extrapolations. Defensible now?
5. The re-ranked cost-reduction list (your ranking, adopted, with hierarchy split/resume moved
   off the list). Any disagreement with how it was adopted?

Keep it short: per item, resolved / not resolved (why), plus any new blocker only if it is real.
End with a verdict: approve as-is, approve with changes (list), or rework.
