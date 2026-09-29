# Modes generate in parallel on one article

Status: plan, 2026-09-29. Overseer queue `qi-j7ahavj5`, Sentry SPIDERYARN-READING2-4C.

> Can we run some of the AI processing in parallel? For example, if I've opened up Ideas and Quotes
> and Drawing and Tweet-threads modes, or whatever, there aren't any dependencies between them, and
> probably we won't hit rate limits from the AI provider, so if possible let's allow them to run in
> parallel if the user triggers generation of them. The only complexity I can see is for something
> like Trajectory mode, which should wait until any of the modes that it draws on to have finished
> if they're running. Likewise, I think the Illustrated diagram might depend on the other diagram (I
> forget what we called it). There may be other cases of dependencies that we also need to take
> into account that I've forgotten.
>
> — Greg, 2026-09-29

## What serialises them today

Not the browser, and not Vercel. Each mode's panel posts its own job (`useStepJob`, `steps: [step]`),
and the browser drives every active job at once. What makes them wait is **the article's line in the
job queue**:

1. **`blockedByAnother`** (src/store/pg-jobs.ts), asked inside `claim` under the `queue_state` lock:
   a job may not start while any other job on the same slug is `running`, or while an *older* one is
   `queued`. That is the mechanism.
2. **`jobs_one_running_per_slug`** (src/db/schema.ts), a unique index on `slug where status =
   'running'`, is the backstop. Its own comment gives the reason it was built: the filesystem store
   wrote every artefact into one shared `data/<slug>/` directory. That store was deleted 2026-09-05.

There is also a **global cap of 3 running jobs** (`DEFAULT_JOB_CONCURRENCY`, overridable with
`SPIDERYARN_JOB_CONCURRENCY`), across all readers. It rations spend and provider rate limits, not
correctness. It is untouched here; see *Deferred*.

### Why simply lifting the line would not work

Every job writes into **its own draft revision**, copied from the published one when the job is
claimed, and publishes that draft when it finishes. `publishRevisionIn` refuses a draft whose base is
no longer the published revision (*"something else published while this draft was being written"*,
`PublishRefused` `transient`). So two mode jobs started together would both run their model calls,
and the second to finish would be refused and its paid work thrown away. The line exists, today, to
keep that from happening.

## The dependencies, from the code

Read off each step's `run` and stamp in src/pipeline.ts (a subagent's inventory, spot-checked):

- **`illustrated` reads `sketch`** (the "other diagram" Greg meant is the Sketch).
- **`trajectory` reads `quotes` and `ideas`.**
- No other step reads another step's artefact. No step reads `glossary`, `labels`, `arc`, `assets`
  or `tweets`. `structureHash` does not hash `navLabel`, so `labels` does not make a mode stale.
- Five steps read **their own** previous column (`glossary` and `quotes` append on *Find more*;
  `ideas`, `timeline` and `citations` lend their ids forward). So two jobs for the same step must
  never overlap either.
- Every mode step writes exactly one `article_revisions` column of its own name plus its
  `revision_step_runs` row. Other writes during a run (Storage blobs for `illustrated`, `ai_calls`
  ledger rows) are article-keyed, append-only or content-addressed, and unaffected by revisions.

## The design

Two changes, both on the server. Nothing in the browser changes: a mode that used to show *waiting*
while another mode ran now starts at once.

### 1. The line lets compatible mode jobs overlap

A **sharing step** is one of `arc, tweets, glossary, quotes, ideas, timeline, quiz, faq, sketch,
illustrated, trajectory, debate, citations` — everything after `assets` in `STEP_ORDER`, each of which
writes one column and reads only the article plus what is declared below. A job whose steps are
*all* sharing steps is a **sharing job**. Everything else (ingest, re-extraction, `hierarchy`,
`labels`, `assets`, resets) stays exclusive exactly as today.

One leaf module, `src/sharing-steps.ts`, holds **one exhaustive policy** for the sharing steps: each
step's owned revision column and the other steps it reads (Sol F3). A test holds it against
`STORAGE` (src/store/artifact-storage.ts): exactly one whole column per sharing step, no column owned
twice, every read names a sharing step.

```ts
illustrated: { column: "illustrated", reads: ["sketch"] },
trajectory:  { column: "trajectory",  reads: ["quotes", "ideas"] },
quotes:      { column: "quotes",      reads: [] },   // …and the rest
```

A job is a **sharing job** only if every step is in the policy **and** it carries no `reset` **and**
it does not reserve a name (`reserves_name = false`). An all-sharing reset or first ingest stays
exclusive, and a test says so.

Two jobs **may overlap** iff both are sharing jobs and, with `W` = the job's steps and `R` = the
union of `STEP_READS` over them:

```
W(a) ∩ W(b) = ∅        no step made twice (covers own-column append and id inheritance)
W(a) ∩ R(b) = ∅        b does not read what a is making
R(a) ∩ W(b) = ∅        and the other way round
```

`blockedByAnother` becomes: another active job on the slug that is running, or older and queued,
blocks this one **unless the two may overlap**. The order comparison stays in SQL (the microsecond
`created_at` point in its comment); the SQL returns the candidate rows' steps and the overlap test
is a pure TypeScript function, unit-tested on its own.

So, with Greg's example:

