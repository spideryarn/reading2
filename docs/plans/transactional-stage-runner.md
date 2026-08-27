# The stages move behind one runner, and the artefacts follow the job

> Ok, proceed with planning and then implementing the remainder of the work.
>
> — Greg, 2026-08-27

This is the half [durable-queue-and-uploads.md § 7](durable-queue-and-uploads.md) put to Greg as a
question and he answered **A — port the writes**. It is the piece that actually unblocks an ingest on
Vercel, and it is much larger than that section's two paragraphs make it sound. This document says
how large, in what order, and what is true after each landing rather than only at the end.

> **Where it stands, 2026-08-27.** Landing **A** is done — the queue is behind `JobStore`, with a
> claim, a lease and a fence, and a job now survives the invocation that made it. Of landing **B**,
> one of three pieces is built (`openOrBeginJobDraft`). **C, D and E are not started.** The one
> migration C needs was blocked on a shared `src/db/schema.ts` for most of the day and **is not any
> more** — § Open 1 and 5.
>
> **So uploading still cannot be switched on in production, and none of the above changes that.**
> Every stage still writes `data/<slug>/*.json` and `stepIsDone` reads those files, so invocation A
> writes `raw.json` to an ephemeral disk and invocation B finds nothing and fetches again. The job is
> durable; the pipeline is not.

