# Several articles at once, and a queue behind each one

**Status: both stages built.** Stage 1 — several articles at once — shipped on 2026-08-30. **Stage 2,
a queue behind each article, was built on 2026-09-02** and not from this plan: it was recut as
[260902e](260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md), which is
where the design that shipped lives. Read that one for the four indexes, the claim-time order rule
and the enqueue ownership check; this one for the history and for Greg's words at the top.

The review opened *"STOP — do not build this plan as written"* with four blockers. **All four were
checked against the code and all four were right**; what they changed is recorded in § *What the
review changed*. The work became two stages because one of the blockers was a prerequisite this
session did not own — [260830aq](260830aq-late-steps-read-the-store.md), built on 2026-09-01.

## The job

Greg, 2026-08-30, after hitting `That article already has a job running. Wait for it, or stop it
first.` while asking for Tweets on an article he was reading:

> Ok, so let's run multiple jobs across articles. Fix the bug if it's clear what the fix is. If you
> think it'll involve a lot of work to allow parallelism within an article (e.g. Tweets and
> Glossary, say), then just keep appending to the per-article queue.

and, on why:

> In general, I think we will need the ability for multiple things to run simultaneously. What is
> stopping that? Is it worries about CPU/RAM/database connections? Or something else? Certainly
> having one job across all owners doesn't seem feasible. Can't we rely on Vercel and the LLM
> providers to scale?

So: **two articles may run at once; two jobs on one article queue, they do not race.** Parallelism
*within* an article is explicitly out of scope, and § *Why within-an-article stays serial* says what
it would have cost.

## What is true today

Three rules, all of them partial unique indexes, all of them in
[`src/db/schema.ts`](../../src/db/schema.ts):

```
  jobs_only_one_running   unique on (true)          where status = 'running'
      → at most ONE running job in the whole table, across every owner

  jobs_active_slug        unique on (owner, slug)   where status in ('queued','running')
      → at most one job in flight per article — and it does three jobs at once:
          reserve the name · de-duplicate the request · serialise the article

  jobs_draft_revision_unique                        (not touched by this plan)
```

Neither index is consulted by a `SELECT`. Both are **raised**: the claim is one `UPDATE`, and a
`23505` on it is turned into an ordinary `busy` — [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts)
§ *`23505` is an answer, not an error*. That shape is what makes this change small.

Three consequences that are easy to miss:

1. **One claim walks a whole job** (`walkClaim`, [`src/jobs.ts`](../../src/jobs.ts)), and `LEASE_MS`
   is sized for the worst-case ingest. So a running ingest holds the *global* slot for the length of
   the ingest, not the length of a step. Every other article on the machine waits behind it.
2. **The 409 is thrown at enqueue time and only for slug-named work** — `!request.url &&
   !request.upload` in `enqueue`. A pasted URL never sees it; it gets renamed to `paper-2` instead.
   Reader-triggered steps — tweets, glossary, summary, ideas, sketch — are exactly the requests that
   do see it.
3. **A driver already exists and already drives every job.** `useJobs` starts one `drive` loop per
   queued-or-running job in the polled list, one set per tab
   ([`src/web/useJobs.ts`](../../src/web/useJobs.ts)), retrying `busy` for ever with an 8s ceiling
   and no time limit. So raising the cap needs no scheduler: the loops are there, being told `busy`.

   **And it is mounted more widely than its own comment says.** `useJobs.ts` asserts that the
   reading view mounts none, because the bands are mutually exclusive. That is stale for the second
   time: `OwnedReader` mounts `useArc` unconditionally ([`src/web/App.tsx`](../../src/web/App.tsx)),
   and `useArc` goes through `useStepJob` to `useJobs`. **Every owner reading view is a driver for
   every queued job in the account**, in default `toc` mode, band or no band. Visitors are not —
   `OwnedReader` is the capability seam. The comment has to be fixed in the same breath, since it is
   now load-bearing for this design and wrong.

   What still has no driver is **production with no tab open at all**: `pump` returns immediately
   when `VERCEL` is set, `vercel.json` has no crons, and `advanceJob` has two callers in the repo.
   That does not change here.

## The two stages

**Stage 1 — several articles at once.** Replace the global cap. Depends on nothing, fixes Greg's
headline ask, and the review's blockers do not touch it.

**Stage 2 — a queue behind each article.** Replace the 409. This is the half that fixes the symptom
Greg actually reported, and it **must not ship before late steps read the published store** — see
§ *The prerequisite*.

