# GPT Sol's review of 260902c

The plan is [260902c-concurrent-migrations-across-worktrees.md](260902c-concurrent-migrations-across-worktrees.md).
Run 2026-09-02, `gpt-5.6-sol` at high effort, ~23 minutes, with the drizzle-kit exit codes,
`journalProblems`, `reconcileLedger` and the prefix-dependent test pasted in as evidence.

**Every blocking finding was checked against the tree before being accepted, and all of them held.**
One number did not: it says `pgReady` has 65 caller files and it has 67 — the finding that number
supported is still right. Verbatim below.

---

## Verdict

**Do not build this plan as written.** The core diagnosis is right—forked snapshots are dangerous, and Drizzle’s generate path exits 0—but Stages 1, 2, 3, and 4 each contain a material error.

## Findings

### 1. Blocker: Stage 1’s proposed invariant is false in this repository

Snapshots are named `<prefix>_snapshot.json`, not `<tag>_snapshot.json`. Drizzle writes the prefix alone at [bin.cjs](/Users/greg/dev/spideryarn/reading2/node_modules/drizzle-kit/bin.cjs:32926).

More importantly, the real repository has:

- 52 journal entries but only 50 snapshots.
- No snapshot for `0003_reader_state_owner_fks` or `0029_assets`.
- A dangling historical link: `0022_snapshot.prevId` is not `0021_snapshot.id`.

The missing `0029` snapshot was intentional and already caused the next generation to re-emit its DDL; [0030 documents the repair](/Users/greg/dev/spideryarn/reading2/drizzle/0030_drop_summary_steer.sql:9). `npx drizzle-kit check` nevertheless currently prints “Everything’s fine” and exits 0.

Therefore “every journal entry has a snapshot linked to the previous journal entry” would fail the real tree immediately.

A correct validator needs exact historical exceptions, plus these checks:

- Parse every non-underscore entry under `meta/`, because Drizzle does—not merely `*_snapshot.json` files ([bin.cjs](/Users/greg/dev/spideryarn/reading2/node_modules/drizzle-kit/bin.cjs:8127)).
- Snapshot prefixes and IDs are unique.
- Every physical snapshot maps to exactly one journal prefix; journal prefixes cannot collide.
- Snapshot filenames, lexically sorted, follow the same order as the corresponding journal subsequence.
- No two snapshots share a `prevId`.
- Every new snapshot after the historical exceptions links to the preceding physical snapshot.
- Version and dialect are valid.
- The lexically last snapshot is the intended terminal snapshot.

Even that does not prove snapshot contents correspond to the SQL or current `schema.ts`. A stale but structurally perfect snapshot passes. The generator needs a postcondition as well.

Cases the proposed walk could pass incorrectly include duplicate `id`s, a self-loop masked by duplicate IDs, a stale snapshot body, a renamed old snapshot that becomes lexically last, or two journal tags sharing one prefix/snapshot.

### 2. Blocker: “the loser regenerates” is only correct for unpublished schema migrations

The accurate claim is:

> No resolver that edits only `_journal.json` can be correct.

A resolver can be correct if it reconstructs the snapshot and SQL from the merged schema—the proposed regeneration is one such resolver.

But regeneration is unsafe or lossy when:

- The SQL contains a data backfill, grants, functions, `NOT VALID`, RLS, or another hand edit.
- It is a custom-only migration: ordinary `generate` may produce “No schema changes” and no replacement.
- Drizzle asks whether something was renamed versus dropped and recreated; different answers can generate destructive SQL.
- The trunk’s terminal snapshot is stale or missing. The `0029`/`0030` incident proves “trunk’s last snapshot therefore makes the DDL right” is not an invariant.
- The migration has reached production. Published migrations must be immutable; regenerating changes its timestamp/hash and creates divergent history. With one real production database, the repair must be a new forward migration.

The runbook should classify the migration first:

1. Unpublished and purely generated: regenerate.
2. Unpublished but hand-edited/custom: preserve the old SQL unconditionally, regenerate the schema portion, and manually review/reapply the custom portion.
3. Applied only to shared local Postgres: either preserve that migration and regenerate the other side, or reset with Greg’s approval.
4. Applied to production: never delete, restamp, or regenerate it.

“Keep a copy if hand-edited” is too weak. Always retain the original commit/path for comparison.

### 3. High: Timestamp prefixes reduce collisions; they do not make them impossible

Drizzle timestamps have **one-second resolution**:

```ts
new Date().toISOString()...slice(0, 14)
```

([bin.cjs](/Users/greg/dev/spideryarn/reading2/node_modules/drizzle-kit/bin.cjs:30615))

Two agents generating during the same second still write the same `<timestamp>_snapshot.json`. Different migration names only separate their SQL files; snapshots use the prefix alone. `drizzle-kit drop` also derives the snapshot path from `tag.split("_")[0]` ([bin.cjs](/Users/greg/dev/spideryarn/reading2/node_modules/drizzle-kit/bin.cjs:91778)).

