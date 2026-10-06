Fixed the evaluator defects and overstated conclusions. The shipping decision remains unresolved. No commits; `SKIM_SYSTEM`, result files, and stage 1 are unchanged.

- **F1 — P1, unresolved:** [Plan:161](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/docs/plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md:161). B2 is declared shippable despite not clearly clearing the accepted dangling-case gate: **15–8, five ties**, versus control **11–10**. Shipping needs further target-case evidence or an explicit change to that gate. Red test: not applicable; evidence finding.

- **F2 — P1, documentation fixed:** [Skim reference:361](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/docs/project/skim.md:361). “Neither fault above the old level” was unsupported. Misstatements are **3 versus 1**; the control is **3 versus 2**. An absolute count within the control range does not establish no regression. Corrected the reference, investigation, and plan. Red test: not applicable.

- **F3 — P2, documentation fixed:** [Investigation:371](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/docs/investigations/261006b-skim-cue-situates-the-quote-eval.md:371). “Did not move the route” overstated aggregate similarity. One article has **62% order agreement versus 86% between controls**. The wording now distinguishes observed differences from an established prompt effect. Red test: not applicable.

- **F4 — P2, fixed:** [Evaluator:347](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/scripts/eval/skim-cue-pairs.ts:347). Missing or duplicate judgments and invalid choices could produce successful scores. Added validation. Missing, duplicate, and invalid-choice tests were seen red before fixing.

- **F5 — P2, fixed:** [Evaluator:95](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/scripts/eval/skim-cue-pairs.ts:95). Multiple runs inflated screens while pairing only the first run. The script now refuses them. The repeated-run test was seen red first.

- **F6 — P2, wider; unfixed:** [Older evaluator:371](/var/tmp/spideryarn-worktrees/skim-cue-situates-and-glossary-chips/scripts/eval/skim-again-pairs.ts:371) similarly lacks judgment completeness and uniqueness checks. Static finding; no red test because it is outside this stage.

Verification: **110 scoped tests pass**, including the three requested suites and nine evaluator tests. Typechecking and scoped lint pass; typechecking used `node --import tsx` because the npm wrapper hit sandbox IPC restrictions. All regenerated evidence matches the recorded files byte-for-byte, and keys are balanced.

Version, cap, budget, validation, unchanged input hash, and removal of C check out. The version bump alone makes old routes outdated, not stale. Section 3 contains no material contradiction with `plainWords("ask")` or permission to state the finding. Both cue surfaces wrap in CSS; browser rendering at 200 characters was not exercised. Postgres tests remain yours.

VERDICT: not ready