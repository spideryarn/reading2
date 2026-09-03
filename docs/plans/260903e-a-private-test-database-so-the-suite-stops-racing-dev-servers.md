# A private test database, so the suite stops racing dev servers

## Goal

`npm test` is nondeterministically red on this box, and `npm run check`'s test gate reports a green
that cannot be reproduced. Give the Postgres-touching suites a database nobody else is inside, so
that a green means something — and until that lands, make a contended run **say so** instead of
looking like a bug in `claim`.

The second half is done (Stage A below). The rest is the plan.

## The evidence

Measured 2026-09-03 on the Hetzner box, on an unchanged tree at `4f55360b`:

| Run | Result |
| --- | --- |
| Full suite, run A | 6 failed of 10,297 |
| Full suite, run B | **31 failed — a disjoint set of files** |
| `tests/store-jobs-parity.test.ts` alone, 3× back to back | 2 failed, then 5, then 4 |

Every failure was the same shape: `expected 'busy' to be 'claimed'`. Disjoint failure sets across
runs of identical code is contention, not breakage.

### Root cause

`claim` takes one global singleton row with `NOWAIT` and refuses the moment anyone else holds it —
[`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts):

```sql
select 1 from queue_state where id = 1 for update nowait
```

That is deliberate and **is not changing**: a plain `for update` would queue, holding transactions
and connections out of a pool sized 5, and the browser starts a driver for every active job at once.
It is a row lock rather than `pg_advisory_lock` because production runs through Supabase's
transaction pooler, where session advisory locks silently do nothing
([`src/db/client.ts`](../../src/db/client.ts)).

### Who the foreign claimant actually is

**Not other agents' test runs.** [`tests/helpers/run-lock.ts`](../../tests/helpers/run-lock.ts)
already serialises those — one advisory key, taken by every suite that runs a job, measured 23–50
failures → 0. Its own docstring names what is left:

> A lock only excludes the holders that agree to take it. **A real ingest on the same laptop never
> will.**

So the remaining claimant is a **dev server**, and it does not poll: `claim` and the unscoped
`settleExpired()` run only inside `advanceJob` ([`src/jobs.ts:1485,1517`](../../src/jobs.ts)), driven
by `POST /api/jobs/:id/advance` from a browser tab. On this box that means another worktree's dev
server plus whatever browser automation is running. A `running` row was observed appearing and
vanishing mid-investigation.

### The isolation boundary, proved rather than argued

Spiked 2026-09-03. A private database was built (`createdb`, then `pg_dump -s -N spideryarn -N
drizzle` restored, then all 63 migrations), and the same suite run twice at the same moment while
the **shared** database's singleton was deliberately held:

| | Database under test | Result |
| --- | --- | --- |
| A | private `spideryarn_test_spike` | **89 passed** |
| B | shared `postgres` | **38 failed**, every one `TEST DATABASE CONTENDED` |

Same code, same contention, same minute; only the database differs. This also served as the positive
control: had the redirect silently failed, run A would have been red like run B.

## References

- [testing.md](../project/testing.md) — the suite's conventions, and § *When a skip is not
  acceptable*, which is why the gate runs under `REQUIRE_POSTGRES=1`.
- [`tests/helpers/run-lock.ts`](../../tests/helpers/run-lock.ts) — the existing advisory-lock
  serialisation, what it measured, and its own account of what it cannot cover. **Read before
  building anything here**; it is half of this problem already solved.
- [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) — `claim`, the `NOWAIT` singleton, and the
  four things `busy` can mean.
- [`src/env.ts`](../../src/env.ts) — `.env.local` beats the shell *except* for a value that differs
  from the startup snapshot. The ordering trap in "Key decisions" below lives here.
- [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) — `resolveTargetUrl({ shellWins: true })`,
  which is how a script points the migrator at another database, and the `Target:` line to read.
- [database.md](../project/database.md) — § *`DATABASE_URL=… npm run db:migrate` does not do what it
  looks like*.
- [worktrees.md](../project/worktrees.md) and
  [260828r-worktrees.md](260828r-worktrees.md) — where per-worktree databases were considered and
  rejected. **The recorded reason is wrong**; see below.
- [silent-success.md](../reusable/silent-success.md) — the class this whole plan is about.
- Review answers from 2026-09-03: GPT Sol and Fable both argued for logical-database isolation, and
  disagreed about retries. Recorded under "Key decisions".

## Principles and key decisions

**The recorded rejection of per-worktree databases is mistaken, and this plan overturns it.**
[260828r-worktrees-step0-review-prompt.md](260828r-worktrees-step0-review-prompt.md) says:

> six migrations … declare hard foreign keys into `auth.users`, which GoTrue owns inside the same
> database. A fresh database has no `auth` schema, so those migrations fail. And `CREATE DATABASE …
> TEMPLATE` does not rescue it: the copy's `auth.users` is a frozen snapshot while the shared stack's
> GoTrue keeps writing new users to the original, so a freshly signed-up user fails the FK on insert.

That is sound **for a development database**, where live GoTrue signs up real users. It does not
transfer to a **test** database: the copy carries its own `auth` schema, so the foreign keys are
intra-database in the copy, and no test signs up through GoTrue — they seed `auth.users` directly via
[`tests/helpers/seed-auth-user.ts`](../../tests/helpers/seed-auth-user.ts), with a test asserting
that is the only place that inserts. GPT Sol, Fable and a literature review reached this
independently. **Stage E corrects the doc**; leaving a wrong premise in place is how the next agent
re-rejects the right answer.

**Contention is reported, never retried.** Fable proposed a bounded retry on `another claim is being
decided`. Rejected, on GPT Sol's reasoning:

> Retries turn a contaminated run into an apparently valid green and can conceal real queue
> regressions.

A contended run stays red and explains itself. That is the whole of Stage A.

**RAM was never the blocker.** Extra *databases* inside the one Postgres server are near-free — the
app database is 53 MB and the container holds 229 MiB regardless. Extra *Supabase stacks* are the
expensive thing, and none is proposed. Connections are the real cost: 16 workers × a pool of 5 is 80
connections, so a per-worker stage must cap workers and lower `DATABASE_POOL_MAX`.

**Simpler options passed over, and why:**

- **Retries** — makes a polluted run green. Above.
- **Schema-per-worker** — Drizzle's `pgSchema("spideryarn")` emits `"spideryarn"."jobs"` explicitly
  and `search_path` cannot redirect it. Making the name dynamic means auditing raw SQL, migrations,
  grants and probes — a wide application change to solve test infrastructure.
- **Transaction-rollback per test** — app code opens its own pools and transactions, and some suites
  deliberately use several connections. An outer transaction cannot contain that, and it would
  falsify the very locking tests that are failing.
- **Truncate between tests** — destructive to peers on a shared database (it would delete the
  `queue_state` singleton, which `claim` then throws on), and it cannot stop a concurrent claimant.
- **A bigger advisory mutex** — this already exists and is `run-lock.ts`. Dev servers do not take it,
  which is exactly the gap.
- **Testcontainers / a second bare Postgres** — a credible fallback if the local role ever lacks
  `CREATEDB`, but it stands up a database with no `auth` schema and adds container lifecycle for
  nothing, when a suitable server is already running.
- **`CREATE DATABASE … TEMPLATE postgres`** — cannot work: Supabase's own services (realtime,
  storage, postgrest, pg_cron, pg_net) hold ~19 permanent sessions to `postgres`, and Postgres
  refuses to clone a template that anybody is connected to. Verified. Hence dump-and-restore.

**One database per run before one per worker.** One architecture — logical-database isolation —
introduced at the simplest useful grain first. Per-run plus a serialised database lane removes dev
servers, internal contention and residue from killed runs in one step; per-worker is a later
optimisation for wall-clock, not correctness.

## The ordering trap, written down because it will bite

[`src/env.ts`](../../src/env.ts) snapshots the environment at module load and then makes `.env.local`
win over the shell — unless the value *differs from that snapshot*, which it reads as "this process
meant it". So:

- a **script** must assign `DATABASE_URL` **before** the first import of `src/env.ts` (the value
  becomes part of the snapshot, which `shellWins: true` then prefers);
- a vitest **setup file** must assign **after** it (so the value differs from the snapshot).

Get either backwards and `.env.local` silently restores the shared database while everything reports
success. `DATABASE_URL=… npx vitest` **does not work** and fails silently, which is why every stage
below carries a positive control asserting `current_database()`.

## Stages

### Stage A — make a contended run say so — **done**

- [x] `tests/helpers/expect-claimed.ts`: `expectClaimed(outcome, label?)` returns the job, or throws
      naming the refusal reason; the two reasons a suite cannot cause itself (`another claim is being
      decided`, `already running …`) throw a `TEST DATABASE CONTENDED` banner saying the run is not a
      product verdict. No retry.
- [x] `tests/expect-claimed.test.ts`, written first and watched red.
- [x] All 37 claim assertions in `tests/store-jobs-parity.test.ts` converted.
- [x] Proved the contention branch actually fires, twice: once by holding the singleton directly
      (`scripts/spike-contended-claim.ts`), once via 38 real failures in run B above. A branch nobody
      has watched fail is not evidence.
- [ ] Adopt `expectClaimed` in the other job suites that assert `claimed` — a repo-wide sweep, cheap
      subagent. Deferred out of Stage A to keep its diff readable.

### Stage B — one private database per run

- [ ] `scripts/db-test-create.ts`: `createdb`; `pg_dump -s -N spideryarn -N drizzle` from `postgres`
      restored into it (carries `auth`, `extensions`, `storage`, grants — roles are cluster-level);
      then the real migrator. Idempotent, and named `spideryarn_test_<something stable>`.
      `scripts/spike-migrate-to.ts` is the working prototype of the migrator half.
- [ ] Decide the name's grain — per run (`<uuid>`, dropped at teardown) or per worktree
      (`basename(ROOT)`, reused). Per-run self-cleans after a killed run and cannot be crossed by
      another branch's migrations; per-worktree is cheaper per run. **Technical fork — settle with
      Sol, not with Greg.**
- [ ] A vitest setup file doing the redirect with the ordering above, plus the positive control:
      refuse to run unless `current_database()` matches the expected name.
      `tests/setup/spike-db.ts` is the prototype.
- [ ] Serialise the database lane for this stage (`fileParallelism: false` for a `test.projects`
      group). Slower is acceptable; reproducible is the point.
- [ ] Teardown: `DROP DATABASE … WITH (FORCE)`, and scavenge stale `spideryarn_test_*` on startup so
      a killed run does not leak databases for ever.
- [ ] Write the failing test first: a test that asserts the setup refuses when pointed at `postgres`.
- [ ] Re-run the A/B experiment above as the acceptance criterion — green against the private
      database while the shared singleton is held, red when its own is held. Counted, not eyeballed.
- [ ] Delete the four `spike-*` files once promoted.

### Stage C — the lane that must stay on the shared database

- [ ] `shared: true` opt-out in [`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) for the
      suites that genuinely exercise the Supabase services, which are bound to `postgres` and do not
      follow `DATABASE_URL`: `tests/auth-user-seeding.test.ts` (asserts GoTrue 500s for the whole
      database), `tests/seed-admin-signin.test.ts`, `tests/store-realtime-sessions.test.ts`.
