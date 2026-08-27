# The queue and the upload records get shared durable storage

> Now let's address the queue and shared durable storage.
>
> — Greg, 2026-08-27

**Read the correction first.** The first draft of this plan opened by calling this *"the last piece
between this app and an ingest that works on Vercel."* That is false, and
[GPT Sol's review](durable-queue-and-uploads-review-sol.md) returned **NO-SHIP** on it, saying the
plan was wrong in shape rather than incomplete. It was right, and the reason is worth putting above
everything else because it is the thing this whole migration keeps mis-estimating:

> **A durable job row does not make a filesystem pipeline durable.** Every stage still writes
> `data/<slug>/*.json`, `stepIsDone` reads those files to decide what is finished, and the Postgres
> artefact adapter **is not written** — [`src/store/artifacts.ts`](../../src/store/artifacts.ts) says
> so in its own header. So invocation A advances `fetch`, writes `raw.json` to an ephemeral disk, and
> invocation B takes the next `/advance`, finds no file, and runs `fetch` again. Moving the job row
> changes nothing about that.

So this work is **necessary and not sufficient**, and the rest of this document says so. What follows
is the corrected plan: same three pieces, a materially different fence, and an honest statement of
what still has to happen before uploading a PDF can be switched on in production.

---

## What is actually broken, checked rather than recalled

1. **A job lives in one process's memory.** `src/jobs.ts` holds `const jobs = new Map<string, Job>()`
   and mirrors it to `data/_jobs/<id>.json`. Every entry point starts there. The `jobs` table in
   [`src/db/schema.ts`](../../src/db/schema.ts) exists, is fully specified, and **nothing reads or
   writes it**. `JobStore` in [`contracts.ts`](../../src/store/contracts.ts) is declared with no
   implementation on either side.

2. **So the advance endpoint cannot work across invocations.** `POST /api/jobs` creates the job in
   instance A; the browser's `POST /api/jobs/<id>/advance` may land on instance B, whose Map is empty.
   `advanceJob` does `jobs.get(id)`, gets `undefined`, and the route 404s.

3. **Uploads refuse themselves rather than fail that way.** `recordsSurviveTheRequest()` returns
   `!process.env.VERCEL` and `POST /api/uploads` answers 503 when it is false. That was the honest
   thing to do with a filesystem record, and it is the only reason uploading is off in production.

4. **And the artefacts have the same problem, one layer down** — §"The dependency" below. Fixing 1–3
   without 4 gives a job that both invocations can *see* and neither can *continue*.

---

## The dependency nobody had written down

Three facts, each checked in the tree today:

- `src/jobs.ts` runs every step against `fsArtifacts`, hardcoded.
- `src/store/artifacts.ts`: *"the Postgres one is not written yet."*
- `src/store/revisions.ts` says the stages still write the filesystem, so a fresh Postgres draft
  stays empty.

Which means the ordering in
[postgres-storage-implementation.md § What happens next](postgres-storage-implementation.md#what-happens-next-in-order)
was right and this plan had inverted it: **item 4 (the shared transactional stage runner) comes
before item 5 (the advance endpoint)**. The advance endpoint got built first because it is small and
self-contained; that was fine, and it does not make the ordering wrong.

**What that means for this piece of work.** Everything below is needed whichever way the artefact
half is solved, so none of it is wasted — but the last step, *turn uploading on in production*, is
not ours to take. It waits on the artefacts. Said here so that a green test run at the end of this
work is not mistaken for a deployable feature, which is [the pattern](../reusable/silent-success.md)
this repo keeps writing up.

**And there is a real choice about how the artefact half is solved**, which is §7 and is a question
for Greg rather than a decision here.

---

## Scope

| | | |
|---|---|---|
| 1 | **The job record moves behind a store seam**, Postgres adapter on the existing `jobs` table, filesystem adapter that is today's behaviour | the shared part |
| 2 | **The attempt token, the fenced write, and a claim that releases** | the correct part |
| 3 | **Enqueue de-duplication and slug reservation stop being process-local** | the part the review said was missing |
| 4 | **The upload record moves the same way**, onto a new `uploads` table | the part Greg asked for by name |

Not in scope, each with a home: the Postgres artefact store and the shared stage runner (step 11
half B stage 5), the cutover flag flip (step 13), the staging-object sweep, pg-boss.

---

## 1. The job record behind a store seam

> **Half built, 2026-08-27.** The contract ([`src/store/jobs.ts`](../../src/store/jobs.ts)) and the
> Postgres adapter ([`pg-jobs.ts`](../../src/store/pg-jobs.ts)) exist and are tested, including the
> fence. **Not yet wired**: `src/jobs.ts` still holds the `Map`, and there is no filesystem adapter,
> so nothing reaches the store yet. That is the state the step-10 notes call the most dangerous one
> in the table, so it is written here rather than left to the file list — and the reason it stopped
> at this line is § 7: the wiring's *shape* depends on which way the artefact half goes, because
> hydrate-and-push would sit inside `runOneStep` in exactly the place claim/release does.


### The contract is transitions, not patches

`JobStore` as declared carries `claim(attemptId, leaseMs)`, `heartbeat` and `rescueExpired` — the
autonomous-worker design job-queue-rethink superseded. It is replaced by named transitions, because
**a generic `update(id, patch, attemptId?)` makes fencing optional and an optional fence is not a
fence** — step 12's own conclusion, and the review's finding 5 says the same thing from the other
end: a `commit(patch)` cannot check `cancelling` as part of the write, so a claimant can commit a
step onto a job the reader has already stopped.

```ts
export interface JobStore {
  list(owner: OwnerId): Promise<Job[]>;
  get(id: string, owner: OwnerId): Promise<Job | undefined>;

  /** Insert, or return the job that is already doing this exact work. Atomic. */
  enqueueOrGet(job: Job): Promise<{ job: Job; created: boolean }>;

  /** Take the job for **one** step. Fails rather than waits. */
  claim(id: string, owner: OwnerId, attempt: string, leaseMs: number): Promise<Claimed>;

  /** A step ran and the job is not over: record it and **release the claim**. */
  releaseStep(id: string, attempt: string, steps: JobStep[], patch: StepPatch): Promise<Job>;

  /** The job is over: done, error or cancelled. Clears the token and the lease. */
  finish(id: string, attempt: string, outcome: JobOutcome): Promise<Job>;

  /** Not a claimant, so not fenced: Stop, Delete, retention. */
  requestCancel(id: string, owner: OwnerId): Promise<Job | undefined>;
  forget(id: string, owner: OwnerId): Promise<boolean>;
  trimFinished(owner: OwnerId, keep: number): Promise<number>;
}
```

`Claimed` is a union rather than `Job | undefined`, because three things have to be told apart and
the caller does something different with each: `{ kind: "claimed", job }`, `{ kind: "busy", reason }`
and `{ kind: "gone" }`. Collapsing busy into gone reports a 404 for a job that is merely working,
which the client loop reads as *stop asking*.

**Every method takes the owner** except the two the attempt token already proves. Jobs got owners on
2026-08-27 for reasons written in `Job.ownerId`'s comment; a store method taking only an id re-opens
that hole one layer down.

### The adapters

- **`src/store/pg-jobs.ts`** — against the `jobs` table. **Three fields on `Job` have no column** —
  `upload`, `failureKind` and `profile` — and §4's migration adds them. That count came from putting
  the type beside the table, which is the only way this kind of gap is ever found: `profile` rides in
  every prompt a job's steps send, so a job resumed on another instance without it runs the plain
  prompt and reports success. The identical failure `guidance`'s own column comment describes, one
  field along.
- **`src/store/fs-jobs.ts`** — `writeOnce` / `persist` / `loadFromDisk` lifted out of `src/jobs.ts`
  unchanged, including the serialised-writes map, the `forgotten` set and `sweepStopped`. Not a
  rewrite: the same code behind a different door, so a laptop with no database behaves exactly as it
  does now.

### What happens to the in-memory Map

**It stops being the truth.** That is affordable for a reason worth checking rather than assuming:
`step.detail` — the thing that changes twice a second — is explicitly *not persisted while running*,
and `persist(job)` is called only at step boundaries. A six-step ingest is roughly a dozen small
`UPDATE`s. The frequency objection to a database-backed job record does not apply to this one.

**What it costs, stated plainly:** live sub-step detail stops crossing instances. The poll that reads
`3/8 chunks` out of a running process's memory will, on another instance, read Postgres and see the
detail as of the last step boundary. The card is correct at every boundary and quiet in between. Two
ways to buy it back, neither in this work: persist `detail` on a throttle, or stream the advance
response.

**And `list()` must not read every job.** `prune()` keeps 50 finished jobs per owner today; a
Postgres `list()` without that is an immediate payload regression as well as an unbounded table.
`trimFinished` is on the contract for that reason and is called where `prune` is called now.

### `sweepStopped` stops being true, and the deadline is what replaces it

`sweepStopped` returns every `running` record to `queued` at boot. Its justification is in its own
comment and is **single-process reasoning**: this process has just started, so nothing on disk can
have work happening against it. Against a shared database that is false — a `running` row may belong
to a live instance mid-step.

So the Postgres adapter does not sweep at load. The filesystem adapter keeps it, where the reasoning
still holds and is exactly why a dev-server restart leaves a job resumable.

---

## 2. The fence, rewritten after the review

> **Built and tested, 2026-08-27**, in `pg-jobs.ts` and `tests/store-jobs-pg.test.ts`. Two of those
> tests earned their comments the hard way and both are worth knowing about: the constraint check
> matched nothing at all because Drizzle wraps the driver error, and the fence test passed with
> `status = 'running'` removed until it was rebuilt on the state that condition is actually for.


The first draft got two things wrong here and both were criticals. They are corrected in place rather
than quietly replaced, because the wrong version is the one somebody will re-derive.

### Claim, and what it will not do

```sql
update spideryarn.jobs
   set status = 'running',
       attempt_id = $attempt,
       lease_expires_at = now() + $lease,
       started_at = coalesce(started_at, now())
 where id = $id
   and owner_id = $owner
   and cancelling = false
   and status = 'queued'
returning *
```

`rowCount === 1` is a claim. `0` is *not yours*, *finished*, *stopping*, or *somebody is inside it*,
and the adapter reads the row separately to say which.

**Note what is not in that `where`: there is no expired-lease takeover.** The first draft had one,
and argued it was safe because "nothing here is unattended". Both halves of that were wrong:

- **The browser loop is automatic.** `drive()` in [`useJobs.ts`](../../src/web/useJobs.ts) advances
  and retries on its own with exponential backoff. Nobody presses anything per step. So a steal is a
  program deciding to run a second copy, not a person deciding to resume.
- **A stolen-from claimant can still write.** The fence covers the job row. It does **not** cover the
  artefacts, and cannot while the stages write files: a stage writes its output and *then* calls
  `finishStep`, so a stale claimant's files land before its token is refused. `beginStep`'s own
  comment says it plainly — *"This is not a lock, and must not be read as one."* The first draft
  cited that marker as an independent fence. It is not one.

So: **an expired lease marks the job `error`, and Retry is explicit.** That is step 12's original
rule, which the first draft departed from and should not have. It costs a click and it removes the
whole class of two-runners-one-article. Auto-takeover becomes available the day artefact writes are
transactional, and not before — recorded as a trigger rather than a maybe.

### The claimant stops itself, before its lease does

An expired lease is only a safe signal if the claimant has really stopped. On Vercel the platform
guarantees that: a function killed at `maxDuration` cannot be alive after it. **Locally nothing kills
anything**, so the same lease means nothing on a laptop — the review's finding 4, and it is right.

So the claimant enforces its own deadline: a timer set at claim to `leaseMs − margin` that aborts the
step's `AbortSignal`, which every step already honours. The lease then expires *after* the claimant
has already unwound, on every platform, because we are the thing that stops it rather than the host.
A deadline-abort commits as an ordinary interruption with a sentence saying so, not as a mystery.

Two honest limits: a synchronous stall cannot run the timer (4 MB of DOM was measured at ~2.6s of
blocked event loop, so the margin is sized for that), and a model call already in flight is billed
whatever we do with the response.

### Release, which the first draft simply did not have

The sharpest finding in the review, and a genuine hole: a claim sets `running` with a live lease, and
the first draft only ever cleared the token on the *terminal* commit. So after step 1 succeeded, the
job would sit `running` with a token nobody holds, and **every subsequent advance would get `busy`
until the lease expired** — the endpoint deadlocking itself on the happy path.

One step, one claim, one release:

```sql
update spideryarn.jobs
   set status = 'queued', attempt_id = null, lease_expires_at = null,
       steps = $steps, title = coalesce($title, title)
 where id = $id and attempt_id = $attempt and status = 'running'
```

All three conditions in the `where`, always. `status = 'running'` is the one this project has now
dropped twice — a terminal row keeps its token, so `id` + `attempt_id` alone lets a rescued-and-failed
job accept its own former claimant's write and return `rowCount === 1`: success, reported, wrong
output. `rowCount === 0` throws a typed `StaleAttemptError`, because zero-rows-reads-as-success is
the pattern.

`finish` is the same predicate with a terminal status, and clears the token and lease too.

### Cancel

`requestCancel` sets `cancelling = true` and is not fenced — it is not a claimant. `claim` refuses
while it is set, so Stop costs at most the step in flight, which the running claimant aborts through
its own signal exactly as today. Across instances Stop means *no further step starts*, which for a
browser-driven loop is Stop working, and better than the 10 seconds step 12 was willing to accept.

### `jobs_only_one_running` is a mutex, not a scheduler

The partial unique index gives global concurrency 1 and a second claim raises `23505`, which the
adapter catches and reports as `busy`. That is correct and it is why `queue_state` is not needed —
but **`queue_state` is not dropped**, because `tests/db-schema.test.ts` asserts the singleton
constraint and removing a table is a migration decision of its own. It stays, unused, with a comment
saying why.

The index does not *start* anything. Whatever is queued behind the running job starts because
something asks again — the browser's `drive()`, which already backs off and retries on `busy`, or
§5's local pump. Naming that is the point: the constraint serialises, the pump schedules, and
confusing the two is how a job sits queued for ever.

---

## 3. Enqueue de-duplication and slug reservation

Today both are `Map` scans — `activeFor(slug)` finds the first active job for a slug and `sameWork`
decides whether to hand it back. Neither survives a second instance, and the second instance is the
whole point of this work. Two constraints, both cheap:

- **`work_key text not null`** — an immutable hash over the canonical ordered `{step, force}` list
  plus `guidance ?? ""` plus `profile ?? ""`, with a partial unique index over
  `(owner_id, slug, work_key)` where `status in ('queued','running')`. `enqueueOrGet` is
  `insert … on conflict do nothing returning *`, then a select when nothing came back. Today's
  identity already includes guidance, and `postgres-migration.md` omitted it; profile joins it for
  the same reason, since a job differing only by profile is genuinely different work.
- **The active slug is reserved by the same index**, one column short: a partial unique index on
  `(owner_id, slug)` where `status in ('queued','running')` makes "one active job per article" a fact
  rather than a convention. `freeSlug` / `freeUploadSlug` stop being check-then-use and become
  insert-and-retry-the-suffix.

**One behaviour change to be honest about.** Today a second, *differently*-shaped job for the same
slug is queued behind the first. Under the slug index it is refused with a conflict the route turns
into a 409. That is a small loss and the right trade while concurrency is 1 — the alternative is
letting two jobs queue against one article and hoping they run in the order that makes sense, which
is the fault `orderSteps` exists to prevent, one level up. Flagged in §8 rather than decided.

---

## 4. The upload record

> **Built, 2026-08-27.** The table and its two migrations, then
> [`src/store/uploads.ts`](../../src/store/uploads.ts) with a filesystem adapter (today's code,
> moved) and [`pg-uploads.ts`](../../src/store/pg-uploads.ts), with `src/upload-records.ts` reduced
> to the seam. `tests/store-uploads-parity.test.ts` runs the same two-simultaneous-claims race
> against both, and was watched red against a read-then-write implementation of the Postgres claim
> before it was believed. **This does not switch uploading on in production** — see § The dependency.


The state machine is already storage-agnostic on purpose — `canTransition`, `grantExpired` and
`sweepable` live in [`src/source.ts`](../../src/source.ts) and know nothing about files. So this is a
change of adapter, and the exported names in `src/upload-records.ts` do not move.

### The table

```sql
create table spideryarn.uploads (
  id                uuid primary key,
  owner_id          uuid not null,                       -- FK to auth.users in the custom migration
  filename          text        not null,
  claimed_bytes     integer     not null,
  claimed_sha256    text        not null,
  status            text        not null,
  minted_at         timestamptz not null default now(),
  grant_expires_at  timestamptz not null,
  sha256            text,
  bytes             integer,
  reason            text,
  slug              text,
  check (status in ('pending','claimed','verified','rejected','expired')),
  check (claimed_bytes > 0 and claimed_bytes <= 52428800),
  check (claimed_sha256 ~ '^[0-9a-f]{64}$'),
  check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  check (status <> 'verified' or (sha256 is not null and bytes is not null)),
  check (status <> 'rejected' or reason is not null)
);
create index uploads_owner_minted on spideryarn.uploads (owner_id, minted_at desc);
```

Five points where the review corrected the first draft, each a small thing that would have shipped:

- **Five statuses, not four.** `UploadStatus` carries `expired` too. Four would have passed every
  test and every migration, and failed at the first expiry with a constraint violation nobody could
  read. The list belongs beside the type it copies — and the test that keeps them in step is worth
  more than the constraint: assert `NEXT`'s own keys against the values the column accepts, so a
  sixth status added to the type fails a test rather than a write.
- **`integer`, not `bigint`.** `node-pg` returns `int8` as a **string**, because it does not fit a JS
  number in general — so a `bigint` column silently turns `bytes: 52428800` into `"52428800"` and
  every arithmetic comparison downstream starts lying. The cap is 50 MB and `integer` holds 2 GB.
- **No `claimed_at`.** The first draft invented it. `UploadRecord` has no such field, and a column
  with nothing to hold is a column somebody later writes code to fill.
- **The two evidence checks.** `verified` without a hash, or `rejected` without a reason, are states
  the type cannot express and the table could. Now it cannot either.
- **The owner FK matches the jobs one.** Whatever `auth.users` deletion does to a job it must do to
  that job's upload; one cascading and one restricting is a retention policy nobody chose.

### The claim gets simpler, and that is the interesting part

On the filesystem, claiming exactly once needs a create-only marker (`open(…, "wx")`), because
read-then-write has a gap however short. In Postgres it is one statement:

```sql
update spideryarn.uploads
   set status = 'claimed'
 where id = $id and owner_id = $owner
   and status = 'pending' and grant_expires_at > now()
returning *
```

`rowCount === 1` wins the race, `0` loses. The filesystem adapter's cleverest machinery is the piece
the database makes disappear — and the review agreed this one is sound.

### The terminal transitions need the job's attempt token

The review's finding 8, and it is real: `settleUpload` and `rejectUpload` are called from inside a
pipeline step, so a stale claimant can reject an upload that the live claimant is about to verify —
after which the live one cannot settle it, because it is already terminal.

With expired-lease takeover removed (§2) there is no stale claimant to do it, so **this is closed by
construction for now**. It reopens the day takeover comes back, so `settle` and `reject` take the
attempt token from the start and check it against the job row in the same transaction. Cheap now,
and the alternative is finding it again later from the other end.

### Then the guard changes rather than going

`recordsSurviveTheRequest()` becomes *"does this installation have a store that survives the
request"* — true for Postgres, false for files-on-Vercel. A misconfigured deployment still refuses
honestly instead of minting a grant into a record nobody will find, and the sentence in
`src/messages.ts` stays. **It does not go away in this work**, because §"The dependency" means an
upload that got past it would still fail at the first step boundary.

---

## 5. The local pump

job-queue-rethink rejected *"browser drives while open, server picks up when it is not"* as needing
client leases and worker leases and fencing and rescue and two schedulers. That rejection was made
before the advance endpoint needed a lease and a fence of its own — and it needs both, because an
invocation can die mid-step whoever asked for the step. So the marginal cost of a second caller is
no longer all of that machinery, and the rethink's own blessing of the rescue cron says why:
*"another caller of the same primitive."*

One primitive, two callers:

```
runOneStep(jobId, owner) →  claim  →  run one step (own deadline)  →  release or finish
        ↑                                                                       ↑
   advanceJob: once, and report                    the local pump: again, until nothing is queued
```

- **`advanceJob`** is `runOneStep` once. Unchanged from the caller's point of view.
- **The local pump** replaces `void queue.add(…)` and p-queue goes with it — concurrency 1 is now
  `jobs_only_one_running` rather than a library's promise. The review is right that the first draft's
  loop was not a pump: it exited on `busy`, so job B never started once job A took the slot. A pump
  **retries `busy` with backoff and keeps going until nothing is queued**, which is what p-queue does
  today and what "close the tab and it still finishes" means on a laptop.
- **On Vercel the pump does not start**, because it cannot survive the invocation and would only
  produce `running` rows with dead claimants. The browser is the only driver there, which is what the
  endpoint was built for.

Nothing hands anything over: both callers claim the same way and losing means being told `busy`.

---

## 6. What has to be true before this is believable

Each pinned to a specific way of being wrong, and each watched red before it is believed.

1. **The fence.** Two attempts, one job: the second `claim` says `busy`; then let the first's lease
   lapse, fail the job, and prove the first token's `releaseStep` throws `StaleAttemptError`. Watched
   red with `status = 'running'` removed from the predicate — that is the condition this project has
   dropped twice, so the test exists to catch the third time.
2. **Release.** Claim, run a step, release, claim again with a *different* token, and get a claim
   rather than `busy`. This is the deadlock the review found; without this test the happy path breaks
   on step two and every symptom points at the client.
3. **The deadline.** A step that ignores its signal is aborted by the claimant's own timer before
   `lease_expires_at`, and the job commits as interrupted. Fails if somebody later "simplifies" the
   timer away, which would leave the lease meaning nothing on a laptop.
4. **Two jobs, one slot.** Claim A, claim B, get `busy` rather than a `23505` escaping as a 500.
5. **Enqueue twice at once.** Two concurrent `enqueueOrGet` calls for identical work produce one row
   and one job id. Against both adapters.
6. **Mint here, claim there.** Two store instances on separate connections — as close as a test gets
   to two invocations — mint an upload through one and claim it through the other, twice
   concurrently; exactly one wins.
7. **Parity for the things the review listed** and the first draft had not: `retryJob` carrying
   upload, guidance and profile; `forgetJob` refusing an active job; `trimFinished` keeping 50;
   `sweepStopped` on the filesystem adapter only; the `example` fixture.

---

## 7. The question that has to go to Greg

The artefact half has two shapes and they are not close to each other in cost:

**A. Port the writes.** Finish the Postgres artefact store and put the eight stages behind one
transactional stage runner — claim, run, validate, commit — used by the queue and the stage CLIs
alike. This is step 11 half B stage 5 and it is already the written plan. It is the right end state:
one transaction covering the draft, the step-run row, the artefact and the job transition, which is
what makes expired-lease takeover safe and what job-queue-rethink calls the thing most likely to be
got wrong.

**B. Materialise, run, put back.** Leave the stages writing files, and have the runner hydrate
`data/<slug>/` from durable storage at claim and push it back at commit. Much smaller — the stages do
not change at all — and it is how a lot of serverless build steps actually work. Its costs are real
and should not be soft-pedalled: transfer per step, a commit that is a set of object writes rather
than a transaction, and a shape that has to be undone later rather than built on.

**Recommendation: A**, and not because B is unsound. Because B's weakness is exactly the property
this design needs most — a commit that cannot be atomic cannot fence, and every hard thing here
(takeover, cancellation, resume, two tabs) reduces to whether the commit is atomic. B would buy a
working Vercel ingest sooner and would put the fence back where it was before this review.

> **Decided: A.** Greg, 2026-08-27, asked with both shapes drawn side by side and the costs of each
> stated. So the eight stage modules move behind one transactional stage runner, and the slower route
> is taken deliberately rather than by drift.

**What that settles immediately**, and it is the reason the question was worth asking before writing
another line: `runOneStep`'s shape. Under A it is claim → run → **one transaction** → release, which
is what §2 already describes, so the wiring can be built now and the transaction grows to swallow the
artefact writes when [step 11 half B stage 5](postgres-storage-implementation.md#what-happens-next-in-order)
lands. Under B the same function would have gained a hydrate before the step and a push after it, in
the very place claim and release sit — so building the wiring first and choosing afterwards would
have meant writing that function twice.

---

## 8. Open

1. ~~**A or B**~~ — **decided: A**, above.
2. **The active-slug index refuses a second differently-shaped job** where today it queues behind.
   §3. Right call at concurrency 1, but it is a behaviour change and it is the reader who meets it.
3. **Retention for uploads.** Jobs have `prune()`; uploads have nothing on either side of the move,
   so `uploads` grows for ever. One reader and a small row, so "later" may be the honest answer — but
   as a decision rather than an oversight.
4. **Migration ownership.** `src/db/schema.ts` is shared and `drizzle-kit generate` diffs the whole
   schema, so an unrelated in-flight column gets swept in. This migration is generated in one sitting
   with the diff read line by line, and `tests/db-schema.test.ts` updated in the same commit —
   including the `queue_state` assertions, which stay.

## See also

- [durable-queue-and-uploads-review-sol.md](durable-queue-and-uploads-review-sol.md) — the review that
  returned NO-SHIP on the first draft, and the source of most of the corrections above
- [job-queue-rethink.md](job-queue-rethink.md) — why browser-driven advance, and the three things that
  survive from the design it replaced
- [postgres-storage-implementation.md § What happens next](postgres-storage-implementation.md#what-happens-next-in-order) — the ordering this plan had inverted
- [pdf-upload-and-storage.md](pdf-upload-and-storage.md) — the upload flow this unblocks, and does not finish
- [ingest-queue.md](../project/ingest-queue.md) · [ingest-resume.md](ingest-resume.md) · [silent-success.md](../reusable/silent-success.md)