## The design

**Move the per-article mutex from enqueue time to claim time, and make the global one a number.**

The guarantee that matters — two jobs never publish the same article concurrently — is kept exactly,
because it is enforced at the moment a job starts running rather than at the moment it is asked for.
What goes away is the refusal.

```
  today                                   after

  POST {slug, steps:[tweets]}             POST {slug, steps:[tweets]}
        │                                       │
        ▼                                       ▼
  jobs_active_slug refuses  ──► 409       row inserted, status = queued
                                                │
                                          drive loop asks to advance
                                                │
                                          claim: article busy ──► busy, back off
                                                │
                                          ingest finishes, article free
                                                │
                                                ▼
                                          claimed, runs, publishes
```

### The four indexes that replace the two

| Index | On | Where | What it is for |
|---|---|---|---|
| `jobs_one_running_per_slug` | `(owner_id, slug)` | `status = 'running'` | **the article mutex** — raised on the claim, answered as `busy` |
| `jobs_reserved_slug` | `(owner_id, slug)` | `status in ('queued','running') and reserves_name` | **name reservation** — only for requests claiming a new name |
| `jobs_active_work` | `(owner_id, slug, work_key)` | `status in ('queued','running')` | **de-duplication** — a double-click on Tweets |
| ~~`jobs_only_one_running`~~ | — | — | dropped; replaced by a counted cap, § below |

`jobs_one_running_per_slug` is `jobs_active_slug` with `queued` removed from its predicate. The other
two are the jobs it was also doing, given somewhere of their own to live.

**`jobs_active_work` is the index [`src/db/schema.ts`](../../src/db/schema.ts) says was removed as
"strictly subsumed"**, and it was — while `jobs_active_slug` covered `queued`. Relaxing that one is
exactly what un-subsumes it. That comment must be rewritten rather than left to contradict the
schema.

**`reserves_slug` is a new boolean column**, true iff the request arrived with a URL or an upload —
i.e. it is *asking for* an article rather than *naming* one.

**No existing column can stand in for it, and the obvious candidate actively misleads.** `url` does
not discriminate: `enqueue` fills it from `meta.json` for a late-step job
(`request.url ?? (request.upload ? undefined : await urlForSlug(slug))`), so
`{slug, steps:["tweets"]}` on a shelved article carries a URL exactly like a paste does. `upload_id`
marks uploads only, `work_key` is a sha256 and not invertible, and `steps` cannot speak for it either
— `enqueue({slug, steps:["fetch"]})` with no URL is a real shape that a test already uses. The
predicate exists today only in memory, at the `if (!request.url && !request.upload)` that throws the
409. This persists that one boolean at insert so an index can see it.

A slug-named step job never reserves, so it can never be renamed and never be refused. On the
filesystem side it rides beside `workKey` as a sibling key in the stored document
(`src/store/jobs-fs.ts`), which keeps it off the public `Job` type for
the same reason `workKey` is off it.

### Which conflict fired

`enqueueOrGet` currently uses `onConflictDoNothing()` and then re-reads, because there was only one
index that could fire. With three, the caller has to know which — so the insert catches `23505` and
branches on the constraint name with `violatesConstraint`
([`src/store/db-errors.ts`](../../src/store/db-errors.ts)), which this file already does on the claim
path.

The mapping onto the existing `{ job, created, sameWork }` return needs no signature change:

- `jobs_active_work` → identical work already pending → `{ created: false, sameWork: true }` → the
  caller hands that job back and pumps it. Today's behaviour, reached by a narrower index.
- `jobs_reserved_slug` → the name is held by different work → `{ created: false, sameWork: false }` →
  the caller allocates the next suffix and retries. Today's behaviour.
- Nothing else can fire on an insert, because the article mutex is `status = 'running'` and a row is
  inserted `queued`.

**The 409 becomes unreachable for slug-named work**, which is the whole point. It stays reachable for
`freeSlug` exhaustion (`Too many articles already called "x"`), which is a different sentence.

### The global cap

`jobs_only_one_running` is a unique index on a constant, and a constant cannot express N. Two ways to
replace it, and this plan proposes the first:

**A. Count inside the `queue_state` row lock.** `queue_state` is a singleton table that exists for
precisely this and is, verified by grep, **read by nothing and written by nothing outside its own
migration and two schema tests** — its own
comment says *"Claiming locks it FOR UPDATE before choosing a job"*, and the Postgres claim does not.
Wrap the claim in a transaction: `select … for update` on the singleton, count `running` rows, refuse
with `busy` at the cap, otherwise the existing `UPDATE`. The row lock serialises claims, so the count
is exact rather than a read-committed guess.

