**Verdict: do not ship yet.** The client fixes are applied and pass, but C1 remains: the full-list sentence can identify the wrong criterion. Both new sentences are unchanged, as requested.

- **C1 — P1; reasoned; not fixed.** Input: the oldest criterion is pending without comments, while a younger finished criterion blocks trimming. “The oldest one has your comments placed on it” is false and directs the reader toward the wrong row. Added a Postgres characterization case, **unrun**. The delete sentence uses the product’s words and has no equivalent false claim found.

- **C2 — P1; reproduced; fixed.** Input: delete during a stream, receive `done`, then receive the original DELETE’s 409. Restoration used the earlier pending snapshot and could remain pending indefinitely. Hidden results and stream failures were also discarded. The deletion record now retains the latest hidden state. Regression tests in `tests/use-criteria-refusals.test.tsx`: **run, passing**.

- **C3 — P1; reproduced; fixed.** Input: two deletes awaiting refusals, with the second removal changing the first row’s saved index. Refusals could reverse the rows. Restoration now uses `(createdAt, id)`. Test: **run, passing**. Adding a new criterion meanwhile also passes.

- **C4 — P1; reproduced; fixed.** Input: change articles, reuse a criterion id, delete that row, then receive the old article’s DELETE response or stream frame. The old work could restore the wrong row. Restoration now checks deletion identity and article scope. Tests: **run, passing**.

- **C5 — P1; mixed outcome reasoned, premature duplicate reproduced; fixed.** Input: the original DELETE refuses and restores the row; the stream’s duplicate DELETE subsequently succeeds after placements are cleared elsewhere. The client would retain a deleted row. Duplicate DELETEs now wait and are skipped after restoration. Refusal and successful-delete controls: **run, passing**.

- **C6 — P2; reproduced; fixed.** Input: choose a colour, delete during streaming, then restore a `done` carrying an older colour. Restoration bypassed the local choice. It now applies that choice. Test: **run, passing**.

- **C7 — P2; coverage gap confirmed; fixed.** The existing second-delete test did not prove tombstone clearing. Added a refusal followed by `result` and `done`. Replacing tombstone deletion with membership checking produces the intended failure. Test and mutation: **run**.

- **C8 — P3; reasoned; fixed.** Claims about the “whole” cause chain, both comment callers using transactions, trim ordering, and duplicated route wording were inaccurate. Corrected the comments/docs and made the two authorised route edits. Matcher tests and documentation checks: **run, passing**.

Retention is unchanged: candidate selection and pending-row exclusion are identical, and the matched trim error still throws out of the transaction callback. Added **four unrun Postgres cases** covering pending retention, multiple trim candidates rolling back, another article, and another owner. Rollback assertions now compare every stored criterion column.

The original sequential Postgres cases could still pass a broken pre-check that loses a genuine concurrent race. Their id-only assertions could also miss overwritten fields. The implementation catches the actual statement failure; the stronger assertions address the latter gap.

The matcher alone does not distinguish schemas. Current statements target the schema-qualified Spideryarn tables, and the catches surround the relevant statements before scrubbing. No reachable schema collision or unrelated-statement misclassification was found.

Files changed:

- `src/web/useCriteria.ts`
- `src/referee-criteria-store.ts`
- `src/routes.ts`
- `src/store/db-errors.ts`
- `src/store/pg-comments.ts`
- `src/store/pg-referee-criteria.ts`
- `tests/use-criteria-refusals.test.tsx` — new
- `tests/db-foreign-key-errors.test.ts` — new
- `tests/referee-routes-postgres.test.ts`
- `docs/project/referee-mode.md`
- The stage’s plan document

Verification:

- Final unit selection: **4 files, 62 passed, 0 failed**.
- Initial client reproduction: **6 failed, 2 passed**; additional targeted races: **2 failed, 8 skipped**.
- Tombstone mutation: **1 failed, 7 skipped**.
- Typecheck: **4 projects passed; 3,346 source files covered**.
- Lint: **9 files; 0 errors, 1 warning, 7 informational diagnostics**. Final Postgres-test-file lint was clean.
- Diff whitespace check passed.
- Postgres tests remain **unrun**. One aggregate selection included a database-lane file and stopped before tests ran. The `npm run typecheck` launcher was blocked by IPC permissions; its underlying script passed via `node --import tsx`.
- No `npm test`, commits, or changes to the prohibited files.

Wider notes, unchanged: the reused developer-register 400 sentence reaches readers directly through `useComments`. Also, an old stream can still paint another article when no deletion record exists; that predates this stage and remains outside these fixes.