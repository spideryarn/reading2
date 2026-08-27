# Schema drift guard

**Status:** plan, awaiting review. Written 2026-08-27.

Nothing tells us when the deployed code expects a column the database does not have. That has now
happened twice in one day, and the second time was found by accident while testing an unrelated
thing.

## What happened, both times

**The first**, and the one with a postmortem already:
[unguarded-job-store-and-the-migration-that-migrated-the-laptop.md](../postmortems/unguarded-job-store-and-the-migration-that-migrated-the-laptop.md).
`npm run db:migrate` applied migrations to the laptop while printing `✓ migrations applied`, so the
remote stayed four behind. `spideryarn.com` rendered a failed `select … from "spideryarn"."jobs"`.

**The second**, found 2026-08-27 while checking whether Vercel logs could be read programmatically:

```
GET /api/jobs 500   column "profile" does not exist   (42703)
```

Nine of those on `/api/jobs`, six on `/api/library`, six on `/api/health`, over 24 hours. The fix
from the first postmortem had landed; the migrations still had not been applied when the code that
needed them shipped.

And a third was queued up behind it. `0018_raw_sources` adds `raw_source_sha256` and
`raw_source_kind` to `article_revisions`. It was committed in `a63ea6e`, `src/db/schema.ts` on
`main` declares both columns, and the migration was **not applied to the remote**. Production was
only healthy because it happened to be running an older commit (`d5a9d51`) that predates the schema
change. The next deploy of `main` would have reproduced the same 42703 on a different table.

(It was applied by another agent while this plan was being written, so the immediate risk is gone.
The gap that let it sit there is not.)

## The shape of the class

> A check you have never seen fail is not evidence.
>
> — [silent-success.md](../reusable/silent-success.md)

Every instance is the same: **the code and the database disagree about what columns exist, and
nothing notices until a reader gets a 500.** The migration ledger being behind is one cause. A
migration applied by hand, a `push` against the wrong target, or a restored snapshot are others.
Checking "are all migrations applied" catches only the first. Checking the columns catches all of
them, and it checks the thing that actually breaks.

## What to build

**A single function that asks the database which columns it has, and compares that against the
columns Drizzle declares.** Drizzle already knows: `getTableColumns()` on each exported table gives
the column names, and `information_schema.columns` gives the database's. The answer is the set
difference, in one query.

Two callers:

1. **`npm run db:check`** — `scripts/db-check.ts`, taking its target from `DATABASE_URL` exactly as
   `db-migrate.ts` does, including the same shell-beats-`.env.local` precedence and the same
   password-stripped `Target:` line. Exits non-zero when anything is missing. This is the one to run
   before deploying, and it needs no new database grants because it runs as whoever you point it at.

2. **`/api/health`** — a `schema` block beside the existing `store` and `ssl` ones, appending to
   `warnings` when a declared column is absent. Anything in `warnings` already fails the check, so
   this needs no new failure plumbing.

### The constraint that decides the design

`spideryarn_app` — the role Vercel runs as — **cannot read the migration ledger.** Verified against
the remote, 2026-08-27:

```
connected as: spideryarn_app
CAN read ledger: NO -> permission denied for schema spideryarn_migrations
article_revisions raw_source columns present: 2/2
```

So a health check that compares `__drizzle_migrations` against `drizzle/meta/_journal.json` would
need a new `GRANT` on a schema that is deliberately outside `schemaFilter`. Reading
`information_schema.columns` needs nothing — the app role can already do it, as the second line
above shows. That is the deciding reason to compare columns rather than migration tags, and it
happens to be the more direct check anyway.

### What it must not do

- **Not fail on extra columns in the database.** A column the code no longer declares is normal
  during a rollback and is not what breaks. Only *missing* ones matter.
- **Not query every table separately.** One `information_schema` query for schema `spideryarn`,
  grouped in memory.
- **Not run on every request.** `/api/health` only.
- **Not name a value from the environment**, per the existing rule in `vercel-health.ts`.

## Proving it

Per [silent-success.md](../reusable/silent-success.md) and the working agreements, the check gets
tested **against the broken state before it is believed**:

