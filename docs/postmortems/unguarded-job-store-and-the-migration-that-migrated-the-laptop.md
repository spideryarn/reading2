# The shelf that printed its own SQL, and the migration that ran on the wrong machine

**2026-08-27.** Reported by Greg, from a screenshot of `spideryarn.com`: under the Add box, in red,
the whole of a failed query — every column name, the `where`, and his own `owner_id`.

```
Failed query: select "id", "owner_id", "slug", "url", "title", "steps", "guidance", "status",
"error", "cancelling", "attempt_id", "lease_expires_at", "draft_revision_id", "profile",
"failure_kind", "upload_id", "upload_filename", "work_key", "created_at", "started_at",
"finished_at" from "spideryarn"."jobs" where "spideryarn"."jobs"."owner_id" = $1
order by "spideryarn"."jobs"."created_at" desc, "spideryarn"."jobs"."id" desc
params: 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a
```

In the same message he added that dragging a PDF onto the Add zone did nothing. It was the same
root cause wearing a different coat, and a third bug was underneath both.

> **All three fixed the same day.** The remote schema is current; the stores are guarded at their
> exports; the migrator says which database it is about to change. Tests in
> [`tests/store-guarded.test.ts`](../../tests/store-guarded.test.ts), proved red first. Everything
> in the present tense below describes the code and the database as they were.

## Three bugs, and only the first one is visible

**One — the remote database was four migrations behind.** `drizzle/` had 0000–0017. The production
ledger had fourteen rows, 0000–0013. So `spideryarn.jobs` was missing `profile`, `failure_kind`,
`upload_id`, `upload_filename` and `work_key`, and `spideryarn.uploads` did not exist at all. The
jobs poll on the homepage asked for five columns that were not there. The PDF drop needed a table
that was not there. One cause, two symptoms.

**Two — the raw Drizzle error reached the browser.**
[`src/store/db-errors.ts`](../../src/store/db-errors.ts) exists precisely to stop this, and its
header makes the argument in as many words:

> Wrapping the object rather than each method is the point. A guard you have to remember to apply
> is a guard that is missing from the method somebody adds next year.

It then left the applying to whoever wired a store up. Three Postgres stores are selected **outside**
`src/store/index.ts` — [`src/jobs.ts`](../../src/jobs.ts),
[`src/upload-records.ts`](../../src/upload-records.ts) and
[`src/store/revisions.ts`](../../src/store/revisions.ts) — each for a good and separately documented
reason: `index.ts` imports `fs.ts`, which imports half the app, and `npm run check` gates on import
cycles. All three were selected raw. The file that argues against relying on memory relied on memory
three lines later.

**Three — and this is why (1) happened at all — the documented way to migrate the remote migrated
the laptop.** `.env.prod` says:

```
DATABASE_URL=<remote> DB_MIGRATE_ALLOW_REMOTE=yes npm run db:migrate
```

`loadEnvLocal()` in [`src/env.ts`](../../src/env.ts) deliberately lets the **file** beat the shell,
and it is right to: a stale export in somebody's profile should not quietly reconfigure the server.
But `scripts/db-migrate.ts` calls it and then reads `process.env.DATABASE_URL`, so the shell value
was replaced by `.env.local`'s `127.0.0.1:54362` **before the remote check ran**. The guard that
exists to make a remote migration deliberate looked at the laptop, was satisfied, and said nothing.
`isLocalDatabaseUrl` returned true. The migrations applied. It printed `✓ migrations applied`.

Every part of that command worked. It just worked somewhere else.

## Proving it rather than reasoning about it

The precedence was checked before anything was fixed, with a sentinel host:

```
$ DATABASE_URL="postgresql://sentinel:sentinel@REMOTE-SENTINEL.example.com:5432/postgres" \
    npx tsx scratch-envtest.mts
[env] .env.local overrode DATABASE_URL from the shell environment.
DATABASE_URL host after loadEnvLocal: 127.0.0.1:54362
```

The warning line was there the whole time. It says `.env.local overrode DATABASE_URL`, which is a
true statement about an environment variable and reads, at a glance, like a note about a dev-server
config. Nothing in it says *and therefore this migration is about to run on your laptop*.

## Why the second bug is the interesting one

The screenshot leaked an `owner_id` — a uuid, and Greg's own. That is the mild case.

`pgJobStore.create` binds the article's URL, its title, the reader's `guidance` and the reader's
**profile text**. `pgUploadStore.mint` binds the **filename off the reader's own disk**. And
`src/routes.ts` does three things with one error object: sends `err.message` to the client, hands it
to the log, and — on some paths — writes it into the row's `error` column, where the *next* failed
query binds a string that already contains it and Drizzle flattens it in one level deeper. The
existing header calls that third path the worst of the three. It was open on the jobs store for a
day.

