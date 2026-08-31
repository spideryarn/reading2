# Finish the move from files to the database

**Status:** plan, unbuilt. Reviewed twice by GPT Sol; **NO-SHIP both times**, and restaged after the
second — [finish-the-database-move-review-sol.md](finish-the-database-move-review-sol.md).

The **execution plan** for the remaining work in [delete-the-importer.md](delete-the-importer.md).
That document is the authority on *why*; this one is the staging.

> This pipeline work seems to be taking forever.
>
> — Greg, 2026-08-30, when he parked it

Parked that morning, restarted the same evening, because the parking was not safe — § *Trigger 5*
there.

## Why now

Three live faults, and they are **one defect wearing three costumes**: the pipeline's artefact reads
do not go through the store. `SPIDERYARN_STORE=postgres` swaps every *reader* store through
[`src/store/index.ts`](../../src/store/index.ts); [`src/jobs.ts`](../../src/jobs.ts) imports
`fsArtifacts` directly, so the *writer* half never joins that selection and reads a job-scoped `/tmp`
that is empty for any job that did not itself ingest the article.

| # | what happens | how it fails |
|---|---|---|
| 1 | A single-step job (`{ steps: ["tweets"] }`) on a published article | **Loud.** `ENOENT … blocks.json`. Three occurrences on 2026-08-30. |
| 2 | Retry on a failed job for a published article | **Silent.** `hasEarlierBlocks` reads the empty scratch, answers `false`, `assertIdsCarried` asserts nothing, stage 3 mints fresh ids and orphans every comment, highlight and note. The job reports success. |
| 3 | A claim hands a job back mid-run | **Silent and wrong.** The `/tmp` path carries the job id, not the attempt id, so a resumed claim can fall through to a stale artefact and declare a step done. |

## The decisions

Greg, 2026-08-30:

1. **The full end state** — filesystem store and importer deleted, local dev on Postgres.
2. **`assertIdsCarried` refuses loudly.** No exemption, no override.
3. **Deploy at the end, every stage deployable**, value as early as it can honestly be had.
4. **The data is not precious** — local *or* production. Alpha, no users. Refetch freely.
5. **Migrations and deploys authorised**, including with tests or typechecking blocked.

## The thing Greg asked for that is not available

> Define the stages such that we get most of the value with working versions as soon as possible …
> rather than deferring the main value to the end.
>
> — Greg, 2026-08-30

**The user-visible value cannot arrive before the flip, and the first version of this plan was wrong
to promise it.** That version had a stage 1 that made the pipeline *read* Postgres while the stages
still *wrote* files. Sol killed it, and the reason is concrete rather than stylistic:

- **A fresh ingest has no published revision to read.** `assets` asks `session.reads` for `toc`'s
  blocks inside its `run` and throws when they are absent
  ([`src/pipeline.ts`](../../src/pipeline.ts) § `assets`). Point the reads at the published revision
  and **the ordinary default pipeline fails on every new article** — the common path, broken to fix
  the uncommon one.
- **Layering the scratch in front brings back the first NO-SHIP**, because `/tmp` is scoped to the
  job and not the attempt.
- **A handback persists nothing.** `publishingSession` delegates every non-terminal commit to the
  filesystem session; only a `done` ending publishes. So the next claim cannot recover the previous
  claim's output whatever the reads do.
- **Cancel-then-retry binds the last published revision**, not the failed job's files, so a refresh
  that got through fetch and extract and then failed retries against the old article.

The all-skipped problem follows from the same root: *"no work was needed"* and *"an earlier claim
wrote work this instance cannot see"* stay indistinguishable until writes are durable and
generation-aware. **Durable writes are the prerequisite for fixing faults 2 and 3, not a later
refinement** — a read-only fix moves them rather than closing them.

So the staging below front-loads everything that *can* be front-loaded — every path-based read
converted, every guard repaired, every fingerprint completed — and the faults close at stage 3, which
is as early as they honestly can. Each stage before that is still independently deployable and leaves
the system better than it found it; none of them alone fixes what Greg hit.