1. Against local Postgres with every migration applied → passes.
2. Drop one column locally (`alter table spideryarn.jobs drop column profile`) → `db:check` exits
   non-zero and names `jobs.profile`; `/api/health` reports it in `warnings` and `ok:false`.
3. Restore, confirm green again.

Step 2 is the test that matters. A green run in step 1 alone proves nothing.

## What was built

Reviewed by GPT Sol before building —
[schema-drift-guard-review-sol.md](schema-drift-guard-review-sol.md), seven findings, all checked
against the code rather than taken on trust. Three changed the design:

- **`getTableColumns()` keys by the TypeScript name.** `rawSourceSha256`, not
  `raw_source_sha256`. Measured before it was believed: **21 of the 39 columns** on
  `article_revisions` differ, so the obvious `Object.keys()` implementation would have reported 21
  missing columns on a perfectly healthy database. `Object.values(…).map(c => c.name)` is the
  contract.
- **`information_schema.columns` includes views**, so a view of the right shape standing where a
  table should be would pass. Joined to `information_schema.tables` on `BASE TABLE`, with a test
  that renames the table and puts a view in its place.
- **"Extra columns cannot break old code" was wrong.** A `NOT NULL` column with no default breaks
  inserts from code that does not know about it — which is exactly the window between applying a
  migration and promoting the deploy. Reported separately as `requiredButUndeclared`.

The pieces:

- [`src/db/schema-drift.ts`](../../src/db/schema-drift.ts) — declaration discovery, one
  `information_schema` query, and a pure comparison.
- [`scripts/db-check.ts`](../../scripts/db-check.ts) — `npm run db:check`, exits non-zero on drift,
  same shell-beats-`.env.local` precedence as the migrator.
- [`src/vercel-health.ts`](../../src/vercel-health.ts) — a `schema` block, cached and coalesced like
  the store check, contributing to `warnings` and so to the existing 503.
- [`tests/db-schema-drift.test.ts`](../../tests/db-schema-drift.test.ts) — 16 tests.

`withoutPassword` moved from `scripts/db-migrate.ts` into
[`src/db/ssl.ts`](../../src/db/ssl.ts) so both commands print the `Target:` line through one
redactor rather than two.

### Answers to the three questions

1. **Existence and nullability now, types later.** `information_schema.data_type` treats arrays,
   domains and user-defined types specially, so a type comparison needs a canonicaliser that is
   itself worth testing. Not today.
2. **Fail hard.** `/api/health` is already a deployment-readiness check where every warning is a
   503, and a column the code selects and the database lacks is not an advisory.
3. **Yes, CI — and it is not built yet.** See below.

## Proved, both ways

Against local Postgres, and each assertion seen red before it was believed:

| | result |
|---|---|
| migrated database, `npm run db:check` | 16 tables, 197 columns, `✓ no schema drift` |
| **production**, as `spideryarn_app` | 16 tables, 197 columns, clean |
| `drop column jobs.profile` (in a rolled-back transaction) | `missing: ["jobs.profile"]` |
| a required column the code does not declare | `requiredButUndeclared: ["jobs.tenant_id"]` |
| a view standing where `jobs` should be | every `jobs.*` column reported missing |
| `/api/health` with `jobs.profile` dropped | 503, `schema.missing: ["jobs.profile"]`, warning names it |

The production run is the one worth keeping: it went through the **session pooler as
`spideryarn_app`**, the credential Vercel actually uses, because `information_schema` hides columns
the connecting role has no privilege on and an administrator seeing everything proves nothing about
what the app can select.

## The second review, and the false green it caught

[schema-drift-guard-code-review-sol.md](schema-drift-guard-code-review-sol.md). The code review
earned its keep more than the plan review did, exactly as the working agreements predict.

**The one that mattered.** `jobs.cancelling` is declared `.notNull().default(false)`, and
[`tryEnqueue`](../../src/store/pg-jobs.ts) never sets it — the database default is the only thing
filling it in. Drop that default and the column still *exists*, so the check as first written stayed
green while every job insert failed. An existence check is not enough on its own; the report now
also carries `defaultLost` and `nullabilityMismatch`, and a rolled-back test drops that default
against a real database and watches the check go red.

