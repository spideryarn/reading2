Verdict: revise the plan before building. Logical-database isolation remains right, but Stage B/C cannot land safely in the order written, and the shared-lane inventory is wrong.

## Findings

1. **Certain, blocking — Stage B and Stage C must land atomically.**

The private setup’s positive control runs before each test file, so it cannot first require a private database and later let `pgReady({ shared: true })` switch back to `postgres` ([plan line 187](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md:187)). The shared/private choice must happen before that control.

Use disjoint Vitest projects or file manifests:

- private Postgres lane: private setup, asserts its generated database name;
- shared-services lane: shared setup, asserts `current_database() = 'postgres'`;
- ordinary unit lane: remains parallel and does not create a database.

The shared list also needs correction:

- Add `tests/admin-store.test.ts`. It explicitly combines private SQL aggregates with GoTrue’s account list ([lines 37–57](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/admin-store.test.ts:37), [81–87](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/admin-store.test.ts:81)). An empty clone produces no accounts while GoTrue still reads `postgres`.
- Keep `auth-user-seeding.test.ts` and `seed-admin-signin.test.ts` shared.
- Remove `store-realtime-sessions.test.ts` from the shared list. Despite its name, its Postgres half only seeds `auth.users` directly and exercises `pgRealtimeSessionStore`; it never calls Realtime ([lines 206–262](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-realtime-sessions.test.ts:206)).