- [ ] Audit for transitive Storage use before assuming three is the whole list. Blobs look safe —
      no migration references `storage.*`, and `putIfAbsent` is content-addressed — but
      `blobStore()` returns the real Supabase adapter whenever the credentials are set
      ([`src/store/blobs.ts`](../../src/store/blobs.ts)), so this wants checking rather than
      assuming. Cheap subagent.
- [ ] Note, do not fix: `RawSourceStore.remove(key)` under content addressing lets one tenant delete
      bytes another tenant's row points at. That hazard exists today and no option here changes it.

### Stage D — pollution as its own verdict

- [ ] In [`scripts/check.ts`](../../scripts/check.ts), before the test gate:
      `select application_name from pg_stat_activity where datname = current_database() and pid <>
      pg_backend_pid()`. Any row means somebody is inside *my* test database — name them and fail the
      gate as **polluted**, which is a different answer from red. Only exact once the database is
      private; until then the same query against `postgres` is a warning, not a gate.
- [ ] Make the gate print the database it actually reached, and refuse to run its Postgres gate
      against `postgres`. A shared-database green should stop being representable.

### Stage E — the docs

- [ ] Correct the wrong `auth.users` / cross-database-FK premise in
      [worktrees.md](../project/worktrees.md), [260828r-worktrees.md](260828r-worktrees.md) and
      [260902c-concurrent-migrations-across-worktrees.md](260902c-concurrent-migrations-across-worktrees.md),
      pointing at this plan. Both are wording-is-a-rule docs, so
      [edit-important-docs.md](../reusable/edit-important-docs.md) applies — one approved change at a
      time.
