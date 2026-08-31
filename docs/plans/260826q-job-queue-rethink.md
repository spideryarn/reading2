# Rethinking the job queue

> for the job queue, would it be easier to hold the state in the browser? And/or to use RLS? And/or
> are there libraries/patterns/Postgres/Supabase functionality that could help us?
>
> — Greg, 2026-08-26

Three questions, asked after
[step 12](260826e-postgres-storage-implementation.md#step-12-jobs-and-claiming-decided-before-it-is-built)
was designed and cross-reviewed but before a line of it was written. Answered here by three web
research passes and a GPT Sol judgement, all on 2026-08-26.

**The short version.** Two of the three ideas are dead ends, and the third one is right in a form
Greg did not quite propose. But the most important thing this exercise turned up is not an answer to
any of the three: **ingest on Vercel does not currently work, and two documents say it does.**

> **The endpoint was built on 2026-08-27**, along with the durable job record it needs —
> [260827h-durable-queue-and-uploads.md § 8](260827h-durable-queue-and-uploads.md#8-the-wiring-built-2026-08-27), and
> two code reviews of it are in this folder. **Ingest on Vercel still does not work**, and the
> sentence above is still the most important thing here: the *job* is durable now and the *pipeline*
> is not, because every stage still writes `data/<slug>/*.json`. That half is
> [260827j-transactional-stage-runner.md](260827j-transactional-stage-runner.md).
>
> The paragraph below headed *"And the fencing must cover the output, not just the job row"* called
> it correctly and it is still open — see that plan's § *Two things the reviews left open*. It also
> called it *"the single most likely thing to get wrong"*, which is worth its own line, because what
> actually happened is subtler than getting it wrong: the fence was built correctly around the job
> row and the output stayed outside it, so nothing looks broken.

---

## The live bug this uncovered

[260825d-deploy-and-repo-move.md](260825d-deploy-and-repo-move.md) says `POST /api/jobs` *"returns its 202 receipt
and continues the work with Vercel's `waitUntil`, which is exactly the shape
[`src/jobs.ts`](../../src/jobs.ts) already has"*.

**Both halves are false.**

- There is **no `waitUntil` anywhere in the repo** — checked, not inferred.
- `enqueue` starts an untracked floating promise (`void queue.add(…)`), and the Vercel adapter awaits
  only the request handler. A floating promise is *not* the shape `waitUntil` needs; `waitUntil`
  requires handing the promise to the platform explicitly.

So on Vercel the function returns 202 and the runtime is free to freeze or tear down the instance
immediately. The browser then polls a job that may never advance. And `vercel.json` caps the function
at **300 seconds** — the exact upper bound of a 1–5 minute ingest, with no margin.

This is [silent success](../reusable/silent-success.md) in the deployment story itself: the receipt
arrives, the UI shows a job, and the work may simply not happen. **It is independent of which queue
design wins**, and it should be fixed or written down as broken before anything else here.

One more fact that bears on every option below: **`waitUntil` is best-effort.** No retries, no
durability, dies with the invocation, and bounded by the same `maxDuration` rather than a longer
budget of its own. It is not a background worker and cannot be made into one.

---

## Idea 1 — hold the state in the browser

**Verdict: right instinct, wrong literal form. The corrected version is the best design we have.**

### Why the literal version is not on

**It has already been tried on this project's own predecessor, and it failed in production.**
[ingest-queue.md](../project/ingest-queue.md) records it: the previous version ran ingestion inline
in Next.js API routes *"with the browser tab as the orchestrator: a React component held the task
list and called the API once per unit of work."* The result was **504s on long documents and all
progress lost on a refresh**, and their own status doc still lists moving off it as unstarted.

That is this exact proposal, run for real, with a verdict already written down.

### The corrected shape

Postgres owns the job. The **browser asks the server to advance it one step**.

```
   BROWSER                          SERVER                        POSTGRES
   ───────                          ──────                        ────────
   POST /jobs/:id/advance  ──────►  read next permitted step ───►  job row
                                    run that ONE step
                                    commit its result       ───►  draft revision
                           ◄──────  return what happened          step-run row
   call again until done
```

The browser does **not** choose the step and cannot skip one — the server reads what is next from
Postgres. One request runs one step synchronously and commits before returning.

### What that deletes from step 12

FIFO claiming and the claim-again loop · worker kicks · boot rescue · cron rescue · rescue hidden
inside `GET /api/jobs` · the `queue_state` singleton and its lock-order and deadlock discipline ·
renewable heartbeats · `work_key`, **if** competing work is rejected rather than queued.

### What has to stay durable server-side regardless

The job's requested work and per-step state · `draft_revision_id` · the slug reservation · a
database-enforced single-running-step rule · **an attempt token and a fenced final write** · step
currency, publication validation, ownership and errors.

### How the browser failure cases actually land

| | |
|---|---|
| Tab closes mid-step | That request either commits or dies. No later step starts. Reopening reads durable state and resumes |
| Two tabs | Both may ask to advance; one conditional transition wins, the other gets a conflict and watches |
| Refresh, offline | Processing pauses *between* steps and resumes from Postgres |
| Lost invocation | A fixed attempt deadline makes it visibly interrupted; Retry is explicit |

**Refresh gets cheaper than it is today**, and for a reason worth noticing: `stepIsDone` already
derives what is finished from the *artefacts* rather than from the job record, so a refreshed browser
re-reads status and resumes. Today's mutable `Job` / `JobStep` record is a second account of the same
fact and can drift from it.

### The hybrid is a trap

Browser drives while open, server picks up when it is not. **Reject it.** Detecting that the browser
has gone and handing ownership to a server worker needs client leases *and* worker leases *and*
fencing *and* rescue *and* two schedulers. That is more complex than step 12, not less.

*(The research pass disagreed here and proposed a one-minute Vercel Cron calling the same idempotent
step endpoint as a rescue net — which is a much cheaper hybrid than the one Sol rejected, because the
cron is just another caller of the same primitive and the lock makes it a no-op while a tab is
driving. Worth weighing; it is not the same thing as handing over ownership.)*

---

## Idea 2 — RLS

**Verdict: no. Not merely orthogonal — inert, on the connection this app actually uses.**

RLS *does* govern mutations, not only visibility, so the usual dismissal is imprecise. The real
reasons:

1. **`auth.uid()` would be `NULL`, always.** The app connects as `spideryarn_app`, an ordinary login
   role, through the transaction pooler — **not** as a Supabase user carrying a JWT.
   `auth.uid()` reads `request.jwt.claims`, a session setting that PostgREST populates *after*
   validating a JWT it received over HTTP. A direct `pg` connection never presents one. Turning on
   `owner_id = auth.uid()` policies today would **deny everything**, not isolate anyone.
2. **The security boundary here is grants, not RLS**, deliberately — PostgREST cannot see the
   `spideryarn` schema at all.
3. **It cannot do the interesting half of fencing.** A policy could compare an attempt token held in
   a transaction-local setting, but that is the same predicate step 12 already has, moved from a
   `WHERE` into a `USING`, and **harder to debug** — an RLS-blocked write silently affects zero rows,
   which is the precise failure `fencedUpdate`'s `rowCount === 1` assertion exists to catch. It still
   would not select work atomically or serialise claimants.
4. `currentOwnerId()` is a process-wide environment value today, and reads do not filter by owner.

RLS is for when the second user arrives, as defence *behind* the API's own owner filtering. It does
not intersect queue correctness. **And a note for that day:** `spideryarn_app` must not be the table
owner and must not hold `BYPASSRLS`, or RLS is decorative for it too.

---

## Idea 3 — libraries and Postgres/Supabase native

### The one that actually matters: pgmq has no fencing

**Supabase Queues is GA and is built on `pgmq`.** Its guarantee is exactly-once delivery *within a
visibility window* — and that phrasing is the whole story. `read()` bumps `read_ct` and hides the
message until `vt` elapses. **There is no attempt id and no ownership token**, so if worker A's
visibility window lapses while A is merely slow rather than dead, B picks the message up, and A's
eventual `delete()` **succeeds unconditionally**.

That is the failure step 12's three-condition fence exists to prevent, named exactly. So pgmq would
not remove the fencing code — we would write it anyway, on top of pgmq, with pgmq underneath as an
extra moving part. And its strength, many workers pulling a shared backlog, is not this problem:
concurrency here is deliberately **1**.

Also worth knowing: the JS path is `supabase.schema('pgmq_public').rpc(…)` — through PostgREST —
which collides with the decision that the API layer is the boundary and the `spideryarn` schema is
not exposed. (Calling `pgmq.send()` as plain SQL over Drizzle avoids that.) Enabling the extension
appears to need a Dashboard click rather than a migration, since none of our three credentials is
superuser.

### The rest, briefly

| | Verdict |
|---|---|
| **`FOR UPDATE SKIP LOCKED`** | The honest baseline, and already the plan. `SKIP LOCKED` is not even needed at concurrency 1 — there is no backlog to skip past |
| **`pg_advisory_xact_lock`** | Safe under the pooler (transaction-scoped; it is the *session*-scoped kind that is not), self-releasing on crash, and a smaller replacement for `queue_state`. **Open question flagged and not verified:** holding one open across a 60–90s model call parks a pooled connection idle-in-transaction. Check against Supabase's `idle_in_transaction_session_timeout` and pool size before relying on it |
| **`pg_cron`** | Available on all plans, 1-minute minimum, runs as `postgres` in-database. Cannot reach HTTP (the `http` extension is disabled) — but step 12's rescue sweep is **pure SQL**, so cron can run it directly. Strictly less code than "piggyback on the jobs poll behind a module-level timestamp guard", which step 12 already admits misfires N times across N instances. **Goes dark while a free-tier project is paused** — which is also when nothing else is running |
| **Realtime** | Fine for pushing progress to a browser. **Useless for cancellation**, and for a sharper reason than LISTEN/NOTIFY's: a Vercel function is frozen between invocations, so there is no live process holding a subscription. You cannot push to a process that is not scheduled |
| **Supabase Edge Functions** | Deno, not Node — the pipeline would need porting to a second runtime. Background tasks cap at 150s free / 400s paid, and the free cap is already below our stated job length. No capability Vercel does not have |
| **BullMQ Postgres backend** | **Reject, and upgrade the reason.** It needs one dedicated long-lived `LISTEN` connection per instance — a worker shape, not a serverless one, and the primitive the pooler kills. Also four weeks old, and its own docs still call Redis the battle-tested option |
| **graphile-worker** | **Reject, now on technical grounds rather than download counts.** OSS crash recovery is a flat **4-hour** lock timeout with no heartbeat (fast recovery is paid Worker Pro), and OSS **cannot cancel an active job**. Those are the two things we need most |
| **pg-boss** | **Reopen — see below** |

### pg-boss deserves reopening, and the recorded reason for rejecting it was incomplete

The 2026-08-25 rejection said pg-boss brings its own job table beside ours, leaving two sources of
truth. On a closer reading of its v12 API that objection mostly dissolves:

- **It already has the heartbeat, lease and cancellation step 12 spent 400 lines designing** —
  `heartbeatSeconds` with automatic `touch()`, `expireInSeconds` as an independent stale bound, and
  `cancel()` on an active job delivering an `AbortSignal` to the handler. That is the same shape we
  converged on independently — *and GPT Sol found three critical fencing faults in our version before
  a line was written*, which is the actual argument here.
- **`singletonKey` plus an `exclusive` queue policy is the unsolved `work_key`**, already built.
- **Global concurrency 1 falls out of one queue with that policy** — no `queue_state` dance.
- **A first-class Drizzle adapter on `node-postgres`**, the driver already chosen. Job creation can
  run *inside the same transaction* as the slug reservation, which fixes the `freeSlug` race for
  free — a listed step-12 prerequisite.
- **It expects a transaction pooler.** LISTEN/NOTIFY is opt-in; the default is polling, the docs
  state plainly that notify does not work under transaction-mode pooling, and it emits
  `listen_notify_unavailable` and **keeps polling** rather than failing.
- **Serverless is an explicit design goal** — use `fetch()` / `complete()` / `touch()` rather than
  the long-lived `work()` loop.
- **Retries and dead-lettering are opt-in.** `retryLimit: 0` and none of it engages, so "brings
  machinery we do not want" is not a forced cost.

**The corrected version of the objection, which does survive:** `job.data` / `output` is one payload
plus one result blob, and `update()` only touches jobs that are *not yet active* — so live per-step
progress for a 1-second poll cannot live in pg-boss's row. A companion table is still needed. But
that is not a second copy of what pg-boss owns; it is a fact pg-boss never claimed to hold.
**pg-boss's row becomes the single lifecycle authority and our table shrinks to a step-progress
log** — a reduction on today's plan rather than a duplication.

**Three things to spike before committing:** how fast a remote `cancel()` actually reaches another
process's `AbortSignal` (is it tied to the 60s monitor interval?); whether its pool coexists with the
`max: 2` discipline set for Supavisor; and whether the pooled connection has `CREATE` for its
`pgboss` schema.

---

## Decided: the browser-driven advance endpoint

**Greg, 2026-08-26: *"Go with whichever's easiest for now."*** That has a clear winner, and the
reason is not code volume:

> **pg-boss does not solve the actual blocker.** Vercel has no long-running process. A queue library
> gives you a queue, not durable compute — you would still need something to *run* the job, and on
> Vercel that is another cron-triggered function with its own time limit. Browser-driven advance makes
> each step fit inside one ordinary request, so the problem disappears rather than moving.

It is also easiest on every other axis: no new dependency, no extension to enable, no Dashboard click
that CI cannot do, no `pgboss` schema, and none of the three unknowns that would need spiking first.
It keeps [the boring-first rule](../../CLAUDE.md), and it reuses two things already built —
`stepIsDone`, which derives progress from the *artefacts* rather than a job record, and the partial
unique index that already enforces one running job.

**The cost, stated plainly so it is not discovered later:** an ingest no longer finishes with nobody
watching. Close the tab mid-ingest and it stops between steps until a browser comes back. If that
turns out to matter, the cheap recovery is a one-minute Vercel Cron calling the *same* advance
endpoint — the lock makes it a no-op while a tab is driving, so it is another caller of one
primitive rather than a second scheduler. That is **not** the hybrid rejected above, which handed
*ownership* over.

**pg-boss is not dead, it is deferred**, and now with a trigger rather than a vague "revisit":
adopt it if and when there is a long-lived worker host to run it on (Fly, Railway, Render), at which
point its heartbeat, `singletonKey` and `AbortSignal` cancellation all become free rather than
irrelevant. Record that rather than re-deriving it a third time.

### What to build, smallest first

1. `POST /api/jobs/:id/advance` — server reads the next permitted step, runs that one step, commits,
   returns. The browser cannot name or skip a step.
2. The atomic waiting→running transition, with a fresh attempt token, leaning on the partial unique
   index that already exists.
3. **The fenced output write** — the draft, the step-run row and the job transition in *one*
   transaction, zero rows affected treated as failure. This is the part that must not be skipped.
4. The client loop in the add-article page: call, await, call again.
5. Only then, if wanted: the one-minute cron as a rescue net.

Steps 1–3 depend on `draft_revision_id`, which
[step 11](260826e-postgres-storage-implementation.md#step-11-the-pipeline-writes-revisions) needs anyway —
so this waits on that migration rather than racing it.

## What this comes down to

The two strong options — **browser-driven advance** and **pg-boss** — are alternatives, not
complements. Choosing between them turns on one question about how the product is actually used, and
nothing technical settles it:

> **Do you paste a URL and watch it, or paste a URL and walk away?**

- **Watch.** Browser-driven advance wins clearly. Much less code, no lease arithmetic, no rescue
  sweep, no `queue_state`, and Stop becomes *instant* — the browser simply does not fire the next
  request — where step 12 accepts up to a 10-second delay.
- **Walk away.** Then an ingest must finish with nobody watching, and that is precisely the property
  browser-driven advance deletes. A one-minute rescue cron recovers it at one-minute resolution;
  whether that is "finishes on its own" or a consolation prize is a judgement about the product.

Either way, **three things stay**: an attempt token with a fenced final write, a job-owned draft
revision, and the single-running-step rule (the partial unique index is already in the schema).

**And the fencing must cover the output, not just the job row.** A stale invocation must be unable to
write its draft, mark its step done, *or* publish — the fence check and every durable write in one
transaction, zero rows affected treated as failure. Checking the token and then writing separately
recreates the exact race the token exists to prevent. This is the single most likely thing to get
wrong whichever design wins.

## What to do next

1. **Fix or write down the `waitUntil` gap.** Independent of everything above, and currently
   misdescribed in two documents.
2. **Answer the watch-versus-walk-away question.** It selects the design.
3. ~~Then either spike pg-boss's three unknowns, or build the advance endpoint — not both.~~
   **The advance endpoint, 2026-08-27.** pg-boss stays deferred with the trigger this document set.

## Resuming after the tab closes

Asked separately and answered in [260826s-ingest-resume.md](260826s-ingest-resume.md): **yes, and most of it already
works**, because `stepIsDone` derives what is finished from the *artefacts* rather than a job record.
That makes "skip the bits it did" a fold over the step list rather than bookkeeping, and it means the
two accounts can never drift because there is only one.

Two things there bear directly on the cost recorded above. `sweepStopped` currently marks a job
`error` when the process stops, so a closed tab reads as a *failure* rather than a pause — a one-line
change, and worth making whichever design wins. And the mixed-generation fault in the artefact store
matters more here than anywhere else, because **resume is exactly the situation that produces it**.

## See also

- [260826e-postgres-storage-implementation.md § Step 12](260826e-postgres-storage-implementation.md#step-12-jobs-and-claiming-decided-before-it-is-built) — the design this reconsiders
- [ingest-queue.md](../project/ingest-queue.md) — why p-queue, the original library comparison, and the predecessor's browser-orchestrator failure
- [260825d-deploy-and-repo-move.md](260825d-deploy-and-repo-move.md) — where the `waitUntil` claim lives
- [silent-success.md](../reusable/silent-success.md)
