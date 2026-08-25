# The ingest queue

Paste a URL on the homepage and an article appears on the shelf a minute or two later, with the
stages ticking over while you watch.

> Now let's think about the "Add" functionality that takes a URL as an argument. There should be
> some kind of queue that processes things (e.g. fetch, Mozilla Readability, sanitiser), and ideally
> a progress indicator.
>
> — Greg, 2026-08-25

Before this, the add box on the homepage printed the four commands for you to run yourself. That was
honest — there was no job runner — and it is what
[library.md § Adding an article](library.md#adding-an-article-the-box-submits-now) described. This is that stub
growing up, and it kept the shape it promised it would: the input stayed, and the command list became
the progress list.

| File | What's in it |
|---|---|
| [`src/pipeline.ts`](../../src/pipeline.ts) | the six steps, as data — the only place that knows the pipeline's order |
| [`src/jobs.ts`](../../src/jobs.ts) | the queue, the job records, and the restart sweep |
| [`src/routes.ts`](../../src/routes.ts) | six HTTP routes, all of which return immediately |
| [`src/web/useJobs.ts`](../../src/web/useJobs.ts) | the poll |
| [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) | the box and the progress list |
| [`src/ingest.ts`](../../src/ingest.ts) | `slugFromUrl` and `isSlug` — what an article gets called, and whether that name is safe |
| [`src/fetch.ts`](../../src/fetch.ts) | stage 1, somebody else's — [fetching.md](fetching.md) |

## The pipeline is a list, not a function

Six steps, in [`src/pipeline.ts`](../../src/pipeline.ts):

```
  fetch     Fetching the page              → data/<slug>/raw.html
  extract   Extracting the article         → output/<slug>.html, data/<slug>/meta.json
  blocks    Splitting into blocks          → output/<slug>.blocks.json   (and the sanitiser)
  toc       Building the table of contents → data/<slug>/tree.json, data/<slug>/blocks.json
  arc       Writing the arc                → data/<slug>/arc.json
  tweets    Writing the thread             → data/<slug>/tweets.json     (never on a plain add)
```

Each step is a name, a label, **the artefact it produces**, and the function that produces it. A job
is a *list of step names*, which is the whole reason this is data rather than four `await`s in a row.
Greg asked for more than "add this URL" — re-run one stage after a prompt change, refresh an article
from source, and *"potentially it'll be used in other ways too"* (2026-08-25). All of those are the
same machinery given a different sub-list, and none of them needed a special case.

- **Add** — every step in `DEFAULT_INGEST_STEPS`, which is the first five.
- **Re-run a stage** — `{ slug, steps: ["arc"], force: ["arc"] }`.
- **Refresh from source** — the default steps, with `force: ["fetch"]`.
- **Write the thread** — `{ slug, steps: ["tweets"] }`, which is the button on the tweets page.

### `STEP_ORDER` is not the default list

They were the same array until the sixth step arrived, and separating them is the whole change the
tweet thread needed in this file ([tweet-thread-page.md](../plans/tweet-thread-page.md#the-one-real-snag-stated-precisely)).
The constant was quietly doing three jobs:

| Read at | What it means there | Does `tweets` belong? |
|---|---|---|
| `orderSteps`, sorting by `STEP_ORDER.indexOf` | the chain's order | **yes** — a name that is missing gets `-1` and sorts to the *front*, so it would run before `fetch` |
| `isStepName`, which is `STEP_ORDER.includes` | the names the API will accept | **yes** — otherwise `POST /api/jobs { steps: ["tweets"] }` is a bad request and the button can never work |
| `enqueue`'s `request.steps ?? …` | what a bare "add this URL" runs | **no** — a thread costs a model call and nobody asked for one |

So `STEP_ORDER` gained `tweets` and `enqueue` now defaults to `DEFAULT_INGEST_STEPS`, which is the
same five as before. [`tests/jobs.test.ts`](../../tests/jobs.test.ts) pins both: that `tweets` is a
valid name, and that it is **not** in the default list.

### The pipeline is no longer one straight line

`cascadeForce` above encodes *"invalidating a step invalidates everything after it"*, and that is
sound for a chain in which each step eats what the one before it wrote. **`tweets` is not a link in
that chain.** It reads `blocks.json` and `tree.json` — the same inputs the arc reads — and nothing
reads what it writes. Its position after `arc` in `STEP_ORDER` is about *running order*, not about
dependency, and reading it as dependency costs money: forcing `arc` in a job that also holds
`tweets` would spend a second model call rewriting a thread whose inputs never moved.

So `FORCE_ONLY_WHEN_NAMED` in [`src/pipeline.ts`](../../src/pipeline.ts) holds the steps the
positional cascade may not speak for, and `tweets` is in it. Forcing an earlier step no longer
forces the thread; `force: ["tweets"]` still does, which is the rewrite button.

**Read that together with the next section, because neither half is safe alone.** Taking a step out
of the cascade is only defensible when the step can tell for itself whether it is current — and
`tweets` can. `arc` deliberately stays *in* the cascade for the inverse reason: it has no freshness
check, so its position is the only signal it has. Give it one and it belongs in the set too.

### A step can now say whether its artefact is *current*, not just present

`stepIsDone` asked one question — are the files there? — and calling the answer a cache was
generous. A `tweets.json` describing last week's text is present, so the step would skip, report
*"already done"* with a green tick, and the page would serve a thread about an article that has
since changed. A [silent success](../reusable/silent-success.md) of the exact kind this repo keeps
finding, and the reason the plan's `sourceHash` was not enough on its own: **nothing would ever have
read it.**

`PipelineStep` therefore has an optional `isDone(ctx)`. Existence still runs first and the override
can only narrow the answer, so a freshness check can never declare a missing file fine. `tweets` is
the only step that supplies one so far: `threadIsCurrent` in [`src/tweets.ts`](../../src/tweets.ts)
compares the stored `sourceHash` against the blocks on disk, and checks the prompt version and the
model id with it — which is what [architecture.md § Storage](architecture.md#storage) has always
specified for a cached artefact and what nothing had implemented. Anything unreadable answers *not
current*: the cost of being wrong that way is one model call, and the other way round is a wrong
thread served for ever.

The consequence worth stating: a refresh does not force the thread, but it does not strand one
either. The next time anything asks for `tweets` the hash no longer matches, so the step runs
without anyone having to remember.

### Forcing a step forces every step after it

This was wrong for an afternoon, and the way it was wrong is the reason it is now a rule rather
than a convention. "Refresh from source" was written as `force: ["fetch", "extract"]` — force the
two stages that read the outside world, leave the rest alone. But the rest are not independent of
them: `blocks`, `toc` and `arc` all find their artefacts still on disk from last time, skip
themselves in milliseconds, and report three green ticks. What you get is **a freshly fetched
article under last week's tree and last week's arc** — every gist describing paragraphs that have
moved, and nothing anywhere saying so.

That is [silent success](../reusable/silent-success.md) exactly: the pipeline reports success, the
check you would naturally run (*did the refresh work? is the article current?*) says yes, and the
reading view quietly shows the wrong thing. Caught by an outside review rather than by using it,
which is the usual way with this family.

So `cascadeForce` in [`src/jobs.ts`](../../src/jobs.ts) expands any `force` to include everything
downstream of the earliest step named. The pipeline is a chain; invalidating a step invalidates what
comes after it, by definition. The alternative is asking every caller to remember a rule the
pipeline already knows.

### A step is done when *all* its files are there

`extract` writes the HTML **and** `meta.json`. `toc` writes `tree.json` **and** its copy of
`blocks.json`. Each step declares an `outputs` list rather than a single artefact, and counts as
done only when every one of them is present — because a crash between the two writes would
otherwise leave a step reporting itself finished with half its output, and the stage after it
consuming the missing half.

**There are two copies of `blocks.json`, and it matters here.** Stage 3 writes
`output/<slug>.blocks.json`; stage 4 copies it into `data/<slug>/blocks.json` as it writes the tree,
so the pair in the data directory is guaranteed to be the one the tree was built from. Each step's
`done()` checks *its own* artefact — the first one for `blocks`, the second for `toc`. Getting that
backwards means a finished `blocks` step reports itself unfinished until `toc` has also run, so
every retry redoes stage 3 and a `{ steps: ["blocks"] }` job can never skip itself. Which also means:
run `blocks` on its own and the two copies disagree until you run `toc` as well. That is the
pipeline's existing shape, not something the queue introduced, and it is why a re-run of a middle
stage should generally include the ones after it.

Sanitising is not a step. It happens *inside* `blocks`, at the top of `splitIntoBlocks`, so that the
stored `blocks.json` is already safe and no later consumer has to remember —
[`src/sanitize.ts`](../../src/sanitize.ts), and see [open-questions.md § Q9](open-questions.md) for
how that landed.

### `fetch` is its own step, and that is new

Stage 1 used to be three lines inside `src/extract.ts`. It is now a step with an artefact,
`data/<slug>/raw.html`, which [architecture.md § Storage](architecture.md#storage) has always listed
and nothing had ever written.

The reason is retries. Extraction going wrong is the common failure — Readability is a heuristic —
and when it does you want to try again **without asking the publisher a second time**, and without
the answer being different because they changed the page in between. The previous version of this
project reached the same conclusion from production:
[original-version/extraction.md § Keep the untouched original](original-version/extraction.md#keep-the-untouched-original).

The step itself is three lines because the work is [`src/fetch.ts`](../../src/fetch.ts), which
landed the same day from the agent who owns stage 1 — byte caps counted on the decompressed stream,
the page's own declared encoding rather than an assumed UTF-8, PDFs told apart by their bytes,
address checks before each redirect hop, and typed failures carrying a sentence a reader can act on.
Those sentences are what a failed step shows. It takes an `AbortSignal`, so cancelling a job stops
the fetch rather than waiting it out. See [fetching.md](fetching.md).

## The queue: p-queue

Chosen 2026-08-25 against
[third-party-library-selection.md](../reusable/third-party-library-selection.md). **p-queue 9.3.3**,
published a month before it was picked; 33.6M downloads a week, 4.3k stars, one small pure-ESM
package with no dependencies and nothing to install alongside it. Concurrency, priorities, pause and
`AbortSignal` are the API.

**Concurrency is 1, deliberately.** Three of the six steps are long model calls billed by the token
and one is a fetch of somebody else's server. Running two articles at once would double the spend
rate, halve the politeness, and turn the progress display into a race — for a single reader adding a
handful of articles a day, in exchange for nothing.

| Rejected | Why |
|---|---|
| **BullMQ** | The best-known of these and its `updateProgress` + `QueueEvents` is exactly the progress mechanism we want — but it needs **Redis**, and [architecture.md](architecture.md) says filesystem, one process, no infrastructure. Worth a second look one day: BullMQ 6 added a Postgres backend, though its own docs still call Redis "the most battle-tested option". |
| **pg-boss** | The runner-up, and the one to adopt **when Postgres lands** — Postgres-only, nothing else to run, with retries, backoff, dead-lettering, cron and `LISTEN/NOTIFY` included. It needs a database we don't have yet, and adopting one to get a queue would be the tail wagging the dog. |
| **graphile-worker** | The same idea as pg-boss and a good library. pg-boss has 2.7× the downloads and 1.6× the stars, which under [our first criterion](../reusable/third-party-library-selection.md#selection-criteria) — pretraining data — is the whole difference. |
| **bee-queue** | Redis again, with less momentum than BullMQ. No upside. |
| **fastq** | Fine, and lower-level than we need. Its enormous download count is `glob` pulling it in transitively, not people choosing it. |
| **better-queue** | Looks like it does everything; last published September 2022, no types. A trap. |
| **Inngest, Trigger.dev** | Hosted SaaS, or a self-hosted stack of eight to ten containers. For one reader on a laptop. |
| **Nothing at all** — a hand-rolled FIFO | Genuinely viable at ~50 lines, and it was close. p-queue wins on the two criteria that matter here: an API a model already knows cold, and someone else owning the concurrency and abort edges. |

The previous version of this project had **no queue**, and is worth reading as evidence rather than
as precedent — [original-version/overview.md](original-version/overview.md). Its ingestion ran inline
inside Next.js API routes, with the browser tab as the orchestrator: a React component held the task
list and called the API once per unit of work. Their own docs call it a prototype shortcut, and it
cost them production 504s on long documents, lost all progress on a refresh, and never got migrated.
`PROJECT_STATUS.md` there still lists *"Background processing — move from frontend-driven to proper
job queue"* as unstarted. So: the server owns the queue here, and the browser only watches.

## Why polling

`GET /api/jobs` every second while anything is running, every eight seconds when nothing is.

A job is five or six steps over one or two minutes, so a one-second poll is at worst a second behind
something that changes every twenty; nobody can tell. What it buys is that the client holds no
connection. It survives the dev server restarting under it, which vite does on any config change. It
is the same three lines against a future standalone server, or against a serverless one where SSE is
awkward. And there is no reconnect logic to get wrong — the failure mode of a dropped `EventSource`
is a progress panel that quietly stops updating, which looks exactly like a stuck job.

The poll reschedules itself on each response rather than running on an interval, so a slow response
can never stack a second request on the first.

## Idempotent is the goal; this is a step towards it

Greg, asked whether an interrupted job should survive a restart (2026-08-25):

> We want to get to the point where this is idempotent and simply picks up from where it started.
> But if that's a lot more work, then make a note somewhere that this is the intention, and build
> simpler machinery that's a step in that direction.

**What is built.** Every step declares the files it produces, and a step whose files are all already
on disk is *skipped* rather than run. Job records live in `data/_jobs/<id>.json`, written
atomically. On startup, anything still marked `running` or `queued` is turned into an error —
this process has just started and its queue is empty, so nothing on disk can have work happening
against it. The steps keep their individual statuses through that sweep, so a swept job still shows
which stages finished, and **Retry queues the same steps and skips them**.

So in practice: the server dies during `toc`, you press Retry, and `fetch`, `extract` and `blocks`
are skipped in milliseconds while `toc` starts again. That is "picks up from where it started" for
the case that matters — the two model calls, which are the expensive part.

**What is not built, honestly.** The check is *existence*, not correctness. A file
that is present but truncated, or that was written by an older version of a prompt, counts as done.
The three things that would close the gap, roughly in order of value:

1. **Content hashing.** [architecture.md § Storage](architecture.md#storage) already specifies that
   `tree.json` is keyed on `hash(blocks.json) + prompt version + model id`. **One step implements it
   now** — `tweets`, via the optional `isDone` above — and that is the shape the rest should follow:
   `done()` becomes "the artefact is current" rather than "the artefact exists", and a prompt change
   invalidates the right things by itself. `tree.json` and `arc.json` still carry no hash, so they
   are still existence-only, and `arc` still needs the force-cascade to notice that its tree moved.
2. **Atomic artefact writes.** Job records are written temp-then-rename; the pipeline stages are not.
   A crash mid-write leaves a truncated file that the next run treats as finished.
3. **Automatic resume on startup**, rather than a sweep to `error` and a Retry button. Cheap once
   (1) and (2) hold, and unwise before then: automatically re-running steps against artefacts we
   cannot vouch for is how you get a tree built for the previous version of an article.

The sweep-then-retry shape is deliberately the same one
[`sweepOrphaned`](../../src/routes.ts) uses for comments, and for the same reason: a status of
`running` on disk does not mean work is happening, and a spinner that spins for ever is the worst of
the available outcomes.

Related, and the reason a failed job stops rather than continuing: every step consumes the artefact
the one before it wrote. Carrying on past a failure would run the two model calls against whatever
stale file happened to be on disk, and produce a tree for the previous version of the article —
which looks entirely fine. A [silent success](../reusable/silent-success.md).

## The one security check

`isSlug` in [`src/ingest.ts`](../../src/ingest.ts) is a path-traversal guard, not a tidiness check.

A slug arrives from the client on `POST /api/jobs` and is joined onto `data/` and `output/`, so
`../../.ssh` has to be refused there or it is refused nowhere. It lives beside `slugFromUrl` because
the two must not drift: everything `slugFromUrl` can produce must pass, and
[`tests/ingest.test.ts`](../../tests/ingest.test.ts) asserts both halves.

For the `{ url }` shape the slug is **derived, not accepted** — the add box shows you the same
derivation so the two agree by construction rather than by trust.

## The routes

```
  GET    /api/tweets/:slug     the thread, and whether it still describes the article
  GET    /api/jobs             every job this server knows about, newest first
  POST   /api/jobs             { url } | { slug, steps?, force? }  → 202, the job
  GET    /api/jobs/:id         one job — what the poll reads
  DELETE /api/jobs/:id         forget a finished job's record (artefacts untouched)
  POST   /api/jobs/:id/cancel
  POST   /api/jobs/:id/retry   → 202, a NEW job with the same steps
```

`POST /api/jobs` answers **202**, not 200: the work has been accepted and has not been done, and the
body is a receipt to poll. Retry creates a new job rather than mutating the old one — what went
wrong the first time is worth keeping, and overwriting it would erase the only evidence at exactly
the moment somebody is trying to work out what happened.

Cancelling stops a queued job outright, and a running one as fast as the step it is in allows. Every
step gets the `AbortSignal`: the fetch layer folds it into its own deadline, and the Anthropic SDK
takes one directly, so a model call stops mid-stream. The tokens already streamed are paid for
either way, so there is nothing to save by letting the call run on — and a Stop button that does
nothing for two minutes is a Stop button that looks broken. Between the click and the step
unwinding the job carries `cancelling`, which is why the button says "Stopping…" rather than
staying "Stop".

## Naming the step is the point

Each row of the progress list says what is happening: *Extracting the article*, *Building the table
of contents*. Not "Step 3 of 5", and not "Loading…".

That is the one thing the previous version got right without a queue at all —
[original-version/extraction.md § Document lifecycle](original-version/extraction.md#document-lifecycle-atomic-no-processing-state)
records a blocking screen with method-aware captions, and
[design-system.md § Loading](original-version/design-system.md#loading-states) is the reasoning. A
named step tells you what is slow and what is about to fail. A counter tells you neither.

The two model steps also report as they stream — how much has arrived, not what it says, because the
JSON is unparseable until it is complete. That is a deliberately low bar: the question a reader
watching a two-minute step is actually asking is whether anything is still happening.

## When this becomes Postgres

`Job` and `JobStep` live in [`src/types.ts`](../../src/types.ts), shaped as table rows — every field
a scalar or a small blob a column could hold. The same discipline `LibraryEntry` follows
([library.md § When this becomes Postgres](library.md#when-this-becomes-postgres)).

| Today | Then |
|---|---|
| `data/_jobs/<id>.json`, one file per job | a `jobs` table, `steps` as `jsonb` |
| p-queue, in the server process | **pg-boss**, `SKIP LOCKED`, surviving the process |
| restart sweep marks orphans `error` | pg-boss's own visibility timeout, and a real retry policy |
| one process, so the in-memory map is authoritative | the table is authoritative; `LISTEN/NOTIFY` for wakeups |
| polling `/api/jobs` | still polling — it is fine, and it is the part that does not need to change |

The seam is [`src/jobs.ts`](../../src/jobs.ts): `enqueue`, `listJobs`, `getJob`, `cancelJob`,
`retryJob`, `forgetJob`. Nothing above those six knows there are files.

## They are the same functions the CLI runs

`npm run extract`, `npm run blocks`, `npm run toc` and `npm run arc` still work, and still do exactly
what they did. Each of those scripts is now a thin argv wrapper around an exported function, and the
queue calls the same function — so there is one code path per stage and no way for the two to drift.
That was the point of the refactor, and it is the thing to preserve if anyone changes a stage.

Greg chose in-process over spawning subprocesses (2026-08-25). The cost is real and worth stating: a
stage that throws inside the server process is now the server's problem, and the four stage files
belong to other agents ([architecture.md § Stage ownership](architecture.md#stage-ownership)). The
edits were kept to the smallest shape that could work — lift the body of `main()` into an exported
function, leave everything else alone — and no stage's behaviour or artefacts changed.

## See also

- [library.md](library.md) — the homepage this box sits on
- [architecture.md](architecture.md) — the pipeline, the storage layout, and who owns which stage
- [content-extraction.md](content-extraction.md) — stages 1–2, and what `meta.json` is for
- [setup-dev.md](setup-dev.md) — the commands, for when you want to run a stage by hand
- [original-version/overview.md](original-version/overview.md) — the project that did this without a
  queue, and what it cost
- [silent-success.md](../reusable/silent-success.md) — why a failed step stops the job
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — the process
  behind the p-queue choice