```
Quotes ──────────────▶ publish
Ideas  ──────────────────▶ publish          (all four start at once)
Sketch ────────────────────────▶ publish
Thread ───────────▶ publish
Trajectory   (waits: reads quotes, ideas) ········▶ starts after both ──▶ publish
Illustrated  (waits: reads sketch)       ···················▶ starts ──▶ publish
```

FIFO is kept for every pair that may not overlap, so an older exclusive job (a re-extraction) is
never jumped: a mode job newer than it waits behind it, as today.

`jobs_one_running_per_slug` is **dropped** (migration), like `jobs_only_one_running` before it: a
unique index cannot say "unless compatible". The mechanism was always the locked read; the index's
catch in `claimIn` is documented there as unreachable today and goes with it.

### 2. A sharing job that finds the article moved rebases instead of being refused

At the terminal `done` settlement (`pgStoreSession` `settleIn`, just before `publishRevisionIn`),
under the article lock already held: if the draft's base is not the current revision **and** the job
is a sharing job, try to **rebase**:

1. Mint a fresh draft from the current revision (`beginDraftIn`'s copy), fenced to this job.
2. Copy this job's `W` columns and their `revision_step_runs` rows from the old draft onto it —
   column and run row as one unit, because `stampForStep` cross-checks them.
3. Dispose of the old draft (failed, as any abandoned draft is).
4. Publish the new draft through the unchanged `publishRevisionIn`, whose base check now passes.

**Only when it is provably a no-conflict rebase**, compared on the data and not only on provenance
(GPT Sol F1). With `B` the old base and `C` the current revision:

- every `article_revisions` column that `REVISION_CARRY_POLICY` marks `carry` and that is **not** a
  sharing step's column is equal (`is not distinct from`) in `B` and `C` — tree, labels,
  nav_label_status, assets, raw/extract/meta fields;
- `revision_blocks` are the same set in `B` and `C` over `CARRIED_BLOCK_COLUMNS`;
- for every step in `W ∪ R`, its column is equal in `B` and `C`;
- the `revision_step_runs` rows are equal as sets **over a semantic projection** — `step_name`,
  `input_hash`, `implementation_version`, `prompt_version`, `model`, `status`, `started_at`,
  `finished_at`; never `revision_id` or `attempt_id`, because `beginDraftIn` does not carry
  `attempt_id` and a literal comparison would refuse the ordinary case (Sol F2) — for every
  non-sharing step and every step in `W ∪ R`.

When the overlay copies `W`'s run rows it copies `attempt_id` too, so the published row is what a
normal publication would have kept.

Otherwise it refuses exactly as today (`PublishRefused`, transient). The queue rule makes the refusal
unreachable for queue jobs; the check makes the rebase safe against anything else that publishes
(scripts, a future caller) rather than trusting the queue. `publishRevisionIn`'s "no opt-out" stance
is kept: it is not changed and still refuses a moved base.

The result is `C` plus my columns, so another concurrent job's publication is kept, not buried.

### What this deliberately does not do

- **Run steps of one job concurrently.** A Trajectory job that names `quotes` and `ideas` as
  `precededBy` still runs them in order. Separate jobs are what a reader opening several modes makes.
- **Make `labels` a sharing step.** It rewrites `tree` and `nav_label_status` and writes the base on
  failure; a column copy is wrong for it. A mode opened while labels are still arriving waits, as today.

## Stages

1. **Overlap rule and rebase**, one stage, because the rule without the rebase turns waiting into
   paid refusals. `src/sharing-steps.ts`, `blockedByAnother`, the migration, the rebase in the session,
   tests: the pure overlap function; two sharing jobs on one article claiming together; trajectory
   blocked by a running quotes job; a mode job blocked by an older queued exclusive job; the rebase
   publishing both columns; the rebase refusing when `W ∪ R` or a non-sharing run row moved. Docs:
   `ingest-queue.md` and the comments that say *"two jobs never run on one article"*.
2. **Browser check** at desktop and phone width: open two modes, generate both, see both progress at
   once and both land.

## Deferred

- **The global cap of 3.** One reader opening four modes now takes every slot on the machine, and
  the fourth mode (and everybody else's work) waits. Raising it is one environment variable on
  Vercel, and it is Greg's call because it rations spend across all readers. Recommendation: leave
  it at 3 until the reader numbers say otherwise; a per-owner cap is the better shape if it bites.
- **Coalescing a newer same-step request into a running one**, and running a job's independent steps
  concurrently — neither is what Greg asked for.

## Simpler options passed over

- **Drop the line and let the second job fail and retry.** Pays twice for the losing mode, every time.
- **Merge concurrent requests into one job.** Jobs arrive at different moments; a running job cannot
  absorb a step without re-opening its draft, which is the rebase anyway with more states.
- **Per-step artefact tables instead of revision columns.** The right shape if revisions ever stop
  being the unit of publication; far too large for this.

## Review log

- **Plan review, GPT Sol, round 1** (2026-09-29): no P0. F1 (P1) compare revision data, not only
  run-row provenance — taken. F2 (P1) `attempt_id` is not carried, so compare a semantic projection
  and copy it on overlay — taken, with a test whose base came from a real job. F3 (P2) one policy,
  checked against `STORAGE`; resets and name-reservers exclusive — taken. Sol agreed dropping
  `jobs_one_running_per_slug` is right and either deploy order is safe, and found no other code
  relying on one running job per article.
