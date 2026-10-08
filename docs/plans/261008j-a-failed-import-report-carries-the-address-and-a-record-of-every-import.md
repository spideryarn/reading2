# A failed import's Report this carries the address, file name and error; and a record of every import

Up: [plans.md](../project/plans.md) · report `spya-a5gzb9` (SPIDERYARN-READING2-8A) · question
[q-a7kffw](../user-feedback/questions/q-a7kffw.md) · overseer queue item `qi-m8683pz7` · follows
[261001s](261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md)
§ review item 6.

## What Greg asked for

Greg's reply `spya-f9c9pe` to q-a7kffw, 2026-10-08, in the Feedback dialog:

> yes, it's fine for the filled-in report to carry information about the metadata that you suggest,
> whether it's the source address, file name, error sentence, that's definitely fine.
>
> I mean, maybe we should even actually have a database table or something. I mean, more generally,
> it feels like we should be storing all of the imports, and if they're successful, maybe there's
> very little to store other than that it happened when it happened and whatever. But for a failed
> import, we definitely want to be storing information, I'd have thought. Now, it could go to
> Sentry, but maybe it makes more sense to put it in the database and then it can link to a bunch of
> other stuff. So, in other words, let's just make sure that we are making it possible for the dev
> agent to access, find, debug whatever it needs to solve problems from production after the fact.

Question 2 of q-a7kffw (link back to an uploaded file) was not answered and stays as built.

## What is there now

