# `db:migrate` applies nothing, and says `✓ migrations applied`

On 2026-08-31 the laptop's database was four published migrations behind. Nothing had
failed, nothing had been skipped out loud, and `npm run db:migrate` had been reporting
success the whole time. The four were:

| migration | what was missing from the live schema |
|---|---|
| `0032_jobs_concurrency_cap` | the old `jobs_only_one_running` index was still there, so "at most one running job in the whole table" was still being enforced |
| `0033_quotes` | `article_revisions.quotes` did not exist — about 34 test suites were red because of this one |
| `0034_flowery_wolfsbane` | `chat_messages.passages` and `.interrupted` did not exist |
| `0036_drop_summary_column` | `article_revisions.summary` was still there, and `revision_step_runs_step` still allowed `'summary'` |

It was found while merging origin into a branch that had not pulled for a day, by
probing the catalogue for each migration's effect. It was **not** found by reading the
journal, and it could not have been: the journal says what should have run.

## The root cause

drizzle's node-postgres migrator keeps a **watermark, not a ledger**. It reads the single
newest `__drizzle_migrations` row, once, before its loop, and then applies only journal
entries whose `when` is strictly greater:

```js
// node_modules/drizzle-orm/pg-core/dialect.cjs
const dbMigrations = await ...`select id, hash, created_at from … order by created_at desc limit 1`;
const lastDbMigration = dbMigrations[0];
for (const migration of migrations) {
  if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
```

So a migration whose `when` is **below** the newest applied row is not "pending". It is
unreachable, permanently, in silence. The migrator never compares it to anything again.

Two things pushed the watermark over those four, and either would have been enough.

**One: a hand-written journal timestamp.** `0035_timeline`'s entry was written by hand
with `when: 1788200000000` — a round number, later than every migration around it,
including `0036_drop_summary_column` at `1788175229610`, which landed in the same commit
(`98c95e1`). Nothing recorded why. From that commit onwards, **`0036` is unreachable on
any database that applied `0035` first**, which probably includes production.

**Two: a branch's own migrations, generated from a real clock.** Two local migrations
made that evening carried genuine drizzle-kit timestamps (`1788191337811`,
`1788194935325`) that were newer than origin's published `0032`–`0034` and `0036`,
because origin's were authored earlier in the day and had not been pulled. Applying the
local pair raised the watermark above all four. After that, `git pull` could bring the
files down and `db:migrate` could never run them.

The second is the more general trap, and it has nothing to do with anyone doing anything
wrong: **any branch that generates a migration and applies it before pulling can strand
every published migration older than its own.** Drizzle's model assumes one linear clock,
and parallel work does not have one.

## Why nothing caught it

- **The command's own success is not evidence.** `migrate()` returning without throwing
  means "nothing was greater than the watermark", which is the same thing it says when
  there is genuinely nothing to do. [silent-success.md](../reusable/silent-success.md).
- **The journal agrees with the bug.** It is the list of migrations that exist, not the
  list that ran. Reading it — which is the obvious check — confirms all is well.
- **`scripts/deploy-checks.ts` § `migrationState()` repeated the watermark test**, so it
  called unreachable entries "not pending" for exactly the same reason the migrator
  skipped them. A check that shares an assumption with the code under test cannot fail
  where the code fails.
- **The schema drift checker does not cover this.** `src/db/schema-drift.ts` says in its
  own header that it does not look at indexes, constraints or back-fills — which is three
  of the four effects above.

## The fix

**The repair**, in [`scripts/db-repair-migration-ledger.ts`](../../scripts/db-repair-migration-ledger.ts).
It reports by default and needs `--apply` to write. It reconciles only migrations it has
a written reconciliation for, and refuses anything else, because a blind replay is unsafe
— see below. Each reconciliation carries its preconditions, its DDL, and its
postconditions; the DDL, the ledger rows and the postcondition checks all happen inside
one transaction under an advisory lock, so a failed postcondition rolls the whole thing
back rather than leaving a database that disagrees with its own ledger.

**`0033_quotes` cannot be replayed verbatim, and this is the part worth remembering.**
Its last statement re-adds `revision_step_runs_step` with the step list as it stood
*before* `timeline` existed. Running it on a database that already has `0035_timeline`
fails on the first `timeline` row with a 23514 — and had it succeeded, it would have left
a constraint forbidding a step the pipeline still runs. So the reconciliation takes only
the column and lets `0036` install the correct final CHECK. **A migration is only
idempotent-safe in the order it was written**, and out-of-order repair has to be written
out by hand, per migration, or not attempted. GPT Sol found this;
[260831ag-migration-watermark-repair-sol.md](../plans/260831ag-migration-watermark-repair-sol.md) § 1.

**Where the repair differs from the historical SQL, the ledger row means something
weaker** than an ordinary drizzle row: *this database has been brought to this
migration's postcondition*, not *these bytes ran here*. Worth knowing when reading the
table later. On this laptop that applies to `0033`, `0034` and `0037`, whose columns had
arrived from a `drizzle-kit push` in another session rather than from the migrations —
their type, nullability and default were each checked against what the migration would
have built before anything was recorded as applied.

**The guard**, so the class cannot recur, is in `scripts/db-migrate.ts` — a preflight that
refuses before any DDL when the journal and the ledger cannot be reconciled, and in
particular when a pending entry's `when` does not clear the watermark; a postflight that
every journal entry has exactly one matching row; and an advisory lock, because drizzle
takes none and two migrators can read the same watermark. There is also a static test
that a new journal entry's `when` must exceed every entry before it, with the published
`0035`/`0036` inversion grandfathered rather than the rule weakened.

**A ledger check alone would not be enough**, and it is important not to mistake it for
the whole answer: it compares metadata against metadata, and the repair *writes* that
metadata, so a mistaken insert makes it green by construction. The targeted catalogue
probes — does the column exist, is the index gone, what does the constraint say — are
what actually prove the schema, and they stay.

## What would have caught it, and what still would not

Caught: the preflight above, on the first `db:migrate` after the watermark moved.

**Still not caught:** a migration that runs and does the wrong thing. Every check here
verifies that the named effect exists, not that it was correct to want it. And the
production database has not been examined at all — there are no credentials in the tree —
so the claim that `0036` is unreachable there is an inference from the timestamps, not an
observation. **Check it before migrating production**, and expect the preflight to refuse
the first time it runs there. That refusal is the guard working, not a reason to force it;
the runbook is in the Sol review § 5.
