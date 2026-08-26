# Resuming an ingest, and where the migration stands

> Let's say I start a new doc, the queue begins working, then I close the tab, then come back later,
> can we make it so it idempotently resumes (ideally skipping the bits it did, and picking up where
> it left off)?
>
> — Greg, 2026-08-26

**Short answer: yes, and most of it already works.** Not because anyone built resume, but because
of a decision made earlier for a different reason — *what counts as done is derived from the
artefacts, not from a job record*. That is what makes resume close to free, and it is worth saying
out loud before the design, because it is the whole trick.

Three things stand in the way. Two are already on the list for other reasons. The third is a one-line
behaviour change.

---

## Where the migration stands

Plain version. The detail lives in
[postgres-storage-implementation.md](postgres-storage-implementation.md) — its progress table and its
[ordered next steps](postgres-storage-implementation.md#what-happens-next-in-order) are the
authority, and this section deliberately does not repeat them.

**Done.** Reading comes out of Postgres entirely. Comments and shelf state are written there.

**Built but not connected.** Chat, saved searches and glossary lookups. Written, reviewed twice,
and currently unreachable — the riskiest state on the board, because from a file listing it looks
finished.

**Half built.** The pipeline's "is this step done?" check now *parses* the artefact instead of
checking a filename exists. Three known faults in it, none fixed.

**Redesigned rather than built.** The job queue — see
[job-queue-rethink.md](job-queue-rethink.md).

**Decided by Greg on 2026-08-26.** The demo article goes into the database marked as a fixture; an
unknown slug 404s rather than returning an empty list; and the queue takes whichever shape is
easiest, which turned out to be the browser-driven one.

---

## Why resume is nearly free already

`stepIsDone` asks the **artefact store**, not the job row: *does this step's output exist, and was it
made from this article by this prompt and this model?* Progress is therefore a **function of what is
stored**, not a status field somebody has to keep in step with reality.

So "skip the bits it did" needs no bookkeeping at all. It is a fold over the step list:

```
   the job's requested steps:   fetch  extract  blocks  toc  arc
   stepIsDone says:              yes     yes      yes    no   no
                                                          ▲
                                              resume here ─┘
```

That also means the two accounts can never drift, because there is only one. A job row that said
`toc: done` beside a missing tree would be a lie the system could tell; this cannot be.

**And the most expensive step already resumes *within* itself.** `toc`'s labelling pass is many model
calls, and it writes `labels-progress.json` as it goes — a mid-step checkpoint a later run may reuse.
So an interrupted labelling run does not start from zero.

## The three things in the way

### 1. A half-finished step can report itself done

The blocker, and it is already
[the first item on the next-steps list](postgres-storage-implementation.md#what-happens-next-in-order).
A step writes several artefacts, each landing atomically on its own, with no moment where all of them
land together. Kill a re-run halfway and you can have old and new side by side, all parsing, all
present — and the step says done.

**Resume is exactly the situation that produces this**, so it cannot be waved through as unlikely.
Under Postgres a transaction makes it impossible; on the filesystem it needs the generation check the
review asked for.

Until this is fixed, resume can skip a step that never really finished, and the damage shows up
later as an article whose tree does not match its blocks.

### 2. Closing the tab currently marks the job **failed**, not paused

`sweepStopped` sets a running or queued job to `error` with "stopped", and marks its running step
`error` too. The reasoning was sound for one long-lived process — *this process just started, so
nothing can be running* — and it is wrong the moment work is expected to pause and continue.

**This is the one-line behaviour change.** A job nobody is currently advancing is **waiting**, not
failed. Only a step that actually threw makes it `error`. Nothing else in the resume story needs a
new state.

### 3. Something has to notice you came back

With the browser-driven design there is no worker sitting there. Coming back *is* the trigger:
opening the library or the article page finds the unfinished job and offers to carry on.

## The design

One endpoint, and it is idempotent by construction because it recomputes rather than remembers:

```
POST /api/jobs/:id/advance

   server:  which of this job's steps is the first that stepIsDone says false?
            none left            → return { done: true }          ← safe to call for ever
            one is already running → return { busy: true }        ← the other tab is on it
            otherwise            → run exactly that step
                                   commit its artefacts, its step-run row and the
                                   job transition in ONE transaction
                                   return what happened
```

The browser calls it in a loop until `done`. **The browser never names a step** — it cannot skip one,
re-order them, or run one twice, because the server derives what is next from what is stored.

Calling `advance` on a finished job is a no-op. Calling it twice concurrently, from two tabs, is
resolved by the single-running-step rule already in the schema: one transition wins, the other is
told `busy` and watches. Calling it a week later resumes from wherever the artefacts say.

### What "come back later" looks like

The shelf already knows an article is part-ingested, because the same `stepIsDone` fold answers it.
The card says how far it got — *"3 of 5 done"* — and clicking it resumes. No new state, no
reconciliation, no separate "unfinished jobs" list that can disagree with the articles.

### What must still be true

- **The step is all-or-nothing.** Postgres transaction, or the filesystem generation check. This is
  blocker 1 and it is not optional — everything above rests on "done means done".
- **The final write is fenced.** The draft, the step-run row and the job transition in one
  transaction, `rowCount === 1` treated as the success condition. A stale invocation that wakes up
  after you resumed elsewhere must be unable to write anything. This survives from
  [step 12](postgres-storage-implementation.md#step-12-jobs-and-claiming-decided-before-it-is-built)
  and is the thing most likely to be got wrong.
- **`force` still overrides.** Re-running deliberately must not be skipped as already-done;
  `cascadeForce` already handles the downstream half.

### What resume honestly cannot recover

**A model call that was in flight when the tab closed is paid for and lost.** The bytes were streamed
and never stored. Resume re-runs that step from its start — except `toc`'s labelling, which has its
checkpoint. Fixing this in general means checkpointing every streamed call, which is not worth it for
one user; saying it out loud is.

## What this needs, in order

1. Fix the mixed-generation fault in the artefact store (already item 1 on the main list).
2. `sweepStopped` → a job nobody is advancing is **waiting**, not `error`.
3. The `advance` endpoint, the fenced transaction, and the browser loop — which needs
   `draft_revision_id`, so it follows step 11's migration.
4. The shelf card showing how far an article got, and resuming on click.

Steps 1 and 2 are worth doing **regardless of which queue design wins**, and 2 is small enough to do
on its own.

## See also

- [job-queue-rethink.md](job-queue-rethink.md) — why the queue is browser-driven, and the ingest that does not work on Vercel today
- [postgres-storage-implementation.md](postgres-storage-implementation.md) — the progress table and the ordered next steps
- [ingest-queue.md](../project/ingest-queue.md) — the queue as it is now, and how far "idempotent" already goes
- [silent-success.md](../reusable/silent-success.md) — why "done means done" is the load-bearing part