Two more:

- **Visible is not readable.** `information_schema` lists a column the role holds *any* privilege
  on, so an `INSERT`-only grant would show an unreadable column as healthy. The query now asks
  `has_column_privilege(…, 'SELECT')` and treats a non-selectable column as inaccessible.
- **Zero rows gave the right failure with the wrong diagnosis.** The privilege answer only existed
  on column rows, so an empty-but-perfectly-accessible schema reported "the role cannot USAGE this
  schema". The query is now anchored on a one-row `access` CTE with the columns left-joined, so
  there is exactly one honest privilege answer whatever the schema holds.

And the review was right that **no health test would have missed the feature**: every existing one
passed with the integration deleted. [`tests/health-schema.test.ts`](../../tests/health-schema.test.ts)
covers the wiring — missing column, failed query, filesystem store, coalescing, cache expiry — and
was checked by deleting the integration and watching **6 of its 7 go red**, then restoring the file
and confirming it byte-for-byte with `diff`.

### The finding that was deferred, and then taken

Sol flagged `console.error` in a request path as a breach of
[logging.md](../project/logging.md), which it is. It was left alone at first because the block
matched the store check directly above it, and *that* one's `console.error` was pinned by a test in
`tests/health.test.ts` asserting an operator still gets the full text — so moving one would leave the
file speaking two conventions, and moving both meant rewriting somebody else's test.

Both moved, separately, the same day. `log` gained a `health` component, and each site now logs the
**error object** rather than a `message` plucked out of it — which is the part that matters beyond
tidiness: `safeError` can only apply its allowlist to something it is handed whole, and a string
assembled at the call site sails past redaction (logging.md rule 3). The caller still gets 200
characters and nothing more.

The test that pinned `console.error` now pins the logger instead, and it is a **mock rather than a
spy on stdout** for a reason worth writing down: `src/log.ts` is `silent` under `NODE_ENV=test`, and
its destination is a SonicBoom writing to fd 1 with `fs.writeSync` — so a `process.stdout.write` spy
observes nothing whatever the handler does, and would have gone green on the day the logging was
deleted. Checked by deleting both log calls and watching both tests go red, then restoring the file
and confirming it byte-for-byte with `diff`.

## Where the gate actually is

Sol's first finding was that this guard finds drift *after* promotion:

> With the plan as written … only the next `/api/health` poll reports 503 and pages someone. A
> reader can lose the race.

That was written before [`scripts/deploy.ts`](../../scripts/deploy.ts) landed, and it reads worse
than the truth now. `npm run deploy` closes most of it without a line of new code:

- **Before the push**, `migrationPlan` compares `spideryarn_migrations.__drizzle_migrations` against
  `drizzle/meta/_journal.json` under the *migrator* credential, and `applyMigrations` applies what is
  pending. That is the cause of both 2026-08-27 outages, caught ahead of promotion.
- **After it**, `judgeHealth` in [`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts) turns
  **every** entry in the health response's `warnings` into a deploy failure. The schema block feeds
  `warnings`, so drift fails the deploy by itself — nobody had to teach `judgeHealth` about it. The
  script captured the previous production deployment before it changed anything, so the failure
  arrives with the rollback command already written out.

So the two checks are complementary, as the header of `schema-drift.ts` says: the ledger catches a
migration that has not run, and the columns catch a hand-dropped column, a bad restore or a revoked
grant, which no ledger comparison can see.

**What is left is genuinely narrower.** A column-level failure that does *not* come from a pending
migration is still found after the deployment is live rather than before it — and with a
git-push-triggered deploy there is no pre-promotion window to put it in, so closing that properly
means changing how deployment works, not adding a call. Not worth it for the residual case.

Two things would still be worth having, neither urgent:

1. `npm run db:check` against the **app-role** URL among the pre-push gates, which would catch the
   residual case before promotion for the cost of one query.
2. CI: start an empty database, apply all migrations, run `db:check`, and **fail rather than skip**
   if the database was never reached. A skipped check protects nothing.
