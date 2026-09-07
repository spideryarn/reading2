## Findings

- **R1 — P1 — [`scripts/ai-cost.ts:881`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/scripts/ai-cost.ts:881).** `--owners` still defines product as every category except `non-product`. An unrecognised scope becomes `unknown` in `costCategoryOf`, so it enters `ALL PRODUCT` and the per-owner pricing figures—while the ordinary report puts the same row in `other`. I reproduced this with `scopeKind: "retired-in-2025"`: it contributed all 123 nanos to owner-product spend. This directly contradicts Stage 6’s new product contract and the test’s “cannot drift” claim.  
  **Smallest fix:** in `ownersReport`, partition the grouped rows with `partitionByScope`, build a second fold from `product`, and use that fold for `printSpread`, `printOwners`, and margin calculations. Keep the full fold for coverage/category reporting. Add the unrecognised-scope counterexample to the test.

- **R2 — P3 — [`src/ai-spend.ts:546`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/ai-spend.ts:546).** The `costSource` contract now says something the fix deliberately makes false: that it is derived from the nanos fields and that `provider` wins whenever OpenRouter answered. `paidLooksFree` is precisely an OpenRouter answer deliberately projected as `none`.  
  **Smallest fix:** document the discrepancy exception and say `moneyFields` derives the stored source from `SpendProvenance`.

- **R3 — P3 — [`src/ai-spend.ts:376`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/ai-spend.ts:376), [`plan:904`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:904).** The old projection did not contain “five independent ternaries”: it had three ternaries, one helper call, and one direct source assignment.  
  **Smallest fix:** replace “five independent ternaries” with “five independently assigned fields.”

- **R4 — P3 — [`evals/cost/run.ts:78`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/evals/cost/run.ts:78).** The tree still says Product is `scopeKind !== "eval"` in current explanatory prose. The same stale definition appears in [`evals/cost/feasibility.md:46`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/evals/cost/feasibility.md:46) and [`tests/cost-eval.test.ts:504`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/tests/cost-eval.test.ts:504).  
  **Smallest fix:** update these to the positive `request | job_step` definition.

- **R5 — P3 — [`scripts/ai-cost.ts:1353`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/scripts/ai-cost.ts:1353).** Immediately after printing `other` as `UNRECOGNISED SCOPE`, the report says those scopes are “in no pocket above.”  
  **Smallest fix:** say “in the unrecognised pocket above.”

- **R6 — P3 — [`src/cost-report.ts:261`](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/cost-report.ts:261).** “$2.85 of 837 calls” combines two snapshots: the plan’s after-pocket counts total 1,225, versus 1,224 before. The handoff explains that a CLI row arrived; the committed prose does not.  
  **Smallest fix:** note that one CLI row arrived between runs and avoid presenting `$2.85 / 837` as one snapshot.

F1’s implementation otherwise checks out: the non-gap branch preserves the old five expressions; ordinary BYOK, computed, provider-nonzero, and genuine zero-without-upstream rows are unchanged. `totalRows`, the SQL aggregate, reconciliation, admin unpriced markers, and realtime handling accept the new legal `none` shape correctly. Admin already uses `request | job_step`; `jobSpend()` is a per-job total and needs no scope correction.

The `Pick` concern is safe: adding a required field to `AiCallRow` still fails at the annotated row construction. `other` is reachable because the database column is unconstrained text and its reader casts it to today’s union. `All recorded` correctly folds all rows, including `other`, and the four partitions conserve every row.

Validation: the requested three suites passed, 59 tests. The shared branch advanced to Stage 7 during review; `cost-report` and `ai-call-images` remained exact Stage 6 files, while `cost-categories` included the subsequent additions.

**Verdict: approve after these revisions.**