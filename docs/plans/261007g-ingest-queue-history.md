# The ingest queue: the history moved out of the reference doc

Moved verbatim from [docs/project/ingest-queue.md](../project/ingest-queue.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so.

## The top of the doc

> **An ingest works on Vercel as of 2026-08-30, and everything below this line about it not working
> is kept because each answer was a correct diagnosis of a real obstacle and none of them was the one
> that mattered.** A real article — `paulgraham.com/todo.html` — was pasted at spideryarn.com and
> came out the other end: fetched, extracted, ten blocks with fresh ids, a table of contents, and
> published to the shelf. That morning the same paste had failed in sixteen milliseconds, as nine
> before it had.
>
> Three things had to be true together, and the last was the one nobody was looking at:
>
> 1. **A writable disk.** `ROOT` was derived from the module's own location, which is two levels up
>    from `src/store/` in the repository and `/var` in a bundle — so every ingest died on
>    `mkdir '/var/data'`. Now an injected, invocation-scoped root.
> 2. **One invocation for the whole job.** Every `/advance` may land on a different instance, so
>    step two looked for what step one wrote and found nothing. A claim now walks every step —
>    `walkClaim` ([`src/jobs.ts`](../../src/jobs.ts); it was called `advanceJobToCompletion` then).
> 3. **Something that actually publishes.** This is the one that had been marked done and was not.
>    `publishRevision` was called only from `revisions.ts`, the fixture loader and tests — **never
>    from the job path**. So a job could run every stage, write every file, go `done`, and leave
>    `articles.current_revision_id` exactly where it was. A green job, an empty shelf, and every
>    check reporting success. `src/store/publish-session.ts` is the finalizer that closed it. (That
>    decorator was deleted on 2026-09-01; the publication is now `pgStoreSession`'s own — see
>    *A finished job publishes the article* below.)

The hydration fix remains in [ingest-queue.md](../project/ingest-queue.md); the current publication seam
is in [§ A finished job publishes the article](../project/ingest-queue.md#a-finished-job-publishes-the-article-and-until-2026-08-30-it-did-not).

> **Superseded, and kept.** *"This does not make an ingest work on Vercel, and the section below
> saying it nearly does is the mistake worth not repeating."* Every stage still writes
> `data/<slug>/*.json` and `stepIsDone` reads those files, so invocation A writes `raw.json` to an
> ephemeral disk and invocation B finds nothing and fetches again. The job is durable; the *pipeline*
> is not. **True when written, and it correctly named obstacle 2 above** — what it missed is that
> fixing it would still have produced a green job and an empty shelf, because nothing published.

Before this, the add box on the homepage printed the four commands for you to run yourself. That was
honest — there was no job runner — and it is what
[library.md § Adding an article](../project/library.md#adding-an-article-the-box-submits-now) described. This is that stub
growing up, and it kept the shape it promised it would: the input stayed, and the command list became
the progress list.

## The pipeline is a list, not a function

### A step is done when *all* its files are there

#### The former per-step output declaration

(It declared an `outputs` list of repository paths beside `produces` until 2026-09-05, and the pair
existed so the swap to kinds could be checked against the old declaration. The paths went with the
filesystem store.)

## The queue: it was p-queue, and now it is an index and a loop

**p-queue is gone as of 2026-08-27**, and the reason is worth keeping because the library was never
the problem. It was chosen on 2026-08-25 against
[third-party-library-selection.md](../reusable/third-party-library-selection.md) — **p-queue 9.3.3**,
33.6M downloads a week, one small pure-ESM package, concurrency and `AbortSignal` in the API — and
the rejected list below is still the right list for the question that was being asked.

What changed is the question. Concurrency 1 was a promise **this process** made, and the moment
there can be two instances it stops being a fact. It became `jobs_only_one_running`, a partial unique
index that the database enforced across all of them.

### Concurrency is a number now, and it was never a resource limit

**Until 2026-08-30 this section said "concurrency is still 1, and still deliberately"**, and the
argument it gave was a good one: three of the six steps are long model calls billed by the token and
one is a fetch of somebody else's server, so running two articles at once doubles the spend rate and
halves the politeness — *"for a single reader adding a handful of articles a day, in exchange for
nothing."*

The exchange stopped being nothing.

### The browser is the worker

The loop that calls `POST /api/jobs/:id/advance` lived inside `useJobs`, which is mounted from the
shelf, the add page and `useStepJob`. **`App()` is a chain of early returns**, so it returns a
different root per route and there is no persistent shell component at all: every route change
unmounted all three, and `drive`'s `while (alive())` stopped.

**The plan for this work said that meant "click into an article and your import stops", and that was
wrong** — worth recording, because it is the claim two rounds of review were argued against.
`useArc` runs on every owned reading view and goes through `useStepJob`, so the reading view mounts
a poller of its own and picks the job back up within a second. What actually stopped were the routes
that mount none: `/profile`, `/design`, `/admin`, the landing page.

### What the card says, and why it says the time

> **The trap, sprung three times in one day, and the third time it survived two reviews.** The first
> figure came from grouping `_ai-calls.jsonl` by `runId`, which pulls in **eval batches of several
> articles under one id**. Corrected to group by `jobId` — and that version, *"hierarchy: six runs,
> median 409s"*, was wrong in both halves: **five of the six jobs failed at `hierarchy`**, so the
> median was a time to *failure* printed on a card as a time to finish; and model-call spans are not
> the clock `displayJob` shows, so the number could not be checked against the screen at all.
>
> **The tell was there and was argued away.** One "run" was 772 seconds, and no step can run that
> long — the claimant aborts itself at 740s. A measurement impossible under the code's own deadline
> is not a measurement. Noticing that and explaining it away is how a wrong number survives two
> reviews. GPT Sol found it on the third pass;
> [silent-success.md](../reusable/silent-success.md) is the whole of it.

### The rejected list, kept

Still the right answers to the 2026-08-25 question, and pg-boss is still the first thing to
re-evaluate — see [§ When this becomes Postgres](../project/ingest-queue.md#when-this-becomes-postgres).

| Rejected | Why |
|---|---|
| **BullMQ** | The best-known of these and its `updateProgress` + `QueueEvents` is exactly the progress mechanism we want — but it needs **Redis**, and [architecture.md](../project/architecture.md) says filesystem, one process, no infrastructure. Worth a second look one day: BullMQ 6 added a Postgres backend, though its own docs still call Redis "the most battle-tested option". |
| **pg-boss** | The runner-up — Postgres-only, nothing else to run, with retries, backoff, dead-lettering and cron included. It needed a database we didn't have, and adopting one to get a queue would have been the tail wagging the dog. **Postgres has since landed as a plan**, and this was reconsidered rather than inherited: still no, but for a different reason, and it stays the first thing to re-evaluate — see [§ When this becomes Postgres](../project/ingest-queue.md#when-this-becomes-postgres). |
| **graphile-worker** | The same idea as pg-boss and a good library. pg-boss has 2.7× the downloads and 1.6× the stars, which under [our first criterion](../reusable/third-party-library-selection.md#selection-criteria) — pretraining data — is the whole difference. |
| **bee-queue** | Redis again, with less momentum than BullMQ. No upside. |
| **fastq** | Fine, and lower-level than we need. Its enormous download count is `glob` pulling it in transitively, not people choosing it. |
| **better-queue** | Looks like it does everything; last published September 2022, no types. A trap. |
| **Inngest, Trigger.dev** | Hosted SaaS, or a self-hosted stack of eight to ten containers. For one reader on a laptop. |
| **Nothing at all** — a hand-rolled FIFO | Genuinely viable at ~50 lines, and it was close. p-queue wins on the two criteria that matter here: an API a model already knows cold, and someone else owning the concurrency and abort edges. |

The previous version of this project had **no queue**, and is worth reading as evidence rather than
as precedent — [original-version/overview.md](../project/original-version/overview.md). Its ingestion ran inline
inside Next.js API routes, with the browser tab as the orchestrator: a React component held the task
list and called the API once per unit of work. Their own docs call it a prototype shortcut, and it
cost them production 504s on long documents, lost all progress on a refresh, and never got migrated.
`PROJECT_STATUS.md` there still lists *"Background processing — move from frontend-driven to proper
job queue"* as unstarted. So: the server owns the queue here, and the browser only watches.

## The failures Retry is not offered under

Until 2026-08-26 the button appeared under every failure. That included the ones that are
arithmetic. Greg pasted a long article, stage 4 worked out that its answer would not fit in one
model response, said so, and offered him a Retry — which made the identical call and failed
identically. The whole story is in [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md).

## A finished job publishes the article, and until 2026-08-30 it did not

**A decorator held this seam from 2026-08-30 to 2026-09-01**, and it is worth a paragraph because
several plans and reviews are about it. `publishingSession` wrapped the *filesystem* session and, at
the end of a `done` job, copied the files the stages had written into a draft and published that. It
existed because the stages wrote their own files inside `run()` and returned nothing a session could
write, so `pgStoreSession` would have refused every one of them by name. Every step returns its
product now, so the copy has nothing left to do, and the flip
([260831b](../plans/260831b-finish-the-database-move.md) § Stage 3 — the flip) deleted it.

