**C1 — P2: superseded “none” survives a later list.**  
Input: Glossary reads none for A, then a list; the mounted hook switches A → B → A while subsequent reads fail. **Reproduced:** expected `error`, received `none`. The article page remounts by slug, so no reader-facing duplicate charge was established. **Fixed:** all twelve hooks clear `saidNoneFor` on an accepted result. The regression went red before the fix and now passes.

**C2 — P2: rollout notes incorrectly promise immediate busy responses.**  
Input: the migration holds `queue_state`’s table lock. **Reasoned:** `FOR UPDATE NOWAIT` still waits for that table lock; NOWAIT covers row locks only. **Fixed:** corrected both rollout documents. No PostgreSQL contention test was run. [PostgreSQL locking documentation](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)

**C3 — P2: committed picture fixtures fail typechecking.**  
Input: the Sketch and Illustrated fixtures spread `BODIES` values typed `unknown`. **Reproduced:** two `TS2698` errors. **Fixed:** narrow fixture casts; final typechecking passes.

Other review conclusions:

- Existing results survive failed refreshes and retries. Ordered reads prevent superseded replies from changing the ref; offline results clear it without settling the rewrite hold. No further lifecycle defect found.
- An armed press over `none` plus a failure can start work while existence is uncertain—the cost described in the brief. The StrictMode test confirms exactly one unforced POST across repeated activations and failed retries. The guard limits automatic attempts per article/target/session.
- The local copies remain simpler than introducing another helper API.
- The migration drops exactly the foreign key and column, without `CASCADE`. Searches including `tools/`, `evals/`, string names and fragments found no runtime accesses. The singleton, CHECK, seed, no-delete trigger and missing-row refusal remain.
- Export data is unchanged. The shared omitted-tables list loses `queue_state` in both the manifest and generated HTML.
- All eight pending files and ledger writes run in one transaction. Failure rolls them back together. The final drop needs no table rewrite, but its locks last until commit/rollback; contention duration is unmeasured. Follow the existing finite migration-timeout requirements. Claims wait; browser advance failures retry. Broader claim-lock handling was left unchanged.

The pre-flight’s “holds a value” arm logically detects a non-null job ID, but **has no runtime negative control**. Replacing it with `WHERE false` could pass the cited empty-database checks. Likewise, schema-derived export coverage could pass with the PostgreSQL foreign key still present; `db:check` cannot prove trigger preservation; row-contention tests do not establish table-lock behaviour.

Files changed:

- Twelve reviewed `src/web/use*.ts` hooks: Citations, Debate, Faq, Glossary, Ideas, Illustrated, Quiz, Quotes, Simple, Sketch, Skim and Timeline.
- `tests/read-error-matrix.test.tsx`.
- Both `261007c` rollout documents, the `261007g` plan, and [the postmortem](/var/tmp/spideryarn-worktrees/sweep7-generate-button-and-queue-column/docs/postmortems/261007g-a-remembered-absence-must-expire-when-a-newer-result-arrives.md).

Ran: all four commit inspections, searches and snapshot/migrator inspection; requested Vitest suites **213/213 passed**; typecheck passed via `node --import tsx scripts/typecheck.ts` after the npm wrapper hit sandbox IPC restrictions; scoped lint, `db:chain` and diff whitespace checks passed. No PostgreSQL tests, `npm test`, migration application or commit.

**Verdict: ship with these fixes applied.**