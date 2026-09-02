# Concurrent migrations across worktrees

Parent work: [260828r-worktrees.md](260828r-worktrees.md). That plan's step 4 proposed a file-lock
"database lease" and an automated refusal on duplicate migration numbers. **Both are wrong**, and
this plan says why and what replaces them. Started 2026-09-02.

Greg, 2026-09-02, which is the whole brief:

> For duplicate migration-numbers, is there any reason why that's a problem? Can't we just run them
> both? Let's aim to make things robust so that multiple agents can be working in separate worktrees
> and things merge cleanly, where possible.

## The short answer to his question

Yes — **the database will run both**, because the migrator reads journal tags and two distinct tags
carrying the same number are two distinct migrations to it. Two worktrees can also mint a tidy `0052`
and `0053` and still fail. So refusing duplicate numbers is not sufficient, and the parent plan's
proposal is dropped.

But it is not wholly irrelevant either, and the first draft of this plan overstated that. Under the
current index layout the snapshot file is named from the **prefix alone**, so two `0052`s want one
`0052_snapshot.json` and the repository cannot hold both. Put precisely:

> Duplicate SQL-number prefixes are not a database invariant, but they are a metadata filename
> collision under drizzle's index layout.

Which is an argument for [stage 5](#5-migrationsprefix-timestamp-reduction-not-prevention) — change
the layout — rather than for a refusal.

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

**No resolver that edits only `_journal.json` can be correct.** Sorting the merged entries by `when`
and renumbering `idx` fixes the journal and leaves the chain forked — it would make a forked chain
*pass* the tests, which is worse than the conflict it removes. Snapshots are a linear chain and
drizzle has no notion of merging them.

*An earlier draft said "no journal-resolution script can be correct" and "the loser regenerates" full
stop. Both were too strong — a resolver that reconstructs the snapshot and the SQL from the merged
schema is correct, and regeneration is one such resolver but not a universally safe one. See
[stage 4](#4-the-regeneration-runbook-classified-by-what-the-migration-is).*

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

## What GPT Sol found, 2026-09-02, and why the stages below are not the ones first written

The first version of this plan had four stages and **each of them was materially wrong**. Sol's
review is in [260902c-concurrent-migrations-review-sol.md](260902c-concurrent-migrations-review-sol.md);
every blocking claim in it was checked here before being accepted, and one number in it was wrong.
The three that change the design:

**1. The proposed snapshot invariant is false on this repository right now.** Checked:

```
journal entries                     52
snapshot files                      50
entries with no snapshot            0003_reader_state_owner_fks, 0029_assets
chain break (prev id != next prevId)  0021 → 0022
npx drizzle-kit check                 "Everything's fine 🐶🔥", exit 0
```

So "every journal entry has a snapshot linked to the previous one" would go red on the real tree the
moment it was written — and `drizzle-kit check` is green on all of it, so it catches a *fork* and not
a *hole*. A validator needs the historical exceptions written down explicitly.

**2. Snapshots are named `<prefix>_snapshot.json`, not `<tag>_snapshot.json`.** This plan said `tag`.
The consequence is not cosmetic: two migrations sharing a numeric prefix share one snapshot *file*,
so the repository cannot hold both. That partly rehabilitates the parent plan's instinct — duplicate
numbers are not a database problem, but under the index layout they are a **metadata filename
collision**, which is a different and real thing.

**3. "Regenerate on the trunk's last snapshot and the DDL is right" is already known to be false
here**, and it is written down in a migration. [`drizzle/0030_drop_summary_steer.sql`](../../drizzle/0030_drop_summary_steer.sql):

> `drizzle-kit generate` wrote three more statements than this and all three were wrong.
> `0029_assets.sql` is hand-written and has no `meta/0029_snapshot.json`, so the newest snapshot
> drizzle could diff against was 0028 — which predates the assets column and the widened step CHECK.
> It therefore re-emitted both, and applying them failed on
> `column "assets" of relation "article_revisions" already exists`.

This repo has already lived the exact failure that unconditional regeneration would cause. The fix
recorded there — keep the generated snapshot so the next generate diffs against reality — is the
precedent stage 2 has to follow.

## Built, 2026-09-02

Stages 1–5. Stage 6 is a plan of its own and stage 7 was never going to be built.

Reviewed twice more after the plan review: by Fable before building
([260902c-concurrent-migrations-review-fable.md](260902c-concurrent-migrations-review-fable.md)) and
by GPT Sol on the finished code
([260902c-concurrent-migrations-code-review-sol.md](260902c-concurrent-migrations-code-review-sol.md)).
**The code review found more than the plan review did, which is the argument for weighting it
higher.** Four High findings and five Medium, every one of them real, and the most important could
not have been visible at plan stage: the wrapper checked the snapshot chain *after* drizzle ran, so a
folder that was already holed would produce a bad-but-complete migration — all three artefacts
present, postcondition satisfied. That is the `0029 → 0030` failure exactly, caught after the damage.
It is a precondition now, and it refuses without generating.

| | |
|---|---|
| [`scripts/migration-snapshots.ts`](../../scripts/migration-snapshots.ts) | `readSnapshots` and `snapshotProblems` — nine checks over `drizzle/meta/`, plus `HISTORICAL`, the three exceptions with a reason on each. |
| [`tests/migration-snapshots.test.ts`](../../tests/migration-snapshots.test.ts) | The real folder green, the exception list pinned in both directions, and eleven fixtures showing it refuse. |
| [`scripts/db-generate.ts`](../../scripts/db-generate.ts) | `npm run db:generate` now requires a `.sql`, a snapshot **and** a journal entry, or an explicit `--allow-empty`. |
| `npm run db:chain` + [`scripts/check.ts`](../../scripts/check.ts) | `drizzle-kit check` is a gate on the branch, not only at the deploy. ~2 s, offline. |
| [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) | Warns on a broken chain. **A warning, not a refusal** — see below. |
| [`drizzle.config.ts`](../../drizzle.config.ts) | `migrations.prefix: "timestamp"`. |
| [`tests/db-step-constraint.test.ts`](../../tests/db-step-constraint.test.ts) | Reads journal order rather than sorting filenames; the `/^\d{4}_/` assertion is gone. |
| [database.md § Two worktrees generated at once](../project/database.md#two-worktrees-generated-at-once) | Stage 4's runbook. |

**Four things came out different from the plan, and each is an improvement Fable's review or the
building found:**

- **Stage 2's own checklist was missing the check the stage exists for.** Its six bullets never
  included "every journal entry has a snapshot", and the chain-link check cannot stand in for it,
  because the physical chain **splices cleanly over both holes** — `0004`'s parent is `0002` and
  `0030`'s is `0028`. A validator built exactly from the bullets would have passed a future
  `0029`-shaped hole, which is the incident the stage cites as its own precedent. Found by Fable.
- **It is not in `journalProblems`, and could not usefully have been.** That function is
  `(journal, hashes)` and pure, called from inside `reconcileLedger`; snapshots would mean changing
  two signatures and every caller. It is a sibling function instead, mirroring the module's own
  `readJournal`/`hashMigrationFiles` split.
- **`db:migrate` warns rather than refuses.** A forked chain does not make a migration wrong —
  `migrate()` never opens a snapshot — so refusing would block safe pending SQL over a defect it has
  nothing to do with. `db:generate` refuses, which is where it bites.
- **`HISTORICAL` is exported production code, not a test constant**, unlike `GRANDFATHERED` in
  `tests/migration-journal.test.ts`. That one is only ever called from a test; this one also runs in
  the preflight, and a preflight whose "green" silently means "two known holes" is not auditable.

**And one hole was written and then found in the wrapper itself**, which is worth recording because
it is this plan's own subject turned on its author. The first `db:generate` returned early on
`--allow-empty` when nothing had been written — and a forked chain makes `generate` refuse and exit 0
*without* printing "No schema changes", which at that level is indistinguishable from an honest
no-op. So the flag printed a green ✓ over a red `Error:`. The fix is that the folder-wide check runs
first and unconditionally; verified by forking `drizzle/meta/` for a minute and watching it go from
✓ to exit 1 naming the fork four ways.

**Both halves of the central claim were reproduced before anything was built** (a copy of `drizzle/`
with a second snapshot claiming `0051`'s parent): `check` names both files and exits 1, `generate`
prints the same red `Error:` and exits **0**, writing nothing. And the timestamp prefix was run for
real before the config changed — `20260902084631_proving_the_prefix.sql`, its snapshot sorting after
`0051_snapshot.json`, `when` still `Date.now()`, `idx` still contiguous.

## What we are going to do

Reordered on Sol's recommendation: **snapshot safety before the prefix change**, because timestamps
reduce one collision shape and detect no corruption at all.

### 1. `drizzle-kit check` becomes a gate

It exits 1 on a forked chain, it is green on this tree today, and only
[`scripts/deploy.ts:444`](../../scripts/deploy.ts) runs it. Put it in
[`scripts/check.ts`](../../scripts/check.ts) so a fork is caught on the branch rather than at the
deploy. One line, no new machinery, and it is the cheapest thing here.

**It does not cover the holes** — it is green with `0003` and `0029` missing. That is stage 2.

### 2. A snapshot validator, with the historical exceptions written down

In `journalProblems` (so `db:migrate`'s preflight sees it) plus `tests/migration-journal.test.ts`.
Not the naive walk this plan first proposed. It must check:

- every non-underscore entry under `meta/` is parsed, because drizzle does — not just `*_snapshot.json`
- snapshot prefixes and `id`s are unique, and no two snapshots share a `prevId`
- every physical snapshot maps to exactly one journal prefix, and journal prefixes do not collide
- snapshot filenames in lexical order follow the journal's order for those entries
- after the historical exceptions, each snapshot links to the preceding physical one
- the lexically last snapshot is the intended terminal one

**The three exceptions are named constants with the reason attached**, in the shape of the existing
`GRANDFATHERED` inversion list — which is already the repo's pattern for exactly this, and already
has a test pinning it so it cannot quietly grow.

**What this still cannot prove**: that a snapshot's *contents* match the SQL or `schema.ts`. A stale
but structurally perfect snapshot passes. That is stage 3's job.

**Proving it** — fixtures that go red for a fork, a missing snapshot, a duplicate `id`, a self-loop
masked by duplicate ids, and a renamed old snapshot that becomes lexically last. The real `drizzle/`
must stay green. Sol listed those cases because the naive walk passes every one of them.

### 3. Wrap `db:generate` so success means output

The root failure is that `drizzle-kit generate` can exit 0 having written nothing — on a forked
chain, and on the other no-output paths. A wrapper that requires a new journal entry, a new `.sql`
**and** a new snapshot, or an explicitly acknowledged no-op, closes the whole class rather than the
one case we found. This is the stage that would have caught `0029`.

### 4. The regeneration runbook, classified by what the migration is

"The loser regenerates" was too broad. Regeneration is lossy or forbidden depending on the migration:

| | |
|---|---|
| unpublished, purely generated | regenerate — the simple case, and the common one |
| unpublished, hand-edited or custom-only | **keep the original SQL unconditionally**; regenerate only the schema part and re-apply the custom part by hand. Ordinary `generate` may say "no schema changes" and produce no replacement at all |
| applied only to the shared local Postgres | preserve it and regenerate the other side, or reset — **Greg's call**, per [AGENTS.md](../../AGENTS.md) |
| **applied to production** | **never delete, restamp or regenerate.** Published migrations are immutable; the repair is a new forward migration |

Also: drizzle asks whether a thing was renamed or dropped-and-recreated, and answering differently on
the regenerate produces different and possibly destructive SQL. And "keep a copy if you hand-edited
it" is too weak — always retain the original path for comparison.

The journal conflict itself is still resolved by taking the trunk's file wholesale
(`git show origin/dev:drizzle/meta/_journal.json > drizzle/meta/_journal.json` — a file write, not a
`git checkout`, so it stays inside the house rules).

### 5. `migrations.prefix: "timestamp"` — **reduction, not prevention**

Drizzle's timestamp is `slice(0, 14)` of the ISO string — `YYYYMMDDhhmmss`, **one-second
resolution**. Two agents generating in the same second still write the same
`<timestamp>_snapshot.json`, and different migration *names* only separate the `.sql` files, because
the snapshot uses the prefix alone. So this greatly reduces collisions and does not eliminate them,
and the plan must not say otherwise.

Mixing with the existing index-prefixed files is otherwise sound: `0051_` sorts before `2026…_`,
lexical order stays chronological through year 9999, and the migrator reads journal order rather than
directory order. **The dangerous case is a rename** — drizzle picks the lexically last snapshot as
its diff base, so a renamed old snapshot can become "latest" while the metadata still looks valid.
Stage 2's "lexically last snapshot is the intended terminal one" check is what catches that.

One dependent, and the repo sweep for it was right: `tests/db-step-constraint.test.ts` sorts `.sql`
filenames and asserts `/^\d{4}_.*\.sql$/`. It must read journal order and drop the `\d{4}`.

### 6. Locking moves to its own plan

The shared/exclusive lock across migrate, reset and test runs is a separate piece of work and is
**not** a prerequisite for the above. What this plan hands it, so the thinking is not lost:

- **The seam is `globalSetup`, not `pgReady`.** One shared lock per Vitest invocation, released by
  global teardown: one session per `npm test` rather than per file, it covers the suites that
  hand-roll their readiness probes, and it changes no callers. Checked — `pgReady` has 67 caller
  files (Sol said 65), but `blocks-baseline`, `checkpoints-durable-resume`, `glossary-ideas-baseline`,
  `public-visibility-pg` and `store-checkpoints` reference it **zero** times, so the `pgReady` seam
  would have missed real database activity in silence. The count was wrong and the finding was right.
- **Wait with a deadline, and no cycles**: a test holding the shared lock must never wait on a
  migration subprocess needing exclusive. Start at 120 s, matching the repo's measured run-lock
  budget; `lock_timeout` applies to advisory acquisition; time out loudly.
- **Session locks need a direct or session-pooled connection**, which is why
  [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts)'s existing refusal of the transaction pooler
  on 6543 becomes load-bearing rather than incidental.
- **`db:reset` stays a manual stop-the-world operation** needing Greg's approval, and **must not
  claim lock protection**. `supabase db reset` kills the lock holder, which leaves an unprotected
  window in which a test run or another migration can enter, plus a gap between reset and migrate,
  plus tests that probe an empty schema, skip, and report green. Only a coordinator that survives the
  reset and holds across reset-migrate-reseed would fix that, and there is no reason to build one yet.

### 7. Not doing: refusing duplicate numbers

Still dropped, but the reasoning is now narrower than this plan first claimed — see Sol's finding 6,
recorded under [Corrections](#corrections-this-plan-makes-to-what-was-believed).

## What a lease cannot do

A non-additive migration — a dropped column — applied by one worktree breaks the running dev server
of every other worktree. That is inherent to one shared database, and it belongs in
[worktrees.md](../project/worktrees.md) as a stated limit rather than something the lock pretends to
cover.

## What the wider world does, researched 2026-09-02

Greg asked for this before deciding. Every link below was checked rather than taken from the report.

**Stage 3 (timestamp prefixes) is the oldest fix there is.** Rails moved from `001_` to timestamps in
2.1 for exactly this reason — collisions between developers on different branches.

**Stage 2 (the loser regenerates) is the de facto drizzle answer, and there is no official tool.**
[drizzle-orm discussion #1104](https://github.com/drizzle-team/drizzle-orm/discussions/1104), "Best
way to deal with migration merge conflicts?" — 13 comments, answered 2024-10-02, with a maintainer
saying to customise it per team. The official
["migrations for teams"](https://orm.drizzle.team/docs/kit-migrations-for-teams) page is **literally
a stub**: "This section will be updated right after our release of the next version of migrations
folder structure." Checked by fetching it.

**And the linear approach is a defensible choice, not a poor relation.** Alembic (`alembic merge`,
`down_revision = ('rev_a','rev_b')`) and Django (`makemigrations --merge`) model migrations as a DAG
and create an explicit merge node, keeping both branches. Drizzle's flat journal and linear snapshot
chain cannot express that, so regenerate-and-delete is the only structurally available option here —
**but** Adam Johnson, who maintains `django-linear-migrations`, argues forced-linear is *better* even
where the DAG exists: merge migrations do not guarantee the same execution order across environments,
so staging stops simulating production. Part of the Django world picks our approach on purpose.

**Stage 1 fills a gap other tools close natively** — Alembic refuses on multiple heads, Django
refuses with "multiple leaf nodes", and Prisma 8's migration graph anchors each migration to real
schema states, which is structurally the same idea as walking `prevId`. Nobody says "don't check
this"; they say "our tool does it for you".

And our `exit(0)` sits in a **known, unfixed family**:
[drizzle-orm#5774](https://github.com/drizzle-team/drizzle-orm/issues/5774) — *"drizzle-kit generate
derives idx from journal alone — prefix collision + silent snapshot overwrite when journal is stale
vs on-disk SQL"* — open since 2026-05-17 with **zero comments**. Verified via `gh`. The exact
`exit(0)`-on-forked-snapshot behaviour is not filed verbatim anywhere; we found it by reading
`bin.cjs`. Worth filing upstream.

**Stage 4 needs one correction to its wording.** Rails has locked migrations since 5.2
(`ActiveRecord::ConcurrentMigrationError`) and Flyway does by default; Django's core `migrate` does
not, needing `django-pglocks`. So a single **exclusive** lock per migrator is the majority pattern.
**The shared/exclusive split for test-runs-against-migrate is ours**, found in general Postgres
how-tos and in no migration tool's playbook. Sound use of the primitive; do not write "standard" next
to it.

**The pooler trap is real and we are already clear of it.** Rails + PgBouncer in transaction mode is
the textbook failure: session-scoped advisory locks break because the unlock can land on a different
backend. [`scripts/db-migrate.ts`](../../scripts/db-migrate.ts)'s header already requires a direct or
session connection and never the transaction pooler on 6543 — so this is a reason that rule must
*stay*, and stage 4 should say so rather than rediscover it.

**Watch, do not build against**:
[Commutative Migrations](https://github.com/drizzle-team/drizzle-orm/discussions/5005) (2025-10-31)
would have drizzle-kit detect that two branches' migrations touch different tables and merge them
automatically. Undocumented and unreleased as far as we can confirm. If it ships, stages 1–3 get much
smaller.

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

Kept in the order they were made, because the sequence is the point: three of these are corrections
*of corrections*, and each round was confidently stated.

**About the parent plan:**

- Its step 4 lease **exists already**, as a Postgres advisory lock in `db-migrate.ts` rather than
  something to build on `scripts/lockfile.ts`. The weaker primitive was about to be built next to the
  better one.
- Its duplicate-number refusal is not sufficient — but **not irrelevant either**, which this plan's
  first draft got wrong in the other direction. Under the index layout a duplicate number is a
  snapshot *filename* collision.

**About this author's own claims, in order:**

- "There is no duplicate-migration-number refusal" — understated. `journalProblems` and
  `reconcileLedger` already enforce better invariants than a number check.
- "The silent-failure class is closed" — closed on the ledger side, **open on the snapshot chain**,
  and the open one exits 0. Found by Fable.
- "Timestamp prefixes make order inversions structurally impossible" — wrong. Journal order is array
  order, and after a merge that is whatever the resolver wrote.
- "…what makes an inversion impossible is the loser regenerating, because a fresh `when` is later
  than everything" — **also wrong**, and this was the correction to the previous line. `when` is
  `Date.now()`, so it is later than everything only if the clock is not behind and no later-stamped
  branch merges concurrently. Regeneration makes inversions *loud*, via the existing check. Nothing
  here makes them impossible.
- "There is no journal-resolution script that can be correct" — too strong. No resolver that edits
  **only the journal** can be; one that reconstructs the snapshot and SQL from the merged schema can.
- "The loser regenerates" — too broad. Lossy for hand-edited or custom-only SQL, and **forbidden for
  anything applied to production**, where the repair is a new forward migration.
- The proposed stage-1 invariant — **would have failed on the real tree the day it was written**,
  because two snapshots are missing and the chain already breaks at `0021 → 0022`.
- `<tag>_snapshot.json` — it is `<prefix>_snapshot.json`.
- The proposed proof for the lock was **backwards**: "change the key on one side and everything
  passes" proves the protection test is missing, not that the protection works. Under that mutation
  an overlap assertion must fail. That is [silent-success.md](../reusable/silent-success.md) applied
  to a proof this plan wrote while quoting silent-success.md.

**About Sol's review**, since it is not infallible either: it says `pgReady` has 65 caller files.
It has 67. The finding that number was supporting — that five DB-backed suites reference `pgReady`
zero times, so the seam would miss them — is correct, and was the reason to move the seam.
