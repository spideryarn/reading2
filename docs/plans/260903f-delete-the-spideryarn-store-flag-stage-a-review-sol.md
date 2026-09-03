## Findings, ranked

1. **High — a raw Postgres store is still exported.**  
   [`createPgSourceStore`](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg-source.ts:137>) returns an unguarded `SourceStore`; only the singleton at line 194 is wrapped. Tests import the factory directly. The shape guard cannot see it because it scans only `export const pgX` ([store-guarded.test.ts:366](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-guarded.test.ts:366>)). I confirmed `isGuardedStore(createPgSourceStore(...))` is `undefined`, while `pgSourceStore` reports `"source"`. So “every Postgres store is guarded at its export” and “the next one is caught” are both too strong. Factories and re-export syntax remain holes.

2. **High — both security brands are forgeable.**  
   `SCRUBBED` uses `Symbol.for` and accepts inherited marks via `in` ([db-errors.ts:356-363](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/db-errors.ts:356>)). `GUARDED` has the same global-key problem ([db-errors.ts:444-499](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/db-errors.ts:444>)). The statement “this mark can only be put here” is false.

   I planted both marks without modifying the repo. The scrubbed probe returned the identical raw error, including `SENTINEL-READER-PROSE`, its raw stack, and `code: "UNSAFE-CODE"`. The guarded-store probe caused `guardDbStore` to return an entirely unwrapped object. This is not presently shown to be remotely exploitable—code in the process must forge it—but it is the wrong trust primitive for a confidentiality boundary. Private `WeakSet`/`WeakMap` state would make the claim true.

   For legitimately scrubbed errors, the behavior is good: the sanitized stack frames and SQLSTATE survive, and the second guard returns the same safe object.

3. **High — the migration guard already believes a false negative.**  
   The witness records calls only; non-function property reads are returned without recording ([fs-store-witness.ts:44-68](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/fs-store-witness.ts:44>)). Yet [`store-artefacts-pg.test.ts`](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-artefacts-pg.test.ts:75>) imports the condemned adapter’s `PATHS` and reads it at line 143. The JSON nevertheless puts that file in `ranAndTouchedNothing` ([witness.json:1112](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-witness.json:1112>)), and it has no registry entry.

   I reran that file under the witness: five relevant tests passed, while the recorded result was exactly `"sites":[]`. The hole check then blesses it by blindly unioning `ranAndTouchedNothing` into `accounted` ([registry.test.ts:206-211](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.test.ts:206>)). So the claimed single blind spot is wrong.

   The “fifth thing” is therefore a non-call dependency. Two broader variants also escape:

   - Source-text reads, which the graph script itself admits it cannot see.
   - Non-literal dynamic imports: the script records them as `unfollowable` ([candidates.ts:166-175](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/store-migration-candidates.ts:166>)), but the registry test reads only `reports` and never fails on `unfollowable`.

   The dated witness does not degrade gracefully for edited existing files. A file already in `ranAndTouchedNothing` can begin executing an existing statically reachable dependency and remain exempt forever. Negative evidence needs file-content freshness, or changed files must revert to `static-only`/unclassified.

   Also, the registry currently contains **92**, not 93, entries: 33 database, 24 filesystem, 13 fake, 22 collateral.

4. **Medium — two collateral verdicts violate the category’s “no edit” contract.**  
   Both [`a-claim-that-lost-its-draft.test.ts:74`](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/a-claim-that-lost-its-draft.test.ts:74>) and [`claim-session-postgres.test.ts:124`](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/claim-session-postgres.test.ts:124>) directly import `DATA_ROOT_ENV` from condemned `data-root.ts`. They then deliberately configure and assert on scratch filesystem roots; in the latter, those assertions are explicitly load-bearing ([claim-session-postgres.test.ts:192-228](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/claim-session-postgres.test.ts:192>)). Their registry entries list only ledger/path collateral ([registry.ts:166](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:166>), [registry.ts:311](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.ts:311>)). Deleting or relocating `data-root.ts` necessarily requires touching both files.

The requested spot checks otherwise look right: `store-pg-session` must re-express case 6 rather than delete it; `store-roundtrip` needs a new source-side oracle; `store-chat-pg` is genuinely resolved by moving its shared symbols; and `store-glossary-delete-pg` is import-only collateral.

The early return is sound for the current contract: the adapter’s inner seam name should win. A future requirement to expose one object under two diagnostic names would need an explicit alias/view mechanism. Keeping `guarded()` redundant until the hinge is reasonable belt-and-braces; remove it with the selector.

Removing slugs from the seven refusal messages is also right. They are title-derived reader data, while the caller/request context already identifies the article.

Tests run:

- The three guard suites: **3 files passed; 50 tests passed, 5 skipped**.
- The full requested command: those three passed, but the registry suite could not launch its nested `tsx` process in this sandbox (`EPERM`), yielding **56 passed, 1 failed, 5 skipped**.
- Running the graph script directly succeeded: 603 test files, 196 executable reaches. It found the newly merged `hierarchy-eval-incumbent-parity.test.ts` as an ordinary unclassified arrival, so that part of the live guard does work.