## What looked finished and was not — including two of my own mistakes

**Two of the three items I first listed here were wrong**, corrected 2026-08-31 after Sol's second
review. They are kept rather than deleted, because the way they were wrong is the lesson: an
inventory subagent reported the *filesystem* side of a deliberately one-sided store as "no Postgres
implementation", and I passed it on without opening the Postgres file.
[silent-success.md](../reusable/silent-success.md) applies to a subagent's report exactly as it does
to a passing test.

**The Postgres write path is partly exercised — narrower than I claimed.**
`delete-the-importer.md:2118` says *"every call to `write` in this repo is in a test."* Stale:
`publishingSession` → `copyArtefacts` → `pgArtifactsIn.write` is production-reachable. What remains
unexercised is the **direct `pgStoreSession` product-commit path** — exactly what the flip depends
on. Still the largest risk, but a precise one.

**`htmlCarriesItsIds` inverts, and must be fixed earlier than I had it.** `extract.extractedHtml` and
`blocks.stampedHtml` both resolve to `at.htmlFile` — *the same file* — so on disk the guard sees an
`extract` that re-ran without ids. Split into two columns it reads stage 3's own output against stage
3's own blocks and returns `true` always. **Sol's correction: any Postgres-backed preflight triggers
this, so the guard is replaced in stage 1, not stage 2.**

**~~`db:export` fails open.~~** Wrong. `scripts/db-export.ts` builds `exportBlobStore()` before the
database is opened and before anything is written, catches, and exits; the constructor requires both
credentials and checks project identity. Nothing to fix.

**~~Three store methods lack a Postgres implementation.~~** Wrong — only `deleteGlossary` does.
`pgVisibilityStore.set` and `pgAdminStore.listUsersAcrossOwners` both exist; the 501s are the
filesystem side. A small piece of work, not a stage.

**A dead seam nobody listed: `revisionLifecycle`.** `src/store/revisions.ts` says no production module
imports it; the only reference is a guard test. Deleted in stage 4.

## What the inventory found

**`sendSource()` is ungated** — [`src/routes.ts`](../../src/routes.ts) reaches `fsLocations(slug)` and
`readRaw(dir)` with no store branch.

**Upload collision handling reads outside job scope** — `slugIsSpokenFor` reads `raw.json` through
`contextPaths` during enqueue, before `runInJob`, where `dataRoot()` deliberately throws on a
deployment.

**`toc` and forced `extract` are still path-based** — `toc` opens `blocksPathFor(ctx)`, `extract`
reads the scratch raw manifest. Both were missing from my first stage 1; Sol caught it.

**The checkpoint store has no callers** — `src/store/checkpoints.ts` says so itself. The real
checkpoints bypass it, and `scripts/checkpoints-sweep.ts` sweeps `data/` directly.

**`sketch` is already converted** — `STEP_ORDER` has eleven steps and `sketch` is the one absent from
`LEGACY_UNCONVERTED_STEPS`. The worked example for the rest.

**The deploy scripts depend on the layout** — `scripts/deploy.ts` copies `data/` and `output/` into
the deploy-test worktree; `deploy-checks.ts` gates on sentinel files beneath them.

**The corpus** — ~33 fixtures in `data/`, and 76 of 320 test files reference `example/`, `data/` or
`output/` (grepped by path, so an upper bound).

## The stages

Sol's recommended staging, adopted. Each ends green, committable and deployable. Sol reviews the
built code at every boundary, weighted above any plan-stage review. **The plan and the affected docs
are updated in the same commit as the stage.**

### Stage 1 — every input comes from the store, while reads stay on the filesystem

No switchover, no behaviour change a reader would notice, and nothing that can break a fresh ingest.

- **Complete every fingerprint.** `tweets`, `glossary`, `summary` stamp only the blocks hash but
  consume the tree and metadata; `ideas` and `sketch` omit metadata. Harmless while reads return
  `null`; the moment they succeed, an incomplete stamp lets a **stale artefact skip**.
