# Plan review prompt: shelf topics round two (260928d)

Read-only review of a PLAN. Do not change any file. Time matters: a deploy takes whatever is on dev at 15:50 BST, so be decisive and short; findings over essays.

**Candidate (live, untracked)**: docs/plans/260928d-shelf-topics-diversity-coverage-and-detail-view.md. Base commit: `git log -1`. Context: the previous plan docs/plans/260928a-shelf-facet-terms.md (§ Design), src/shelf-terms/extract.ts (`foldKey`), src/shelf-terms/choose.ts (`greedy`, `isRedundant`, `stemForOverlap`, `shelfTermMetrics`), src/web/ShelfTerms.tsx (`COLLAPSED_CHIPS`, the sort by count), scripts/shelf-terms-report.ts.

## Please

1. Is the diagnosis in § Why it happens today correct against the code?
2. Will the Stage 1 design actually give (a) no near-duplicates like "AI systems"/"AIs" in the first dozen and (b) near-total coverage in the first 5–8 shown — or does it trade one for the other badly? Any simpler rule that does both? Check the gain formula, the thresholds, and the interaction between the hard skip and the soft penalty.
3. Anything that makes Stage 1 unsafe to push by itself before the deploy (e.g. the extractor version bump causing a slow first load for real readers; the route order change; tests)?
4. Stage 2: anything wrong or missing in the detail-view design.

## Output

Findings R1, R2, … with severity (P0 data loss/security/charging/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design risk; P3 prose), established or reasoned, evidence, recommendation. Then a one-line verdict.
