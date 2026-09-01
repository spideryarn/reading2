# Consultation: what should a reader be able to do about a stuck ingest job?

You are being asked for **design input**, not a code review. Nothing has been built yet. Argue for
the smallest design that actually removes the failure, and say clearly where you disagree with the
options below.

## The product

Spideryarn. A reader pastes a URL (or uploads a PDF), and a six-step pipeline turns it into an
article on their shelf: `fetch → extract → blocks → hierarchy → assets → arc`. Two of those steps
are model calls and take minutes. It runs on Vercel (serverless, `maxDuration` 800s, region lhr1),
with Postgres. There is **no cron, no worker, no queue daemon** — `vercel.json` has no `crons`
array and `api/` is a single function.

## How the queue actually works today (verified in the code, not assumed)

**The browser is the worker.** `POST /api/jobs/:id/advance` runs *one* step and returns.
`src/web/useJobs.ts` polls `GET /api/jobs` (1s while anything is active, 8s otherwise) and, for
every job it sees in `queued` or `running`, starts a `drive()` loop that calls `/advance` until the
server answers `done`. The server-side pump exists but is disabled in production:

```ts
// src/jobs.ts
function pump(id: string, owner: OwnerId): void {
  if (process.env.VERCEL) return;   // <-- laptop only
  ...
}
```

So in production **nothing moves a job unless a browser tab belonging to that reader is open on a
page that mounts `useJobs`** (the shelf, or `/add/<url>`).

**A claim, not a takeover.** A running step holds an attempt token and a lease. `LEASE_MS =
760_000` (12.67 min); the claimant sets its own abort at `LEASE_MS - DEADLINE_MARGIN_MS` = 740s,
which must stay under the 800s platform kill. One claim covers a whole job, because handing off
would land on a cold instance with an empty `/tmp` and re-run everything.

**The sweep is lazy and narrow.** `failExpired()` runs at the top of *every* `/advance` call —
there is no timer, because there is no scheduler. It is one statement:

```sql
UPDATE jobs SET status='error', attempt_id=NULL, lease_expires_at=NULL, cancelling=false,
                draft_revision_id=NULL, error='…interrupted…', failure_kind='retry'
WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at < now()
```

Note the `WHERE`: **only `running` rows with a lapsed lease.** A `queued` row has no lease at all.
An expired lease is never *taken over*, only failed — because artefact writes are not yet
transactional, and two runners writing one article is the thing being avoided.

**One job in flight per article**, enforced by a partial unique index `jobs_active_slug`. A request
that names a slug (`{slug, steps:['summary']}`) and finds one gets a 409: *"That article already
has a job running. Wait for it, or stop it first."* A request that pastes a URL gets the same 409
once `freeSlug` proves the held slug is that URL's.

**Stop already exists**: `POST /api/jobs/:id/cancel`. One `UPDATE` with a `case`: queued → straight
to `cancelled`; running → set `cancelling=true` and leave the lease and attempt alone, because the
claimant must be the one to unwind (it may be on another instance, where the `AbortSignal` cannot
reach). The button reads "Stopping…" until the claimant notices at its next step boundary.

**What the reader sees.** The `/add/<url>` page, and an "Add an article" box on the shelf that
shows this sitting's jobs, with earlier ones folded behind an `n earlier imports` chevron. Anything
still running always shows. A failed job's card never auto-clears and carries a Retry button when
`failureKind` says another go could help. Retry creates a *new* job with the same steps; steps whose
artefacts are already present are skipped in milliseconds, so a retry resumes rather than restarts —
the two model calls are the expensive part.

There is **no admin view of jobs across owners.**

## The failure states we can actually reach in production

1. **Abandoned `queued`.** Claimant released after a step; the tab closed before the next
   `/advance`. No lease, so `failExpired` can never see it. The slug is held by `jobs_active_slug`,
   so a re-paste of the same URL 409s. It clears only if the reader opens a page that mounts
   `useJobs`, whose first poll picks it up and drives it. Nobody else's traffic helps — the poll is
   scoped to that reader's own jobs.
2. **`running` with a dead claimant.** Instance killed mid-step (deploy, OOM, platform eviction).
   The lease is live for up to 12.67 minutes. Every `/advance` in that window answers `busy`, so the
   reader watches a progress row that does not move, with no error and no elapsed-time signal.
   After the lease lapses, the *next* `/advance` from that reader sweeps it to `error` with an
   "interrupted" message and a Retry button.
3. **Stop pressed on a dead claimant.** `cancelling=true` is written and nobody ever reads it. The
   button says "Stopping…" and stays disabled for up to 12.67 minutes, after which the row is
   swept — and reported as *interrupted*, not *cancelled*, which is not what the reader did.
4. **The observed local incident that prompted this.** A row said `running` with `started_at` NULL
   and a lease that had expired 40 minutes earlier, and nothing reclaimed it, because nothing was
   calling `/advance` for that owner.

## What Greg asked

> I'm wondering what a user would do if this happened to them in production? We had talked about a
> progress bar for showing the things in queue, with a way to cancel things. Presumably that would
> help with this kind of thing? And/or cancel anything that takes longer than some period (e.g. an
> hour)? Any better ideas?

## The house style you are arguing inside

- **Prefer boring**, and **prefer simple over easy**: fewer parts touching each other beats fewer
  lines. Adding infrastructure (Redis, a queue library, a container) needs to clear a high bar;
  Postgres and shadcn/Tailwind are the only two exceptions ever granted.
- **Silent success is the enemy.** Most bugs in this repo have been something reporting success
  while doing nothing, with the obvious check agreeing because it shared an assumption with the
  code. A spinner that spins for ever is treated as the worst available outcome.
- **Reader-facing copy is part of the design**, in plain words, saying the true thing.
- A cross-family review is expected to name the *simpler option that was passed over*.

## The questions

1. **What is the right thing for the reader to be able to do**, and where does it live? Is a queue
   panel with a Stop button per row the answer, or is the existing add-page card plus shelf box
   already the surface and the problem is purely that it does not say enough?
2. **Is a time-based auto-cancel (say, an hour) a good idea or a trap here?** Note the pipeline's
   own worst case is ~9 minutes of real work and the lease is already 12.67 minutes, so an hour is
   two orders of magnitude of slack over a job that is definitionally either progressing or dead.
   What is the *right* clock, and what should the reader be told when it fires?
3. **The `queued`-with-no-lease hole.** Options we see: (a) give queued rows a `stale_after`
   timestamp so `failExpired` can see them too; (b) make `failExpired` sweep on *any* authenticated
   request, not only `/advance`; (c) a `GET /api/jobs` that sweeps before it lists; (d) an actual
   Vercel cron. Which, and why not the others? Is (d) the honest answer we are avoiding because
   "no infrastructure" has become a reflex?
4. **Should an expired lease become a takeover rather than a failure?** The blocker is that
   artefact writes are not transactional. Is failing-and-Retry actually fine for a single-reader
   product, given a retry skips completed steps — or is the resume gap worse than it looks?
5. **Should Stop be able to force-clear a job the server can prove nobody holds?** i.e. a Stop on a
   `running` row whose lease has already lapsed could go straight to `cancelled` in the same
   `UPDATE`, rather than writing `cancelling` and waiting. What breaks?
6. **What should the reader see while a step is legitimately slow?** Today a two-minute model call
   reports bytes streamed. Is elapsed time plus "this normally takes about a minute" the cheap win,
   and does that make most of the above unnecessary?
7. **What are we not thinking of?** Name the failure this design will have that we have not listed.

Be concrete. Where you recommend something, say what it costs and what the simpler thing we should
do instead is if we only do one.