Supabase’s services are bound to the stack’s one configured database; merely cloning schemas does not redirect GoTrue or Storage. [Supabase documents that architecture explicitly](https://supabase.com/docs/guides/auth/architecture).

2. **Certain — choose per-run, not per-worktree.**

Per-worktree does not meet the plan’s correctness claim: two test commands in one worktree would share rows and migrations. `fileParallelism: false` serialises files inside one Vitest invocation, not separate invocations.

Choose a UUID-bearing per-run name. I would reconsider only if measured clone-and-migrate time materially harms the normal edit/test loop and the replacement includes a whole-run, cross-process mutex. Even then, I would first optimise per-run creation with a cached immutable baseline rather than weaken isolation.

The scavenger needs a safety rule. “Scavenge `spideryarn_test_*` on startup” ([line 192](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md:192)) can drop another active run during its brief zero-connection window. Put creation time in the name and drop only databases that are both:

- older than a deliberately generous threshold; and
- carrying no sessions in `pg_stat_activity`.

Also, a killed run does not “self-clean”; a later run scavenges it.

3. **Certain — the 37 Stage A conversions preserved their assertions, but Stage A is not yet a clean stopping point.**

The diff shows all 37 old assertions only checked `.kind === "claimed"` and discarded the returned job. `expectClaimed` is strictly stronger at those sites. The three hand edits are sound:

- the loop at [line 748](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-jobs-parity.test.ts:748) still assigns `heldBy` only after a successful assertion;
- the wrapped pair around [line 1308](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-jobs-parity.test.ts:1308) lost only formatting;
- the wrapped assertion around [line 1607](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-jobs-parity.test.ts:1607) likewise lost nothing.

However, my parity run reproduced a pre-existing filesystem flake at [line 699](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-jobs-parity.test.ts:699): `first` and `second` can receive the same millisecond timestamp ([`aJob`, line 348](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-jobs-parity.test.ts:348)), after which random ID order can make `second` the predecessor ([jobs-fs.ts lines 442–448](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/src/store/jobs-fs.ts:442)). The helper correctly reported:

> another job on this article is ahead of it

Give the two jobs explicit ordered timestamps before committing Stage A.

4. **Certain — the contention split is valid for these 37 sites, but overstated as a general rule.**

There are four current `busy` reasons:

- `another claim is being decided`
- `already running N of M jobs`
- `another job on this article is ahead of it`
- `another request is inside this job`

The fourth appears at [pg-jobs.ts lines 491–497](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/src/store/pg-jobs.ts:491) and should get an explicit “not contention” helper test alongside the article-line reason.

For today’s converted calls, classifying the first two as contamination is sound:

- ordinary calls use `CAP = 100`;
- the low-cap tests establish fewer live jobs than their successful claim allows;
- claims are sequential and the run lock excludes peer job suites.

But the helper’s claim that a suite “cannot cause” those reasons is too absolute. A future concurrent-claim test can contend on the singleton, and a regression that leaks 100 running jobs inside the current run can produce `already running`. Keep the behavior, but document it as “contention under these call-site invariants,” not something intrinsic to the string.

I would also type the four reasons as a literal/template-literal union instead of leaving `why: string` at [jobs.ts line 58](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/src/store/jobs.ts:58). Then adding a fifth reason can force the diagnostic classifier to be revisited.

5. **Certain — redirect plumbing is broadly safe; clean-state semantics are not.**

The central connection paths do read `process.env.DATABASE_URL` late enough:

- `pgReady`: [line 216](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/helpers/pg-ready.ts:216)
- application pool: [client.ts lines 71–99](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/src/db/client.ts:71)
- the hand-built test pools similarly read it after setup.

But several tests assume seeded data that a schema-only clone will not contain. Certain examples include:

- `store-checkpoints.test.ts` inserting `ADMIN_USER_ID_LOCAL` without seeding it first ([line 274](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-checkpoints.test.ts:274));
- `store-artefacts-pg.test.ts`, whose comment explicitly says it relies on Greg’s existing Auth row ([lines 115–126](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/store-artefacts-pg.test.ts:115));
- `blocks-baseline.test.ts` doing the same insertion ([line 1087](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/tests/blocks-baseline.test.ts:1087)).

A cheap pre-build audit is:

- make an explicit private/shared Postgres test manifest;
- statically scan Postgres tests for `DEV_OWNER_ID`, `ADMIN_USER_ID_LOCAL`, `auth.users`, `SUPABASE_URL`, `blobStore`, and direct `new Pool`;
- require every fixed owner used beneath an Auth FK either to call `seedAuthUser` or be listed as a shared-state exception;
- add a guard test ensuring every file calling `pgReady` or directly constructing a Postgres pool appears in exactly one lane.

Storage integration remains shared even when SQL is private. That may be acceptable for content-addressed unique keys, but the plan should say plainly that it is not isolating the bucket.

6. **Certain — the dump approach is viable, but the recipe needs tightening.**

`pg_dump -s` carries definitions, not table contents. With the current exclusions it carries remaining non-system schemas, extension declarations, functions, triggers, RLS policies, ownership/ACLs and publications unless explicitly suppressed. It omits Auth users, Storage buckets/object rows, sequence values, large objects, actual Storage bytes, and cluster-global roles. PostgreSQL documents both the all-non-system-schema default and schema-only behavior [here](https://www.postgresql.org/docs/current/app-pgdump.html).

Specific changes:

- Create from `template0`, not the default `template1`, to guarantee an empty restore target; PostgreSQL recommends that for dump restoration ([documentation](https://www.postgresql.org/docs/current/app-pgdump.html)).
- Exclude `spideryarn_migrations`, not merely `drizzle`. The configured ledger schema is `spideryarn_migrations` ([drizzle.config.ts line 40](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/drizzle.config.ts:40)). Restoring its empty definition happens to work, but a clean migrator proof should let the migrator create its own ledger.
- Restore with fail-fast atomic semantics: custom archive plus `pg_restore --exit-on-error --single-transaction`, or plain SQL via `psql -X -v ON_ERROR_STOP=1` while independently checking both process exit codes. By default, restore can continue after errors; PostgreSQL exposes `--exit-on-error` specifically for this ([pg_restore documentation](https://www.postgresql.org/docs/current/app-pgrestore.html)).
- Inspect/assert the archive manifest: forbidden app schemas absent; required `auth.users` and extensions present. That turns the broad dump selection from an assumption into a checked baseline.

Copying Auth/Storage RLS definitions is harmless but mostly unused because their services still connect to `postgres`. Event-trigger behavior is the speculative part: inspect the actual archive list and either deliberately retain those objects or exclude them by name.

7. **Certain — the environment-ordering claim is correct and reproduced.**

I ran:

```sh
DATABASE_URL=postgresql://nobody:nobody@127.0.0.1:1/should_not_survive \
REQUIRE_POSTGRES=1 npx vitest run tests/store-jobs-parity.test.ts
```

The suite attempted `127.0.0.1:54362/postgres`, proving `.env.local` replaced the command-line value exactly as [env.ts lines 60–75](/home/greg/code/spideryarn2/.claude/worktrees/test-db-isolation/src/env.ts:60) predict.

The helper test passed 6/6. The requested live contention spike could not connect because this execution sandbox rejected localhost sockets with `EPERM`, so I cannot claim an independent live reproduction of that branch.

## Recommended stage order

1. Finish Stage A: add the fourth-reason test, tighten the reason contract, fix the equal-timestamp parity flake, and adopt the helper at remaining appropriate sites.
2. Build the database factory and dump/restore tests behind a manual spike config. Do not change default `npm test` yet.
3. Build the explicit private/shared manifests, audit seed dependencies, and fix them while the new lane remains opt-in.
4. Atomically activate the three Vitest projects, their positive controls, per-run lifecycle, stale scavenger, and `npm test`/`npm run check` integration. Re-run the A/B acceptance experiment.
5. Correct the important docs with approval; update `testing.md` alongside activation rather than leaving behavior undocumented until a later stage. Delete spikes once their promoted replacements have passed.
6. Keep per-worker cloning optional.

That gives every commit a green, deployable stopping point. The present Stage B does not: it redirects shared-service and seeded-state tests before Stage C repairs them.