- **Report this** (`src/web/import-report.ts` § `importProblemReport`) pre-fills the job id, slug,
  status, failed step name, failure kind and three timestamps. Not the address, file name or error
  sentence — [feedback.md § The one rule](../project/feedback.md#the-one-rule) kept them out.
- **The `jobs` row already holds everything a debugger wants**: `url`, `upload_id`,
  `upload_filename`, `error`, `failure_kind`, `steps` (each step's status, error and times),
  `ingest_event_id`, and the timestamps. Dismiss stopped deleting it on 2026-10-02 (it stamps
  `dismissed_at`).
- **But the row does not last.** `trimFinished` (src/store/pg-jobs.ts) keeps 50 finished jobs per
  owner, imports and mode runs together, interleaving failures and successes — so a busy reader's
  failure is gone within a day or two of imports and mode runs. And Delete permanently takes the
  article's terminal jobs with it (`deleteTerminalJobs`, src/store/pg-shelf.ts).
- **`ingest_events`** is never deleted, but it is the billing ledger: charged ingests only (not CLI,
  not mode runs), and it says nothing about why one failed.
- **There is no committed way for an agent to read a production job.** Agents improvise a script
  with `.env.prod`'s credentials each time — the thing
  [database.md](../project/database.md) warns about after 2026-10-07.

So the gap Greg names is real: a failure is recorded, then deleted on a schedule nobody chose for
debugging, and there is no ready door to it.

## What changes

### Stage 1 — Report this carries the address, the file name and the error

`importProblemReport` adds, when the job has them:

```
Source: https://example.com/the-page        (job.url)
File: my-paper.pdf                          (job.upload.filename)
Error: <the failed step's error, or job.error when no step failed>
```

The reader sees all of it in the box and can edit or delete any of it before sending — that is what
puts it inside the rule's third clause (*a fact the reader is told, on the page, that we take*), and
the privacy page says so too. The error sentence is cut at 2,000 characters with an ellipsis, so the box can never open fuller
than Feedback's 20,000-character limit allows (Sol's finding 7). Kept as is: no stripping of a
query string. Greg chose B knowing an
address with a private token in it would be stored in the report, and the reader can see and delete
it.

Changes alongside: the button's `title`; feedback.md § The one rule's bullet (rewritten from "never
the address…" to what it carries now, with Greg's reply quoted); `PrivacyPage.tsx` § *If you send us
a bug report* gains one sentence; privacy.md notes it; the comment at the top of
`import-report.ts`; `tests/import-report.test.ts` red first (asserts the three lines appear, and
are absent when the job has none).

### Stage 2 — `import_records`: one row per import that ended, kept

A new table, `spideryarn.import_records`, one row per **import** job that reached a terminal status
— done, error or cancelled. An import is a job whose steps include `fetch`, the same test as
`isImportJob` (src/job-state.ts), written in SQL as `NEW.steps @> '[{"name":"fetch"}]'::jsonb` —
an array of *objects*, because `@> '["fetch"]'` matches nothing (sql.md § Migrating data inside a
JSONB column). Successes are recorded too, as Greg asked; their row is just short.

Columns, copied from the job at the moment it ended:

| column | from | why |
|---|---|---|
| `job_id` text PK | `jobs.id` | the id a Report this names; no FK, because the job row is trimmed |
| `owner_id` uuid → `auth.users` **on delete cascade** | `owner_id` | whose. Cascade rather than `jobs_owner_fk`'s restrict: an erased account takes its import history rather than being refused by it (changed from restrict while building — restrict also made every test that deletes its seeded user fail on rows the trigger wrote) |
| `slug` | `slug` | the article's address at the time. Slugs are not renamed today; if that arrives, this table is one more place it has to reach |
| `status` | `status` | done / error / cancelled |
| `failure_kind` | `failure_kind` | the closed reason |
| `failed_step` | first step with status `error` | what to filter on |
| `error` | that step's error, else `jobs.error` | the sentence |
| `url`, `upload_id`, `upload_filename` | same | where it came from; `upload_id` → `uploads` **on delete set null** |
| `ingest_event_id` | same | **composite** FK `(ingest_event_id, owner_id)` → `ingest_events (id, owner_id)` as `jobs_ingest_event_fk` — a record cannot point at somebody else's reservation — with `on delete set null (ingest_event_id)` (Postgres 15+), so a record never stops a reservation going |
| `steps` jsonb | `steps` | per-step status, error and times — the job's own shape, read whole by a person, never filtered on (the sentence sql.md asks for) |
| `created_at`, `started_at`, `finished_at` | same | when |
| `recorded_at` default now() | | Store when it happened |

**Written by a trigger on `jobs`, not by the application.** `AFTER INSERT OR UPDATE OF status`,
firing when `NEW.status` is terminal and (on update) `OLD.status` was not, and the steps contain
`fetch`; `insert … on conflict (job_id) do nothing`. A narrowly scoped security-definer function,
with public execution revoked: a missing runtime-role grant must not stop a job ending, while
`SET search_path = ''` and fully qualified names keep the elevated function closed. Why a trigger:
four code paths move a job into a terminal status (`settlingIfTerminal`, `requestCancel`,
`settleExpired`'s sweep, `settleIn` — listed in pg-shelf.ts), and `noteEnded` is on only two of them.
A rule in one of them is not a rule. A trigger also catches a hand-run repair.

**One record is the first terminal ending of one job id.** Retry makes a new job, so it is a new
record. A job that a hand repair moves terminal → queued → terminal keeps its first record; tested
and written down rather than discovered.

**Never trimmed.** One short row per import is nothing at our size; a cap is deferred until a count
says otherwise.

**Deleted with the article.** `deleteTerminalJobs` (Delete permanently, and
`scripts/never-published-tidy.ts` through the same `destroy`) also deletes the owner's
`import_records` for that slug, in the same transaction. **An import that never became an article**
— stopped while queued, or failed before the article row existed — has no Delete button to reach it,
so its record stays until the account goes, and the privacy page says exactly that. The account is
erased by hand today (PrivacyPage *Deleting things*), and the cascading owner key takes the records
with it.

**Grants**: nothing to add. `anon` and `authenticated` get nothing in `spideryarn`; the app role gets
the table by default privileges (database.md). Nothing in the app reads it: no route, no client
type.

**Privacy page**: *What we keep* gains a bullet — a record of each import: the address or file
name, when, and if it failed, which step and the error message. It goes when you delete the
article; one that never became an article stays until your account is deleted.

### Stage 3 — a door for the dev agent

`scripts/import-records.ts`, read-only, reusing `productionClient()` from
`scripts/feedback-reporter.ts` (`begin read only` … `rollback`, verified TLS, `Target:` printed):

```
npx tsx scripts/import-records.ts                 # last 20 failed imports: job id, when, step, kind, host
npx tsx scripts/import-records.ts --all           # successes and cancels too
npx tsx scripts/import-records.ts <job-id>        # one record in full: url, file, error, every step
```

There is no local command-line mode: its purpose is production. The test hands `readRecords` its
own test-database connection instead, so the production target selection is not weakened for a test
seam. The list omits the error sentence, slug and full address (host only), since a list is the thing
that gets pasted around; one job in full shows everything.

debugging.md § *Something is wrong in production* gains a fourth row (*the database: an import that
failed — kept for good*), and ingest-queue.md gets a section, *The record of every import*, which
is this design's home.

## The simpler option passed over

**Keep the import's own `jobs` row instead of copying it** — GPT Sol's finding 1, and the strongest
alternative. `dismissed_at` already separates keeping a row from showing it, so `trimFinished` could
stamp a doomed import hidden rather than delete it: no new table, no trigger, no copied columns.

Passed over because **a `jobs` row is not inert to the rest of the code; it is read as "something
is still attached here"**. `scripts/never-published-tidy.ts` holds an article while any job names
its slug (`has-jobs`), and `scripts/draft-sweep-backlog.ts` holds a draft any job names
(`job_named`). The rows this option would keep for ever are exactly the failed imports, and the
articles and drafts those two scripts exist to clear are exactly the leftovers of failed imports —
so keeping the job pins the stored text of every failed import, permanently. `src/minimal-paper.ts`
and `src/store/pg-billing.ts` also ask whether a job exists for an upload or a reservation; those
answers are right today but would have to be re-argued for a table that now means two things. A
record table that nothing else reads costs one migration and a trigger, and changes no answer
anywhere else.

**Sentry instead**, as Greg mentions: it ages out in 30 days, cannot join to `ingest_events`,
`uploads` or `ai_calls`, and its events are scrubbed of exactly the error sentences we want.

## Deferred, named

- **Mode runs** (arc, tweets, glossary…) are not imports and are not recorded. Same table later,
  or a sibling, if a mode failure ever needs the same.
- **The build that ran it** (commit sha). The trigger cannot see it; it needs a `jobs` column
  written at claim. Until then `finished_at` against the deploy times answers it.
- **A cap or age-out** on `import_records`.
- **An admin page** listing them. The script is the door for now.
- **Backfill**: the rows still in `jobs` today are not copied in. Could be one `insert … select`;
  deferred because it is a write to production data Greg has not asked for.
- **A link back to an uploaded file** — q-a7kffw question 2, unanswered, stays as built.

## Tests (red first)

- `tests/import-report.test.ts`: the three new lines, present and absent.
- `tests/import-records-pg.test.ts`, against the trigger through plain SQL on `jobs`: each terminal
  status leaves exactly one row with the right fields, whether reached by update or by an insert born
  terminal; a job whose steps lack `fetch` leaves none; a second terminal update (Dismiss stamping
  `dismissed_at`) adds none; terminal → queued → terminal keeps the first; deleting the job leaves
  the record; `deleteTerminalJobs` removes the owner's records for that slug and not another
  owner's. Plus one end-to-end case through `enqueue` (a fetch that fails offline, as
  `tests/owner-jobs.test.ts` does) so the real path is seen to write it.
- `tests/import-report.test.ts`: the error cut at 2,000 characters.
- the script: its pure formatting, and `readRecords` against the test database through an injected
  connection.

## Security

Touches no defence in [security-map.md](../project/security-map.md): no route, no reader-facing
read, no change to who can see what. The new table holds what `jobs` already holds, for longer;
that is a privacy change, and the privacy page says it.

## GPT Sol's plan review, and what changed

[261008j-import-records-plan-review-sol.md](261008j-import-records-plan-review-sol.md), verdict
*rethink*. Each finding, checked:

1. **Keep the `jobs` row instead** — checked, and declined for the reason Sol asked to be written
   down: § The simpler option passed over.
2. **An import that never became an article has no delete path** — right. The plan and the privacy
   wording now say such a record stays until the account goes.
3. **Composite owner FK on `ingest_event_id`, every `on delete` named** — taken, as in the table;
   but the owner key cascades rather than restricts, and the reservation key sets its own column
   null, so the record never blocks an erasure.
4. **Spell out the JSON predicate** — taken; it is the trap sql.md documents.
5. **First terminal ending wins** — taken as a stated rule with a test.
6. **Slug is not a durable identity** — slugs are not renamed today; the column's note now says a
   rename would have to reach this table. Delete-by-slug also takes a retry's records, which is
   wanted.
7. **Migration shape and an unbounded prefill** — taken: an ordinary generated migration with the
   FKs and trigger appended by hand, and the error cut at 2,000 characters.
