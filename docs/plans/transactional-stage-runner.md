# The stages move behind one runner, and the artefacts follow the job

> Ok, proceed with planning and then implementing the remainder of the work.
>
> — Greg, 2026-08-27

This is the half [durable-queue-and-uploads.md § 7](durable-queue-and-uploads.md) put to Greg as a
question and he answered **A — port the writes**. It is the piece that actually unblocks an ingest on
Vercel, and it is much larger than that section's two paragraphs make it sound. This document says
how large, in what order, and what is true after each landing rather than only at the end.

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

So the work is: **both directions, all nine stages, plus the runner, plus the adapter, plus the
CLIs.** Said now, because an estimate that starts from "port the writes" is wrong by about half.

## One fact that reverses the review's ordering, for a reason it could not have had

[GPT Sol's review](durable-queue-and-uploads-review-sol.md) ends with an order, and its item 1 is this
document while its item 3 is the job wiring. That was right on the evidence it had, and it is wrong
now for a reason that only shows up when you read `pg-revisions.ts`:

> `beginRevision`, `publishRevision` and `failRevision` all fence on the job, and they do it with
> `update spideryarn.jobs set … where id = $1 and attempt_id = $2 and status = 'running'`
> — `fenceJob`, [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts). **That is the same
> row and the same three conditions the job store's own fence uses.** Until the wiring lands, no job
> has ever been written to that table, so every one of those fences matches zero rows and throws
> `NotTheLiveAttempt` — which is why nothing passes `job` today.

The transaction Sol asks for is a transaction *around the job attempt*. It cannot be built before the
job attempt exists. So the wiring goes first — not as "the last piece" this time, but as the
precondition for the fence. Everything else in Sol's order stands.

---

## The order, and what is true after each step

Four landings. Each is independently useful, independently testable, and leaves the tree working.

### A. The wiring — `src/jobs.ts` behind `JobStore`

Already specified step by step in
[durable-queue-and-uploads.md § 8](durable-queue-and-uploads.md#8-the-wiring-built-2026-08-27)
and already reviewed. Nothing here changes it.

**True afterwards:** a job survives the invocation that made it, two instances share one queue, and
`jobs.attempt_id` is a real value that `fenceJob` can match. **Still false:** the artefacts do not,
so a second invocation still re-runs the step. The advance endpoint is not switched on for Vercel by
this and the guard stays.

### B. The Postgres artefact adapter — additive, nothing else moves

A new `src/store/pg-artifacts.ts` implementing `ArtifactStore` against the columns that already
exist, plus the parity test that runs both adapters through one set of cases — the shape
`tests/store-jobs-parity.test.ts` and `tests/store-uploads-parity.test.ts` already use.

Every one of the twelve `ArtifactKind`s has a home in `article_revisions` today, and only one of them
is awkward:

| kind | where |
|---|---|
| `meta` | `title`, `byline`, `site_name`, `lang`, `excerpt`, `note`, and the six PDF columns |
| `raw` | `raw_bytes`, `raw_content_type`, `raw_encoding`, `raw_sha256`, `requested_url`, `final_url`, `fetched_at` |
| `extractedHtml` / `stampedHtml` | the two columns of those names |
| `tree` `labels` `arc` `tweets` `glossary` `summary` `ideas` | one `jsonb` column each |
| `blocks` | **`revision_blocks` rows**, not a column — plus `block_identities` |

`blocks` being a table is the whole difficulty of this adapter and it is worth naming: writing it is
a delete-and-insert of every row for a revision, reading it is `storedBlocks` (which
[`pg-revisions.ts`](../../src/store/pg-revisions.ts) already has), and `has` must not answer yes for
a revision holding a *previous* generation's rows. `toc`'s second copy of `blocks` is the same rows,
so on this side the two homes the filesystem needs collapse into one — which is the first place this
migration makes something simpler rather than harder.

**Three things to get right, each a way of being quietly wrong:**

1. **`ArtifactMap.raw` is declared `string` and the artefact is an object.** `raw.json` holds a
   `RawManifest` — `src/fetch.ts` — and the fs decoder checks it with `json("file", isString)`, an
   object with a string `file` field. So `read(slug, "fetch", "raw")` casts an object to `string`
   today and hands back something whose `.length` is `undefined`. Nothing has caught it because
   nothing calls it. Fix the type before writing a second adapter against the lie, or the pg adapter
   gets built to match a declaration that is already wrong.
2. **`has` must parse, not exist.** That is the fs adapter's rule and the reason for it survives the
   move: a `jsonb` column holding `null` and a column holding a valid-but-previous-generation value
   are different failures, and only one of them is caught by `is not null`.
3. **`beginStep`/`finishStep` are `revision_step_runs.status` and the attempt token.** The fs adapter
   holds an attempt id in a marker file and refuses to clear another attempt's; the Postgres one is
   one fenced `UPDATE … WHERE attempt_id = $attempt`, which the fs adapter's own comment already
   says. `revision_step_runs` has no `attempt_id` column yet — that is one migration, and it is the
   only schema change this whole document needs.

**True afterwards:** the adapter exists and is tested against the filesystem one. Nothing uses it.

### C. The runner — stages return artefacts instead of writing them

The invasive landing, and the one to take stage by stage.

**The shape.** `PipelineStep.run(ctx)` returns a `string` today, and the stage writes its own files
on the way. It becomes:

```ts
run(ctx: StepContext): Promise<StepProduct>;

interface StepProduct {
  /** The one-line summary kept on the finished step. Exactly today's return value. */
  detail: string;
  /** Everything this step made. The runner writes it, in one call, in one transaction. */
  parts: ArtifactParts;
  /** What it was made from and by. Written with the parts, never separately. */
  stamp: StepStamp;
}
```

and `StepContext` loses `dir` and `htmlFile` and gains `store: ArtifactStore`, so a stage reads its
input by asking rather than by opening a path.

**Why returning rather than handing the stage a transaction-scoped store.** The alternative — put a
store bound to the open transaction on `ctx` and let each stage call `write` when it likes — is less
invasive and keeps the signature. It is worse for one reason: a stage can then write half its
artefacts and return successfully, and the runner has no way to know. Returning makes "what this step
produced" a single value that either exists or does not, which is what lets `write` be one call —
and one call is the entire reason `ArtifactStore.write` takes `parts` rather than a kind at a time.

**The runner** is then `runStep` with its middle replaced:

```
claim (job store)
  → begin the revision, fenced on this attempt
  → run the stage, with its own deadline
  → ONE transaction: artefacts + revision_step_runs + the job transition
  → release (job store)
```

with `publishRevision` on the last step. The claim and release stay *outside*, which is what
[§ 8](durable-queue-and-uploads.md) said to preserve and the reason it said so.

**Stage by stage, easiest first**, because each one is a commit and the order is by how much of it is
already a return value:

1. `arc`, `tweets`, `glossary`, `summary`, `ideas` — one JSON blob each, written at the end of a
   `generate*` that already has the object in hand. Move the `writeFile` up into the runner. The
   read side is a `dir` each, all of it `blocks` and `tree`.
2. `toc` — three artefacts, and it already has a hand-rolled ordering discipline (tree written last,
   atomically) that exists *because* it could not be transactional. The transaction deletes that
   discipline, which is the clearest single case for this whole change.
3. `blocks` — two artefacts, one of which is the HTML that `extract` also writes. `extractedHtml`
   and `stampedHtml` are one path on the filesystem and two columns in Postgres, so this stage gets
   *less* ambiguous rather than more, and `htmlCarriesItsIds` can go from a regex over a file to a
   comparison of two columns.
4. `extract` — four write sites across two modules, and one of them writes another step's artefact:
   the PDF path's `keepTheOriginal` rewrites `raw.pdf` and `raw.json`. That is a cross-step write and
   the runner has to have an answer for it rather than discover it.
5. `fetch` — two write sites plus the upload branch, and the upload branch has a second store in it
   (§ below).

**`tweets` and `summary` need one thing from their owners first**: both keep `PROMPT_VERSION`
module-private, so neither can declare a `stamp` without writing the version out a second time in
`pipeline.ts` — two copies of one string, free to drift, and the drift shows up as an artefact that
never regenerates. `pipeline.ts` says so already. Exporting the two constants is a two-line change in
each and it converts `isDone` to `stamp`, which is what lets the runner stop having two ways to ask
one question.

**The upload branch writes to a second store inside the transaction's window.** `acquireUpload`
advances the upload record (`claimed → verified`, or `→ rejected`) from inside `fetch`'s `run`,
between the file writes and the return. Two different databases' worth of state, and no transaction
spans them. Today the `record.status === "claimed"` guard is what makes a crash there survivable.
Under the runner the settle moves into the same transaction as the artefacts — both are Postgres, so
this is available — and the reject stays where it is, because a rejection has to survive whatever
happens to the step.

**True afterwards:** an ingest works on Postgres, start to finish, on Vercel. This is the landing the
whole migration has been for.

### D. The CLIs

`npm run toc`, `npm run arc` and the eight others take a **directory or a file path** off `argv` and
call `generateToc({blocksPath, outDir})` directly. They touch no `STEPS`, no `StepContext`, no
`ArtifactStore`, no `beginStep`. Putting them behind the runner means giving each one a **slug**
rather than a path, which is a change to what you type as well as to the code.

It is last because nothing else waits on it, and it is not optional: a stage run from its own CLI
leaves no attempt marker, so an interrupted CLI run is invisible to `stepIsDone` — which
`src/store/artifacts.ts` already lists as a legitimate reason `finishStep` finds nothing, and which
stops being legitimate the moment the artefacts are shared.

---

## What has to be true before this is believable

Each pinned to a specific way of being wrong, and each watched red first.

1. **Both adapters agree.** One set of cases, run against `fsArtifacts` and the Postgres store —
   `has` on a half-written step, `read` of every kind, `stampFor` where a stamp exists and where the
   step records none, `beginStep`/`finishStep` with the wrong attempt token.
2. **`has` refuses a previous generation's blocks.** Write blocks for revision 1, begin revision 2,
   ask `has(slug, "toc", ["blocks"])`. The delete-and-insert makes this easy to get wrong in the
   direction that answers yes.
3. **`finishStep` will not accept another attempt's token**, on both adapters, watched red with the
   `attempt_id` condition removed — the condition this project has now dropped twice.
4. **A step that writes half its artefacts writes none.** Kill between two parts and prove the
   transaction took neither. This is the property the whole landing is for and the one the filesystem
   cannot have.
5. **An interrupted run does not publish.** The last step's transaction must not leave a published
   revision behind when the stage threw after writing.
6. **A stage reads what the previous stage returned**, not what is on disk — run the whole pipeline
   with `data/<slug>/` deliberately empty and prove it completes under Postgres.
7. **The `raw` type.** A test that reads `raw` back and uses it as a `RawManifest`, so the cast
   cannot quietly come back.

## Open

1. **`revision_step_runs` needs `attempt_id`.** One nullable column, one migration. Nullable because
   every row written by `db:import` and by a CLI has no attempt and never will.
2. **What a cross-step write means under the runner.** `extract`'s PDF path rewrites `fetch`'s
   artefacts. Either the runner allows a step to return parts belonging to another step — which makes
   `produces` a lie — or the PDF path stops doing it and hands the corrected manifest back some other
   way. Recommendation: the second, decided when stage 4 of landing C is written rather than now.
3. **`outputs(ctx)` has one consumer left** — `src/api.ts` builds the metadata page's per-stage file
   list and byte weights from it. Under Postgres there are no files and no byte weights of that kind.
   The page has to say something different, and what it says is a design question rather than a port.
4. **Migration ownership, again.** `src/db/schema.ts` is modified in the working tree right now by
   somebody else, so the one migration this needs is generated when that lands and not before —
   `drizzle-kit generate` diffs the whole schema.

## See also

- [durable-queue-and-uploads.md](durable-queue-and-uploads.md) — the queue and upload half, § 7 the
  A/B question this answers and § 8 the wiring that goes first
- [durable-queue-and-uploads-review-sol.md](durable-queue-and-uploads-review-sol.md) — the review
  whose ordering this document follows except in one place, and says why
- [postgres-storage-implementation.md](postgres-storage-implementation.md) — step 11 half B, of which
  this is stage 5
- [postgres-migration.md](postgres-migration.md) · [job-queue-rethink.md](job-queue-rethink.md) ·
  [../project/architecture.md](../project/architecture.md) ·
  [../reusable/silent-success.md](../reusable/silent-success.md)
