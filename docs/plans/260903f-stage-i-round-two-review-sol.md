## Verdict: refuse as-is

F4 is an established P1: the candidate fails a mandatory deterministic test.

### Findings

- **F1 — resolved.** The module-scope `loadEnvLocal()` in [src/db/client.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/db/client.ts:46) is correctly placed for application code. I reproduced the production-shaped import with all three Supabase credentials absent from the inherited environment; `src/store/index.ts` loaded them from `.env.local` and reached `BOOT_OK`.

  Everything under `src/` that builds an application connection crosses `db/client.ts`. Several operator scripts deliberately construct their own connections—`db-migrate`, `db-check`, `db-corpus-readiness`, `db-repair-migration-ledger`, `deploy`, and test/spike utilities—but they resolve or load their environment themselves and did not depend on the tombstone side effect.

- **F2 — P2, still open.** The new header’s replacement criterion is sound: the two successful `vercel env rm` results are direct evidence, not circular. But the old criterion survives in the authoritative Stage I section: [the sensor’s disappearance still supposedly opens the gate](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md:5736). [deployment.md also says the removal made the line stop printing](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/project/deployment.md:699), although the already-built deployment necessarily kept reporting it. Correct those two passages to say the sensor prompted the check and the two removal commands supplied the evidence.

- **F3 — resolved** for the originally reported stale present-tense claims.

- **F4 — P1: deleting `src/store/live.ts` leaves ten broken documentation links and fails the test gate.** I ran `tests/doc-links.test.ts`; “point at files that exist” failed with ten references to the deleted file. They occur in [setup-dev.md](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/project/setup-dev.md:122), one postmortem, three older plans, and three places in the current plan. Historical prose can remain, but the links must become unlinked code references, preferably marked “deleted 2026-09-06.” This is P1 because `npm test` is an authoritative landing contract and currently fails directly, with no inference involved.

- **F5 — P2: the permanent guard does not scan two paths the plan says it covers.** [The collector](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/one-store-only.test.ts:100) omits `.env.example` and `AGENTS.md`, while [the done criterion](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md:5836) says this test asserts both. An active `SPIDERYARN_STORE=files` reintroduced into `.env.example` would remain green. Either add those files to the collector or describe their check as a separate final grep.

### Requested judgments

1. **Keep the narrow `notMigrated` tripwire; do not generalise it.** It can fire if the historical helper-and-adapter shape returns, and `SEAMS` has non-empty controls. An “every method only throws” AST rule would be brittle while implying broader semantic coverage than it can provide.

2. **A child-process outcome test is possible and preferable.** Reuse the deleted boot-test harness: clear `VITEST`/`VITEST_WORKER_ID`, set production mode, remove the three credentials from the inherited environment, import `src/store/index.ts`, and require a success marker. Pair it with pinned-empty credentials that must fail, proving the boot check was not merely disabled. Independently, replace the column-zero regex with an AST assertion that `loadEnvLocal()` is a direct `Program.body` statement; column zero does not actually prove module scope.

### Checks

- `tests/one-store-only.test.ts`: **11/11 passed**
- Focused unit run: **143 passed, 1 failed**; the failure was the ten broken doc links
- Sandbox-safe typecheck: **passed**, all 1,427 source files covered
- Migration witness comparison: unchanged substantive buckets—**1 subject, 42 fixture, 43 executable total**; removing the zero-sized flag bucket is correct.