I would not activate T-D unchanged. The private Postgres lane itself is sound, but the claimed semantic boundary around `unit` is not.

## Findings

1. **P1 — `unit` currently reaches the shared Storage database.**

The unit setup poisons only `DATABASE_URL` ([unit-no-database.ts:85](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/unit-no-database.ts:85)). `blobStore()` independently selects Supabase Storage from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` ([blobs.ts:251](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/blobs.ts:251)). Those credentials are present on this box.

These four files are absent from `TEST_LANES`, hence run as `unit`, while using that real service:

- [an-upload-is-queued-only-once-its-bytes-arrive.test.ts:42](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts:42)
- [uploads-api.test.ts:47](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/uploads-api.test.ts:47)
- [raw-source-store.test.ts:26](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/raw-source-store.test.ts:26)
- [upload-acquire.test.ts:30](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/upload-acquire.test.ts:30)

This is not merely an accounting problem. `raw-source-store` repeatedly removes and replaces one deterministic canonical key with deliberately corrupt bytes ([raw-source-store.test.ts:41](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/raw-source-store.test.ts:41)). Concurrent runs of that file can mutate each other’s oracle. `upload-acquire` also derives canonical keys from fixed fixture bytes.

So the private lane’s serialisation does not prevent this collision: these files remain in the parallel unit project, and separate invocations share the bucket anyway.

2. **P1 — a unit test’s child process loses the poison and can reach shared `postgres`.**

A child inherits the poisoned `DATABASE_URL` before loading `src/env.ts`. That makes the poison part of the child’s `INHERITED` snapshot; `loadEnvLocal()` then replaces it with the real `.env.local` URL ([env.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/env.ts:61), [env.ts:297](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/env.ts:297)).

I reproduced that exact shape: a process started with the poison loaded `.env.local` and attempted `127.0.0.1:54362/postgres`. The sandbox refused the socket with `EPERM`, but the target proves the poison had already disappeared. Under Vitest, `NODE_ENV=test` suppresses even the overwrite warning.

Several unit tests spawn `tsx` children. The present database-oriented ones appear to arrange their own refusal, but the advertised semantic backstop is not inherited by subprocesses. A lane sentinel that `src/env.ts` itself honors would close this; a URL assignment in a setup file cannot.

3. **P1 — the “Docker off means skip” path does not skip `health.test.ts`.**

On any `createTestDatabase()` failure without `REQUIRE_POSTGRES=1`, global setup provides `null` ([private-db-global.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/private-db-global.ts:128)); private setup then installs an unreachable URL ([private-db.ts:76](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/private-db.ts:76)).

But `health.test.ts` has no `pgReady` gate. Its health handler reads the migration ledger through `getDb()`. This is the same shape that produced the already-recorded four failures under the unit poison. Moving the file into the private manifest changes its database when one exists; it does not make the no-database case skip.

Therefore ordinary `npm test` with Docker off is now red, contrary to [private-db-global.ts:62](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/private-db-global.ts:62) and the stated “this stage does not change that” promise.

Relatedly, the catch treats every factory error as “Docker off”: dump, restore, cluster-identity and migration failures are all downgraded to `null` unless `REQUIRE_POSTGRES=1`. Only a positively classified “stack unreachable” error should take the skip branch.

4. **P2 — the shared-lane identity control does not identify the stack.**

[shared-db.ts:32](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/setup/shared-db.ts:32) accepts any reachable database named `postgres`. Every local Supabase project—and hosted Supabase—normally has a database with that name.

Thus `DATABASE_URL` can point at another stack’s `postgres`, while `SUPABASE_URL` still points at this stack’s GoTrue, and the control passes. That is precisely the split-brain state the shared lane is supposed to exclude; `admin-store` may then pass vacuously for the reason already documented.

This is not a literal tautology, because it observes a real connection, but its oracle is non-unique. Compare the database endpoint/project to `SUPABASE_URL`, or prove the cluster identity.

5. **P2 — one post-CREATE failure can leak a database outside the cleanup fence.**

In `createTestDatabase`, `createEmptyDatabase()` runs before the cleanup `try` begins ([db-test-create.ts:800](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:800)). If `CREATE DATABASE` succeeds and the pool’s subsequent `end()` rejects, the factory rejects without returning a handle and without dropping the database. It survives until scavenging.

Move creation and URL construction inside the cleanup `try`. The outer global-setup cleanup correctly covers lease, seed and `provide` failures after the factory returns.

6. **P3 — the exemption reason control accepts whitespace.**

[store-migration-registry.test.ts:577](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/store-migration-registry.test.ts:577) checks `why.length`, so 41 spaces satisfy “a real reason.” Use `why.trim().length`.

The other exemption checks are appropriate. “Still invisible” is the right staleness test: once the ordinary scan finds the file, the exemption should disappear. They keep known exemptions tidy; they cannot establish completeness when the semantic poison itself has the Storage and subprocess holes above.

## Controls verdict

- Private `current_database()`: not tautological. It connects through `process.env.DATABASE_URL`, independently observes the reached server, and compares that with the provided minted name.
- Lease: not tautological. It observes a separate backend in `pg_stat_activity` and excludes its own control connection.
- Billing seed fence: not tautological; the connection’s observed database and the separately validated minted name must agree.
- Unit poison control: not tautological; string identity and a real failed connection are separate assertions.
- Shared identity: inadequate, because `postgres` is a database name, not a stack identity.

## Serialisation and teardown

`fileParallelism: false` is effective with the installed Vitest 4.1.11: it forces `maxWorkers` to one, and with `isolate: true` Vitest schedules isolated files sequentially. It does not serialise separate `npm test` invocations, shared-service files, Storage access, or explicitly concurrent tests inside one file. I found no `.concurrent` declarations in the private manifest.

Two runs starting in the same millisecond do not collide: the timestamp is followed by `randomUUID()`. SIGKILL necessarily leaves the database behind; its connection dies and the six-hour scavenger later owns cleanup. Normal failures after the factory returns and before `provide` are dropped correctly.

## Documentation and trade-off

[testing.md:42](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/project/testing.md:42) describes the intended design, not the built one:

- `unit` does reach shared `postgres` through Storage.
- The “two files reach Storage” account omits the four unit files above.
- `private-postgres` includes `health.test.ts`, which does not open a connection “of its own.”
- The four shared files are not all service tests; `db-test-create` is there by factory contract.
- “Everything here is deterministic: no network” is incompatible with the real Storage tests.

I agree with keeping the private SQL lane serial for v1. The measured reliability gain justifies the 1.6–1.8× cost. The blocker is not that trade-off; it is that the current boundary is narrower than both the code and documentation claim.

Focused verification passed: typechecking passed all projects, the unit poison control passed, and the four lane-map assertions passed. The broader registry run’s subprocess-only test could not execute in this sandbox (`tsx` IPC returned `EPERM`), so I did not treat that as a product failure.