- [ ] [testing.md](../project/testing.md): how a suite picks its database, the ordering trap, and
      what `TEST DATABASE CONTENDED` means when you see it.
- [ ] [supabase-local.md](../project/supabase-local.md): that extra databases live on the one stack,
      and how to drop a leaked one.
- [ ] A postmortem under `docs/postmortems/` — the class is *a check that shares an assumption with
      the thing it checks*: the gate and the suite both trusted a database neither owned.

### Stage F — per-worker, only if wall-clock demands it

- [ ] N clones instead of one, with a template keyed by a digest of the drizzle journal plus every
      migration file, so a migration change mints a new template automatically and no mutable
      "latest" template exists.
- [ ] Cap workers and set `DATABASE_POOL_MAX` to 2–3 first; 16 × 5 would exhaust connections before
      the databases cost anything.
- [ ] `VITEST_POOL_ID` is only a small stable index under `pool: "threads"`; under the default
      `forks` it is not (vitest #4982). Use it as a uniqueness key, never as a dense integer.

## Risks

- **Clean databases will expose tests quietly depending on local state** — Greg's seeded owner,
  `db:seed-dev` rows, fixtures assumed present. Sol expects this and budgets for it; Fable does not.
  It is the main reason the estimate has a wide range, and Stage B should expect to fix a tail of
  such tests rather than treat the first red as a bug in the harness.
- **`createdb` requires the local role to have `CREATEDB`.** True on this box; check before assuming
  it on the Mac.
- The spike left `spideryarn_test_spike` on the local stack (~8 MB). Drop it, or let Stage B's
  scavenger take it.

## Estimate

Stage A: done, about an hour. Stage B: 6–10 hours. Stages C–E: half a day. Stage F: only if needed.
GPT Sol budgets four days for the whole thing including the tail of state-dependent tests; Fable
budgets a day and a half. Plan for Sol's number.
