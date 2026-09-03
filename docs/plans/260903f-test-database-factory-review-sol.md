Verdict: I would not ship or activate T-B yet. There are three blocking findings; two were reproduced.

## Findings

1. High/blocking — the scavenger can still drop a live run’s database. Reasoned, high confidence.

The second session check at [db-test-create.ts:987](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:987) and forced drop at [db-test-create.ts:996](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:996) are separate operations:

1. Run A is over six hours old and temporarily has no connection.
2. Scavenger B’s scan and re-read both see zero sessions.
3. A connects after the re-read.
4. B executes `DROP DATABASE … WITH (FORCE)`, terminating A.

PostgreSQL explicitly says `FORCE` terminates connections, whereas ordinary `DROP DATABASE` refuses while another connection exists. [PostgreSQL `DROP DATABASE`](https://www.postgresql.org/docs/17/sql-dropdatabase.html)

There is a second sequence with no race: an old-but-live process between lazily opened pools has zero sessions throughout the drop. The six-hour threshold defines presumed staleness, not ownership.

Recommended safety model:

- Hold one dedicated “lease” connection for the database’s entire run.
- Use non-forced `DROP DATABASE` in the scavenger, so a late connection makes the drop fail.
- Reserve `WITH (FORCE)` for teardown by the run that owns the exact database.
- Treat `only + olderThanMs: 0` as an unsafe test capability, not another fence. It proves knowledge of a name, not ownership.
- Reject non-finite/negative thresholds and invalid `now` values; `NaN` currently defeats every age comparison.

A forward clock correction of more than the threshold can also make a new database appear stale. A backward correction spares it. Because creator and scavenger normally share this host, ordinary cross-host skew is not a concern.

The `pg_stat_activity` role concern is okay: PostgreSQL hides sensitive columns from ordinary roles, but session existence and database name remain visible, so this count sees other roles’ sessions. [PostgreSQL monitoring documentation](https://www.postgresql.org/docs/17/monitoring-stats.html)

2. High/blocking — `assertMintedName` still admits unsafe custom prefixes. Reproduced up to the blocked connection.

`assertPrefix` accepts any prefix beginning with `spideryarn_test_` at [db-test-create.ts:279](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:279). `parseTestDatabaseName(name, prefix)` then removes that entire caller-controlled prefix before validating the timestamp/UUID suffix.

I constructed:

```text
prefix = spideryarn_test_x"; select 1; --
name   = <that prefix>260903120000_<32 hex>
```

`parseTestDatabaseName(name, prefix)` returned the expected date, and `dropTestDatabase` progressed past `assertMintedName`; it stopped only because this sandbox rejects the database connection with `EPERM`.

Both interpolations are affected:

- [CREATE DATABASE at line 781](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:781)
- [DROP DATABASE at line 861](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:861)

I found no other database-name SQL interpolation. Container commands pass the database as an argv element, and `OWNER_ROLE` is a constant.

The simplest fix is to remove customizable prefixes: the UUID already isolates these tests. Otherwise, validate the prefix itself as an ASCII identifier fragment, check `Buffer.byteLength` inside `assertMintedName`, and quote identifiers defensively.

Refusing `spideryarn_test_spike` from `--drop` is the right decision. It lacks the evidence needed to call it factory-owned; manual removal should remain deliberate.

3. High/blocking — T-B is not behind a spike config and already changes default `npm test`. Reproduced.

The default config includes every `tests/**/*.test.ts` at [vitest.config.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/vitest.config.ts:72), including this new file. That contradicts Stage B’s explicit boundary at [260903e:228](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md:228).

Worse, the minted-name positive control at [db-test-create.test.ts:289](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/db-test-create.test.ts:289) is outside the gated `live` suites and opens a database connection even after the integration probe failed.

My focused run produced:

```text
1 failed | 25 passed | 12 skipped
```

The failure was that positive control attempting `127.0.0.1:54362` after the integration tests had skipped for the same unreachable database.

This needs a genuinely separate/manual Vitest config, with the file excluded or renamed out of the default include. That config should require Postgres rather than allowing all meaningful tests to skip. The acceptance guard should either be pure or live inside the integration gate.

The plan also says 36 tests; the runner collected 38.

4. Medium — several claimed silent-success controls are not preserved in the test artifact. Inspected, high confidence.

The committed tests contain good negative controls for `archiveProblems`, `baselineProblems`, restore atomicity, and both session observations. They do not contain a negative control for:

- mismatched `assertSameCluster`;
- a wrong migrator `Target:`;
- the post-migration ledger check.

The ledger check itself is only `count(*) === journal.length` at [db-test-create.ts:831](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/scripts/db-test-create.ts:831). Missing one row plus duplicating another passes. The real migrator’s hash/timestamp reconciliation makes this unlikely to become a current correctness failure, and the `spideryarn.jobs` check provides another independent witness, but this factory-level ledger assertion is not independently strong evidence.

Similarly, the target check searches separately for any `Target:` substring and any `/${name}` substring. Parsing the exact `Target:` URL and comparing its host, port, and pathname would be clearer. The subsequent private-database schema probes currently prevent this looseness from becoming silent success.

5. Low/medium — retaining the event triggers is reasonable, but the written rationale overstates what they do. Reasoned from upstream source.

Only `pgrst_ddl_watch` and `pgrst_drop_watch` are notification-only. The other four react to extension creation/removal and can grant privileges, recreate the GraphQL placeholder, or create a role. The current Supabase Postgres 17 schema shows those definitions directly. [Supabase Postgres schema](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql)

For the current application migrations, the conclusion is still sound: the migration files create no extensions, so those four are dormant; the active watcher sends a database-local notification with no listener in the clone. I would retain the triggers.

However, `archiveProblems` does not assert that there are exactly the six reviewed triggers. The dump silently starts retaining a seventh trigger if the shared database acquires one. Given that these are superuser-restored executable objects, add an allowlisted event-trigger inventory or soften the claim from “the six inspected triggers” to “whatever the shared database currently carries.”

## Checks requested

- The `pg_restore` correction is correct. Upstream source returns exit status 1 when ignored errors were counted. `--single-transaction` supplies atomic rollback and itself implies `--exit-on-error`; writing both flags is redundant but clear. [PostgreSQL `pg_restore`](https://www.postgresql.org/docs/17/app-pgrestore.html)
- Restoring as `supabase_admin` while the database is owned by `postgres` is sound. Without `--no-owner`, `pg_restore` restores each schema object’s original ownership; the database owner remains able to create the new app schema. [PostgreSQL ownership behavior](https://www.postgresql.org/docs/17/app-pgrestore.html#APP-PGRESTORE-OPTIONS)
- The baseline assertions satisfy Stage B’s named minimum: both app schemas absent, `auth.users` present, and required extensions present. They do not prove full catalog equality with the shared database; the broad successful `pg_dump`/atomic restore is doing that work. I would not add a full catalog diff unless exact equality is intended as a maintained contract.
- `assertSameCluster` is a strong check for these two independently initialized stacks. A copied PGDATA directory could share a system identifier, but that is not this host’s stated setup.

## Execution evidence

- Focused Vitest: failed as described; database-backed tests could not run.
- Docker inspection: blocked by permission to `/var/run/docker.sock`.
- Local Postgres TCP: blocked by sandbox `EPERM`.
- Therefore I did not independently reproduce restore, event-trigger, ownership, or scavenger behavior against the live stack.
- Focused Biome lint: passed.
- Underlying typecheck: passed for all 1,190 source files. `npm run typecheck` itself hit the sandbox’s `tsx` IPC restriction, so I ran the same script through Node’s `tsx` loader.