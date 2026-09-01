# Finish the move from files to the database

**Status, 2026-09-01 07:00, resumed after the overnight run.** Stage 2.4 (new — `db:migrate` was
applying nothing) is done and reviewed. Stage 2.5 is measured and passing. Stage 3 items 0, 1 and 5
are done; items 3 and 4 are built but carry an unanswered GPT Sol NO-SHIP that is being answered
now. **Only item 6 — the flip itself — and stage 4 remain.** Nine GPT Sol reviews so far; the two on
the overnight work were both NO-SHIP and both right.

**THREE THINGS WERE OWED at 06:30 and two are discharged** — the orphan migrations in `main` were
fixed by another session, and stage 2.5 has now been measured on a quiet machine. The NO-SHIP is the
one that remains.

| item | state |
|---|---|
| 2.4 migration ledger | **done** — repaired, guarded, deep catalogue probes, postmortem, NO-SHIP answered |
| 3 item 1 — prove the coordinator | **done** (`132be8d`) — and it found the carry hazard below |
| 3 item 3 — `forceForRetry` | built in `265356b`; **Sol NO-SHIP being answered 2026-09-01** |
| 3 item 4 — exact base | built in `265356b` but **did not close the race**; durable `based_on_revision_id` being added 2026-09-01 |
| 3 item 5 — delete the importer | **done** (`b73ad74`) |
| 3 item 0 — short-id slugs | **done** — landed via `74e2915`, `1010a60`; `freeUploadSlug` and `slugIsSpokenFor` gone, `src/store/find-article.ts` committed |
| 3 item 6 — the flip | not started |
| 2.5 refetch | **done** — measured 2026-09-01 on a quiet machine, `✓ ready` |
| 4 | deliberately not started |

**The three things that were owed, and where each stands:**

1. ~~**`main` currently carries two orphan migrations.**~~ **Fixed by another session overnight.**
   `drizzle/meta/_journal.json` is committed and runs to `0046_quiz`; `src/db/schema.ts` carries
   `shortId` at `HEAD`, so the snapshot is no longer ahead of the schema. Verified 2026-09-01:
   `db-repair-migration-ledger.ts` reports 47 journal entries, 47 ledger rows, nothing unreachable,
   nothing pending, no orphans. The history is kept because the *class* is not fixed — the orphan
   check still reads the working tree, so it cannot see this on the machine that causes it.

2. **Sol's NO-SHIP on items 3 and 4 is unanswered**, and item 3's half created a money hole:
   `retryJob` checks only that the job exists, so POSTing `/retry` on a *successful* forced PDF
   refresh now re-runs and re-pays, repeatedly. See § *Stage 3 — the flip* item 3.
3. ~~**Stage 2.5 has never been measured on a quiet machine.**~~ **Measured 2026-09-01 06:35** at
   load average 2.5, and it passes: 0 revisions with stamped-but-not-extracted HTML, 1 source
   reference read back and 0 unreadable, over 15 articles and 4 revisions. `✓ ready`.

| | what | commits |
|---|---|---|
| Stage 1 | every input comes from the store; the fingerprints and the blocks guard repaired | `6e3ee67` |
| Stage 2 | every stage returns its product; `LEGACY_UNCONVERTED_STEPS` is empty | `5e8f744`, `5cf7827` |
| **Stage 2.4** | **`db:migrate` was applying nothing — repaired, and guarded** | |
| **Stage 2.5** | **refetch the corpus — by hand, not a script** | |
| Stage 3 | item 0 (slugs, parallelisable) then the flip | |
| Stage 4 | delete the filesystem store, **and drop `raw_bytes` with it** | |
| ~~Stage 5~~ | folded into stage 4 on Greg's decision 9 | |

The **execution plan** for the remaining work in [260827aa-delete-the-importer.md](260827aa-delete-the-importer.md).
That document is the authority on *why*; this one is the staging.

> This pipeline work seems to be taking forever.
>
> — Greg, 2026-08-30, when he parked it

Parked that morning, restarted the same evening, because the parking was not safe — § *Trigger 5*
there.

## If you are picking this up

Read this section, then § *Why now*, then the stage you are on. Everything else is history you can
reach for when a decision looks arbitrary.

**What you are walking into.** The pipeline writes its artefacts through a store seam rather than to
paths, and every one of the eleven stages returns its product instead of writing files. What has
*not* happened is the switch: [`src/jobs.ts`](../../src/jobs.ts) § `claimSession` still builds
`fsStoreSession({ artifacts: pipelineStore, jobs: store })`, and `pipelineStore` is `fsArtifacts`,
imported directly at line 57. So on a deployment the pipeline still reads and writes a job-scoped
`/tmp` that a single-step job never wrote to, and all three faults in § *Why now* are live in
production exactly as they were on 2026-08-30.

**The single most useful thing to understand before touching anything.** Every stage of this plan
before the flip exists to make the flip *one line*. If you find yourself needing to change a stage's
code to make Postgres work, something earlier was left undone — go and find it rather than adding a
branch.

**The order the remaining work goes in**, and it is short: **stage 2.5** (reset the database, re-add
a few articles by hand), then **stage 3 item 0** (every slug gets a short id — this is the piece to
hand to a second agent), then the rest of **stage 3** one agent at a time, then **stage 4**, which
now includes what used to be stage 5. § *How to run the rest of this with subagents* has the
parallelisation; § *The decisions* 6–9 are Greg's calls of 2026-08-31 and each of them deleted work.

**Where to start reading the code**, in this order:

1. [`src/pipeline.ts`](../../src/pipeline.ts) § `LEGACY_UNCONVERTED_STEPS` — empty, and the comment
   says why it is kept. Then `STEPS`, which is the whole pipeline in one object.
2. [`src/article-input.ts`](../../src/article-input.ts) — the seam the seven article-reading stages
   share, and the shortest statement of what this migration is about.
3. [`src/store/session.ts`](../../src/store/session.ts) § `checkProduct` and `fsStoreSession`, then
   [`src/store/pg-session.ts`](../../src/store/pg-session.ts) § `openPgStoreSession`. The second is
   what replaces the first, and it has **never run in production**.
4. [`src/jobs.ts`](../../src/jobs.ts) § `claimSession` — the line stage 3 changes.

**How to check the tree is healthy before you blame yourself.** `npm test` and `npm run typecheck`
both read the **working tree**, and several sessions share it. A failure naming a file you have not
touched is somebody's half-landed change nine times out of ten; `git diff HEAD -- <file>` tells you
whose. And a full run under load produces timeouts that look like failures: a 380-file run at load
average 38 reported 65 failures, and the same twelve files passed 142/142 as a subset an hour later.
**Re-run the subset before believing a red.**

**Things that have cost time here and will again:**

- **A green suite is not evidence a guard works.** Most of this plan's findings are checks that
  agreed with the bug. Apply the mutation the check exists to catch and watch it go red, every time.
  [silent-success.md](../reusable/silent-success.md), and § *What is proven and what is not* below.
- **`typecheck` cannot see HEAD.** A declaration and the thing it declares can land in separate
  commits and stay green for everyone whose tree holds both halves. It happened three times on
  2026-08-31.
- **Ask Greg before anything that writes to a database**, every time, including a migration that
  looks routine. Local is a lower bar but still ask before wiping.

**A second piece of work wants the same four files, and it is deliberately going first.**
[260831ah-toc-on-request-and-the-tree-that-costs-nothing.md](260831ah-toc-on-request-and-the-tree-that-costs-nothing.md)
takes the 320-second `toc` step off the ingest path: the reader lands on a free tree built from the
author's own headings, and the model call happens when somebody opens Hierarchy. It is the other
half of the same 2026-08-30 ask this plan came from — Greg ordered it *latency first, then
concurrency, then the database move* — so it is a sibling, not a competitor.

**The one contract it has to loosen is yours, and only the internal half of it.**
[`src/article-input.ts`](../../src/article-input.ts) says *"The blocks and the tree are not optional:
a stage with neither has nothing to be about"*, and `tree: Tree` is required both there and in the
public payload. Deferring `toc` makes a tree-less **draft** an ordinary state, so the stage-input seam
learns to answer "not yet" instead of throwing.

**The public payload stays non-null**, and that is GPT Sol's correction to us rather than our own
judgment: the reader builds geometry from `article.tree` unconditionally, even in Plain mode
([`src/web/App.tsx`](../../src/web/App.tsx):1132), and both database readers already refuse a
tree-less revision on purpose ([`src/store/pg.ts`](../../src/store/pg.ts):1786,
[`src/store/public-reader.ts`](../../src/store/public-reader.ts):438). **Broad nullability would
weaken a contract this plan relies on and buy nothing**, so we are not doing it. If you see a change
widening `tree` beyond the stage-input seam, it is not ours and it is probably wrong.

