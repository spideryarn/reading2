# A migration edited after the shared database ran it

On 2026-10-31 the box's readiness loop failed every tick from 05:40Z to at least 09:20Z, before the
suite started, so no commit was checked for about five hours. Production was never affected and
nothing reached a reader: the deploy at 06:53Z (`5aab73ec`) applied only the final file, and
production's ledger row for it holds the current file's hash (checked read-only, below). The shared
local Supabase on the box was the only casualty. The fix was a one-row ledger restamp.

## What happened

```
✗ the journal and this database's migration ledger do not reconcile
• 20261030220450_chat_thread_origin_sources_digest_and_summary was applied from different SQL than
  the file now contains — a migration file was edited after it ran
```

- **`a9386ceae`** (00:27Z, on the unpushed branch `worktree-fbvqmfrs-sources-digest`) added
  `drizzle/20261030220450_chat_thread_origin_sources_digest_and_summary.sql`. That worktree's own
  `db:migrate` applied it to the shared database at `127.0.0.1:54362`, which every tree on the box
  uses. Ledger row 252 was written with hash `8e6358e4…`, the sha256 of that version.
- **`6bbf15b9c`** (02:37Z, the same branch, "GPT Sol's review and its fixes") edited the file. It
  added one statement before the constraint changes,
  `UPDATE chat_threads SET origin_mode = null WHERE origin_mode = 'summary'`, so the new
  `chat_threads_origin_summary` CHECK could not fail on a row the old schema had admitted. It also
  added a trailing newline. The new hash is `234b1915…`.
- Merge `938cd3c5` brought both commits to `dev` at 02:39Z. So **the file was never on `origin/dev`
  in its first form.** The only database that ran that version was the shared one.
- The readiness run at 02:42Z was on `77e802b7`, which predates the merge, and it passed. Its next
  tick, at 05:40Z, picked up the merge, and `db-migrate.ts`'s preflight (rule 4, the hash) refused.
  The same refusal waits for any tree on the box that runs `db:migrate`.

## The class: the shared local database is a publication, and nothing treats it as one

The rule "never edit a migration once it has run" is widely understood. Everyone here reads "once
it has run" as "once it is on `origin/dev`", or "once production has it". On this box, a migration
has *run* the moment any worktree calls `db:migrate`, because every worktree migrates the same
Postgres. That is the moment it is published. Pushing comes later, review comes later, and the edit
came in between.

It is the same shape as
[database.md § Rule 4 on a laptop](../project/database.md#rule-4-on-a-laptop-the-draft-that-ran-and-the-file-that-was-committed)
(2026-09-01): a database ran a draft, and the file was tidied before anyone else saw it. The only
difference is that the database belongs to everyone on the box instead of one laptop. So the cost
lands on whoever migrates next, not on the author.

## Why nothing went red

- **The author's `npm test` was green**, and correctly so. The suite runs against private test
  databases that are migrated fresh from the current files, so their hashes always match. Nothing
  in the suite reads the shared ledger.
- **`npm run db:check` was green**, and still is. It compares the live schema with `schema.ts`, and
  the schema really is right. The edit added a data statement, not DDL.
- **The reviewer that made the edit could not know the file had already run.** The statement it
  added is right for any database that has not run the migration yet, production included. A
  reviewer with only the diff in front of it has no way to see the shared ledger.
- **The preflight did go red**, and it is the only check that could. But it runs only when somebody
  migrates, and it reports to whoever that is: here, the readiness loop, two hours later and in a
  different tree.

## What was done to the local database

The two versions differ in one `UPDATE` and a trailing newline. Every DDL statement is byte-identical.
So the schema the shared database has *is* the current file's end state, and the work is to prove
that and then correct the bookkeeping. Re-running the `UPDATE` would have been wrong: two
`summary`-origin threads with valid `ss-` ids had been created since, and it would have stripped
their origins.

Following the remedy in database.md (probe the postconditions in the catalogue, then restamp):

1. Checked that all the constraints in the file exist with exactly the file's expressions and
   `convalidated = true`: `chat_threads_origin_mode`, `_item`, `_summary` and `_sources_digest`. Also
   checked that every `summary` or `sources-digest` row carries a shaped id (2 of 2 each).
2. `UPDATE spideryarn_migrations.__drizzle_migrations SET hash = '234b1915…' WHERE id = 252 AND
   created_at = 1793397890262 AND hash = '8e6358e4…'`, which updated one row.
3. `npm run db:migrate` in the readiness-checks tree: `Target: postgresql://postgres@127.0.0.1:54362/postgres`,
   `Nothing pending`, `✓ migrations applied`. `npm run db:check`: `✓ no schema drift`.

Production, read-only: the row with `created_at = 1793397890262` has hash `234b1915…`, the current file.

## What would have caught it, ranked by ease against value

**Items 1 and 2 were both built on 2026-10-31** (Greg: *"Use your judgment"*, reply spya-fpdjgq to
q-swc9st): the sentence is in
[database.md § Rule 4](../project/database.md#rule-4-on-a-laptop-the-draft-that-ran-and-the-file-that-was-committed),
and the test is [tests/migration-shared-ledger.test.ts](../../tests/migration-shared-ledger.test.ts),
watched going red on a reproduction of this edit —
[plan 261031e](../plans/261031e-a-test-that-the-shared-database-never-ran-a-different-version-of-a-migration-file.md).

1. **A sentence in database.md**: "a migration has run once any tree on the box has migrated, so a
   review fix to one is a new migration". Costs nothing, and it is the belief that was wrong. But it
   is prose, so it erodes. Written on 2026-10-31, as worded in q-swc9st, on Greg's "use your judgment".
2. **A live test of rule 4 against the shared database.** It would read `DATABASE_URL`'s ledger and
   fail on any journal entry whose applied hash differs from the file, with the message "this
   migration has already run on the shared database; write a new one". The author would have seen
   it red on the next `npm test` after the edit, in their own tree. Cost: one test, plus a decision
   in the test-database registry (`tests/store-migration-registry.ts`) about a test that reads the
   shared database rather than a private one. Built on 2026-10-31 as
   `tests/migration-shared-ledger.test.ts`.
3. **A git rule: refuse a change to any `drizzle/*.sql` that already exists at `HEAD`'s
   merge-base with `origin/dev`.** This was the first idea, and **it would not have caught this
   incident**: the file was never on `origin/dev` before the edit. A stricter version, "no
   migration file is modified by any commit after the one that added it", would have caught it. But
   it also forbids revising a migration nobody has run, and it needs a grandfather list for history.
   Rejected as the first move.
4. Giving each worktree its own database: rejected. It is a large change to the box's one-Supabase
   design, and it would hide the problem from the author instead of showing it to them.

## The fix that is right for the long term

What shipped is a restamp, which is correct here only because every DDL statement was identical. If
an edit changes DDL, a restamp would record a schema the database does not have. Then the remedy is
to bring the schema to the new end state by hand, probe it, and restamp, exactly as database.md
says. The real long-term fix is item 2, now built: the author finds out within minutes, in their own
tree, while the edit can still be turned into a second migration.

## The thing I would tell myself

The reviewer was right about the SQL and wrong about where it was. "Has this run anywhere?" is a
question about the database, not about git, and on this box the answer becomes yes long before the
push.
