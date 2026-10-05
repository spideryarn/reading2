# The draft sweep deletes, and the count mode goes

Up: [plans.md](../project/plans.md). Decided in
[261003f § For Greg 5](261003f-fifth-codebase-sweep-umbrella.md#for-greg); the design it finishes is
[260908f § O](260908f-prioritised-spideryarn-codebase-improvements.md) and
[cron-scheduler.md](../project/cron-scheduler.md).

## What this is

When a pipeline step dies it leaves a draft copy of the article's data behind. Since 2026-09-11 the
first step of every job looks for such drafts on its own article and **counts** them. Greg,
2026-10-04, answering the question "Start deleting abandoned drafts?":

> Q-draft-sweep yes

So the sweep now deletes, the count mode is removed, and the backlog production already holds
(75 rows across 29 articles, about 19 MB, read on 2026-10-03) is cleared once by a script.

## The rule, re-read against today's code (2026-10-05)

`abandonedDraftCondition` in `src/store/pg-revisions.ts`. A revision is abandoned when all four hold:
status is `draft` or `failed`; `created_at` is more than six hours old by the database's clock; no
job row names it (live or ended); no article's `current_revision_id` is it. The sweep takes one
article's, oldest first, ten per job start, and re-checks the same condition under a row lock before
the `DELETE`.

**What goes with a deleted revision**, read from `pg_constraint` on the local database (migrated to
head) rather than from the schema file — six foreign keys reference `article_revisions`:

| child | on delete | what that means here |
|---|---|---|
| `revision_blocks` | cascade | goes with it |
| `revision_phrase_runs` | cascade | goes with it |
| `revision_step_runs` | cascade | goes with it |
| `jobs.draft_revision_id` | set null | never fires: a job-named revision is not a candidate |
| `article_revisions.based_on_revision_id` | set null | should never fire: a base was current when copied, so it is `published`. The backlog script counts it rather than trusting it |
| `articles.current_revision_id` | no action | Postgres refuses the delete outright — a second lock on the article's text |

`block_identities` has no key to a revision and is untouched: an id, once minted, is never deleted
([block-ids.md](../project/block-ids.md)). `revision_phrase_runs` is newer than the sweep's header
comment, which names only two cascades; stage 1 corrects the comment.

A revision's raw source is an object in the `sources` bucket that the row references and does not
own. Deleting a revision deletes no object. An object only ever referenced by an abandoned draft is
then unreferenced — that is the "orphaned blobs" row in cron-scheduler.md's table, already known,
not made worse in any way a reader can see, and not this job.

## Stage 1 — the sweep deletes; there is no mode

- Remove `DraftSweepMode`, `STEP_START_DRAFT_SWEEP`, and `mode` from `DraftSweepOptions`,
  `SweptDrafts`, `DraftSweepOutcome` and the log line. `sweepAbandonedDrafts` always deletes.
  `openOrBeginJobDraft`'s `sweep` option stays, tests-only, for `olderThanMs`, `limit` and the race
  barrier.
- **Red first.** `tests/draft-sweep-on-step-start.test.ts`: the "only counts, by default" case
  becomes "deletes by default" — a job's first step with no `sweep` option deletes the qualifying
  draft. It is red against today's code. The existing first case already covers what must survive
  (current, published, held by an ended job, younger than six hours, another article's); add
  **held by a live job** to it, which is asked for and is the one protection that file checks only
  through the race cases. Every `mode:` in the file goes.
- `scripts/draft-sweep-inventory.ts` stops importing the mode; it stays read-only.
- `cron-scheduler.md` § What we do instead: status becomes "deleting since 2026-10-05", with Greg's
  line quoted.

**The simpler option passed over:** flip the constant to `"delete"` and leave the mode. One line,
but the umbrella's answer names the mode's removal as part of what "yes" buys, and a mode nothing
selects is a second state to keep working.

## Stage 2 — the backlog, once

On-demand sweeping never reaches an article nobody runs a job on, so the 75 rows would otherwise go
only as their articles are next touched. `scripts/draft-sweep-backlog.ts`:

- **Default is a dry run**, inside `begin read only` (checked, as the inventory script does). It
  lists candidates per article id (count, block rows, bytes — no slugs, no text) and then proves,
  by a second query written independently of the predicate, that among the candidate ids **zero**
  are published, current, named by a job, or the `based_on` of another row. Non-zero exits 1. It
  also prints whether the connected role may `DELETE` from `article_revisions` at all
  (`has_table_privilege`) — if the app's role may not, the step-start sweep would fail quietly into
  its savepoint on every job, and this is the cheapest place to find that out.
- **`--delete`** does it: per article, loop `sweepAbandonedDrafts` (the app's own function, so the
  lock-and-recheck is the same code) in short read-committed transactions of one batch each, after
  taking the article row `for update` as the app's caller does. Stops an article when a batch
  deletes nothing. Prints per-article and total deleted, from the `DELETE`'s own row counts, then
  re-runs the count and says what is left.
- **`--prod`** reads `DATABASE_URL` from `.env.prod` (`readEnvProd`); without it the target is
  `.env.local`'s. Always prints `Target:` first. Never a `SET`: `.env.prod` is the transaction
  pooler (database.md § Which host).
- A test drives the exported function against the local database: dry run deletes nothing and
  reports the same set that `--delete` then removes; protected rows survive.

**Running it.** Dry run against production, read-only, results recorded here and in the umbrella.
The real delete only if this session is permitted to write production; if refused, the command is
left for Greg and the Overseer is told. Greg's yes covers these rows; nothing else is written.

**The simpler option passed over:** no script, let on-demand clear it. Rejected because the
Overseer's brief asks for the 75 rows explicitly, and most of those articles may never run another
job.

## Done means

`npm test`, `npm run typecheck` green; GPT Sol plan review (this file) and code review; pushed to
`dev`. The code change reaches production at the next deploy, which the Overseer runs.

## Results

**Plan review, GPT Sol, 2026-10-05** ([answer](261005j-plan-review-sol.md)): build with changes. No
P0 or P1. One P2: the second query must check age as well, and must be tested against ids it should
reject. Both done — `young` is a sixth count, and a test hands `proveUnprotected` one wrong id of
each kind. It checked the lifecycle for a needed revision that could match the rule and found none,
and confirmed the six-row table above against the migrations.

**Stages 1 and 2 built, 2026-10-05.** As planned, with one addition: the backlog script's tests live
in `tests/draft-sweep-on-step-start.test.ts` rather than a file of their own, since they need the
same fixtures. Red first: five cases failed against the counting code before it changed.

**Production dry run, 2026-10-05 15:49 UTC** — `npx tsx scripts/draft-sweep-backlog.ts --prod`,
target the transaction pooler as `spideryarn_app`, inside a read-only transaction:

- **103 revisions (1 draft, 102 failed) across 35 articles; 41,053 block rows, 56.0 MiB.** That is
  more than the 75 across 29 read on 2026-10-03: the same rule, two more days of failed steps. One
  article accounts for 28.7 MiB of it in nine revisions.
- The second query found all 103 and none protected: 0 published, 0 current, 0 named by a job,
  0 younger than six hours, 0 the base of a surviving row.
- `spideryarn_app` may delete from `article_revisions`, so the step-start sweep will not fail into
  its savepoint for want of a privilege.

**Code review, GPT Sol, 2026-10-05** ([answer](261005j-code-review-sol.md)), fixing as it went. It
found nothing wrong in the sweep itself or in what removing the mode touched. Three P1s, all in the
backlog script as first built, all fixed by it:

- **The delete chose its rows afresh.** The survey proved a list of revision ids and then handed the
  delete only article ids, so a row that became eligible in between would have been deleted
  unproven. `deleteDraftBacklog` now takes the survey and deletes only those exact ids;
  `sweepAbandonedDrafts` gained an optional `revisionIds` allow-list for it.
- **The lineage proof covered the whole list, not the batch.** Each locked batch is now proven
  again, inside its own transaction, before its `DELETE`.
- **A shell `DATABASE_URL` could still aim it** when `.env.local` was missing. It now reads the
  named file directly and prints which file.

It wrote these up as a class in
[261005i](../postmortems/261005i-a-proven-list-does-not-prove-a-fresh-query.md), and added
`tests/draft-sweep-backlog-safety.test.ts` (no database). Its sandbox could not reach Postgres, so
its verdict was "not yet — run the PostgreSQL regression suite first".