**B. A `running_slot smallint` column with a unique index on `(running_slot) where status =
'running'`,** the claim picking the lowest free slot. This keeps the property the current design
values — *the database enforces it, not the convention* — at the price of a column and a subquery.

A is simpler and revives a table that is otherwise dead weight; B keeps a backstop against a future
claim path that forgets the lock. **This is the first question for the review.**

**Either way the article rule stays a partial unique index of its own** rather than joining the
counted check. It is then self-enforcing, needs no lock, and — the part that matters for the client —
raises a **distinct constraint name**, so `busy` can say which of the two waits this is. Folding it
into the lock would make both waits one indistinguishable answer.

**And a silent-success trap worth naming.** If `jobs_only_one_running` is dropped and the counted
check is forgotten, nothing fails: `violatesConstraint(err, "jobs_only_one_running")` simply never
fires and every claim succeeds. One test stands between that and a green suite — the parity case that
expects `busy`. It must be rewritten to assert the cap rather than deleted.

The cap is configurable, and **the default is 3** — Greg, 2026-08-30, asked while this plan was
being reviewed. It supersedes the *"default to 2"* recorded earlier the same day in
[260830am-faster-ingest-and-concurrency.md](260830am-faster-ingest-and-concurrency.md), which was answering a narrower
question. Three is enough to ingest one article, ingest a second, and answer a reader asking for a
glossary, all at once.

### Why within-an-article stays serial

Not because tweets and glossary conflict — they touch different artefacts — but because of how any
job publishes. A job opens a draft copied from whatever is published now (`beginDraftIn`), writes
into it, and at the end moves `articles.current_revision_id`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)). It records `basedOn` and
**nothing ever checks it**: `publishRevisionIn` validates that the draft exists, belongs to the
article and is still a draft, and never asks whether the article moved underneath it.

```
   rev N ──┬── job A: draft (+glossary) ──────────► publish  rev N+1
           │
           └── job B: draft (+summary)  ─────────────────────► publish  rev N+2
                      (branched from N, so N+1's glossary is not in it)

   result: the glossary is gone, both jobs report success, every check passes
```

**And a second reason, on the laptop.** `chooseDataRoot` returns the repository root when not
deployed (`src/store/data-root.ts`); the per-job
`/tmp/spideryarn/<owner>/<job>/` split exists only under `VERCEL`. So two jobs on one slug would
write the same `data/<slug>/` locally. That is **not** a problem for this plan — the article rule
means it never happens — but it is a second thing within-article parallelism would have to solve, and
it is invisible in production, which is the worst place for it to be discovered.

So lifting the article mutex without first making publication compare-and-swap on the base revision
would convert a 409 into silent data loss — the shape of
[silent-success.md](../reusable/silent-success.md). Serialising per article keeps it closed by
construction, and it is what Greg asked for. Making it safe is a real piece of work and belongs with
[260827aa-delete-the-importer.md](260827aa-delete-the-importer.md) D2 onward, where the stages stop writing files.

## What the review changed

Four blockers, each verified here rather than taken on trust.

**1. The prerequisite: a queued late step cannot read the article it is for.** `claimSession` always
builds `fsStoreSession({ artifacts: pipelineStore })` and only *wraps* it with publication
([`src/jobs.ts`](../../src/jobs.ts)), so every stage reads files — and on a deployed instance those
files live in a scratch directory scoped to *this job's id*
(`src/store/data-root.ts`). A `summary` job queued behind an ingest
therefore claims on some instance, opens `blocks.json` in its own empty directory, and dies before it
generates anything. Verified: `src/summarise.ts` opens the file directly.

**The plan's own 202 test would have passed while the feature failed** — which is precisely the shape
of [silent-success.md](../reusable/silent-success.md), arriving in the test list rather than in the
code.

This is not hypothetical and it is not ours: session `spideryarn2-1a` reported three production
occurrences on 2026-08-30 (one `tweets`, two `arc`), has a red repro and a plan of its own at
[260830aq-late-steps-read-the-store.md](260830aq-late-steps-read-the-store.md). **Stage 2 waits for it.** Stage 1 does
not depend on it at all.

