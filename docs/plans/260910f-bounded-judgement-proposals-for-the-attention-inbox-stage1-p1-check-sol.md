Report written to [/tmp/260910f-stage1-p1-check-findings.md](/tmp/260910f-stage1-p1-check-findings.md).

- **F11 — holds.** A second budget instance cannot settle the owner’s reservation or free its worst-case charge. Normal owner settlement succeeds, and its private reservation ID is removed afterward.
- **F12 — holds.** Refused stale re-reads are counted as unjudged for both `unavailable` and `stopped`; stale question cards remain. Successful re-reads report zero unjudged sessions.
- **New findings:** None; no F13+.

Tests:

- `tests/overseer-model-budget.test.ts`: 27/27 passed.
- `tests/overseer-attention-pass.test.ts`: 39/39 passed.
- Both original `/tmp` reproductions now produce the safe outcomes.

No repository files were changed.