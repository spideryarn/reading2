# A test that the shared database never ran a different version of a migration file

Status: planned, 2026-10-31. Answers question
[q-swc9st](../user-feedback/questions/q-swc9st.md); the incident is
[261031a](../postmortems/261031a-a-migration-edited-after-the-shared-database-ran-it.md).

> Use your judgment.
>
> — Greg, 2026-10-31, reply spya-fpdjgq to q-swc9st

## The problem, in two lines

On the box every worktree migrates one shared Postgres, so a migration has *run* the moment any tree
calls `db:migrate`, long before it is pushed. On 2026-10-31 a review edited a migration that the
shared database had already run; nothing in the author's tree went red, and the next tree to migrate
(the readiness loop, two hours later) refused for five hours.

## The choice

Of the question's four options, this builds **A** (a test), and adds B's sentence as the "why" next to
the existing rule-4 section of [database.md](../project/database.md) — so it is **C**, the
recommendation. Greg's "use your judgment" was given against the question that quoted B's wording,
so the sentence goes in as written there.

Passed over:

- **B alone**: prose, which is what was already believed and was wrong in the incident.
- **A git rule on edits to `drizzle/*.sql`**: the obvious form misses this incident (the file was not
  on `origin/dev` when edited); the strict form forbids revising a migration nobody has run.
- **A per-worktree database**: a large change to the box, and it hides the problem from the author.
- **Making `npm test` run `db:migrate`'s whole preflight** against the shared database: that also
  judges watermarks, pending entries and orphan rows, which on a shared database belong to *other
  trees'* unpushed work and would turn everyone's suite red over someone else's branch. Only rule 4
  — "a row the shared database stamped with this file's `when` carries this file's hash" — is a fact
  about *this tree's* files.

## What gets built

1. **`appliedFromDifferentSql(journal, hashes, rows)`** in
   [`scripts/migration-ledger.ts`](../../scripts/migration-ledger.ts): pure, returns one problem per
   journal entry whose ledger row(s) carry a hash different from the file. It reuses
   `matchJournalToLedger` and the existing private `hashProblem`, so the comparison is the same one
   `db:migrate`'s preflight makes (condition 4) and cannot drift from it. Entries with no row (not
   yet applied, e.g. this tree's own new migration) and rows with no entry (other trees' unpushed
   work) are deliberately not its business.
2. **Unit tests** for it in `tests/migration-ledger.test.ts`, including the 261031a shape: the same
   `when`, the file grown by one `UPDATE` and a trailing newline.
3. **A live test, `tests/migration-shared-ledger.test.ts`, in the `shared-services` lane** (the lane
   whose files run against the stack's own `postgres`, which is the shared database; its setup file
   already asserts it really is `postgres` on this stack, and scrubs a hosted URL's password so it
   cannot reach a remote). It:
   - gets its connection through `pgReady({ tables: [ledger], keepPool: true })`, which **throws**
     when the database is unreachable or has no ledger table, so it can never report green without
     having read the ledger;
   - asserts the ledger matched at least one journal entry (an empty or wrong ledger is not a pass);
   - **positive control on the live rows**: perturbs one matched entry's hash in a copy of the map
     (as an edit would) and asserts the function reports it, so a broken read or a comparison that
     never fires turns the test red rather than vacuously green;
   - asserts `appliedFromDifferentSql` on the real files is empty, failing with: "this migration has
     already run on the shared database; put the file back and write a new migration for the change
     — or, if you did not edit it, merge origin/dev", plus a pointer to database.md.
   It reads only; it writes nothing to any database.
4. **`TEST_LANES`** gets the file under `shared-services`; the lane scan requires it anyway.
5. **Docs**: B's sentence and a pointer to the test in database.md § Rule 4 on a laptop (and the
   postmortem's ranked list updated to say item 2 was built); testing.md if it lists shared-lane
   files.

## Watching it fail

- the unit cases go red before `appliedFromDifferentSql` exists (it is written test-first);
- the live test, run once in this worktree with a byte appended to an already-applied migration
  file **in this worktree only, never migrated, and restored byte-exactly afterwards** (checked
  with `git diff --exit-code -- drizzle/`): it must go red naming that file. That is the 261031a
  mistake reproduced without touching any database;
- the live test with `DATABASE_URL` pointed at a closed port: it must fail, not skip or pass.

## Known limits

- It runs only when the author runs the suite (or the shared lane). An author who edits and pushes
  without running `npm test` is caught by the next tree's `db:migrate` instead, as before.
- On Greg's Mac it reads the laptop's own database, where the same rule holds.
- After a legitimate restamp of the shared ledger (the 261031a repair), a tree still holding the
  *old* file goes red until it merges `dev`. That is correct, and the message says so.

## Stages

One stage: build, review, land.

## What happened (2026-10-31)

**Reviews of the plan.** Opus: build C as planned; widen the failure message to the readiness-tree
and "another tree ran a different copy" cases. GPT Sol: *build with changes* — (1) `hashProblem`
is silent about a tag with no file hash, so the live test now requires a real sha256 for every
matched entry, and the positive control changes one nibble of the real hash rather than appending
to whatever was there; (2) the shared lane's "four files" was stated in `vitest.config.ts`,
`tests/setup/shared-db.ts`, `testing.md` and pinned by name in `store-migration-registry.test.ts`,
all updated; (4) the message also gives the laptop's working-draft remedy (probe, then restamp —
never blind). Both agreed with C and with rule 4 alone.

**Code review.** When `SUPABASE_URL` is absent, the live test now checks `DATABASE_URL` against this
repo's pinned local Supabase port itself. The shared-lane setup could previously prove which local
`postgres` it reached only by pairing both URLs; unlike the original GoTrue suites, this read-only
test could otherwise pass against another local stack whose database is also named `postgres`.
The lane's current five-file descriptions were corrected at the same time.

**Watched failing**, each in this worktree only, nothing migrated, nothing written to any database:

| what was done | result |
|---|---|
| unit cases before `appliedFromDifferentSql` existed | 6 red |
| one `\n` appended to `20261030220450_chat_thread_origin_sources_digest_and_summary.sql` (the 261031a file and edit shape) | red, naming that file; then truncated back, sha256 `234b1915…` again, `git diff --exit-code -- drizzle/` clean |
| `0001_auth_fks_and_guards.sql` moved out of `drizzle/` | red: "matched migrations with no sha256 of their file" |
| `DATABASE_URL` pinned to a closed port | red at the lane setup (port is not this stack's), before `pgReady`, which would throw next |

The shared ledger, read before building: 233 rows, 233 journal entries, every one matched and equal.
