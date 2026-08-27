# The stages move behind one runner, and the artefacts follow the job

> Ok, proceed with planning and then implementing the remainder of the work.
>
> — Greg, 2026-08-27

This is the half [durable-queue-and-uploads.md § 7](durable-queue-and-uploads.md) put to Greg as a
question and he answered **A — port the writes**. It is the piece that actually unblocks an ingest on
Vercel, and it is much larger than that section's two paragraphs make it sound. This document says
how large, in what order, and what is true after each landing rather than only at the end.

**Read the correction first, again.**
[GPT Sol's review](transactional-stage-runner-review-sol.md) returned **NO-SHIP** on the first draft
of this document, and it was right about the thing everything else hangs off:

> The desired boundary — stage execution outside a transaction, followed by one fenced commit — is
> correct. The proposed contracts and landing order cannot implement it.

The first draft said "one transaction: artefacts + step-run + the job transition", and then said the
release stays outside it. Those two sentences contradict each other and I did not notice.
`pgJobStore.releaseStep` calls `getDb()` and opens its own transaction; `publishRevision` opens
another; production runs through a **transaction pooler**, so separate calls cannot share so much as
a session. So there were three transactions where the design needs one, and the failure is not
theoretical: A writes its artefacts and commits, `failExpired` invalidates A, the release throws —
and A's artefacts are already there. Reverse the order and you get the opposite corruption.

**The job transition is the commit.** It cannot be a separate call. Three more criticals and a
fourth finding that nobody had written down are folded in below, each marked where it lands.

---

## The thing § 7 understated

§ 7 described choice A as *"finish the Postgres artefact store and put the eight stages behind one
transactional stage runner"*, which reads as a write-path change. It is not. Checked in the tree
today, stage by stage:

- **No stage writes through the seam.** `ArtifactStore.write()` has **no production caller at all** —
  its only callers are in `tests/pipeline-artifact-store.test.ts`. All nine stages `writeFile`
  directly, from inside nine different modules.
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

Nothing can be committed atomically until there is one place that owns the transaction. Three pieces,
none of which exists:

**1. `openOrBeginJobDraft(jobId, attemptId)` — built 2026-08-27.** The review's second critical, and
it would have been found the hard way on the second `/advance` of every fresh ingest: `beginRevision` **always** mints a
`randomUUID()` and copies from `articles.current_revision_id`. So request 1 creates R1 and writes
`fetch` into it; request 2 creates R2 from the still-empty published state, points the job at R2, and
`extract` looks for a raw document that is in R1. `RevisionLifecycle` has no reopen, and `toJob` does
not even expose `draft_revision_id` — so the job cannot find the draft it owns. One statement:
reuse the job's draft if the fenced row has one, mint if not.

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

**True afterwards:** there is a transaction with a shape. Nothing uses it.

### C. The Postgres artefact adapter, inside the coordinator

Every one of the twelve `ArtifactKind`s has a home in `article_revisions` today, and only one of them
is awkward:

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
4. `extract` — four write sites across two modules, one of which writes **another step's artefact**:
   the PDF path's `keepTheOriginal` rewrites `raw.pdf` and `raw.json`. Plus the chunk cache.
5. `fetch` — two write sites plus the upload branch (below).

**The CLI wrapper travels with the stage, in the same commit.** The review's fourth finding and it is
a plain fact about the code: `main()` in [`src/arc.ts`](../../src/arc.ts) assumes `generateArc()`
wrote `arc.json` and prints `run.outFile`. Convert the function without the wrapper and
`npm run arc -- data/example` reports success and creates nothing — which is
[silent success](../reusable/silent-success.md) with a green tick on it. The same pattern is in toc,
tweets, glossary, summaries and ideas. So there is no separate "landing D for the CLIs": each stage's
commit keeps its CLI writing files, and moving the CLIs onto the shared runner is the *last* landing
rather than the repair for one this created.

**`tweets` and `summary` need one thing from their owners first**: both keep `PROMPT_VERSION`
module-private, so neither can declare a `stamp` without writing the version out a second time in
`pipeline.ts` — two copies of one string, free to drift, and the drift shows up as an artefact that
never regenerates. `pipeline.ts` says so already. Exporting the two constants is two lines in each.

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

`npm run toc`, `npm run arc` and the eight others take a **directory or a file path** off `argv` and
call `generateToc({blocksPath, outDir})` directly. They touch no `STEPS`, no `StepContext`, no
`ArtifactStore`, no `beginStep`. Putting them behind the runner means giving each one a **slug**
rather than a path, which changes what you type as well as what runs.

Last because nothing waits on it, and not optional: a stage run from its own CLI leaves no attempt
marker, so an interrupted CLI run is invisible to `stepIsDone`. `src/store/artifacts.ts` lists that
as a legitimate reason `finishStep` finds nothing, and it stops being legitimate the moment the
artefacts are shared.

## What has to be true before this is believable

Each pinned to a specific way of being wrong, and each watched red first.

1. **One draft per job, across requests.** Two `/advance` calls on one fresh job, on two connections,
   and prove the second wrote into the *same* revision the first did. This is the failure that would
   otherwise appear as "extract cannot find the raw document" on every single ingest.
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
   condition deleted and proves nothing. That mistake has already been made once here.
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

## Open

1. **`revision_step_runs` needs `attempt_id`.** One nullable column, one migration. Nullable because
   every row written by `db:import` and by a CLI has no attempt and never will.
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
5. **Migration ownership, again.** `src/db/schema.ts` is modified in the working tree by somebody
   else right now, and `drizzle-kit generate` diffs the whole schema. The one migration this needs is
   generated when that lands and not before.

## See also

- [durable-queue-and-uploads.md](durable-queue-and-uploads.md) — the queue and upload half, § 7 the
  A/B question this answers and § 8 the wiring that goes first
- [transactional-stage-runner-review-sol.md](transactional-stage-runner-review-sol.md) — the review
  that returned NO-SHIP on the first draft of *this* document, and the source of the corrections
  above: the commit boundary, the per-request draft, the raw bytes, and the working state nobody had
  written down
- [durable-queue-and-uploads-review-sol.md](durable-queue-and-uploads-review-sol.md) — the review of
  the queue half, whose build order this document follows except in one place, and says why
- [postgres-storage-implementation.md](postgres-storage-implementation.md) — step 11 half B, of which
  this is stage 5
- [postgres-migration.md](postgres-migration.md) · [job-queue-rethink.md](job-queue-rethink.md) ·
  [../project/architecture.md](../project/architecture.md) ·
  [../reusable/silent-success.md](../reusable/silent-success.md)
