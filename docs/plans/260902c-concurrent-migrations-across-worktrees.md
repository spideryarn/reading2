# Concurrent migrations across worktrees

Parent work: [260828r-worktrees.md](260828r-worktrees.md). That plan's step 4 proposed a file-lock
"database lease" and an automated refusal on duplicate migration numbers. **Both are wrong**, and
this plan says why and what replaces them. Started 2026-09-02.

Greg, 2026-09-02, which is the whole brief:

> For duplicate migration-numbers, is there any reason why that's a problem? Can't we just run them
> both? Let's aim to make things robust so that multiple agents can be working in separate worktrees
> and things merge cleanly, where possible.

## The short answer to his question

Yes, you can usually just run them both, and **the number was never the thing that breaks**. Two
worktrees can mint a tidy `0052` and `0053` and still fail; they can mint two `0052`s and be fine.
Refusing duplicate numbers is neither necessary nor sufficient, which is why the parent plan's
proposal is being dropped rather than built.

There are three real failure modes, and they are in different files.

## Failure 1 — the `when` stamp, and drizzle's watermark. **Already closed.**

drizzle's migrator is a watermark, not a ledger: `PgDialect.migrate` reads one row
(`order by created_at desc limit 1`) before its loop, then applies every journal entry stamped
strictly later. It never asks whether an older entry is missing. So a migration whose `when` sinks
below the watermark is skipped for ever while `✓ migrations applied` prints.

Two worktrees make this ordinary rather than exotic: A generates at 13:00 and applies it to the
shared local Postgres; B generated at 12:45 and merges; B's migration is now below the watermark.

**This is already caught**, and the catching is good. [`scripts/migration-ledger.ts`](../../scripts/migration-ledger.ts):

- `reconcileLedger` condition 3 — `unreachable`, "N migration(s) can never be applied" — refuses in
  the preflight, **before any DDL**.
- `journalProblems` — broken `idx`, duplicate tag, duplicate `when`, a journal entry with no `.sql`,
  and a `.sql` the journal does not name. That last is the direction that actually happened on
  2026-08-31, when two sessions both produced an `0032`.
- [`tests/migration-journal.test.ts`](../../tests/migration-journal.test.ts) runs the file-side
  checks in CI on every branch, including "stamps every migration later than every one before it",
  with the one historical inversion grandfathered and pinned so a second cannot appear quietly.

Nothing to build. What this plan adds is a runbook for the *fix*, because refusing loudly still
leaves an agent holding a migration it cannot apply.

## Failure 2 — the snapshot chain. **Open, and it exits 0.**

This is the one that matters, and the parent plan never names it.

Every `drizzle-kit generate` writes `drizzle/meta/<prefix>_snapshot.json` carrying `id` and
`prevId`. It is a linked list. Verified in this repo:

```
drizzle/meta/0050_snapshot.json  id     = 00b7a7af-631f-46c8-a1a6-e13471bc01ca
drizzle/meta/0051_snapshot.json  prevId = 00b7a7af-631f-46c8-a1a6-e13471bc01ca
```

Two worktrees generating from `0051` produce two snapshots with the same `prevId`. drizzle-kit
detects it — and then:

```
node_modules/drizzle-kit/bin.cjs:8226   const abort = report.malformed.length || collisionEntries.length > 0;
node_modules/drizzle-kit/bin.cjs:8228     process.exit(0);      ← the `generate` path
node_modules/drizzle-kit/bin.cjs:91747    process.exit(1);      ← the `check` path
```

**`npm run db:generate` prints a red error and exits 0, writing nothing.** That is a silent success
of exactly the kind [silent-success.md](../reusable/silent-success.md) is about: the operator asked
for a migration, got a success code, and got no migration.

`drizzle-kit check` exits 1 on the same condition, and [`scripts/deploy.ts:444`](../../scripts/deploy.ts)
runs it — so the deploy gate catches a forked chain. **Nothing before deploy does.** Neither
`journalProblems` nor `tests/migration-journal.test.ts` reads snapshots at all, and `migrate()` never
reads them, so the database stays correct right up until the next schema change.

