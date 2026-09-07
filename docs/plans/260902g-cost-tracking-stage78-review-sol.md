### Findings

- **F6 — P1 — [scripts/ai-cost.ts:1381](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/scripts/ai-cost.ts:1381)**  
  Stage 8 fixes only `--owners`. The advertised bare `npm run cost` path still reports money without naming provider accounts or explaining which spend lies outside the cap. Consequently the plan’s “the report says which bill” claim remains false for the ordinary report.  
  **Smallest fix:** reuse the same account/pocket formatter in the ordinary path, deriving tallies from its already-loaded rows or calling `accountsInWindow`. Do not add a second wording of the cap caveat.

- **F7 — P2 — [src/cost-categories.ts:234](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/cost-categories.ts:234)**  
  `JOB_DISPOSITION` is not wholly decorative: its exhaustive key set is useful, and its interactive values drive classification. But the four-way distinction is only partially real. Production reads only `"interactive request work"`; voice is separately hard-coded, while `"step-driven"` and `"no product path"` are behaviorally interchangeable. Changing `pdf` or `debate` from step-driven to no-product would still pass the new tests and leave production behavior unchanged.  
  **Smallest fix:** make `costCategoryOf` consult the disposition for known jobs: request scope accepts interactive or voice, job-step scope accepts step-driven, and no-product is accepted only behind the existing CLI/eval precedence. Preserve the historical unknown-job handling separately and add mismatched-scope tests.

- **F8 — P2 — [tests/ai-calls-spend-pg.test.ts:386](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/tests/ai-calls-spend-pg.test.ts:386)**  
  The Stage 8 tests verify the SQL result, then duplicate the production outside-cap reducer. They never exercise `printBills`, its wiring, or its caveats. Deleting `printBills(bills)`, returning zero from its reducer, or removing the headroom warning would leave all 12 Postgres tests green. The reported mutation proves the query, not the feature.  
  **Smallest fix:** extract and export a pure bill-summary/line builder used by `printBills`, then test OpenRouter BYOK, external computed spend, unpriced calls, the outside total, and the cap/headroom language. Use that test for both report paths required by F6.

- **F9 — P3 — [260902g-cost-tracking-that-can-set-a-price.md:993](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:993)**  
  “That $4.33 was invisible before this stage” overclaims. BYOK already appeared numerically as “billed upstream” in the ordinary report and inside the owners report’s ledger totals. What was missing was its identification as another bill outside the cap.  
  **Smallest fix:** say “That $4.33 was not identified as spend outside the cap before this stage.”

The disputed placements are correct against their collectors: `debate` and `illustrate` are step-driven; embeddings and dictation are request-scoped. Moving `pdf` out of interactive is supported by the call graph, not merely by ledger absence.

The outside-cap arithmetic is correct. `ai_calls_byok_upstream_only` permits a BYOK value only when `provider_account = 'openrouter'`, so an Anthropic BYOK pocket cannot exist in valid data and cannot be double-counted. The admin spend column and `jobSpend()` should remain cross-bill totals; reconciliation is correctly key-scoped and should not be presented as cap headroom.

Within `--owners`, the warning is honest and sufficiently conspicuous despite its length. I would shorten it only while extracting the tested formatter, not as a separate blocker.

Validation: `tests/cost-categories.test.ts` passed, 20/20. I did not rerun the Postgres suite.

*approve after these revisions*