Two things stopped it being worse than it was, and neither is a control: `spideryarn.jobs` had zero
rows, so nobody's article had been queued through Postgres yet; and the query that failed was a
`select` with one bound parameter rather than an `insert` with eight.

## What the fix actually changes

**The guard travels with the store, not with the selection.** `pg-jobs.ts` and `pg-uploads.ts` keep
the raw object literal private and export `guardDbStore(...)` of it. A selection site is a place to
forget; an export is not. This also keeps the import-cycle reasoning intact — the three files still
select their own stores, they just cannot select an unguarded one, because there is no unguarded one
to import.

**Two errors had to be taught to cross it.** This is the half that a coverage test would have missed,
and both were found by something other than reading the code.

`StaleAttemptError` was found by [GPT Sol](../reusable/codex-cli-as-subagent.md), reviewing the plan
before it was built. [`advanceJob`](../../src/jobs.ts) asks `err instanceof StaleAttemptError` to
answer *busy, ask again* when the claim moves to another instance mid-step. Scrubbed, that becomes a
500 — under `postgres`, under contention, and nowhere else. It would have been a genuinely horrible
bug to find, and the naive one-line fix would have shipped it.

`IllegalTransition` was found by `tests/store-uploads-parity.test.ts` going red the moment the upload
store was wrapped. Both adapters threw ``new Error(`An upload cannot go from ${from} to ${to}.`)``
and only the Postgres one now went through the scrubber, so the two stores stopped agreeing about
what an illegal state change says. Parity is what that suite is *for*, and it earned its keep: the
fix is a named class thrown by both adapters, not a weakened assertion.

Both are on the allowlist under one test, now written down where the list lives: **the type is closed
and its message is built from values we chose.** A job id is a uuid we minted; an `UploadStatus` is
one of five literals. The moment a candidate's message can hold a URL, a title, a quote or a model's
answer, it does not belong there however well-behaved its class is.

**The migrator says which database it is about to change.** `scripts/db-migrate.ts` snapshots the
shell's `DATABASE_URL` before `loadEnvLocal()` and prefers it — this is the one place the shell means
it, because the target of a migration is an *argument*, not configuration — and prints a
password-stripped `Target:` line either way. That second half is the one that matters. Preferring the
shell fixes today's command; printing the target is what makes tomorrow's mistake visible in the
second it happens rather than a day later on somebody's homepage.

## What would have caught the whole class

[`tests/store-guarded.test.ts`](../../tests/store-guarded.test.ts), which does three things because
the bug had three layers:

1. **It asks the objects.** `guardDbStore` now stamps a non-enumerable symbol and exports
   `isGuardedStore()`. A source scan can say *this file mentions the guard*; only the object can say
   *I am wrapped*.
2. **It scans for the shape.** Every `STORE === "postgres" ? …` in `src/` must name something
   guarded. The genre, not the list — the rule that
   [simplification-audit.md](../plans/simplification-audit.md) keeps having to restate.
3. **It proves the exemptions.** The four errors that must cross a guard intact are thrown through a
   real wrapper and asserted to arrive as themselves, and a Drizzle-shaped sentinel is asserted to be
   eaten.

Both halves were checked against the broken state before being believed — the guard removed from
`pg-jobs.ts` (two tests red), `StaleAttemptError` removed from the allowlist (one test red), both
restored byte-for-byte and confirmed by `diff`. A test that has never been red proves nothing.

The first version of the source scan **also** failed honestly, and it is worth keeping the story: it
reported `src/store/index.ts`, the one file that had been doing this correctly all along. A
non-greedy regex ended the ternary's branch at the first `:` it met, which was the key's own colon
four characters into `{ deleteGlossary: notMigrated(…) }` — and `notMigrated` was the entire reason
the branch was safe. It is now a bracket-depth scan.

## The second review, and two bugs the fix brought with it

The landed code went back to GPT Sol, which is the review this repo weights higher — a plan-stage
review cannot see what was built. It came back **CHANGES REQUESTED**, and both high-severity
findings were mine, introduced by the fix.