So change the wording to “greatly reduces collisions.”

Mixing existing prefixes with timestamps is otherwise sound under enforced filename order:

- `0051_` sorts before `2026…_`.
- Years 2100–9999 retain chronological lexical order.
- The ORM migrator reads journal order, not directory order ([migrator.cjs](/Users/greg/dev/spideryarn/reading2/node_modules/drizzle-orm/migrator.cjs:36)).

The dangerous case is a rename: Drizzle blindly picks the lexically last snapshot as its base ([bin.cjs](/Users/greg/dev/spideryarn/reading2/node_modules/drizzle-kit/bin.cjs:19862)). A renamed old snapshot can become “latest” while the linked-list metadata remains superficially valid.

The repo sweep found `tests/db-step-constraint.test.ts` as the only current project-code filename-sort consumer, so that part of the audit was good.

### 4. Blocker: The reset lock disappearing mid-reset is not acceptable

Once reset kills the lock holder:

- A new test run can enter during the reset.
- Another migration can enter during the reset.
- There is an unprotected interval between `db:reset` and `db:migrate`.
- Tests can probe the empty schema, skip, and let a run look green.

The reset also loses more than “everyone’s local articles”: local users and storage state are included in the shared contents at risk. The repo explicitly says reset empties the database and replays nothing ([supabase-local.md](/Users/greg/dev/spideryarn/reading2/docs/project/supabase-local.md:290)).

Keep reset as an explicit stop-the-world maintenance operation requiring Greg’s approval. Do not claim advisory-lock protection unless an external coordinator survives the reset and stays held across reset, migration, and reseeding.

### 5. High: Hooking the lock into `pgReady` does not cover the test suite

The current count is 65 caller files, not 67. More importantly, several genuinely DB-backed suites hand-roll their readiness probes, including `blocks-baseline`, `checkpoints-durable-resume`, `glossary-ideas-baseline`, `public-visibility-pg`, and `store-checkpoints`.

Thus the proposed seam silently misses DB activity.

Holding one extra session per test file also multiplies connections across concurrent worktrees and creates hidden cleanup obligations. A simpler and stronger design is one shared lock per Vitest invocation using `globalSetup`, released by global teardown. That:

- Uses one session per `npm test`, not per file.
- Covers hand-written readiness probes automatically.
- Makes “N holders” mean N test processes.
- Avoids changing 65 callers.

Session locks must use a direct or session-pooled connection. PostgreSQL releases them when the session ends, and shared locks conflict only with exclusive locks as expected. [`lock_timeout` applies to advisory-lock acquisition](https://www.postgresql.org/docs/17/runtime-config-client.html), while session-lock lifetime and cleanup are documented under [PostgreSQL advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS).

Waiting is reasonable only with a deadline and a no-cycle rule: a test holding the shared lock must never wait for a migration subprocess that needs exclusive access. Start with **120 seconds**, matching the repository’s already measured run-lock budget, set per session, and keep `statement_timeout` either disabled or larger. Time out loudly.

The proposed proof is backwards: changing one key and seeing “everything passes” proves the protection test is missing. Under that mutation, an overlap/timing assertion must fail.

### 6. Medium: “Two 0052s can be fine” conflates database behavior with metadata behavior

The ORM migrator can run two distinct tags carrying the same numeric prefix because it reads journal tags. But with index naming, two generated `0052`s both own `0052_snapshot.json`; the repository cannot preserve both snapshots.

Therefore duplicate-number rejection is not sufficient, but under the current prefix it is not wholly irrelevant either. Say:

> Duplicate SQL-number prefixes are not a database invariant, but they are a metadata filename collision under Drizzle’s index layout.

### 7. Medium: A fresh `when` is not guaranteed to be later than everything

`when` is `Date.now()`. It is later than the journal only if the machine clock is not behind and no later-stamped branch is merged concurrently. The existing inversion check makes failures loud; regeneration does not make them impossible.

## Recommended order

1. Make `drizzle-kit check` a non-optional gate now. It is already green and catches the ordinary fork.
2. Add a correct snapshot validator with exact historical exceptions, ID/prefix uniqueness, physical-order checks, and tested fork/missing/duplicate-ID/renamed-terminal fixtures.
3. Wrap `db:generate` so success requires a new journal entry, SQL file, and snapshot—or an explicit acknowledged no-op. This closes Drizzle’s other exit-0/no-output paths directly.
4. Write the classified regeneration runbook, with production immutability explicit.
5. Switch to timestamp prefixes, described as collision reduction rather than prevention.
6. Move test/migration locking into a separate plan; use one shared lock per Vitest run.
7. Leave reset manual until there is a coordinator that survives it.

Snapshot safety should precede the prefix change: timestamps reduce one collision shape but do not detect corruption and can still collide within a second.

No files were changed.