**And the obvious hand-fix is a trap.** Repointing the loser's `prevId` at the winner's `id` leaves
the loser's snapshot still diffed from `0051`, without the winner's changes — so the next `generate`
re-emits the winner's DDL as a new migration, and `db:migrate` fails on `already exists` (drizzle
emits bare `ADD COLUMN`/`CREATE TABLE`, no `IF NOT EXISTS`) one migration later, in whichever
worktree generates next. Deleting the loser's snapshot as debris is the same bug mirrored.

**There is no journal-resolution script that can be correct.** Sorting the merged entries by `when`
and renumbering `idx` fixes the journal and leaves the chain forked — it would make a forked chain
*pass* the tests, which is worse than the conflict it removes. Snapshots are a linear chain and
drizzle has no notion of merging them. The only correct resolution is for the loser to regenerate on
top of the merged schema.

## Failure 3 — the shared database. **Half closed.**

One local Supabase, many worktrees.

Already there, and it is the right primitive: `MIGRATION_LOCK_KEY = 260_831`
([`scripts/migration-ledger.ts:695`](../../scripts/migration-ledger.ts)), taken as
`pg_try_advisory_lock` in [`scripts/db-migrate.ts:197`](../../scripts/db-migrate.ts) — refuse rather
than wait, with a clear message — held across the preflight *and* the migrate, released at :278.
`db-repair-migration-ledger.ts` takes it too.

So **the parent plan's step 4 file-lock lease is already built, better, in Postgres.** It should be
struck from that plan rather than implemented.

What it does not cover, and worktrees make common:

- **migrate against a running test suite.** Suites have their own key, `RUN_LOCK = 918_273_645`
  ([`tests/helpers/run-lock.ts:194`](../../tests/helpers/run-lock.ts)), taken only by job suites and
  only against each other.
- **`db:reset`**, which is bare `supabase db reset` and takes nothing.

## What we are going to do

In priority order. Stage 1 is the only one that closes a silent failure.

### 1. A snapshot-chain check, beside the journal checks