**The redactor leaked passwords.** The `Target:` line was
`url.replace(/:\/\/([^:@\/]*)(:[^@]*)?@/, "://$1@")`, which stops at the **first** `@` — and `pg`
accepts one inside a password. Given `postgres://u:p@ss@host/db` it printed `postgres://u@ss@host/db`,
putting half the password on the terminal of a line whose entire job is to be safe to read out. It
ignored `?password=` in the query string, which `pg` also accepts. The refusal path had the same
regex and the same hole. It is now `new URL`, which splits on the *last* `@` exactly as `pg` does,
strips the query parameter too, and **fails closed** — an unparsable URL prints a placeholder rather
than itself. Checked against all six shapes, including a percent-encoded `%40%2F` password and a URL
with no password at all.

There is something worth noticing about the shape of that: the fix for a redaction bug was itself a
redaction bug, written in the same sitting, by someone who had just spent an hour thinking about
exactly this. A regex over a URL is a parser you did not write.

**A second drop lost its file and lied about it.** Making a drop send immediately introduced a race
that the old confirm step had hidden. `take()` overwrote `file.current` and `chosen` before `send()`
reached its in-flight lock, so: drop A starts uploading; drop B is accepted and displayed; B's
`send()` returns at the lock; and A goes on uploading **underneath B's name**, then navigates to A's
article. No second grant was minted and no abort controller was lost — the lock is set before the
first `await`, which is the part that was right — but the display described a file that was not
moving. The file picker had the same hole from the other direction. The refusal is now in `take()`,
which is the one place both entry points pass through.

Sol also found that **an upload survives the component unmounting**: leave the shelf mid-transfer and
the finished request pulls you onto the ingest page of a file you had walked away from. There is now
an unmount cleanup that aborts.

**And two weaknesses in the new tests, which is the finding to take most seriously**, because the
tests are what is supposed to stop all of this happening again:

- `IllegalTransition` was allowlisted and **not covered here at all**. Removing its line would have
  left this suite green; it was protected only by the parity suite, which skips its whole Postgres
  half when there is no database. A skipped test protects nothing.
- The source scanner **over-claimed**. Sol executed its logic and produced four shapes it passed and
  should have failed: the ternary arms the other way round, a nested ternary with one guarded arm,
  the text `guardDbStore(` sitting inside an unrelated string, and `'postgres'` in single quotes. It
  also read no `.tsx` files at all. A check that looks stronger than it is, is worse than a coarse
  one that is honest.

  So the branch parser is gone. The rule is now coarser and strictly harder to fool: in any statement
  that consults the flag, every `pgSomething` identifier must be guarded at its export or wrapped by
  name in that statement. Which arm it sits on stopped mattering, because an unguarded Postgres store
  has no business being in that statement at all. The list of guarded names is **read out of the
  source** rather than written in the test, which removes the two-lists-drifting failure Sol also
  flagged — and there is now a test asserting that the discovery found something, because a regex
  that matches nothing yields an empty set that vouches for nobody and lets everything through.

  All five shapes were then re-run against the rewritten scanner, by writing each one into a real
  file under `src/` and checking the suite went red. Five for five.

## What this says about the shape of the code

Nothing here needs rearchitecting, and the two structural decisions that look like the cause are both
right.

The three out-of-band store selections are not a mistake — the import cycle is real and
`npm run check` enforces it. What was missing was that the guard was applied at a *place* rather than
carried by a *thing*. Moving it to the export costs nothing and removes the whole category.

`loadEnvLocal`'s file-beats-shell precedence is right for the app and wrong for one script, which is
the correct amount of exception: fixed in the script, not in `src/env.ts`, where it would have
changed the behaviour of every other caller to fix one.

The one general lesson is the one this repo keeps writing down. Every bug here was a
[silent success](../reusable/silent-success.md): a migration that reported applying migrations, a
guard that reported guarding, a drop target that caught the file and waited. And in each case the
check somebody would naturally run shared an assumption with the code — `isLocalDatabaseUrl` read the
same overridden variable the migrator did, and the tests asked whether the guard *worked* rather than
whether it was *reached*.

## The third symptom, which was not a bug

The PDF drop was reported as "nothing seems to have happened". Nothing had gone wrong in the drop
handler: it took the file, showed the filename and its size, and waited for a "Send it" press. A
control captioned *Or drop a PDF here* that catches a file and then waits is indistinguishable from
one that swallowed it.

Greg's call, asked directly: dropping should upload. So the two entry points now differ on purpose.
A drop is an unambiguous commit gesture on a target that names itself, and there is nothing to
confirm. The file-picker **button** still chooses-then-sends, because a file dialog is a place people
browse — the first PDF you click is often not the one you meant, and the row with its size and its X
is the only chance to notice before 50 MB goes.

See [ingest-queue.md](../project/ingest-queue.md), [database.md](../project/database.md) and
[logging.md](../project/logging.md).
