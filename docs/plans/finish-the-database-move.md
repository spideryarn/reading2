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

**~~`sendSource()` is ungated~~** — ✅ **Built 2026-08-31 (stage 1b).** It reached `fsLocations(slug)`
and `readRaw(dir)` with no store branch, and it was the last unconditional filesystem read in
[`src/routes.ts`](../../src/routes.ts). It now asks `sourceStore.readPdf(slug)`, a new `SourceStore`
seam in [`contracts.ts`](../../src/store/contracts.ts) selected in
[`index.ts`](../../src/store/index.ts) like every other store: `fsSourceStore` in
[`artifacts-fs.ts`](../../src/store/artifacts-fs.ts), `pgSourceStore` in the new
[`pg-source.ts`](../../src/store/pg-source.ts). `node:fs` and `node:path` are gone from routes.ts
altogether and a test says they stay gone.

- **`readPdf`, not `readSource`, and the narrowness is the safety.** The content type is the
  boundary — an HTML source served from our own origin is stored XSS — so the store hands back the
  one kind the route may set a type for, and adding a second kind has to be a deliberate second
  method. [security.md](../project/security.md).
- **The Postgres side serves both eras.** Reference first (`raw_source_sha256` +
  `raw_source_kind` → the `sources` bucket, bytes re-hashed against the key on the way out), and
  `raw_bytes` behind a `source = 'pdf'` guard for rows written before the reference — which is
  **every article the importer has ever written**, so reference-only would have 404'd the whole
  local corpus while reporting nothing wrong. That second query dies with the column in stage 5.
- **A dangling reference throws `status: 500`, it does not answer `null`.** Same rule as
  `readRawDocument` in [`export.ts`](../../src/store/export.ts). The numeric status is load-bearing:
  `guardDbStore` scrubs everything else.
- **It was also the deployed jobless `dataRoot()` caller** that
  [`data-root.ts`](../../src/store/data-root.ts) named by route. It is not one any more, and that
  file's header says so.
- **Two negative controls were missing, and the review found both.** GPT Sol passed the
  implementation on every point and then said what the *tests* could not do: every Postgres fixture
  was a PDF, so an implementation returning referenced **or** legacy HTML would have passed — and
  that is the guard the whole `readPdf`-not-`readSource` decision rests on. Nothing asserted the
  first query excludes `raw_bytes` either, so putting the 32 MiB column back was a one-word edit no
  test could see. Both are now in `tests/source-store.test.ts` with two HTML fixtures (one
  referenced with its object really present in the bucket, one legacy), and all three were made to
  go red on the mutation they guard before being taken green.

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

- **Complete every fingerprint.** ✅ **Built 2026-08-31 (stage 1a).** `tweets`, `glossary` and
  `summary` stamped only the blocks hash but consume the tree and metadata; `ideas` and `sketch`
  omitted the metadata. All six article-reading stages now share one definition —
  `articleFingerprint` in [`src/source-hash.ts`](../../src/source-hash.ts), lifted from `arc`'s,
  covering blocks + tree + the three metadata fields the prompt head carries. `assets` keeps the
  blocks-only hash, correctly: it is the one stamped stage with no prompt. Harmless while reads
  return `null`; the moment they succeed, an incomplete stamp lets a **stale artefact skip**.
  - **One function per prompt head, not one for all of them.** `articleText` prints three metadata lines;
    `articleWithIds` prints those three **and `URL:`**, and `ideas`/`sketch` synthesise
    `TITLE: <tree.slug>` rather than dropping the head when there is no `meta.json`. The first
    version of this work covered neither and argued the URL out on a reason that was factually wrong
    (`article_revisions.final_url` exists and Postgres already rebuilds `Meta.url` from it).
    `articleWithIdsFingerprint` covers both, resolving the fallback through the shared
    `fallbackHeadTitle` so the stage and its fingerprint cannot drift. Widening the single function
    instead would have spent four model calls on a line the model was never shown.
    GPT Sol NO-SHIP, 2026-08-31.
  - **The Postgres reader had to learn "no metadata" the same way.** `metaFingerprintOf` answered
    `{ title: "" }` where the artefact adapter answers `null`, and the fingerprint tells those apart
    — so an article with no metadata was current to the pipeline and stale to every reader path.
    `citedMetaFingerprintOf` is the URL-carrying sibling, and it takes `final_url` in its argument
    type so a projection that forgot the column is a compile error rather than a silent hash.