A clause in `journalProblems` (so `db:migrate`'s preflight sees it) plus tests in
`tests/migration-journal.test.ts`: walk the journal in order and assert each entry has a
`<tag>_snapshot.json` whose `prevId` is the previous entry's snapshot `id`, and that no snapshot in
`meta/` is unnamed by the journal. Pure, no database — a fact about the repository, so it goes red on
the branch rather than on whoever migrates next.

**Proving it** — fork the chain in a fixture folder (two snapshots, one `prevId`), and separately
delete the last snapshot. Both must go red, and the real `drizzle/` must stay green. A check nobody
has watched fail is not evidence.

### 2. The runbook: the loser regenerates

Into [worktrees.md](../project/worktrees.md), pointed at from
[database.md § A watermark is not a ledger](../project/database.md). For a worktree that merges `dev`
and hits the `_journal.json` conflict:

1. Take the trunk's journal wholesale —
   `git show origin/dev:drizzle/meta/_journal.json > drizzle/meta/_journal.json`. A file write, not
   a `git checkout`, so it stays inside the house rules.
2. Delete your own `.sql` and `_snapshot.json`, keeping a copy if you hand-edited the SQL.
3. Finish the merge, then `npm run db:generate -- --name <same name>`. It diffs the merged
   `schema.ts` against the trunk's last snapshot, so the DDL is right, the chain is linear, and the
   fresh `when` is later than everything — which is what actually makes an inversion impossible.
4. Re-apply any hand edits, run the file tests.

Plus the case where the loser had *already applied* its migration to the shared database before
merging: its ledger row is now `unknown` with `pending > 0`, so the preflight refuses (the case the
`allowHistoricalExtras` comment describes). The row is not on `KNOWN_ORPHANS` and the DDL is already
in the schema, so a regenerated migration fails on `already exists`. For a local database the boring
fix is `npm run db:reset && npm run db:migrate` under the lock — **and the runbook must name its
cost**, which is everyone's local articles. It is `db:reset`, so it is Greg's call under
[AGENTS.md](../../AGENTS.md).

### 3. `migrations.prefix: "timestamp"`

One line in [`drizzle.config.ts`](../../drizzle.config.ts). Filenames become `YYYYMMDDhhmmss_name`
and stop colliding between worktrees, which is the 2026-08-31 accident made impossible rather than
test-caught.

Mixing with the existing 52 index-prefixed files is safe: `migrate()` reads the journal only
(`${folder}/${tag}.sql` per entry, never lists the folder), `hashMigrationFiles` keys by tag, and
drizzle-kit's own `snapshots.sort()` stays right because `0051_` sorts before `2026…_`. `idx` is
still `last.idx + 1` under any prefix, so `journalProblems`' contiguity check keeps working.

**One real dependent**: [`tests/db-step-constraint.test.ts`](../../tests/db-step-constraint.test.ts)
sorts `.sql` filenames (line 40–42) and asserts `/^\d{4}_.*\.sql$/` (line 106). It must read journal
order and drop the `\d{4}`, or it goes red the first time a timestamp-named migration touches
`revision_step_runs_step`.

**What this does not fix, stated plainly**: `drizzle/meta/_journal.json` still conflicts on every
concurrent migration, because both sides append to one array. The prefix change kills the filename
collision, not the conflict. Stage 2 is what makes the conflict cheap.

### 4. Shared/exclusive lock across migrate, reset and test runs

DB-backed suites take `pg_advisory_lock_shared(K)` on a session that outlives the file; `db:migrate`
and `db:reset` take it exclusive, **waiting** with a `lock_timeout` and a "waiting for N test runs"
line rather than refusing, because a suite takes a minute. Hook the shared side into
`tests/helpers/pg-ready.ts`, which 67 files already call — noting `pgReady` closes its pool unless
`keepPool`, so the lock needs a connection that outlives it.

**One constant, exported once and imported by both sides**, never two literals — the seam is the
thing that breaks. Advisory lock rather than `scripts/lockfile.ts` because it lives in the resource
it protects (a lock file inside a worktree protects nothing), it releases when the session dies so
the SIGKILL-then-`rm` cost disappears rather than being tolerated, and it is already this repo's
mechanism twice over.

`db:reset` is the wrinkle: `supabase db reset` kills connections, so the wrapper's own lock dies
mid-reset. Acceptable — the wrapper still waits until no shared holders remain before it starts.

**Proving it** — hold `pg_advisory_lock(K)` in `psql` for 25 s and start a DB suite: it must wait,
not skip. Hold the shared lock and run `db:migrate`: it must wait. Change the key on one side only:
everything passes and the protection is gone, which is the test that matters.

### 5. Optional: `drizzle-kit check` in `scripts/check.ts`

It exits 1 on a forked chain. Today only `deploy.ts` runs it. Cheap, and only worth it if stage 1
turns out not to cover everything.

## What a lease cannot do

A non-additive migration — a dropped column — applied by one worktree breaks the running dev server
of every other worktree. That is inherent to one shared database, and it belongs in
[worktrees.md](../project/worktrees.md) as a stated limit rather than something the lock pretends to
cover.

## The simpler options passed over

- **Keep `prefix: "index"`.** Rejected: a merge then produces an add/add conflict on
  `0052_snapshot.json` *plus* two `.sql` files sharing a number — the 2026-08-31 shape. With
  `timestamp` the only conflicting file is the journal.
- **`.gitattributes merge=union` on `_journal.json`.** Rejected twice over: textual union of a JSON
  array depends on trailing-comma placement and can produce unparseable JSON, and even when it
  works it does nothing about the snapshot fork.
- **A `db:migration:reconcile` script** that sorts by `when` and renumbers `idx`. Rejected, and this
  was the author's first instinct: it cannot fix the snapshot chain, so it would turn a loud
  conflict into a forked chain that passes every test.
- **Refuse duplicate migration numbers**, as the parent plan proposed. Rejected: neither necessary
  nor sufficient, as the top of this doc argues.

## Corrections this plan makes to what was believed

- The parent plan's step 4 lease **exists already** and is a Postgres advisory lock, not something to
  build on `scripts/lockfile.ts`.
- The duplicate-number refusal it proposes targets the wrong invariant.
- "Timestamp prefixes make order inversions structurally impossible" — **this author's claim, and it
  is wrong.** Journal order is array order, and after a merge that is whatever the resolver wrote.
  Timestamp prefixes make *filename collisions* impossible. What makes an inversion impossible is
  the loser regenerating, because a fresh `when` is later than everything.
- "The silent-failure class is closed" — closed on the ledger side, open on the snapshot chain, and
  the open one exits 0.