**Read the correction first, again.**
[GPT Sol's review](transactional-stage-runner-review-sol.md) returned **NO-SHIP** on the first draft
of this document, and it was right about the thing everything else hangs off:

> The desired boundary — stage execution outside a transaction, followed by one fenced commit — is
> correct. The proposed contracts and landing order cannot implement it.

The first draft said "one transaction: artefacts + step-run + the job transition", and then said the
release stays outside it. Those two sentences contradict each other and I did not notice.
`pgJobStore.releaseStep` takes its own `getDb()` and issues a single fenced `UPDATE` — not even a
transaction of its own, which is *worse* rather than better: a lone statement is its own transaction
and cannot be joined to anybody else's. `publishRevision` opens a real one. And production runs
through a **transaction pooler**, so separate calls cannot share so much as a session. So there were
three transactions where the design needs one, and the failure is not
theoretical: A writes its artefacts and commits, `failExpired` invalidates A, the release throws —
and A's artefacts are already there. Reverse the order and you get the opposite corruption.

**And that scenario stopped being hypothetical on the same day.** When the review was written,
`failExpired` had no caller at all; wiring it (landing A) is what makes the sweep something that
really happens. So the window is open now, not later — which is why § Two things the reviews left
open is at the end of this document rather than in the queue's.

**The job transition is the commit.** It cannot be a separate call. Three more criticals and a
fourth finding that nobody had written down are folded in below, each marked where it lands.

---

## The thing § 7 understated

§ 7 described choice A as *"finish the Postgres artefact store and put the eight stages behind one
transactional stage runner"*, which reads as a write-path change. It is not. Checked in the tree
today, stage by stage:

- **No stage writes through the seam.** `ArtifactStore.write()` has **no production caller at all** —
  its only callers are in `tests/pipeline-artifact-store.test.ts`. All nine stages `writeFile`
  directly, and they do it from **eleven** modules rather than nine: the nine stage modules, plus
  [`src/pdf-read.ts`](../../src/pdf-read.ts) (`extract`'s PDF half) and
  [`src/labels.ts`](../../src/labels.ts) (`toc`'s second pass) — and the upload branch writes from
  `pipeline.ts` itself. Worth counting properly, because "one commit per stage" is the plan and two
  of those stages have a second file in them.
- **And no stage reads through it either.** `StepContext` carries `dir` and `htmlFile`, and that is
  how every stage finds its input: `toc` opens `output/<slug>.blocks.json`, `arc` and `tweets` and
  `glossary` and `summary` and `ideas` all take a `dir`. Under Postgres there is no `dir`, so
  converting the writes and leaving the reads gives a runner that stores everything correctly and
  hands the next stage an empty directory.
- **`revisionLifecycle` has no caller in `src/` whatsoever.** Not one. `src/store/revisions.ts` is a
  seam nothing has ever been plugged into, and its header's warning — a fresh draft stays empty and
  `publishRevision` refuses it — is describing a code path that cannot currently be reached.

- **And not every stage write is an artefact.** This is the one nobody had written down, and it is
  the third review running that has turned up such a thing. `toc` writes `labels-progress.json`
  batch by batch and *reuses it after a failure* ([`src/labels.ts`](../../src/labels.ts) §
  `CHECKPOINT_FILE`); PDF extraction caches each validated model chunk under `pdf-chunks/` so that a
  retry pays only for the chunks that failed ([`src/pdf-read.ts`](../../src/pdf-read.ts)). Neither
  belongs in the atomic published artefact set — they are private working state, deliberately
  visible only to the next attempt — and both **need somewhere to live the moment `dir` disappears**.
  Fail label batch eight on one Vercel invocation and retry on another, and without a durable
  checkpoint store every paid batch before it is bought a second time.

So the work is: **both directions, all nine stages, the runner, the adapter, a checkpoint store, and
the CLIs.** Said now, because an estimate that starts from "port the writes" is wrong by about half.

## The ordering, and where I disagreed with the review

The first draft argued that the job wiring had to come before the artefact store, because
`beginRevision`, `publishRevision` and `failRevision` all fence with
`update spideryarn.jobs set … where id = $1 and attempt_id = $2 and status = 'running'` — `fenceJob`,
[`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) — and until a job row exists in that
table every one of those fences matches zero rows and throws `NotTheLiveAttempt`. Which is why
nothing passes `job` today.

**The premise is true and the review confirmed it. The conclusion did not follow**, and the review is
right about why: `pgJobStore` already existed, so a test could create and claim a real job row
without switching production `src/jobs.ts` over. Wiring first, it says, *"merely commits the wrong
release boundary and then rewrites it in C."*

**It was wired first anyway, on 2026-08-27** — [durable-queue-and-uploads.md § 8](durable-queue-and-uploads.md#8-the-wiring-built-2026-08-27).
Two reasons, one of which the review did not have:

1. **A standalone `releaseStep` is the *permanent* shape for one of the two adapters.** This laptop
   runs `SPIDERYARN_STORE=files` against filesystem artefacts, where there is no transaction and
   never will be. So the external call is not a boundary that gets deleted; it is the boundary the
   filesystem keeps. What Postgres grows is a transaction-carrying sibling — exactly the shape
   `recordStepRun(input, tx)` already has one file over.
2. **The wiring is the only piece that improves anything on its own.** Everything before step 5 of
   the review's own build order is invisible from outside: a coordinator, some product types and an
   adapter that nothing calls. A queue that survives the invocation that made it is a thing that
   works today, and the three things that only showed up *while moving the code* — a progress write,
   a slug lookup, and a test seam that only became necessary once `get` returned a copy — are an
   argument for moving code earlier rather than later.

The cost is real, it is one function's call site, and it is written down here rather than discovered
in C: `advanceJob`'s release and finish move inside a transaction callback when C lands.

## The order, and what is true after each step

Five landings, not four, and the first of them is new: the review's central correction is that the
coordinator has to exist before anything can be committed *into* it.

### A. The wiring — **done, 2026-08-27**

`src/jobs.ts` behind `JobStore`, specified and now built in
[durable-queue-and-uploads.md § 8](durable-queue-and-uploads.md#8-the-wiring-built-2026-08-27).

**True afterwards:** a job survives the invocation that made it, two instances share one queue, and
`jobs.attempt_id` is a real value that `fenceJob` can match. **Still false:** the artefacts do not
survive, so a second invocation re-runs the step. The Vercel guard on uploads stays.

**Provisional:** `releaseStep` and `finish` are separate calls. See § The ordering.

### B. The coordinator — one transaction, and something to put in it

Nothing can be committed atomically until there is one place that owns the transaction. Three pieces;
**the first is built, the other two are not.**

**1. `openOrBeginJobDraft(slug, job)` — built 2026-08-27**
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts), tests in
[`tests/store-job-draft.test.ts`](../../tests/store-job-draft.test.ts)).

The review's second critical, and it would have been found the hard way on the second `/advance` of
every fresh ingest: `beginRevision` **always** mints a `randomUUID()` and copies from
`articles.current_revision_id`. So request 1 creates R1 and writes `fetch` into it; request 2 creates
R2 from the still-empty published state, points the job at R2, and `extract` looks for a raw document
that is in R1 — a message about stage 2, from a fault in the runner. `RevisionLifecycle` had no
reopen, and `toJob` does not expose `draft_revision_id`, so the job could not find the draft it owns.

It reads `jobs.draft_revision_id` **fenced on the live attempt and locked `for update`**, inside the
same transaction that may mint. The lock is not belt and braces, and the review of the *fix* is where
that was settled: fencing on the attempt does not stop two callers both reading a null pointer and
both queueing on `lockArticle`, after which the second mints over the first. The job lock is taken
**before** the article lock so every caller takes the two in one order.

**What it does when the recorded draft is not usable**, which is four cases and one refusal:

| state | what happens |
|---|---|
| the job has no `draft_revision_id` | mint — this is the first step of every job |
| there is no `articles` row for the slug | mint, and `beginDraftIn` creates the article |
| the revision is absent, or is not this article's | mint — `sweepAbandonedDrafts` spares job-referenced drafts, but `db:import` and a cascade from `articles` do not |
| the revision exists but is `published` or `failed` | mint |
| **the job row's own slug is not the one asked for** | **`NotTheLiveAttempt`** |

The last is refused rather than recovered from because it is the only one that is somebody's fault: a
live token with the wrong slug means a caller has mixed two jobs up, and minting would repoint a
perfectly good job at an article it has nothing to do with — the same class of fault as `enqueue`
renaming a slug out from under a request.

> **Proving the lock took three attempts and the first two were green against the broken code.**
> Firing two calls with `Promise.all` and asserting one draft passes with `for update` deleted — the
> transactions do not interleave at the point that matters. Holding the *job* row and showing the
> call blocks also passes, because `fenceJob`'s `UPDATE` at the end blocks on that row anyway. What
> works is holding the **article** row, so the call is stuck inside `lockArticle` and has not reached
> `fenceJob`, then asking a third connection for the job row `for update nowait`: refused if the lock
> was taken, granted if it was not — and that grant is precisely the gap. Written down because the
> same shape will come up for every lock in landings C and D.

**2. A raw product with the bytes in it.** The third critical. The type lie was fixed on 2026-08-27
— `ArtifactMap.raw` is a `RawManifest` now rather than a `string`, with a test that goes red if it
goes back — but **that is not this piece**, and the review is right about why: a `RawManifest` holds
a *filename*
([`src/fetch.ts`](../../src/fetch.ts)) and `article_revisions.raw_bytes` needs bytes. A store-neutral
raw product carries provenance **and** payload; anything else reintroduces the filesystem dependency
the whole landing exists to remove.

**3. A checkpoint store**, for `labels-progress.json` and `pdf-chunks/` — § The thing § 7
understated. Separate from the artefact store on purpose: these are private to the next attempt,
must **not** be in the atomic set (a failed step has to leave them behind — that is the point of
them), and must not be published. Small interface, two callers, and it is what stops a retry paying
twice for work that succeeded.

**True afterwards:** there is a transaction with a shape. Nothing uses it — `openOrBeginJobDraft` has
no production caller today, because the thing that would call it is landing D's runner.

### C. The Postgres artefact adapter, inside the coordinator

All twelve `ArtifactKind`s already have somewhere to go — **eleven of them as columns on
`article_revisions`, and one as rows in a different table**, which is the whole difficulty:

| kind | where |
|---|---|
| `meta` | `title`, `byline`, `site_name`, `lang`, `excerpt`, `note`, and the six PDF columns |
| `raw` | `raw_bytes`, `raw_content_type`, `raw_encoding`, `raw_sha256`, `requested_url`, `final_url`, `fetched_at` |
| `extractedHtml` / `stampedHtml` | the two columns of those names |
| `tree` `labels` `arc` `tweets` `glossary` `summary` `ideas` | one `jsonb` column each |
| `blocks` | **`revision_blocks` rows**, not a column — plus `block_identities` |

`blocks` being a table is the whole difficulty, and the review sharpened it into something the first
draft had wrong. The discipline `src/store/import.ts` already follows has to be reproduced exactly:
upsert `block_identities` **first** and never delete them, delete the revision's rows even when the
replacement array is empty, supply the revision's `article_id` for both composite foreign keys, take
the ordinal from the array index, and omit the generated `fts` column.

**And the sharp one.** `blocks` and `toc` collapse onto the same rows, so *the rows cannot say which
step produced them*. On the filesystem they could — two paths, two owners. Here,
`has(slug, "toc", ["blocks"])` would answer yes over stage 3's rows, or over rows **carried forward
from the previous revision by `beginRevision`**, and report a `toc` that has not run as done. So
`has` must consult the matching `revision_step_runs` row rather than the block rows alone. The first
draft called this "the first place the migration makes something simpler"; it is the opposite.

Two more that survive from the first draft:

- **`has` parses, it does not check for null.** A `jsonb` column holding a previous generation's
  valid value is a different failure from one holding `null`, and only one is caught by `is not null`.
- **`beginStep`/`finishStep` are `revision_step_runs.status` plus an attempt token**, one fenced
  `UPDATE … WHERE attempt_id = $attempt` — which the filesystem adapter's own comment already says.
  `revision_step_runs` has no `attempt_id` column: one nullable column, one migration, and it is the
  only schema change this document needs.

**True afterwards:** the adapter exists and is tested against the filesystem one. Nothing uses it.

### D. The stages — return artefacts, and keep the CLIs working in the same commit

The invasive landing, taken stage by stage.

**The shape.** `PipelineStep.run(ctx)` returns a `string` today and writes its own files on the way.
It becomes:

```ts
run(ctx: StepContext): Promise<StepProduct>;

interface StepProduct {
  /** The one-line summary kept on the finished step. Exactly today's return value. */
  detail: string;
  /** Everything this step made. The coordinator writes it, in one transaction. */
  parts: ArtifactParts;
  /** What it was made from and by. Written with the parts, never separately. */
  stamp: StepStamp;
}
```

and `StepContext` loses `dir` and `htmlFile` and gains the store and the checkpoint store, so a stage
reads its input by asking rather than by opening a path.

**Why returning rather than a transaction-scoped store on `ctx`.** The first draft's reason — a stage
could otherwise write half its artefacts and return successfully — is a real property but not the
decisive one, and the review is right that a collector could track required kinds and refuse to
commit. **The decisive reason is that the model call must not be inside the transaction.** Returning
makes that structural: the stage cannot hold a row lock because it has no handle to hold one with.
The timing the coordinator enforces is four steps — a short claim transaction, a short
open-or-create-draft transaction, **the stage with no transaction and no row lock held**, and one
commit.

Costs of returning, said plainly because the first draft did not: every part is live in memory
together until the commit and may be duplicated again during serialisation, and the current ceilings
permit a 32 MiB HTML beside a 32 MiB blocks array beside the raw payload. It also rules out streaming
into the final table without a spool.

**Stage by stage, easiest first** — each one a commit, ordered by how much of it is already a return
value:

1. `arc`, `tweets`, `glossary`, `summary`, `ideas` — one JSON blob each, written at the end of a
   `generate*` that already has the object in hand.
2. `toc` — three artefacts, and a hand-rolled ordering discipline (tree written last, atomically)
   that exists *because* it could not be transactional. The transaction deletes that discipline,
   which is the clearest single case for this whole change. Plus the checkpoint file.
3. `blocks` — two artefacts, one of which is the HTML `extract` also writes. `extractedHtml` and
   `stampedHtml` are one path on the filesystem and two columns in Postgres, so `htmlCarriesItsIds`
   can go from a regex over a file to a comparison of two columns.
4. `extract` — **six** `writeFile` calls across two modules ([`src/extract.ts`](../../src/extract.ts)
   twice, [`src/pdf-read.ts`](../../src/pdf-read.ts) four times), two of which write **another
   step's artefact**: `keepTheOriginal` rewrites `raw.pdf` and `raw.json`. Plus the chunk cache,
   which is checkpoint state rather than an artefact and must not join the atomic set.
5. `fetch` — two write sites plus the upload branch (below).

**The CLI wrapper travels with the stage, in the same commit.** The review's fourth finding and it is
a plain fact about the code: `main()` in [`src/arc.ts`](../../src/arc.ts) assumes `generateArc()`
wrote `arc.json` and prints `run.outFile`. Convert the function without the wrapper and
`npm run arc -- data/example` reports success and creates nothing — which is
[silent success](../reusable/silent-success.md) with a green tick on it. The same pattern is in toc,
tweets, glossary, summaries and ideas. So there is no separate "landing D for the CLIs": each stage's
commit keeps its CLI writing files, and moving the CLIs onto the shared runner is the *last* landing
rather than the repair for one this created.

**`tweets` and `summary` still answer the freshness question the old way**, and the thing that was
stopping them has already gone. Both declare `isDone` rather than `stamp`
([`src/pipeline.ts`](../../src/pipeline.ts)), and both read `ctx.dir` to do it — so under Postgres
they are asking a directory that is not there. The reason given for leaving them was that
`PROMPT_VERSION` was module-private in each, so a `stamp` would have to write the version out a
second time in `pipeline.ts`; **both export it now** (`tweets/2`, `summary/3`, beside
`glossary/3` which made the move first). What is left is one `stamp` line in `pipeline.ts` and one
deletion in each stage. The docstring above `isDone` in `pipeline.ts` still says they are private and
is wrong — worth fixing when those stages are converted, since it is that file's own account of why
two steps are exceptions.

**The upload branch writes to a second store inside the commit's window.** `acquireUpload` advances
the upload record (`claimed → verified`, or `→ rejected`) from inside `fetch`'s `run`. The first
draft moved the *settle* into the transaction and left the *reject* where it was; the review is right
that this contradicts [durable-queue-and-uploads.md](durable-queue-and-uploads.md)'s own requirement
that **both** terminal transitions be fenced — a claimant whose lease has lapsed can still reject an
upload it no longer owns. And `pgUploadStore.settle`/`reject` take no transaction and no attempt
token today, so this is an API change as well as a call-site move. Two protocols:

- **Postgres.** Success: artefacts + verified upload + step-run + the job transition, one
  transaction. Validation failure: rejected upload + step error + failed revision + job failure, one
  fenced transaction.
- **Filesystem.** The existing weaker recoverable order — write artefacts, settle, write the finish
  marker — and it should **say** it is weaker rather than pretend to parity. It cannot promise
  atomicity and a test asserting that it does would be asserting a lie.

**True afterwards:** an ingest works on Postgres, start to finish, on Vercel. This is the landing the
whole migration has been for.

### E. The CLIs onto the shared runner

Eleven scripts in `package.json` (`fetch, extract, pdf, blocks, toc, labels, arc, tweets, glossary,
ideas, summarise`), and none of them touches `STEPS`, `StepContext`, `ArtifactStore` or `beginStep`.
Putting them behind the runner means giving each one a **slug**, which changes what you type as well
as what runs — and it is **two different changes**, not one:

- **Most take a directory or a file path** — `npm run arc -- data/example`,
  `npm run toc -- output/x.blocks.json` — and call `generateArc({dir})` straight. Those swap a path
  for a slug.
- **`fetch` and `extract` take a URL** as `argv[2]`, with the directory an optional `argv[3]`
  ([`src/fetch.ts`](../../src/fetch.ts), [`src/extract.ts`](../../src/extract.ts)). A slug is a
  different *kind* of argument for those two, and `extract` would have to stop deriving its own
  output path from the URL.

Last because nothing waits on it, and not optional: a stage run from its own CLI leaves no attempt
marker, so an interrupted CLI run is invisible to `stepIsDone`. `src/store/artifacts.ts` lists that
as a legitimate reason `finishStep` finds nothing, and it stops being legitimate the moment the
artefacts are shared.

## What has to be true before this is believable

Each pinned to a specific way of being wrong, and each watched red first. **✅ marks the ones that
exist and have been watched red**; the rest are still descriptions.

1. ✅ **One draft per job, across requests.** Two calls on one job get the *same* revision, a third
   adds nothing, and the job row is held across the article-lock wait so two callers cannot both act
   on a stale null. Plus a live token with the wrong slug refused.
   [`tests/store-job-draft.test.ts`](../../tests/store-job-draft.test.ts) — and see the note in § B
   about the two versions of this that passed against the broken code.
2. **Both adapters agree.** One set of cases over `fsArtifacts` and the Postgres store — `has` on a
   half-written step, `read` of every kind, `stampFor` where a stamp exists and where the step
   records none, `beginStep`/`finishStep` with the wrong attempt token.
3. **`has` refuses blocks it did not produce.** Carry a revision forward with `beginRevision`, so the
   rows are present and belong to the *previous* generation, and prove `has(slug, "toc", ["blocks"])`
   answers no. Watched red with the `revision_step_runs` check removed — because rows alone answer
   yes, which is the whole finding.
4. **`finishStep` will not accept another attempt's token**, on both adapters, watched red with the
   `attempt_id` condition removed. Built on the state that needs it — a step-run that has ended and
   still carries its token — not on one reached through the happy path, or it passes with the
   condition deleted and proves nothing.

   **That mistake has now been made three times on this piece of work**, which is enough to call it
   the default rather than a slip: once on the job fence (a different line in the code under test
   cleared the field the second condition checked), and twice on the draft's row lock (§ B). Every
   one of them was a test that looked like it exercised the mechanism and exercised an outcome. The
   habit that catches it costs a minute: copy the file aside, delete the one line, run the single
   test by name, restore.
5. **A step that writes half its artefacts writes none.** Kill between two parts and prove the
   transaction took neither. The property the whole landing is for, and the one the filesystem
   cannot have.
6. **No model call inside a transaction.** Not an assertion about behaviour but about *shape*: a
   test that the stage's context carries no database handle, so the property cannot be lost by
   somebody adding a convenient `tx` to `StepContext` later.
7. **An interrupted run does not publish**, and does not leave the upload terminal — a stale
   claimant's reject must be refused by the fence.
8. **A stage reads what the previous stage returned**, not what is on disk: run the whole pipeline
   with `data/<slug>/` deliberately empty and prove it completes under Postgres.
9. **A retry does not buy a checkpoint twice.** Fail label batch eight, retry, and prove batches one
   to seven were not paid for again — on a *different* store instance, which is what makes it about
   Vercel rather than about one process.
10. **Every CLI still writes its file**, in the same commit as its stage's conversion.

**One more, inherited from the queue and easy to lose here.** Every id and token that crosses into
the database has to be minted by the function the *column* requires, not by a plausible-looking
literal in a test. `advanceJob` passed `mintId()` where `jobs.attempt_id` is a `uuid`, and neither
the caller's tests nor the two-adapter parity suite caught it, because the parity suite minted its
own. The coordinator passes job tokens into `fenceJob`, so the same seam is about to be crossed
several more times: `mintAttempt()` in [`src/store/jobs.ts`](../../src/store/jobs.ts) is the one
place, and tests should read the value out of the caller rather than construct their own.

## Two things the reviews left open, and they are both this document's

1. **The claimant's deadline is cooperative.** The timer aborts a signal; a stage that ignores it
   runs on. So the lease can still lapse under a claimant that is alive, `failExpired` marks the job
   interrupted, and the stage then completes its **filesystem** writes — which nothing fences. Its
   job transition is refused, but the artefacts have already landed. Reviewed twice, still open, and
   it closes here rather than in the queue: the fix is the artefact write being inside the fenced
   transaction, not a better timer.
2. **`beginStep` → stage → `finishStep` carries no job attempt.** Same sentence from the other end,
   and the honest answer to *"does every durable write carry the fence?"* is **no**, and will be no
   until landing D.

## Open

1. **`revision_step_runs` needs `attempt_id`.** One nullable column, one migration — **the only
   schema change this whole document needs**, and it is now unblocked (see 5). Nullable because every
   row written by `db:import` and by a CLI has no attempt and never will. It is what turns
   `finishStep` into one fenced `UPDATE … WHERE attempt_id = $attempt`, which the filesystem
   adapter's own comment has been asking for since it was written.
2. **What a cross-step write means under the runner.** `extract`'s PDF path rewrites `fetch`'s
   artefacts. Either the runner allows a step to return parts belonging to another step — which makes
   `produces` a lie — or the PDF path hands the corrected manifest back some other way.
   Recommendation: the second, decided when that stage is written rather than now.
3. **`outputs(ctx)` has one consumer left** and it is a blocker rather than a loose end: `src/api.ts`
   builds the metadata page's per-stage file list and byte weights from it, and constructs `dir` and
   `htmlFile` to do so. Under Postgres there are no files and no byte weights of that kind, so
   landing D **does not typecheck** until that page has been given something else to say. What it
   says is a design question, and it has to be answered before D rather than after.
4. **Where the checkpoint store lives.** Not the artefact store, because its contents must survive a
   failed step. Not the blob store either, probably. A small table keyed by revision and step is the
   obvious answer and it has not been weighed against anything.
5. **Migration ownership.** `drizzle-kit generate` diffs the *whole* schema, so a migration written
   while somebody else has `src/db/schema.ts` open sweeps their in-flight column in with yours. That
   is what held this up for most of 2026-08-27 — the `search_runs.colour` work was uncommitted —
   and it **landed as `0016_search_colour`, so the tree is clean and the block has lifted.** The one
   column this document needs (§ Open 1) can be generated now, in one sitting, with the diff read
   line by line and `tests/db-schema.test.ts` updated in the same commit.

## See also

- [durable-queue-and-uploads.md](durable-queue-and-uploads.md) — the queue and upload half, § 7 the
  A/B question this answers and § 8 the wiring that goes first
- [transactional-stage-runner-review-sol.md](transactional-stage-runner-review-sol.md) — the review
  that returned NO-SHIP on the first draft of *this* document, and the source of the corrections
  above: the commit boundary, the per-request draft, the raw bytes, and the working state nobody had
  written down
- [durable-queue-and-uploads-review-sol.md](durable-queue-and-uploads-review-sol.md) — the review of
  the queue half's *plan*, whose build order this document follows except in one place, and says why
- [durable-queue-code-review-sol.md](durable-queue-code-review-sol.md) and
  [durable-queue-fixes-review-sol.md](durable-queue-fixes-review-sol.md) — the reviews of the queue
  as **built**, and then of the fixes. Landing A is what they are about, and two of their findings
  are open here rather than there: § Two things the reviews left open
- [postgres-storage-implementation.md](postgres-storage-implementation.md) — step 11 half B, of which
  this is stage 5
- [postgres-migration.md](postgres-migration.md) · [job-queue-rethink.md](job-queue-rethink.md) ·
  [../project/architecture.md](../project/architecture.md) ·
  [../reusable/silent-success.md](../reusable/silent-success.md)