**2. The article mutex must key on `slug` alone, not `(owner_id, slug)`.** `articles.slug` is
**globally unique** — *"because it is the URL contract (`/read/<slug>`)"*,
[`src/db/schema.ts`](../../src/db/schema.ts). So two owners can build toward one slug, and today only
`jobs_only_one_running` keeps them from doing it at the same time. Remove that and both pay in full
before the loser finds out at publication. The running mutex and the name reservation go global on
slug; `jobs_active_work` stays owner-scoped, because de-duplication is a fact about one person's
request.

That two owners can race for a slug at all is **older than this plan** — `freeSlug` resolves through
owner-scoped lookups, so B cannot see A's article — and it fails serially today rather than
concurrently. This does not fix it; it stops making it worse and cheaper to hit.

**3. Constraint-name dispatch is unsound, and the fix is to stop dispatching.** Two identical URL
ingests violate `jobs_active_work` **and** `jobs_reserved_slug` in the same insert, and Postgres
offers no promise about which name it reports. Reported as the reservation, the caller would read
"different work", and `freeSlug` deliberately re-adopts the same slug for the same URL — so it either
loops to the 409 or creates a second article and pays twice.

So the insert keeps `onConflictDoNothing()` and the caller **re-reads and decides**, which is what it
does today. The only change is what it reads: not the single active row, but the active rows for that
slug, asking two questions — *is one of these my work key* (hand it back) and *is one of these
reserving this name* (rename). One query, no constraint names, and the indexes go back to being
guarantees rather than a signalling channel.

**4. The article rule creates contention, not a queue.** `claim(id)` claims whatever id it is handed
and never looks for an older job on the slug, `useJobs` drives every active id at once, and the job
list is newest-first. So a late step can beat a *queued* ingest and fail because the article does not
exist yet.

Sol's remedy is a FIFO predecessor rule. **This plan takes a narrower one**, and says why: strict FIFO
plus Sol's own recommendation to stop sweeping queued jobs puts an abandoned queued job permanently in
front of an article's queue — which is Greg's original complaint wearing a different hat, and the two
recommendations were made in different sections without meeting. The failure that actually costs
something is the one Sol names first: **a job whose article does not exist yet must not claim.** That
is a precondition, not an ordering, it cannot deadlock on an abandoned row, and racing between two
late steps on an article that already exists is harmless — the step stamps hash the current blocks,
so a summary that lands before a re-extraction is *detectably* stale rather than wrong. **This is the
first question for the second review.**

**And the sweep is dropped.** Sol is right that `last_seen_at` cannot tell abandonment from a
suspended phone, and that `advanceJobWith` sweeps *before* it touches the job it was asked about — so
the first request after an outage would kill the job it came to resume. What the sweep was for mostly
dissolves anyway once the 409 goes.

**One correction to this plan's own reasoning.** It claimed process-wide state is not shared on
Vercel because each job is its own invocation. [`src/jobs.ts`](../../src/jobs.ts) says otherwise in
its own words: *"several advance requests for different jobs really can be in flight in one instance
at once."* So the asset gate, the label fan-out and the summary fan-out are shared in production too,
and the assets one is **not** merely latency — a second article can spend its whole budget waiting
behind the first and then publish a manifest full of `out-of-time` failures, leaving images
hot-linked, which is the one thing that step exists to prevent.

## The bug

