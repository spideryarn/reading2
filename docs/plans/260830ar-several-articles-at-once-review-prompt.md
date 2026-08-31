# Review prompt — Several articles at once, and a queue behind each one

You are reviewing a **plan, before anything is built**, in the Spideryarn repo. Read-only.

## The plan

`docs/plans/260830ar-several-articles-at-once.md`. Read it first, then verify every claim it makes against
the code. It asserts several things about the current behaviour; **check each one rather than
taking it on trust** — a plan resting on a wrong reading of the code is the failure mode worth
catching here.

## What the change is, in one paragraph

Today at most one job in the whole `jobs` table may be `running` (`jobs_only_one_running`), and at
most one job per article may be queued-or-running (`jobs_active_slug`). The second one refuses a
reader who asks for Tweets while an ingest is going, with a 409. The plan (a) replaces the global
"one" with a configurable N, and (b) moves the per-article rule from **enqueue time** (a 409) to
**claim time** (a `busy`, so the second job waits in the queue and then runs). Parallelism *within*
one article stays forbidden, deliberately.

## The files that matter

- `src/db/schema.ts` — the `jobs` table, its partial unique indexes, and `queue_state`
- `src/store/pg-jobs.ts` — `tryEnqueue`, `enqueueOrGet`, `claim`, `failExpired`
- `src/store/jobs-fs.ts` — the filesystem adapter, which is **the local default**
- `src/store/jobs.ts` — the `JobStore` contract and its reasoning
- `src/jobs.ts` — `enqueue`, `freeSlug`, `freeUploadSlug`, `slugIsSpokenFor`, `activeFor`,
  `advanceJobWith`, `walkClaim`, `LEASE_MS`, `STEP_BUDGET_MS`, `pump`
- `src/web/useJobs.ts` — the client drive loop, which is the only thing that starts a queued job
- `src/store/pg-revisions.ts` — `beginDraftIn`, `publishRevisionIn` (why within-article stays serial)
- `drizzle/0000_initial_schema.sql`, `drizzle/0001_auth_fks_and_guards.sql`
- `tests/db-schema.test.ts`, `tests/store-jobs-parity.test.ts`, `tests/jobs.test.ts`,
  `tests/helpers/running-slot.ts`, `tests/running-slot.test.ts`
- `docs/project/ingest-queue.md` § *Concurrency is still 1, and still deliberately*

## What I most want from you

Lead with anything that means **do not build this as written**. Then the rest, ordered by severity.

Five specific questions, but do not let them limit you:

1. **The global cap.** The plan offers (A) count the `running` rows inside a `FOR UPDATE` lock on the
   `queue_state` singleton, or (B) a `running_slot smallint` column with a partial unique index on
   it. Which, and why? Note that `queue_state` is currently written by nothing and read by nothing on
   the Postgres claim path, despite its own comment saying claiming locks it. Is A actually exact
   under READ COMMITTED, given the claim's `UPDATE` and the count are separate statements? Is B's
   "pick the lowest free slot" expressible in one statement without a lost-update or a livelock?
2. **The three replacement indexes.** `jobs_one_running_per_slug` (article mutex, `where status =
   'running'`), `jobs_reserved_slug` (name reservation, needs a new `reserves_name` column), and
   `jobs_active_work` on `(owner_id, slug, work_key)` (de-duplication). Do these three actually cover
   everything the one index was covering? Specifically: is there a sequence of requests that gets two
   articles onto one slug, or pays twice for one piece of work, that today's index refuses and these
   three do not? Consider retries, uploads, `freeSlug`'s adoption of an existing slug for the same
   `urlKey`, and a job that is `cancelling`.
3. **Second-order effects of a queued job that now waits.** `activeForSlug` can now return one of
   several rows — `slugIsSpokenFor` and `onShelfOrInFlight` both read it. And the sharper one: if
   job A re-extracts an article and publishes new blocks while job B sits queued for `summary` on
   that article, does B do the right thing when it finally runs, or is it working from something it
   decided at enqueue time? Trace `workKeyFor`, `stepIsDone`, and the freshness checks in
   `beginDraftIn` / `reasonsNotToPublish`.
4. **The queued sweep.** `failExpired` only touches `running` rows, so a `queued` job never expires.
   The plan proposes a `last_seen_at` touched by every claim attempt including refusals, swept after
   a few minutes. Is that right, is it worth a column, and is there a case where a legitimately
   waiting job goes untouched long enough to be swept?
5. **Constants measured with one job running**: the process-wide asset gate in `src/collect-assets.ts`,
   the label fan-out in `src/labels.ts`, the `STEP_BUDGET_MS` pre-flight in `src/jobs.ts`, and
   `poolMax()` in `src/db/client.ts`. The plan calls all four latency-or-money rather than
   correctness. Is that right? In particular: can the claim's deadline pre-flight now start a step it
   cannot finish, and what happens to a job when it does?

Also tell me what the plan's **test list** is missing — especially any test that would pass on the
bug it is meant to catch.

Be concrete. Cite `file:line`. If you think a claim in the plan is wrong, say which and show the code
that says otherwise.