- **Replace the blocks freshness guard** — ✅ **Built 2026-08-31 (stage 1a), then rebuilt the same
  day after review.** `htmlCarriesItsIds` is now `blocksMatchTheirHtml`, and asks a second question
  the first one could not: whether stage 3, run against the HTML stage 2 is holding *now*, would
  produce the blocks that are stored. It re-derives candidates with `splitIntoBlocks` and compares
  them through `blockIdentityFree`, a projection of every `Block` field except the id.

  **The first version compared the two documents' parsed text and was unsound in both directions** —
  it skipped a genuine re-split (`<p>Alpha</p><p>Beta</p>` → `<p>AlphaBeta</p>` has identical text)
  and it re-ran for ever on any article where the sanitiser legitimately removed something, because
  in Postgres `extracted_html` stays unsanitised while `stamped_html` does not. It had been measured
  against one real article. Both halves red-then-green;
  [block-ids.md § The freshness guard](../project/block-ids.md) has the cost and the idempotence
  measurement it rests on. GPT Sol NO-SHIP, 2026-08-31.
- **Convert every path-based input**: the six late stages, `blocks`, **and `toc` and forced
  `extract`**. *(Stage 1b, not built.)*
- Fix `sendSource` — ✅ **Built 2026-08-31 (stage 1b)**, see § *What the inventory found* above.
- Fix the upload-collision read and `deleteGlossary`. *(Not built.)*

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

**~~Unresolved, settle before building.~~ Resolved 2026-08-31, and my premise was false.** I wrote
that `scripts/checkpoints-sweep.ts` is "a filesystem answer that does not carry over". It is not: it
**branches on `STORE`** and calls `sweepPgCheckpoints`
([`src/store/checkpoints-pg.ts`](../../src/store/checkpoints-pg.ts)) — a delete on `last_used_at`,
dry-run by default, indexed, and mutation-tested. I had read only the `else` branch. A second
reclamation path exists too: `article_id`'s `on delete cascade`, from migration 0028. Both landed
2026-08-29, and `checkpoints.ts:122` names the sweep in the very comment I was quoting.

**So the question was already answered by its own dependency, and the answer is: build nothing.**

**And the crash-safety framing was wrong as well** — mine and the peer's, propagated by me into two
documents. Two orderings were conflated:

- **Labels → blocks → tree, tree last, is real today**, but not for the reason given. It holds
  because [`src/pipeline.ts`](../../src/pipeline.ts) reads *file exists* as *step done* and
  `writeFile` truncates before writing. Under one transaction — `toc` returning one `ArtifactParts`
  map through `writeArtefacts` — **both halves of that justification vanish**. Keep the ordering
  until stage 2 actually merges the three, then drop it.
- **`clearCheckpoint` last was never a crash-safety property.**
  [`src/labels.ts`](../../src/labels.ts) says so outright: a checkpoint is *"harmless to forget: read
  by the next run, matched fingerprint by fingerprint, and either reused correctly or ignored."* The
  gap protects **money**, not consistency. A transaction makes it *harder*, since the store sits
  outside the transaction by design — but both branches end at "a leftover row is fine".

**Measured rather than estimated:** 18 pdf chunks totalling 302,942 bytes; exactly one surviving
`labels-progress.json` at 14,824 bytes; the whole corpus, had nothing ever been reclaimed, is **under
500 KB**. Growth is per distinct question set, not per article, and every row costs a paid model
call, which is the floor under the rate. Leave the sweep unscheduled; watch
`sum(pg_column_size(value))` and schedule past ~100 MB.

Full working: [checkpoint-reclamation.md](checkpoint-reclamation.md).

Read `src/labels.ts` after the peer's ToC work lands — `LabelRun` has gained fields, a shortfall
re-ask and a bounded partial accept.

### Stage 2.5 — refetch the corpus, **before** the flip and not after

**Moved here from stage 4 on 2026-08-31, on Sol's third review.** The plan had refetching as
tidying-up after the switchover. It is a prerequisite, and the reason is concrete:

The importer writes `extractedHtml: null` while setting `stampedHtml`
([`src/store/import.ts`](../../src/store/import.ts)), and draft creation carries both columns
forward. Every article in the corpus arrived that way. So after the flip, a `blocks`-only job over an
imported article copies `extractedHtml = null`, fails the new guard, and **has no
`BLOCKS_INPUT_HTML` for the converted stage 3 to run from at all**. Not a degraded result — no input.

That state also contradicts [`src/blocks.ts`](../../src/blocks.ts) § around line 1221, which claims
no state exists with stamped HTML and no extracted HTML. It does; the importer makes it.

Two ways out: write explicit legacy handling for imported revisions, or **refetch every imported
article before the flip**. Refetching wins on Greg's decision 4 — the data is expendable and refetch
is free — and it avoids writing compatibility code whose only purpose is to be deleted at stage 4.

**Done:** no revision reachable by the pipeline has `stampedHtml` without `extractedHtml`, proved by
a query rather than by re-running the importer.

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