- **Replace the blocks freshness guard** — `htmlCarriesItsIds`, before any Postgres-backed preflight
  exists to invert it.
- **Convert every path-based input**: the six late stages, `blocks`, **and `toc` and forced
  `extract`**.
- Fix `sendSource`, the upload-collision read, and `deleteGlossary`.

### Stage 2 — every stage returns its product

The ten unconverted steps stop writing their own files and return `{ parts, stamp }`, using `sketch`
as the worked example. Still `fsStoreSession`, still deployable throughout. Includes D2's checkpoint
callers — `pdf-read.ts` first, then `labels.ts`.

**On `src/toc.ts`.** `delete-the-importer.md` describes this wrongly and dangerously: it calls it a
three-line deletion of `clearCheckpoint()` at a stale line number. The call is at **`src/toc.ts:1285`**
(and `src/labels.ts:2065`), and it is **the last step of a deliberately ordered write sequence** — the
checkpoint is discarded only once `labels.json`, `blocks.json` and `tree.json` are all whole, **tree
last**, because the tree is the file every reader starts from. A crash mid-sequence otherwise leaves
new labels and blocks beside last week's tree, all three mutually inconsistent.

**Unresolved, settle before building:** the original plan deletes `clearCheckpoint` deliberately,
because the checkpoint store has **no `delete`** by design. So what reclaims a finished run's
checkpoint under Postgres? `scripts/checkpoints-sweep.ts` is a filesystem answer that does not carry
over. Either the store gains a reclamation path or checkpoints accumulate for ever.

Read `src/labels.ts` after the peer's ToC work lands — `LabelRun` has gained fields, a shortfall
re-ask and a bounded partial accept.

### Stage 3 — the flip, and the faults close

- **Exercise the real coordinator through `openPgStoreSession`** — the unexercised path.
- **Add exact-base verification**: reads bound to revision R1 must not be overlaid onto a draft
  copied from R2. `beginDraftIn` copies whichever revision is current when the lazy draft opens, and
  `publishAndFinish` checks article identity but *not* the base revision. This is the half of Sol's
  first review still unabsorbed.
- Tests for handback, a warm instance, retry, and all-skipped.
- **Delete or hard-disable the importer in this stage**, not later: once the pipeline publishes
  through `pgStoreSession`, a re-import writes `rawBytes` and friends while leaving the reference
  columns untouched, and the active-job guard no longer covers a finished job. *"Data is expendable"*
  does not make a revision whose metadata and referenced object describe different acquisitions
  correct.
- Then flip.

**Done:** a real ingest, a real single-step job and a real retry, end to end against Postgres, on a
deployed instance. Faults 1–3 each red-then-green.

### Stage 4 — delete the files

Remove the filesystem runtime adapters and `revisionLifecycle`; move local dev and fixtures to
Postgres; refetch the corpus rather than migrating it; rewrite the deploy scripts and `deploy-checks`
off the `data/`/`output/` layout; narrow and fix the affected tests.

**Remove every application reference to `raw_bytes` — but keep the column.**

**Docs in this stage:** [architecture.md § Storage](../project/architecture.md) still describes the
filesystem as the storage model.

### Stage 5 — drop `raw_bytes`

Only after stage 4's release is known good.

**This is why it cannot be one deploy, and it is not about the corpus.** `beginDraftIn` still copies
`rawBytes` through `REVISION_CARRY_POLICY`. Drop the column first and running code fails; deploy the
code and drop together and a rollback restores code naming a column that is gone. Decision 4 does not
touch this: it protects *executable compatibility*, not data. **Sol's correction to my claim that
decision 4 collapsed the demolition.**

## Risks

- **The direct `pgStoreSession` commit path has never executed.** Stage 3 opens by proving it.
- **One production database, no staging** — but expendable data, so a bad migration costs a refetch.
- **Stage 3 is the only stage that changes what a reader sees.** Everything before it is preparation
  and everything after is removal.
