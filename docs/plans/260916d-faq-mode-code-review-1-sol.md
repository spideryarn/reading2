Implemented five review fixes; no findings remain reported-only. Findings are recorded in [260916d-faq-mode-code-review-1-findings.md](/home/greg/code/spideryarn2/.claude/worktrees/faq-mode/docs/plans/260916d-faq-mode-code-review-1-findings.md).

- C1 — P1 — fixed in `src/faq.ts` and `tests/faq.test.ts`: statements can no longer survive as FAQ questions; bumped to `faq/2`.
- C2 — P2 — fixed in the same files: malformed passage fields are now counted as `malformed`, not anchoring failures.
- C3 — P3 — fixed in `src/jobs.ts`: the 150-second allowance is now accurately described as measured, conservative headroom.
- C4 — P3 — fixed in `src/types.ts`: corrected the nonexistent constant reference.
- C5 — P2 — fixed in `tests/faq.test.ts`: removed unsafe optional dereferencing from the request-shape test.

Reviewed and found not defective:

- Question overflow intentionally preserves the model’s first results, then presents survivors in reading order.
- The combined `overCap` counter matches the planned artifact contract.
- The answer allowance is 5,524 tokens plus 40,000 reasoning headroom; it is not undersized against the measured runs.
- Stage, stamp, currentness and GET staleness use the same nullable metadata/tree/block fingerprint.
- Body-only prompt and passage verification agree.
- The migration CHECK exactly matches `STEP_ORDER`.
- Store write/read/carry/export paths are present.

Verification:

- Red-first: 3 new tests failed before fixes, then all 21 FAQ tests passed.
- Non-Postgres scoped suite: 591 tests passed.
- All four TypeScript projects compiled directly.
- Scoped lint: no errors.
- `git diff --check`: passed.
- No commit created.

I could not rerun the three Postgres-dependent tests—`export-route`, `store-artefacts-pg`, and `store-export-covers-tables`—because loopback is unavailable. The supplied pre-fix evidence showed all three passing.