**A `queued` job never expires.** `failExpired` is `where status = 'running' and lease_expires_at <
now()` ([`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts)); a queued row has no lease, because the
lease is set at claim time. So a job left `queued` by a closed tab, a dev-server restart or
`sweepStopped` sits there for ever.

**Most of the harm goes away on its own with this change**, and that is worth being honest about: the
stale row's only user-visible effect today is the 409, and the 409 is what we are removing. Two
residues remain, and they are why a sweep is still wanted:

1. It holds a name, through `reserves_name` and `activeForSlug`, against a later paste of the same
   URL.
2. It is not inert. The next tab that polls will drive it, claim it and **run it** — paying for a
   model call on a job the reader abandoned days ago.

**The fix must not be age-based**, because after this change a queued job may legitimately wait a
long time behind a running ingest, and an age-out would kill exactly the jobs the feature exists to
allow. So: **a queued job is stale when nobody is driving it.** Add `last_seen_at`, touched by every
claim attempt for that job id — the successful ones and the `busy` refusals alike, since a refusal is
the driver saying *I am still here*. Sweep queued rows whose `last_seen_at` (falling back to
`created_at`) is older than a few minutes. A driven job is touched at least every `BUSY_CAP_MS`; an
abandoned one goes stale on its own.

**This is the third question for the review**: whether the residue justifies a column and a second
sweep, or whether the honest answer is to leave stale queued rows to `trimFinished`-style retention
and say so.

## What has to change

| File | Change |
|---|---|
| [`src/db/schema.ts`](../../src/db/schema.ts) | drop `jobs_only_one_running` and `jobs_active_slug`; add the three indexes above, `reserves_name`, `last_seen_at`; rewrite the "strictly subsumed" comment |
| `drizzle/` | one generated migration — **read it before applying**, per [database.md](../project/database.md) |
| [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) | `tryEnqueue` branches on the constraint name; `claim` takes the cap into account and maps the new index to `busy`; `failExpired` gains the queued sweep; `activeForSlug` prefers the reserving job |
| `src/store/jobs-fs.ts` | the same three rules in the in-memory index — `runningNow()` becomes a count and a per-slug check. **This is the local default**, so it is not the secondary adapter here |
| [`src/store/jobs.ts`](../../src/store/jobs.ts) | the contract's comments; `ClaimRefusal.busy.why` gains the article case |
| [`src/jobs.ts`](../../src/jobs.ts) | `enqueue` stops throwing 409 for slug-named work; the concurrency setting and where it is read |
| [`docs/project/ingest-queue.md`](../project/ingest-queue.md) | § *Concurrency is still 1, and still deliberately* is now false and must say what replaced it and why |

Deliberately **not** changing: `walkClaim`, the lease, `STEP_BUDGET_MS`, the publication path, and
how the client drives. The drive loops already do the right thing when told `busy`.

### One thing the client cannot currently say

`ClaimRefusal.why` **never leaves the server**. `advanceJobWith` maps `busy` to
`{ busy: true }` and drops the reason, and maps `stopping` to the same thing; nothing logs it, and
the route sends a 200. So no client can tell *waiting behind your own other article* from *the
machine is at its cap* from *another tab is inside this job* — and after this change the first of
those becomes the common case and is the one a reader most deserves a sentence for.

That wants a field on `Advanced` carrying the reason, and a line in the card. It is small, it is why
the article rule keeps a constraint name of its own, and the plan includes it rather than leaving
"queued" to mean three different things.

## What N > 1 makes wrong that was right

Four constants were measured with one job running. On Vercel each concurrent job is its own
invocation, so process-wide state is not shared and only the last of these bites; **locally they all
do**, and local is the filesystem store and the default.

- the asset fetch gate in [`src/collect-assets.ts`](../../src/collect-assets.ts) is process-wide, so
  N `assets` steps share its permits while each believes it has its own budget;
- the label fan-out in [`src/labels.ts`](../../src/labels.ts) and the summary fan-out in
  `src/summarise.ts` each become N times as many concurrent model calls,
  with **no spend cap anywhere in the repo**;
- `STEP_BUDGET_MS` entries are wall-clock worst cases measured uncontended, and the pre-flight check
  that asks whether the next step fits will say yes on evidence gathered when nothing else was
  running;
- `poolMax()` in [`src/db/client.ts`](../../src/db/client.ts) is deliberately small because the
  Supabase pooler limit is shared across instances. It is already `DATABASE_POOL_MAX`.

**None of these is a correctness bug and all of them are latency or money.** The plan's position is
that the first two want a line each (scale the gate with N; a ceiling on concurrent model calls) and
the third wants a note rather than a re-measurement. **The fourth question for the review** is
whether that is too relaxed — in particular whether the deadline pre-flight can now start a step it
cannot finish, which is the failure `STEP_BUDGET_MS` exists to prevent, arriving by a route the table
cannot see.

## Tests

Every one of these must be **seen red first**, and the ones marked ✱ are the ones a green run would
otherwise prove nothing about.

1. ✱ **Two articles run at once.** Two jobs, different slugs, both claim. Red today on
   `jobs_only_one_running`.
2. ✱ **Two jobs on one article do not.** Second claim answers `busy`, not `claimed`, and the first
   job's artefacts are still there when the second finishes. The second half is the one that matters:
   a `busy` that is really a lost publication passes the first half.
3. ✱ **`POST /api/jobs {slug, steps:["tweets"]}` during an ingest returns 202, not 409**, and the
   returned job is a *different* id from the ingest's.
4. **A double-click on Tweets makes one job**, via `jobs_active_work`.
5. **Two uploads called `paper.pdf` still get two slugs**, via `jobs_reserved_slug` — the collision
   the original index closed. Must be run against the store, not against `freeUploadSlug` alone.
6. **The cap is honoured**: N+1 concurrent claims, the last one `busy`.
7. **A queued job with no driver is swept; a queued job being polled is not.** Two cases, and the
   second is the one that fails if the sweep is age-based.
8. Parity: everything above runs against **both** adapters —
   [`tests/store-jobs-parity.test.ts`](../../tests/store-jobs-parity.test.ts).

**Three existing parity tests invert and must be rewritten rather than deleted**
([`tests/store-jobs-parity.test.ts`](../../tests/store-jobs-parity.test.ts)):

- *"turns a claim away while another job holds the one running slot"* uses two jobs with **different
  slugs**, so under this change both claim. It splits in two: the cap case needs N+1 jobs, and the
  article case is the new test 2.
- *"says when the slug is held by different work"* now describes `jobs_reserved_slug` and only holds
  for a name-claiming request; for slug-named work the answer becomes a second queued job.
- *"will not claim a job the reader has stopped"* carries a comment about releasing so as not to hold
  "the single running slot", which stops being true. The test still passes, which is why the comment
  has to be found deliberately rather than by watching for red.

**The wider blast radius, found by reading rather than by running.** Each of these names a
constraint or its premise, and a name that no longer exists fails in a way that points at the test
rather than at the change:

- [`tests/db-schema.test.ts`](../../tests/db-schema.test.ts) has two: *two jobs cannot be running at
  once* (expects `jobs_only_one_running` by name, on two **different** slugs) and a second-queued-row
  case that expects `jobs_active_slug` for both same and different work. The first becomes a cap
  test; the second splits between the work-key index and the reservation index.
- [`tests/db-schema-drift.test.ts`](../../tests/db-schema-drift.test.ts) pins the exact declared-table
  list, `queue_state` included — so option B, or removing the table, touches it.
- **Five hand-rolled waiters catch `jobs_only_one_running` by name** and go quiet rather than red when
  it stops existing: `store-step-fence`, `store-artefacts-pg`, `store-pg-session`, and two places in
  `jobs-publish-finalizer`. A waiter whose constraint can no longer fire waits for nothing, which is
  the good case; the bad case is that it was the only thing serialising that suite.
- `tests/jobs-fs-load.test.ts` pins that the work key survives a
  restart *"or that ends in a 409 for a request that should not have got one"* — the same 409, and
  after this change the sentence needs rewriting even though the test stays green.

**And an existing test surface that this changes for the better.**
[`tests/helpers/running-slot.ts`](../../tests/helpers/running-slot.ts) exists because
`jobs_only_one_running` makes every suite that inserts a `running` row race every other suite. Raising
the cap reduces that contention rather than adding to it — but the helper's own reasoning becomes
stale and it, and `tests/running-slot.test.ts`, have to be re-read rather than assumed still true.

## Where this sits beside the other plan

[260830am-faster-ingest-and-concurrency.md](260830am-faster-ingest-and-concurrency.md) already has concurrency as its
Stage 4, and its audit table of the four uncontended constants is the same one repeated above. This
plan does not duplicate it — it fills a gap that Stage 4 does not budget for. **That audit reads
`jobs_only_one_running` and does not notice that `jobs_active_slug` covers `queued` too**, so it
treats concurrency as "mostly four numbers and a scheduler". The four numbers are real, but the thing
actually refusing Greg's Tweets request is the second index, and moving it is the larger half of the
work. That file is another session's and is not edited here.

## Questions for the review

1. **A or B for the global cap** — the `queue_state` lock and a count, or a `running_slot` column with
   a real index? Is losing the database-level backstop acceptable when the claim is one function?
2. Does anything else in the tree assume *at most one active job per slug* in a way that a second
   queued row breaks? `activeForSlug` now has a choice to make and `slugIsSpokenFor` reads it.
3. Is the queued sweep worth a column, given the 409 it was mostly causing is being removed?
4. Is the position on the four uncontended constants too relaxed — specifically the deadline
   pre-flight?
5. Is there a case where a job is queued behind a running job on the same article and the **first
   job's publication changes what the second should do** — a re-extraction that re-mints block ids
   under a queued `summary`, say? If so, does the second job need to re-derive anything at claim time
   rather than at enqueue time?
