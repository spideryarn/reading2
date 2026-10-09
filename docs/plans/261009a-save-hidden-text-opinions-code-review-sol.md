## Findings

1. **P2 — FIXED:** Request time was captured after asynchronous preflight, allowing concurrent presses to be ordered incorrectly. Moved it to route entry in [routes.ts](/var/tmp/spideryarn-worktrees/fbgqq38u-save-hidden-text-opinions/src/routes.ts:5894). Drizzle emits the intended update predicate: `WHERE referee_hidden_checks.created_at <= excluded.created_at`.

2. **P2 — FIXED:** Save-before-`done` and save-failure behavior lacked direct regression coverage. Added tests proving `done` waits for persistence and a failed save still returns the paid answer with `saved: false`. Diagnostics now contain only slug, counts, and model; judgments/reasons never reach monitoring. The guarded store scrubs failed-query parameters.

3. **P3 — FIXED:** Two registries missed the table: event timestamp coverage and the rollback artefact manifest. Added both, including stale-finish clock coverage in [event-times.test.ts](/var/tmp/spideryarn-worktrees/fbgqq38u-save-hidden-text-opinions/tests/event-times.test.ts:916). The actual rollback and bundle export implementations were complete.

4. **P3 — FIXED:** Tests did not directly prove that `saved: false` is accepted or that the prior answer remains visible during a retry. Added hook and panel cases. Also corrected contradictory race comments and stale exact query counts.

## Gates

- Focused Vitest command: **5 files passed; 77 tests passed, 1 skipped**.
- Typecheck: `npm run typecheck` could not start because sandboxed `tsx` IPC returned `EPERM`; the identical checker run via `node --import tsx scripts/typecheck.ts` passed all projects and covered all 3,528 source files.
- Biome: passed with no errors; six pre-existing complexity advisories in unrelated `routes.ts` functions.
- `git diff --check`: passed.
- Read-only Drizzle SQL compilation: passed; `setWhere` is emitted in the intended position.
- DB-backed `referee_hidden_checks` tests were not run, per the migration-ledger constraint.

land after fixes