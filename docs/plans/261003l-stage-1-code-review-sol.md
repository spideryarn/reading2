Found and fixed two P1 defects, red-first. No commits made. This file is the review.

- **CR-8 — P1, established, fixed:** [reader-notes.ts:353](src/reader-notes.ts:353). Overall budgets excluded headings and fences. Ordinary responses reached **8,863** and **8,030** characters against 8,000. Complete responses now fit by removing whole rows or exchanges and updating notices.
- **CR-9 — P1, established, fixed:** [reader-notes.ts:110](src/reader-notes.ts:110). Rows were measured before delimiter escaping expanded them. Notes reached **9,126 against 6,000**; a transcript reached **12,660 against 8,000**. Escaped rows are now measured using an idempotent helper, with regressions for consecutive delimiter runs.
- **CR-10 — P2, established, left outside this stage:** [pg-chat.ts:364](src/store/pg-chat.ts:364). Existing Chat logging includes the **current** thread ID. Claim 7 holds for this tool’s retrieved text and requested conversation ID, but needs qualification across the entire HTTP turn.

Ownership, kind restrictions, exchange filtering and history equivalence hold by inspection. Documentation now matches the corrected budgets.

Validation: **173 tests passed**, plus two shared-fence tests; typechecking and scoped lint passed. One broader DNS-dependent test failed in this sandbox and was left unchanged.

Could not run the Postgres-backed files:

- `tests/reader-notes-owner-isolation.test.ts`
- `tests/chat-live-ticket-route.test.ts`

**Verdict: land with the CR-8 and CR-9 fixes.**