**It also touches** `src/pipeline.ts` (the `toc` step's registration and `DEFAULT_INGEST_STEPS`) and
`src/jobs.ts` — which this plan declares one-agent-at-a-time, and that rule holds for both of us.

**One thing you must not take from us: `LEASE_MS` cannot shrink.** An earlier draft of our plan said
that with `toc` off the ingest path a claim covers ~27 seconds of work, so the 760s lease could come
down. **That is false and Sol caught it.** An on-demand `toc` is still a job on the same claim
machinery with the same 320.4s budget ([`src/jobs.ts`](../../src/jobs.ts) § `STEP_BUDGET_MS`), so a
lease sized for a 27-second ingest self-aborts the one call the reader is actually waiting for. After
your flip a handoff gets cheap and the lease can be revisited, but it must still exceed `toc` plus the
deadline margin. Do not inherit the 27-second arithmetic from anything we wrote.
**The sequencing agreed with Greg, 2026-08-31:** the ToC work uses the gap before stage 2.5 starts to
land the contract change while these files are clean, so the flip is built on top of it rather than
colliding with it mid-flight. If you reach `claimSession` and `Article.tree` is already optional,
that is expected and nothing has gone wrong.

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

Greg, 2026-08-31, in answer to *"are there product decisions that would simplify this?"*. Each one
deletes work rather than adding it, and the four together take a stage out of the plan:

6. **Refetch by hand.** No refetch script — reset the database and re-add a few articles through the
   add box. Stage 2.5 stops being a piece of software.
7. **Every slug carries a short id, globally unique**, so two articles can never want the same one.

   > Yes, let's add a short id — and actually then we could in future allow users to rename the
   > slug, and redirect/find it from the short id. So make sure it's globally unique. I'm fine with
   > adding that to all slugs.
   >
   > — Greg, 2026-08-31

   Note the second half: the id is not only collision avoidance, it is **the stable handle a rename
   would redirect through**. That is why it belongs in a column of its own rather than being parsed
   back out of the slug.
8. **A failed refresh starts over.** Do the simple thing now; the design for salvaging a failed
   draft's completed work moves to § *Appendix: someday maybe*.
9. **No rollback support after the flip** — my judgement, taken under *"use your judgment, do the
   simple version for now"*. `raw_bytes` is dropped in stage 4 with the code that stopped naming it,
   so there is one deploy rather than two. The trade is written out in stage 4.

**And one thing deliberately *not* decided**: whether "refresh an article" should exist at all in the
alpha. It stays, and the analysis is in the appendix. Decision 8 makes its worst failure cheap enough
that the question does not have to be answered now.

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
`260827aa-delete-the-importer.md:2118` says *"every call to `write` in this repo is in a test."* Stale:
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

**~~Upload collision handling reads outside job scope~~** — ⚠️ **half fixed.** `slugIsSpokenFor` read
`raw.json` through `contextPaths` during enqueue, before `runInJob`, where `dataRoot()` deliberately
throws on a deployment. It now goes through the artefact seam, so it will move with the store — but
the Postgres branch is stage 3 item 2 and until then this is still the filesystem's answer. Note it
only fires on a *name collision*, which is why nobody has hit it: `articleExists` returns first for
a slug nobody holds.

**~~`toc` and forced `extract` are still path-based~~** — ✅ built in stage 2.

**The checkpoint store has no callers** — `src/store/checkpoints.ts` says so itself. The real
checkpoints bypass it, and `scripts/checkpoints-sweep.ts` sweeps `data/` directly. **Still true**,
and deliberately so: see stage 2b on why redirecting half of `clearCheckpoint` would silently re-buy
a paid model call per batch.

**~~`sketch` is already converted~~** — it was the worked example, and now every stage has followed
it. `LEGACY_UNCONVERTED_STEPS` is empty.

**The deploy scripts depend on the layout** — `scripts/deploy.ts` copies `data/` and `output/` into
the deploy-test worktree; `deploy-checks.ts` gates on sentinel files beneath them.

**The corpus** — ~33 fixtures in `data/`, and 76 of 320 test files reference `example/`, `data/` or
`output/` (grepped by path, so an upper bound). **Re-measured 2026-08-31**: 30 directories under
`data/` excluding `_`-prefixed, 18 with a `raw.json`, 2 with raw bytes and no manifest
(`constitution`, `noema-mythology-of-conscious-ai`), 10 with neither, and 0 missing `storedSha256`.
Of the 18, **nine name an object in `data/_blobs/` and nine name one in the Supabase container's
bucket** — disjoint, and the reason stage 2.5 exists in its present form.

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
- **Convert every path-based input**: the six late stages, `blocks`, `toc` and forced `extract`.
  ✅ **Absorbed into stage 2 and built there**, because converting a stage's input and its output
  turned out to be one edit per module rather than two passes over the same ten files.
- Fix `sendSource` — ✅ **Built 2026-08-31 (stage 1b)**, see § *What the inventory found* above.
- Fix the upload-collision read — ✅ **half built.** It now reads the manifest through the artefact
  seam rather than `readRaw(contextPaths(...).dir)`, so it moves with the store; the **Postgres
  branch does not exist** and is stage 3 item 2, where Sol calls it a hard prerequisite.
- Fix `deleteGlossary`, whose Postgres side is a 501. *(Not built. Small, and nothing depends on
  it — it is the last of the three store methods this plan once wrongly claimed were all missing.)*

### Stage 2 — every stage returns its product

The unconverted steps stop writing their own files and return their artefacts, using `sketch` as the
worked example. Still `fsStoreSession`, still deployable throughout.

**Split into three on 2026-08-31, once the shape of each was clear.** The plan said "the ten
unconverted steps" as though they were one job. Seven of them are the same job done seven times; the
other three are three different problems, and one of them is not a stage-2 problem at all.

- **Stage 2a — the article-reading stages.** `arc`, `tweets`, `glossary`, `ideas`, `quotes`,
  `sketch` and `assets`. Every one reads the article and writes something about it, and every one
  took the identical change.
- **Stage 2b — `blocks` and `toc`.** These *cut* the article rather than read it. `blocks` produces
  two documents that are one file on disk and two columns in Postgres; `toc` produces three
  artefacts in a deliberate order, and holds the checkpoint callers.
- **Stage 2c — `fetch` and `extract`, which are one problem and not two.** These *acquire* the
  article. `fetch` produces bytes as well as a manifest, and `extract` reads those bytes back, so
  neither can move without the other.

  **The blocker here is smaller than this plan and [260827j-transactional-stage-runner.md](260827j-transactional-stage-runner.md)
  both assumed, and the reason is worth writing down: the seam was built months ago and neither
  document noticed.** The claim was that the bytes have no `ArtifactKind`, so converting `fetch`
  means changing what an artefact *is*. But `writeRaw` in [`src/fetch.ts`](../../src/fetch.ts)
  **already** calls `storeRawSource` ([`src/store/blobs.ts`](../../src/store/blobs.ts)), which puts
  the bytes in the content-addressed `sources` bucket through a store that is already selected
  (`blobs-fs.ts` locally, `blobs-supabase.ts` deployed); `storedSha256` and `storedBytes` are already
  fields on `RawManifest`; and `writeRawSource` in
  [`artifacts-pg.ts`](../../src/store/artifacts-pg.ts) already turns that manifest into the
  `raw_sources` row and the reference columns. **The bytes already have a home that is not the
  filesystem.** So `fetch` returns `parts: { raw: manifest }` and simply stops writing three files,
  and `extract` fetches the bytes by content address instead of by path.

  What is genuinely open is the *read* side, and it is a security question rather than a plumbing
  one. `SourceStore.readPdf` is deliberately PDF-only, because it serves bytes to a browser and an
  HTML source served from our own origin is stored XSS
  ([security.md](../project/security.md)). `extract` is not a route and sets no content type, so a
  pipeline-side read of either kind is a different question — but it must be a *different method*,
  not a widening of that one.

  Two holes, and they are the same hole seen from both ends: `readRaw` answers `null` for articles
  fetched before `raw.json` existed, and manifests written before 2026-08-27 carry no
  `storedSha256`, so there is no object to read by address. Greg's decision 4 makes refetching those
  the right answer rather than writing compatibility code — but only if the state is refused loudly
  rather than skipped.

**✅ Built 2026-08-31.** `writeRaw(doc)` loses its directory and returns a `StoredRawManifest`;
`readRawBytes(manifest)` is its inverse; `runExtract({ html, url, slug })` and `runPdfExtract`
return `extractedHtml` instead of writing it. Both steps return `parts`, so
`LEGACY_UNCONVERTED_STEPS` is now **empty** and `LegacyUnconvertedStep` resolves to `never` — every
step's `run` is required by the compiler to return a `ConvertedProduct`, with no way round it.

- **The read went in `src/fetch.ts` as `writeRaw`'s inverse, not on `SourceStore`**, and the reason
  is stronger than the content-type one this plan gave. `pgSourceStore.readPdf` resolves the slug
  through `articles.currentRevisionId` and `ownedSlug`; stage 2 runs against a **draft** revision in
  a job with no request owner, and a fresh ingest has no current revision at all — so a sibling
  method there would answer `null` on the ordinary path. That is the shape of Sol's first NO-SHIP.
  Store selection is `blobStore()`, matching the write; anything else is a split brain by
  construction.
- **The `npm run fetch` CLI still writes its two files.** Every other stage CLI does, the rule is
  *the generator stops writing and the caller writes*, and for a command line the caller is
  `main()`. It prints the object key as well, which is new and earns its place — see below.
- **`RawDocumentUnavailable` is classified `blocked`, not left unclassified.** All three reasons —
  `no-object`, `missing`, `corrupt` — mean the document behind the manifest is not there. Retry
  never re-runs a step that finished, and `fetch` finished, so a retry would read the same absent
  object. The fix is a refetch, and `blocked` is how the reader is told that instead of being
  offered a button that cannot work.
- **The upload branch moved with the fetched branch.** `acquireUpload` wrote `raw.pdf` and
  `raw.json` itself, which would have left the two origins ending in different places — the one
  thing the stage 1/2 seam exists to prevent.

**And it found a fault nobody was looking for: nine of the eighteen local manifests name an object
the reading process cannot see.** `blobStore()` follows the credentials, so the corpus was written
across two stores depending on whether a process had called `loadEnvLocal()`. There was a writer, a
name, a hash and a verification on the way in, and **no reader at all** — so every check that
existed passed, because every check that existed was on the write. It is loud now.
[260831e-a-write-path-with-no-reader.md](../postmortems/260831e-a-write-path-with-no-reader.md) has the measurement
and how to repeat it. Refetching is the answer, per decision 4, and stage 2.5 is where it happens.

#### Stage 2a — ✅ built 2026-08-31

**It does not fix anything a reader can see, and I wrote the opposite here first.** The correction is
worth keeping, because the mistake is the one this whole document is about. Stage 2a makes every
article-reading stage *ask the store* instead of opening a path — but [`src/jobs.ts`](../../src/jobs.ts)
still builds its session as `fsStoreSession({ artifacts: fsArtifacts })` (line 1048, and line 57
imports it). On a deployment that store is rooted at the job-scoped `/tmp` a single-step job never
wrote to. So Greg's tweet button fails exactly as often as before; it now fails with *"No blocks or
tree for nagel-bat — run the toc step first"* instead of `ENOENT … blocks.json`, which is a better
sentence and the same outage.

`tests/late-step-on-a-cold-instance.test.ts` passes because the *test* hands the step a store rooted
at a published copy while `ctx.dir` is empty — which is the deployed shape as it will be after stage
3, and not as it is today. That asymmetry is the fixture's whole value and also the exact way it can
be misread: **it proves the stage is ready for a store that can see the article, not that production
has one.** Both halves were made to go red on the mutation that puts the directory read back.

So what stage 2a buys is that stage 3 becomes one line — `pgStoreSession` at `src/jobs.ts:1048` —
rather than one line plus seven stages that would still be reading the disk behind it.

**And it is now clearer than ever that the reads cannot be moved on their own.** Seven stages ask
`session.reads` *inside* `run`, where before only `blocks` and `assets` did. Point those reads at the
published revision while the writes stay on the filesystem and every fresh ingest fails, because a
fresh ingest has no published revision to read. That was Sol's first NO-SHIP and stage 2a widens it.

**One seam, not seven conversions.** [`src/article-input.ts`](../../src/article-input.ts) holds
`Article { slug, blocks, tree, meta }`, `readArticle` (refuses), `tryReadArticle` (answers `null`)
and `readArticleFromDir` (the command lines and the eval harnesses, and the one filesystem read left
in this half of the pipeline). Each generator takes `article: Article` where it took `dir: string`.

The duplication was the smaller half of the problem. **Each stage's `stamp` already asked the store
for the same three artefacts the stage then read off the disk** — so every one of them hashed what
the store held and generated from what the disk held. On a laptop those are the same bytes; through a
job-scoped `/tmp` they are not, and a stage that hashes one article and generates from another is a
stale artefact reporting itself current for ever. Both halves now go through the one function, so
they cannot disagree.

- **`meta` stays nullable, and what the nullability buys is not what this bullet said until
  2026-08-31.** `ideas` and `sketch` build a stub `{ title: tree.slug }` for the *prompt* while
  fingerprinting the real `null`. The claim here — and in two source comments and two test headers —
  was that hashing the stub instead writes a fingerprint the stamp can never reproduce. It does not:
  `articleWithIdsFingerprint` resolves `fallbackHeadTitle` itself for a `null` meta, so the stub and
  the `null` hash to the same sixteen characters (`…6a2b21a9397b6af2` on `example/`, both), and the
  mutation was applied to the real source with nothing going red anywhere.

  The property that *is* load-bearing: **every field the fallback renders into the prompt has to be
  one the fingerprint represents.** Adding `byline: "Unknown"` to the stub puts a `BY: Unknown` line
  in front of the model that no hash describes — stale for ever, looking healthy — and it left both
  `tests/stage-stamp-agreement.test.ts` and `tests/meta-fallback-fingerprint.test.ts` green.
  `tests/meta-fallback-fingerprint.test.ts` now asks the property directly: the head that reached the
  model must be exactly the head the fingerprint stands for, reconstructed from the fields the
  fingerprint canonicalises. Watched red on that mutation for both stages. `stage-stamp-agreement`
  cannot see it and now says so — both of its sides go on hashing the same `null`. GPT Sol, NO-SHIP
  finding 2 of 2026-08-31.
- **`writeAssets` is gone** rather than left exported with no callers.

#### Stage 2b — `blocks` and `toc`

**`blocks` — ✅ built 2026-08-31.** `runBlocks({ slug, extractedHtml, previous })` takes the document
as a string and returns the stamped HTML and the blocks; the step reads stage 2's document through
`BLOCKS_INPUT_HTML` and returns `parts: { blocks: blocksArtefact(run.blocks), stampedHtml: run.html }`.
It is **synchronous** now — there is nothing left to await, and an `async` wrapper would turn both
refusals into rejected promises a `void`-ing caller could drop.

- **`blocksArtefact`, never a bare `{ blocks }`.** Every writer of that artefact goes through it, and
  the stamp it adds is what lets a reader tell blocks cleaned by the current sanitiser policy from
  blocks cleaned by nothing. The bare version compiles, writes, and makes every article read back as
  *predates the sanitiser* for ever.
- **The hole the conversion opened, and the reason it is worth writing down.** A `runBlocks` that
  returned the **input** HTML where the stamped HTML belongs compiles cleanly, and until 2026-08-31
  nothing in the repository caught it. `blocksMatchTheirHtml` does notice — but only at the *next*
  skip check, and its verdict is "not current", so the step simply re-runs and writes the same wrong
  pair again, for ever. **The Postgres artefact suite passed under that mutation**, because
  `write(… stampedHtml: run.html)` and reading the blocks back cannot see it. Two tests at the seam
  now catch it, and both were watched failing. That is the shape this whole migration keeps meeting:
  the guard exists, the guard is right, and the guard is downstream of the damage.

**`toc` — ✅ built 2026-08-31.** `generateToc({ blocks, slug, checkpointDir? })` returns
`{ parts: { tree, labels, blocks }, inputHash, clearCheckpoint }`, and the step writes all three in
one `parts` map with `stamp: { inputHash: run.inputHash }`.

- **The write order is gone, and the reason written beside it was wrong.** Labels, then blocks, then
  tree last was called crash-safety in both the code and this plan. The real mechanism was narrower:
  `stepIsDone` reads *file exists* as *step done*, and `writeFile` truncates before it writes. One
  `parts` map removes both halves, and the ordering now survives only in `main()`, which really does
  write three files. The comments that asserted the old reason are rewritten rather than left.
- **`inputHash` and nothing else in the stamp, and this was tested rather than reasoned about.**
  `STAMP_SOURCE.toc` is `"labels"`, so whatever the step passes is compared against the labels
  file's own stamp by `assertStampAgrees`. `run.inputHash` *is* `labels.sourceHash`, so it cannot
  clash. A `promptVersion` beside it **throws** — `toc/2` against `labels/1` — and that throw would
  fail every ingest. The hash comes back from the stage rather than being recomputed in the step,
  because a second computation of "the blocks hash" is how the two sides come to disagree;
  `generateToc` asserts at its own seam that `labels.sourceHash === hashBlocks(parts.blocks.blocks)`.
- **`clearCheckpoint` is returned and the pipeline deliberately does not call it.** It should happen
  once the artefacts are *stored*, which is `StoreSession.commit`, after `run` has returned. Calling
  it inside `run` would discard the checkpoint while the write could still fail, and the next run
  would re-buy a whole label pass. Leaving it costs a file the next run either reuses correctly or
  ignores. The command line, which stores the artefacts itself, does call it — in the right order.
- **The checkpoint stays on the filesystem, behind an explicit `checkpointDir`.** `CheckpointStore`
  has no `delete`, on purpose: its header says landing D drops `runId` and `clearCheckpoint` along
  with the one-file-per-run format, and it keys on an `articleId` this stage is not given.
  Redirecting half of it now would silently stop the next run resuming and re-buy a paid call per
  batch. **So D2's `labels.ts` item is not done, and is not pretended to be.**
- **One thing the agent's report and its code disagreed about**, caught by the typechecker rather
  than by reading: the report described `TocRun.inputHash` in detail and the field was in neither
  the interface nor the return. `stamp: { inputHash: undefined }` records nothing, `toc` carries
  `NO_INPUT_HASH`, and `reasonsNotToPublish` then refuses every article. A report is evidence about
  what an agent meant, not about what is in the file.

**One test across all three stages, because every seam moved on the same day.**
`tests/acquire-extract-blocks-end-to-end.test.ts` runs stage 1 → 2 → 3 in sequence through the real
artefact store, with no network and no model call. Every other test in the repo asks about one seam;
this asks whether they join, which matters because the bytes, the article and the blocks all changed
what crosses their boundary within hours of each other, converted by three different agents. It also
asks the two questions no unit test does: that `isDone` answers **true immediately after a run**
(an over-firing guard makes stage 3 re-run for ever while every fixture-based test stays green — two
earlier versions of that guard did over-fire), and that a re-run carries the ids.

**Its first version was vacuous and the way it was vacuous is the lesson.** It asserted that a second
`blocks` run kept the ids, and that passes on the filesystem *whether or not the baseline works* —
`extractedHtml` and `stampedHtml` are one file, so stage 3 re-reads a document that already carries
the ids it wrote last time and simply reuses them. Deleting the baseline outright
(`previous = undefined`) left it green. It now re-runs **stage 2** first, so an id-free document is
back in place and the baseline is the only possible source; the same mutation now reddens it. That is
fault 2 in miniature — in Postgres `extractedHtml` never carries ids, so *every* run is that run.

**`extractedHtml` and `stampedHtml` stay one file on the filesystem, and that is a deliberate
non-decision.** `PATHS` in [`artifacts-fs.ts`](../../src/store/artifacts-fs.ts) maps both to
`at.htmlFile`, which is why `blocksMatchTheirHtml` cannot fail there however carefully it is written
— it compares stage 3's own output against stage 3's own blocks. Splitting the two paths would make
the guard real on a laptop, and it was considered and passed over: it would make every existing
article read as un-extracted, break the fixtures the corpus and 76 test files are built on, and be
deleted again at stage 4 when the filesystem store goes. The guard becomes real in Postgres, where
the columns really are separate, and that is stage 3.

**On `src/toc.ts`.** `260827aa-delete-the-importer.md` describes this wrongly and dangerously: it calls it a
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

Full working: [260831o-checkpoint-reclamation.md](260831o-checkpoint-reclamation.md).

Read `src/labels.ts` after the peer's ToC work lands — `LabelRun` has gained fields, a shortfall
re-ask and a bounded partial accept.

#### What the two NO-SHIPs changed — and the correction to `5e8f744`'s own message

GPT Sol reviewed 2a+2b and 2c separately and returned **NO-SHIP on both**
([260831w-stage2ab-review-sol.md](260831w-stage2ab-review-sol.md), [260831v-stage2c-review-sol.md](260831v-stage2c-review-sol.md)).
Every finding was accepted; all of them are fixed **in `5e8f744` itself**.

**That commit's own message is wrong about this and cannot be amended** — another session had already
committed on top. It says the stage-2c fixes are "part-landed and complete in the next commit"; they
landed in full. The mistake is worth keeping rather than quietly correcting, because of how it
happened: the pathspec commit form takes the **working tree**, so once a fix is in a file there is no
pre-fix version of it left to commit. I had a two-commit split in my head that the mechanics did not
allow, and the agent holding the file was the only one who could see it.

- **The fetch CLI recreated the very split the postmortem is about.** `main()` never called
  `loadEnvLocal()`, so `npm run fetch` wrote to `data/_blobs/` while the server wrote to Supabase —
  and because the CLI writes `raw.json`, the queue skipped `fetch` and `extract` dereferenced against
  the other store. **That CLI exists because I overruled the agent that wanted it diagnostic-only.**
  The reasoning was right about consistency and missed that this CLI, unlike the six others, makes a
  *storage selection* that has to match the server's. `loadEnvLocal()` is now the first statement of
  `main()`, above the argument check so the guarantee is observable from outside, and a `Store:` line
  prints the credentials that chose — sharing its helper with `missingObjectAdvice` so the two cannot
  disagree. **Sol's addition to the postmortem's lesson**: a reader exposes the split promptly, but
  stable selection prevents creating it, and this CLI proved detection alone is not enough.
- **An over-long object was offered a Retry that could not work.** `readRawBytes` passed
  `storedBytes` as `maxBytes`, and both adapters throw a plain `Error` past the limit — so it never
  reached the hash check, never became `RawDocumentUnavailable("corrupt")`, and arrived unclassified.
  Now classified by asking the store how big the object actually is. Deliberately not a catch-all: a
  Storage 503 read as corruption tells a reader to refetch an article that would have loaded on the
  next click.
- **The blocks seam test accepted a mismatched pair — and so does the production guard.** Sol's
  finding was that a mutation preserving ids while changing text passed. The agent fixing it found
  the variant Sol's own suggested replay misses: move the corruption *inside* `splitIntoBlocks` and
  both sides of the replay are corrupted identically. **`blocksMatchTheirHtml` is that same replay**,
  so the step would report itself **done**, permanently, holding a document and a block list that
  describe different words — worse than the re-run loop Sol described. What closes it is re-reading
  the stored HTML with **no baseline**, which does not share the guard's assumption.
  Still uncovered, and said rather than left: a corruption applied consistently to both halves, and
  any change outside a block.
- **The metadata rule I had been repeating was the wrong rule** — see the `meta` bullet above.
- **Two atomicity claims of mine were false.** `toc`'s three artefacts do not "land together or not
  at all": `fsStoreSession` has no transaction and says so. And a missing object does not 404 — the
  filesystem adapter turns `ENOENT` into `null`, so `RawDocumentUnavailable` reaches the route as a
  500. Both comments now say the true thing.

### Stage 2.4 — `db:migrate` had been applying nothing, and saying it had

**Not in the original staging, and it had to come first: the merged code needed an
`article_revisions.quotes` column the laptop did not have, and about 34 suites were red
because of it.** Found on 2026-08-31 while merging, by probing the catalogue for each
migration's effect rather than by reading the journal — which cannot show this, because
the journal is the list of migrations that exist, not the list that ran.

Four published migrations were unreachable here: `0032_jobs_concurrency_cap`,
`0033_quotes`, `0034_flowery_wolfsbane` and `0036_drop_summary_column`. drizzle's migrator
keeps a **watermark, not a ledger** — one row, read once, and only entries strictly newer
than it are applied — so anything whose `when` slips below it is skipped for ever, in
silence. `0035_timeline`'s hand-written round `when` of `1788200000000` put `0036` below
the line for everybody, **probably including production**; a branch's own newer generated
timestamps put the other three below it here.

The whole write-up, including why `0033_quotes` **must not be replayed verbatim** — its
final CHECK predates `timeline` and would reject rows that now exist — is in
[260831h-db-migrate-applies-nothing-when-a-journal-timestamp-jumps-the-queue.md](../postmortems/260831h-db-migrate-applies-nothing-when-a-journal-timestamp-jumps-the-queue.md).
GPT Sol's review is [260831ag-migration-watermark-repair-sol.md](260831ag-migration-watermark-repair-sol.md).

**Done, locally:** [`scripts/db-repair-migration-ledger.ts`](../../scripts/db-repair-migration-ledger.ts)
reconciled all four plus `0037`, in one transaction under an advisory lock, with every
effect re-probed after the commit. `0036` destroyed nothing here — zero summary step runs,
zero non-null summary values. No journal entry is unreachable any more.

**Done, and it is the part that stops this recurring** (`e07a519`): `scripts/migration-ledger.ts`
holds the judgements, and `db:migrate` runs a preflight before `migrate()` as well as a postflight
after, under a session advisory lock because drizzle takes none. The preflight refuses — exit 1, no
DDL, no tick — unless the applied entries are a contiguous prefix **in journal order** (not
timestamp order: `0035` sits before `0036` and is stamped later, so sorting by `when` would call a
healthy database broken), every pending entry clears the watermark, and every applied row's hash
matches its file. `tests/migration-journal.test.ts` fails on any new inversion, with the published
`0035`/`0036` one grandfathered rather than the rule weakened.

**The postflight is weaker than it reads**, and its own author says so: it compares metadata with
metadata, and the repair *writes* that metadata, so a bad insert makes it green by construction. The
catalogue probes are the half that proves the schema.

**Owed on production, and nobody has looked:** there are no production credentials in this
tree, so the claim that `0036` is unreachable there is an inference from timestamps, not
an observation. Expect the preflight to refuse the first time it runs against production.
**That refusal is the guard working, not a reason to force the gate** — the runbook is
Sol's § 5.

### Stage 2.5 — refetch the corpus, **before** the flip and not after

**Moved here from stage 4 on 2026-08-31, on Sol's third review.** The plan had refetching as
tidying-up after the switchover. It is a prerequisite, and the reason is concrete:

The importer writes `extractedHtml: null` while setting `stampedHtml`
(`src/store/import.ts`), and draft creation carries both columns
forward. Every article in the corpus arrived that way. So after the flip, a `blocks`-only job over an
imported article copies `extractedHtml = null`, fails the new guard, and **has no
`BLOCKS_INPUT_HTML` for the converted stage 3 to run from at all**. Not a degraded result — no input.

That state also contradicts [`src/blocks.ts`](../../src/blocks.ts) § around line 1221, which claims
no state exists with stamped HTML and no extracted HTML. It does; the importer makes it.

Two ways out: write explicit legacy handling for imported revisions, or **refetch every imported
article before the flip**. Refetching wins on Greg's decision 4 — the data is expendable and refetch
is free — and it avoids writing compatibility code whose only purpose is to be deleted at stage 4.

**And since 2026-08-31 there is a second, larger reason to refetch.** Nine of the eighteen local
manifests name a source object the reading process cannot see, because `blobStore()` follows the
credentials and the corpus was written across two stores
([260831e-a-write-path-with-no-reader.md](../postmortems/260831e-a-write-path-with-no-reader.md)). Stage 2c made
that loud: `extract` now dereferences the manifest, so about half the corpus refuses on a laptop
until it is refetched. Same answer, same reason — decision 4 — and it is now the *first* thing a
developer hits rather than something discovered at the flip.

#### How to do it — by hand, and that is decision 6

**Do not write a refetch script.** It would be software whose only purpose is to be deleted at stage
4, and the tests that touch `data/` **enumerate the directory** rather than naming slugs
(`store-parity` and `store-roundtrip` both `readdir`), so a smaller corpus simply means fewer cases.

So: reset the database, and re-add three or four articles through the add box like a reader would.
That exercises the real path, which a script would not.

```
npm run db:reset          # ASK GREG FIRST — it empties the database and puts nothing back
npm run db:seed-owner     # the one auth.users row every owner_id points at
npm run dev               # then paste three or four URLs into the add box
```

**Four test files name specific slugs** and will need looking at rather than assuming:
`tests/stage2c-raw-bytes.test.ts`, `tests/store-artefact-manifest.test.ts`,
`tests/timeline-resolve.test.ts`, `tests/timeline-time.test.ts`. An hour, not a stage.

**Two things to establish, before and after**, because the point is to end a known-bad state rather
than to have run a command:

```sql
-- 1. Revisions with stamped HTML and no extracted HTML — the importer's signature.
select a.slug from spideryarn.article_revisions r
  join spideryarn.articles a on a.id = r.article_id
 where r.stamped_html is not null and r.extracted_html is null;

-- 2. Manifests naming an object this process cannot see: the probes are written out
--    verbatim in docs/postmortems/260831e-a-write-path-with-no-reader.md. Nine of eighteen, locally.
```

**Done means both queries come back empty and the probe finds every object** — proved by running
them, not by a command having reported success. A refetch that silently skipped an article looks
exactly like one that worked.

### Stage 3 — the flip

**This heading did not exist until 2026-08-31 and its absence was doing damage:** every bullet below
was sitting under stage 2.5, so the document read as though refetching the corpus and switching the
store were one piece of work. They are not, and the whole staging argument turns on their being
separate.

**The flip itself is one line** — `fsStoreSession` becomes `pgStoreSession` at
[`src/jobs.ts:1048`](../../src/jobs.ts), where line 57 also imports `fsArtifacts` directly. Stage 2
exists so that this line is the only one that has to change; everything before it was making that
true.

#### Item 0 — every slug carries a short id (independent, and the one piece to parallelise)

**Greg's decision 7, and it deletes item 2 below rather than adding to it.** This has nothing to do
with the store move, shares no files with the rest of stage 3, and is independently committable — so
it is the natural thing to hand to a second agent while the first proves the coordinator.

**What it is.** A new article's slug becomes `<readable>-<shortid>`; `mintId` in
[`src/ids.ts`](../../src/ids.ts) already produces the `spya-k3m9qt` form the rest of the codebase
uses. `articles.slug` is *already* globally unique at the column
([`src/db/schema.ts`](../../src/db/schema.ts)), so what changes is not the constraint but the fact
that **two new articles can no longer want the same slug**.

**What it deletes**, and this is the point:

- `freeUploadSlug` and `slugIsSpokenFor` ([`src/jobs.ts`](../../src/jobs.ts)) go entirely. With them
  goes **item 2 below** — the Postgres branch GPT Sol called a hard prerequisite for the flip — and
  the whole *"is this article this upload's own"* question, which under Postgres would have needed a
  join to `jobs.upload_id`.
- `freeSlug`'s collision paths — the host prefix and the `-2`…`-99` counter — become unreachable.

**What it must NOT delete, and this is the trap.** `freeSlug` also *adopts*: adding the same article
twice, in any spelling of its URL, returns the existing slug rather than making a second article.
That is `urlKey`, it is the answer to a Greg question of 2026-08-26, and the story of getting it
wrong is in `freeSlug`'s own header — `http://` vs `https://` produced two shelf cards under one
headline, having paid twice. **Keep the adoption path; delete only the collision paths.**
`tests/jobs.test.ts` § `freeSlug` covers this without a filesystem, network or queue, and is where
the proof belongs.

**The second half of the decision.** The id is also the stable handle a future rename would redirect
through, so it goes in **its own column** rather than being parsed back out of the slug — a slug the
reader has renamed no longer contains it. That column, its unique index, and a lookup that resolves
`/read/<anything>-<shortid>` are the shape; **the rename UI itself is not this stage** and should not
be built now.

**Reader-visible, so it is a product change as well as a refactor.** Every new article's URL gains a
suffix. Existing articles keep their slugs — nothing is rewritten — and the corpus is being reset at
stage 2.5 anyway. Production articles are expendable under decision 4, but *say so to Greg before
touching them* rather than inferring permission from the decision.

**Done means:** a new article and a new upload both get a suffixed slug; adding the same URL twice in
two spellings still returns one article; `freeUploadSlug` and `slugIsSpokenFor` are gone from
`src/jobs.ts`; and the short id resolves an article on its own. Each proved by a test watched red
first — in particular the adoption test, because that is the one this change can silently break.

#### The line itself, exactly

[`src/jobs.ts`](../../src/jobs.ts) § `claimSession` currently reads:

```ts
export async function claimSession(job: Job, attempt: string): Promise<StoreSession> {
  const inner = fsStoreSession({ artifacts: pipelineStore, jobs: store });
  if (STORE !== "postgres") return inner;
  return publishingSession(inner, { job: { id: job.id, attemptId: attempt }, slug: job.slug, from: pipelineStore });
}
```

Under `postgres` it must become `openPgStoreSession({ slug: job.slug, job: { id: job.id, attemptId:
attempt } })` ([`src/store/pg-session.ts`](../../src/store/pg-session.ts)), which opens or reopens
the claim's draft and returns a session whose `commit` is one transaction. **`publishingSession`
goes with it** — it exists because `fsStoreSession` publishes nothing, and `pgStoreSession` settles
and publishes inside its own transaction. Read `publish-session.ts`'s header before deleting it;
there is a `done` ending that reaches the store through `settleJob` as well as through `commit`, and
whatever replaces it has to cover both.

The filesystem branch stays for now — it is what every laptop runs until stage 4.

#### Do these in this order, and none of them is optional

**Item 0 above can run alongside item 1 and no further.** From item 3 onward everything converges on
`src/jobs.ts`, and one agent at a time in that file is the lesson of 2026-08-31.

**1. Prove the coordinator runs at all.** `openPgStoreSession` → `pgStoreSession` → `commit` is the
**direct product-commit path, and it has never executed in production**. `copyArtefacts` →
`pgArtifactsIn.write` is reachable today and is *not* the same path. Drive one real step through it
against the local database before changing anything else, so that every later failure is about the
thing you just changed.

**2. ~~`slugIsSpokenFor`'s Postgres branch~~ — deleted by item 0, not built.** It asked *is this
article this upload's own* by reading the `fetch` manifest, and under Postgres that answer is on
`jobs.upload_id` rather than on the revision. Sol called building it a hard prerequisite; Greg's
decision 7 removes the question instead. **If item 0 is not done, this comes back** — and the failure
is a retried upload finding its own slug occupied, taking `slug-2`, and paying for the transcription
again. The comment in `src/jobs.ts` naming this stage must go with it.

**3. Retry after a failed forced refresh** — the fourth fault, below. **Already decided** (Greg's
decision 8): re-force from the earliest *originally* forced step, which is a change to
`forceForRetry`. What is left is building it and writing the test that goes red first. Do it before
you flip, because flipping is what makes the fault real.

**4. Exact-base verification.** Reads bound to revision R1 must not be overlaid onto a draft copied
from R2. `beginDraftIn` copies whichever revision is current when the lazy draft opens;
`publishAndFinish` checks article identity but **not** the base revision. This is the half of Sol's
*first* review still unabsorbed, and it has been carried forward through five reviews without being
built — treat that as evidence it is easy to skip rather than evidence it is unimportant.

**5. Delete or hard-disable the importer**, in this stage and not later. Once the pipeline publishes
through `pgStoreSession`, a re-import writes `rawBytes` and friends while leaving the reference
columns untouched, and the active-job guard no longer covers a finished job. *"Data is expendable"*
does not make a revision whose metadata and referenced object describe different acquisitions
correct. `db:import` has **no non-test callers** — checked 2026-08-31 — so this breaks nothing.

**6. Then flip**, and only then.

#### The fourth fault, which item 3 above is about

**A failed forced refresh loses the work it completed, and reports success.** Sol found this on
2026-08-31; it is a fault in its own right rather than a refinement of the three at the top.

1. Published revision R1 exists.
2. A forced job writes new `fetch`, `extract` and `blocks` into a draft, then fails at `toc`.
3. The failed draft is discarded ([`src/store/pg-session.ts`](../../src/store/pg-session.ts)).
4. Retry forces only from the first *unfinished* step
   ([`src/jobs.ts`](../../src/jobs.ts) § `forceForRetry`).
5. Its new draft copies **R1**, so the earlier steps skip as current and `toc` runs over the old
   article. **The retry reports success and the refresh is silently gone.**

**Decided: re-force from the earliest *originally* forced step.** Greg's decision 8 — do the simple
thing, and move the alternative to § *Appendix: someday maybe*. It is a change to `forceForRetry`
([`src/jobs.ts`](../../src/jobs.ts)), which today forces from the first step that did not *finish*;
it must force from the first step the original request forced. `cascadeForce` takes it from there.

**What that costs, stated honestly rather than waved through.** A failed refresh re-runs from the
top, so a book's PDF transcription is paid twice. The obvious mitigation — the per-chunk checkpoints
— **does not help on a deployment**: `pdf-read.ts` writes them to `<dataDir>/pdf-chunks/` and
`dataDir` is the job-scoped `/tmp`, so a new job cannot see them. They work on a laptop and nowhere
else. That is landing D2, still unbuilt, and this decision is a reason to want it sooner rather than
an argument against the decision.

**Write the failing test first.** It is four steps of fixture and it will not be obvious afterwards
that it was ever wrong — a retry that reports success is exactly the shape that gets re-broken.

#### Done means

- A real ingest, a real single-step job (`{ steps: ["tweets"] }` on a published article) and a real
  retry, end to end against Postgres, **on a deployed instance** — the laptop cannot show this,
  because `dataRoot()` on a laptop is the repository root and every path accidentally works.
- **Faults 1–4 each red-then-green.** Fault 1 has a test already
  (`tests/late-step-on-a-cold-instance.test.ts`) whose docstring says exactly what it does and does
  not prove; the others need writing.
- Tests for handback, a warm instance, retry, and all-skipped — the four job-lifecycle shapes that
  behave differently once a draft exists.

### Stage 4 — delete the files

**Re-inventoried 2026-09-01 against `f5d6720`, and this stage's own description was wrong in eight
places.** What follows below is the original reasoning, which still holds; these are the corrections
to its facts. They are listed first because every one of them would have cost an agent time.

- **`src/store/fs.ts` (533 lines) is missing from the deletion list entirely**, and it is the biggest
  single item: **nine of the ten `guarded(...)` filesystem halves live there** (`fsArticleReader`,
  `fsChatStore`, `fsSearchStore`, `fsRefereeCriteriaStore`, `fsGlossaryLookupStore`,
  `fsCommentStore`, `fsShelfStore`, `fsLibrarySearch`, `fsReaderStore`); only `fsSourceStore` is in
  `artifacts-fs.ts`. Two further `fs*` uses in `src/store/index.ts` are **not** `guarded()` pairs and
  so would be missed by a sweep for that word: `fsGlossaryStore` in the `deleteGlossary` ternary, and
  `fsAssertWritableGlossary`, which exists specifically to 403 the committed `example/` article —
  **deleting `example/` and that function is one decision, not two.**
- **`REVISION_CARRY_POLICY` is in [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts):182,
  not `src/store/pg.ts`.** `pg.ts` holds a *different* exhaustive per-column map,
  `REVISION_READ_POLICY`. Both are keyed on every column, so a column change touches both.
  `tests/store-revision-policy.test.ts` asserts every declared column is classified, which is the
  guard that makes "drop the column and forget the policy entry" impossible — good news, and the
  reason to do the two together rather than carefully.
- **`readArticleFromDir` is 13 call sites, 8 of them production** — `tweets`, `ideas`, `arc`,
  `quotes`, `glossary`, `timeline`, `quiz`, `sketch` — not the tidy single seam this section implies.
  Two more hide inside spawned-subprocess source strings (`tests/parse-json`, `tests/stop-details`)
  where a grep for the import does not find them. It is still worth deleting; it is not a morning.
- **`dataRoot()` has only two direct production importers** (`artifacts-fs.ts:41`,
  `find-article.ts:56`), which is better than feared. But **`StepContext.htmlFile` is not
  checkpoint-only** — stage 3 reads and writes ids into it and `src/api.ts:974` uses it — so the
  claim above that "several stages still take a `dir` for checkpoints alone" is true of `dir` and
  false of `htmlFile`.
- **"28 of 400" is wrong and should never have been written down.** Recounted: the denominator is
  **431** test files, and the numerator is **75** by the same method that produced the original 76
  (non-comment lines naming `example/`, `data/` or `output/`). No method reproduces 28. The 76 was
  right all along; the 28 was a mismeasurement that made this stage look four times smaller than it
  is. Roughly **49** test files compute their own `ROOT/data` and so would not follow a
  `SPIDERYARN_DATA_ROOT` change.
- **The enumerator list above is half wrong.** Of the seven named, only `store-artefact-manifest`,
  `store-parity` and `store-roundtrip` enumerate the *corpus*. `store-guarded`, `ai-call` and
  `auth-users-fence` walk `src/`, and `glossary-lookups` readdirs one scratch slug it just made — a
  shrinking corpus does nothing to any of them. Missed enumerators that do matter:
  `store-export-raw`, `store-block-roles-pg`, `helpers-load-article`, `helpers-seed-reader-state`,
  `chat-anchor`, `owner-isolation`, and eight over `data/_jobs`.
- **Two of the four "names specific slugs" files are wrong.** `stage2c-raw-bytes` uses tmpdirs and
  `example.test` URLs; `timeline-time:19` explicitly says it *avoids* reading the corpus because
  `data/` is gitignored. The real list is 28 files, headed by `artefact-copy`, `block-roles`,
  `chat-tools`, `quotes`, `router`, `slug`, `store-parity` and `timeline-resolve`.
- **The deploy-gate trap is already fixed and is no longer part of this stage.** `scripts/deploy.ts`
  no longer copies the laptop's `data/`+`output/`; it copies from the tracked fixture corpus inside
  the gate worktree (`GATE_FIXTURE_ROOT`), and `deploy-checks.ts`'s 13 sentinels all live under
  `tests/fixtures/data-root/`. Commit `30e2b1b`, *"The gate asked which laptop, not which commit"*.
  What remains here is that the sentinel list needs rewriting **again** when the filesystem store
  goes.

**And the largest change: half of this stage's test work has already been done by somebody else.**
[260901b-committed-fixture-corpus.md](260901b-committed-fixture-corpus.md) is **built and landed** —
a committed corpus at `tests/fixtures/data-root/` (57 files, 1.14 MB, five slugs),
`tests/helpers/require-fixture.ts` which fails closed at each consumption boundary, and
`tests/fixture-corpus.test.ts`, which is exactly the *"declared inventory that a test asserts"* this
section asked for. It **deliberately defers the ~76-file sweep to this stage**, on Greg's call, so
that the same files are not moved twice. Three things it hands over:

1. **A file collision to coordinate**: `scripts/deploy-checks.ts` §§ around 574–614 has to be
   rewritten to match whatever lands, and this stage plans to touch the same file. Whoever goes
   second must know.
2. **Its Sol review already settled a question this section was going to ask.** A test-side article
   loader **must not wrap `readArticleFromDir`**, because that function is on this deletion list —
   the same conclusion this section reached independently, now confirmed and accepted there.
   `fixtureArticle()` was deliberately not built.
3. **Known-open, inherited**: `store-artefact-manifest` still fails against the corpus (`raw.pdf` and
   `labels-progress.json` read as unhomed); `doc-links` is green only because `data/reader.json`
   happens to exist on this laptop; and the gate symlinks `.env.local`, so a gate run writes
   corpus-derived reader state into the laptop's local Postgres.


Deletion, and it is the largest stage by file count and the least dangerous by consequence: every
mistake here is a compile error rather than a wrong artefact.

**What comes out**, and the list is longer than it looks because the filesystem is load-bearing in
places nobody thinks of as storage:

- The filesystem runtime adapters — `artifacts-fs.ts`, `jobs-fs.ts`, `checkpoints-fs.ts`,
  `ai-calls-fs.ts`, `uploads-fs.ts`, `blobs-fs.ts` and the `fs*` halves of every `guarded(...)` pair
  in [`src/store/index.ts`](../../src/store/index.ts). Each one goes with its branch, not before it.
- **`revisionLifecycle`** ([`src/store/revisions.ts`](../../src/store/revisions.ts)) — a dead seam no
  production module imports; the only reference is a guard test.
- **`readArticleFromDir`** in [`src/article-input.ts`](../../src/article-input.ts), and with it the
  last filesystem read in the article half of the pipeline. This is the payoff for having put it in
  one place: a function to delete rather than seven `readFile`s to hunt.
- **`dataRoot()`** and [`src/store/data-root.ts`](../../src/store/data-root.ts) entirely, once
  nothing resolves a path. Check `contextPaths` and `StepContext.dir`/`htmlFile` with it — several
  stages still take a `dir` for checkpoints alone, and those are the D2 landing rather than this one.
- `RawManifest.file`, which is now a restatement of `kind`. `SHAPE.raw`
  ([`src/store/artifacts.ts`](../../src/store/artifacts.ts)) validates it, so it should come to
  validate the live reference fields instead — Sol, 2026-08-31, *"not a stage-2c blocker"*.

**What has to move rather than go:**

- **Local dev and the fixtures.** `example/` and `data/` are what every test and every laptop reads.
  76 of 320 test files referenced `example/`, `data/` or `output/` when last counted — an upper
  bound, grepped by path. **28 of 400 as of 2026-08-31.** Expect this to be most of the work.

  **This is being designed by [260828r-worktrees.md](260828r-worktrees.md) rather than here**, and on
  Greg's decision the ~76-file sweep is deferred until this stage gives it a durable target. Four
  things came out of that work that change what this stage must do, and three of them correct this
  document:

  - **`SPIDERYARN_DATA_ROOT` does not redirect a test that computes its own root.**
    `store-roundtrip:48`, `artefact-copy:55` and `store-parity:109` each do
    `path.resolve(import.meta.dirname, "..")`. So they follow no store-side change this stage makes,
    and two of them are enumerators — **this stage could move the seam, watch the suite stay green,
    and conclude the corpus had followed it.** It would not have.
  - **Several suites enumerate the corpus rather than naming slugs** — `store-artefact-manifest`,
    `jobs`, `parse-json`, `store-guarded`, `glossary-lookups`, `ai-call`, `auth-users-fence` all
    `readdir`. A corpus that shrinks makes them quieter, not redder, and an empty one passes
    everything. Whatever replaces `data/` needs a **declared inventory that a test asserts**.
  - **A test-side article loader must take a fixture-shaped contract, not wrap `readArticleFromDir`** —
    that function is on this stage's own deletion list below, and wrapping it would cancel the payoff
    the list is claiming ("a function to delete rather than seven `readFile`s to hunt").
  - **`example/` is already committed** — 6 tracked files, 76 KB, a complete small article. That is
    the precedent for a committed fixture corpus, and it has been there the whole time.

  **And a constraint that is not technical.** `data/<slug>/chat.json`, `comments.json` and
  `searches.json` are **Greg's real reading** — his conversations and annotations, not test data;
  `noema`'s `chat.json` alone is 92 KB. A committed fixture corpus changes what is in this repository
  for ever. Fixtures that need reader state should **synthesise it rather than copy his**, and
  nothing under `data/` belongs in a review prompt sent off this machine.
- **The deploy scripts.** [`scripts/deploy.ts`](../../scripts/deploy.ts) copies `data/` and
  `output/` into the deploy-test worktree, and `deploy-checks.ts` gates on sentinel files beneath
  them. Both need rewriting off that layout, and there is a known trap:
  [the deploy test gate cannot pass](../project/deployment.md) because the gate worktree has no
  gitignored `output/`, so ~12 tests fail structurally and forcing became routine. **Fixing that is
  part of this stage**, because after it there is no `output/` to be missing.

**`checkNoteFields` is a stage-4 question, and the answer is probably "delete".** `src/block-fields.ts`
was rescued out of the importer at item 5 and has no production caller; its own header says the
decision is Greg's. It is a stage-4 decision rather than a live one, and here is why: the only path
that could want it is `copyArtefacts` → `writeBlocks`, which reads a `blocks.json` off a disk — the
same "somebody else's JSON" the validator was written for. **That path is on this stage's deletion
list.** Once it is gone, blocks only ever reach the store from `src/blocks.ts` in the same process
that minted them, and a validator for untrusted block data has nothing untrusted left to validate.
So: delete it with the disk-reading path, unless stage 4 finds a caller that survives. The database
CHECKs it overlaps with (`revision_blocks_role` and friends) stay either way; what would be lost is
the two id *shapes* and `footnote ⇒ supplement`, and `tests/block-roles.test.ts` records what those
were.

**Remove every application reference to `raw_bytes`, and drop the column in the same stage** —
Greg's decision 9. It used to be two stages and two deploys; the paragraph under § *~~Stage 5~~*
explains what that bought and why it is not being bought. Two things to get right inside this one
stage: `beginDraftIn` copies `rawBytes` through `REVISION_CARRY_POLICY`, so the policy entry goes
with the column; and `pgSourceStore.readPdf`'s second query — the `source = 'pdf'` fallback for rows
written before the reference — dies here too, which is only safe because stage 2.5 refetched
everything.

**Docs in this stage:** [architecture.md](../project/architecture.md) still shows the filesystem
layout in its diagram and its stage table, and § *Storage* still describes it as the storage model.
That file is one of the seven entry points, so editing it goes one approved change at a time with
the before and after shown — [edit-important-docs.md](../reusable/edit-important-docs.md).

### ~~Stage 5~~ — folded into stage 4

**Greg's decision 9, 2026-08-31.** The heading is kept because code comments and earlier commits
point at it. The work now happens inside stage 4; what follows is why it was ever separate, which is
worth reading before anyone un-folds it.

Only after stage 4's release is known good.

**This is why it cannot be one deploy, and it is not about the corpus.** `beginDraftIn` still copies
`rawBytes` through `REVISION_CARRY_POLICY`. Drop the column first and running code fails; deploy the
code and drop together and a rollback restores code naming a column that is gone. Decision 4 does not
touch this: it protects *executable compatibility*, not data. **Sol's correction to my claim that
decision 4 collapsed the demolition.**

**Why it is folded in anyway.** The two-deploy dance buys exactly one thing: the ability to roll the
code back after the flip without stranding it on a column that is gone. With no users and expendable
data, the realistic response to a bad deploy is to roll *forward*. So one deploy, and if it goes
wrong we fix and redeploy rather than revert. **That is a risk taken deliberately, not an oversight**
— if the flip ever ships to real readers, un-fold this first.

**And the ordering is forced by the deploy script rather than by taste.**
[`scripts/deploy.ts`](../../scripts/deploy.ts) applies migrations **before** it pushes the code, so a
single `npm run deploy` carrying both would drop the column while the old code still selects it.
Another session hit exactly this on 2026-08-31 dropping `article_revisions.summary` and split it into
two runs; ours is the same shape. Greg's call, not something to run past him.

**One more asymmetry to carry into any migration here**, learned the same day: adding a name to the
`revision_step_runs_step` CHECK is free, **removing one is not**, because Postgres validates a
re-added CHECK against the rows already in the table. So a DELETE of the affected rows must precede
the ADD CONSTRAINT — and it passes on a fresh local container with no history and fails on
production, which is a delayed fuse and a false negative in one.

## How to run the rest of this with subagents

Follow [engineering-manager.md](../reusable/engineering-manager.md); this is only what is specific to
*this* job. The short version of that doc: keep the plan, the stage boundaries, the briefs, reading
the diffs, deciding what the reviews were right about, and the commits. Hand the implementation to
Opus subagents and the trawling to Sonnet.

**What parallelises, and what does not.**

| | can run alongside | why |
|---|---|---|
| Stage 2.5 (refetch) | nothing — do it first | everything after it needs a corpus that works |
| Stage 3 **item 0** (slugs) | items 1 and 4 | touches `src/ingest.ts`, `src/jobs.ts` § slugs, the schema; no overlap with the store |
| Stage 3 **item 1** (prove the coordinator) | item 0 | `src/store/pg-session.ts` and a test; reads only |
| Stage 3 **items 3–6** | nothing | each one changes what the flip does, and they share `src/jobs.ts` |
| Stage 4 | nothing | it deletes the files everything else still reads |

So: **two agents at most, and only during item 0.** Everything else in stage 3 is one agent at a
time, because `src/jobs.ts` is the file the whole stage converges on and three sessions editing it
was the single largest source of trouble on 2026-08-31.

**Brief every agent with the file list *and* the exclusions.** The briefs that worked on stage 2 all
had the same four parts: the files you own, the files you must not touch and who has them, what
"done" looks like, and *which mutation to apply to prove the check you wrote can fail*. The last one
is what separated the useful reports from the confident ones.

**Two habits worth copying from stage 2**, both of which caught real defects:

- **Ask for the mutation result, not the test.** Three agents reported "watched red before green"
  with the exact failure message, and two of those discovered their check could not go red at all —
  which is the finding, and it would not have surfaced from a green suite.
- **Tell them to say what they left undone and what they think is wrong with the brief.** The
  `ideas` write, the `TocRun.inputHash` field and the pathspec problem were all caught that way, and
  two of the three were my errors rather than theirs.

**Check the tree before believing a red**, and before writing a commit message: `git diff HEAD --
<paths>`, never bare `git diff`. Several sessions share this working tree, `npm test` and
`typecheck` both read it rather than HEAD, and a full run under load reports timeouts that look
exactly like failures.

**GPT Sol at the end of every stage, on the built code, without exception.** Six reviews so far, six
NO-SHIPs, every finding accepted and three of them corrections to me rather than to the code. Scope
the diff to your own files, append the new files in full — `git diff` does not show untracked ones,
which is how a whole seam once reached a reviewer as nothing at all — and say plainly which failures
in the suite are other people's.

## Appendix: someday maybe

Ideas that were worked out far enough to be worth keeping and then deliberately not built. **Nothing
here is a to-do.** Each is here because rediscovering the reasoning would cost more than the two
paragraphs it takes to keep it.

### Salvaging a failed refresh's completed work

Deferred by Greg's decision 8; stage 3's fourth fault takes the simple road instead.

The expensive half of a forced refresh is `fetch`, `extract` and — for a PDF — the transcription. If
a refresh fails at `toc`, all of that is complete and correct in the discarded draft, and re-forcing
from the earliest originally forced step throws it away.

The alternative is to **retain the failed draft** and let the retry adopt it rather than beginning a
new one from the published revision. What that needs, and why it was not worth it today:

- **A rule for when a retained draft is finally dropped.** Nothing currently has one. A draft kept
  for ever is a second copy of every article that failed once.
- **A guarantee the retained draft is still the right base.** This is the same question as stage 3's
  exact-base verification, one level harder: the published revision may have moved since.
- **A decision about a draft whose failure was the input's fault** — a page that now 404s, a PDF that
  will not parse. Adopting that draft retries a failure rather than salvaging a success.

**The cheaper prerequisite is landing D2**, the checkpoint store's real callers. The per-chunk PDF
checkpoints already hold the expensive part; they are simply written to a job-scoped directory that
the next job cannot see. Making them durable would recover most of the value of this idea for a
fraction of the work — which is why, if this ever comes back, it should come back as D2 rather than
as draft retention.

### Removing "refresh an article" from the alpha

Considered on 2026-08-31 and deferred with decision 8; the refresh button on the shelf stays.

The shelf sends `{ slug, force: ["fetch"] }` ([`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx))
and `cascadeForce` re-runs everything after it. That one button is what makes the fourth fault
reachable, and it is most of the pressure on carrying block ids across revisions.

**What removing it would actually buy, measured rather than assumed:** the fourth fault vanishes
rather than being fixed, and `assertIdsCarried`'s cross-revision baseline stops being load-bearing.

**What it would not buy, which is why it looked bigger than it is.** Drafts and publication stay
either way: a `{ steps: ["tweets"] }` job on a published article opens a draft too, so
`beginDraftIn`, `publishAndFinish` and stage 3's exact-base verification are all still needed.

**What it would cost.** An article whose page has changed could not be updated, and a sanitiser
policy bump could not be applied to an existing article without deleting it — which takes its
comments and notes with it. That is the reason not to: the thing this whole plan protects is reader
data attached to block ids, and the cure would destroy it on a schedule.

## What is proven, and what is only plausible

Written down because six reviews of this work have each found a check that agreed with the bug, and
the difference between *tested* and *watched failing* is the only thing that has reliably told them
apart. If you extend this list, say which kind each new line is.

**Proven — a mutation was applied and the named test went red:**

- Every article-reading stage's embedded `sourceHash` equals the `inputHash` its `stamp` computes,
  in both metadata states (`tests/stage-stamp-agreement.test.ts`, seven stages, plus a negative
  control that catches all seven hashing a constant).
- Stage 3 returning the *input* HTML where the stamped HTML belongs, and a corruption placed one
  function deeper inside `splitIntoBlocks` where the replay and `blocksMatchTheirHtml` agree with
  the bug (`tests/blocks-baseline.test.ts`, `tests/acquire-extract-blocks-end-to-end.test.ts`).
- Ids carried across a re-extraction with the baseline dropped
  (`tests/acquire-extract-blocks-end-to-end.test.ts`).
- The fetch CLI's store selection diverging from the server's, and the call moved below the argv
  check (`tests/stage2c-raw-bytes.test.ts`, child process).
- An over-long object classified as corrupt rather than reaching the reader unclassified, and a
  transient store failure *not* classified as corruption.
- An upload's own slug on retry (`tests/pipeline-slug-claim-files.test.ts`).

**Proven 2026-08-31, and it closes item 1:** the direct `openPgStoreSession` → `pgStoreSession` →
`commit` path, driven with a **real stage's product** — a real queued `{ steps: ["blocks"] }` job,
really claimed, through the real `STEPS` registry and `advanceJobWith`, nothing mocked
(`tests/pg-session-real-step.test.ts`). Read back on another connection: a new revision published,
`stamped_html` stage 3's own output, `revision_blocks` carrying the ids forward, the step run `done`,
`jobs.draft_revision_id` cleared. `blocks` because it is the only real stage that costs nothing —
`fetch`/`extract` want the network, the other eight are paid calls.

**Item 1's heading overstated the gap, and that is worth correcting rather than quietly fixing.**
`tests/store-pg-session.test.ts` has driven this path through `advanceJobWith` against local Postgres
since 2026-08-30, sixteen cases, each mutation-tested. What was actually missing was a *real stage's
product*: every case there uses `fakeArc`/`fakeTweets` returning hand-built literals. § *What is
proven* worded it correctly ("never executed **in production or in a real ingest**"); the item did not.

**Not proven, and each is a place to be careful:**

- **The flip inherits a silent-success hazard, now observed rather than inferred.** With `commit`
  writing nothing at all, the job still reported `done: true`, published a revision and cleared its
  pointer. `REVISION_CARRY_POLICY` is a **denylist**, so `blocks`, `stampedHtml` and every late
  artefact carry into a draft, and `assertProduced` reads the carried copy back and cannot tell a
  written artefact from an inherited one. **After the flip, a stage whose write silently fails
  publishes last revision's work and reports success.** The proving test only catches it because it
  plants markers the real stage cannot reproduce — and neither marker is in `hashBlocks` or
  `checkTree`, so the publication gate passes anyway. **Any future test of a post-flip stage needs a
  deliberately-stale fixture or it proves nothing.**
- **The publication gate reads the `toc` run row and no other.** A mutation that never called
  `finishStep` published a revision whose `blocks` run was still `running`.
  [`pg-session.ts`](../../src/store/pg-session.ts)'s own comment predicts this; it is now observed.
- **A fresh ingest is still only covered by fakes** — `openOrBeginJobDraft` with no published
  revision to copy needs the network. So is a multi-step walk: only the terminal `done` commit has
  been driven with a real stage.
- **The direct commit path has still never executed in production**, which is a different claim from
  the one above and remains true.
- **A pair corrupted consistently in both halves**, and any change outside a block (the `<title>`,
  say), are invisible to every guard here *and* to `blocksMatchTheirHtml`. Stated rather than fixed.
- **A store that lies in `head` as well as in `get`** makes an over-long body surface as an ordinary
  error with a Retry offered. Rethrowing when `head` cannot explain the failure is the right answer
  — an unreachable store is a fault, not a corrupt document — so it is left, with a comment.
- **Nothing has been run on a deployed instance.** Every claim in this plan about deployment
  behaviour is derived from `dataRoot()` and the job scoping, not observed. On a laptop `dataRoot()`
  is the repository root, so every path accidentally works and the faults are invisible.
- **`tests/doc-links.test.ts` reads the filesystem, not git**, so an untracked doc under a tracked
  link satisfies it and the breakage appears only after somebody commits. It cannot see that class
  until it has already happened.

## Risks

- **The direct `pgStoreSession` commit path has never executed.** Stage 3 opens by proving it.
- **One production database, no staging** — but expendable data, so a bad migration costs a refetch.
  The exception is *executable* compatibility, which decision 4 does not cover: see stage 5.
- **Stage 3 is the only stage that changes what a reader sees.** Everything before it is preparation
  and everything after is removal. It is also the only stage where being wrong is expensive, because
  it is the only one that can publish a revision nobody meant.
- **The corpus is currently unusable for stage 2c's path.** About half the local articles refuse
  `extract` until stage 2.5 refetches them — loudly, by design, but it will be the first thing you
  hit and it is not a bug you introduced.
- **Several sessions share this working tree**, and three times on 2026-08-31 a change landed in two
  commits with the halves separated. Before you write a commit message, read
  `git diff HEAD -- <paths>` rather than your own plan
  ([version-control.md](../project/version-control.md) § *A pathspec cannot commit a version of the
  file that no longer exists*).
