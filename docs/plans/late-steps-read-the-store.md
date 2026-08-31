# Late steps read the store, not `ctx.dir`

**Status:** plan, unbuilt. One failing test is in the tree
(`tests/late-step-on-a-cold-instance.test.ts`) and is red for the production reason.

## What happened

Greg asked for a tweet thread on an article he was already reading:
`https://www.spideryarn.com/read/nagel-bat/tweets`. The job failed two seconds after it was
queued.

```
ENOENT: no such file or directory, open
'/tmp/spideryarn/001bb7a0-7720-4f1b-8b9d-1ee6e63d132a/spya-bpcjus/data/nagel-bat/blocks.json'
```

The Vercel runtime log for deployment `dpl_2ydtHC76pndcgjsAnucrCXgvQsdE` (commit `1ed4407`) has
the whole shape of it, and shows it is not one incident but a class. Three single-step jobs in an
eleven-minute window on 2026-08-30, all against articles that were already published, all dead the
same way:

| time | job | slug | steps | outcome |
|---|---|---|---|---|
| 18:25:43 | `spya-…` | `nagel-bat` | `["arc"]` | ENOENT on `blocks.json`, in `generateArc` |
| 18:39:09 | `spya-bpcjus` | `nagel-bat` | `["tweets"]` | ENOENT on `blocks.json`, in `generateTweets` |
| 18:47:22 | `spya-…` | `what-if-we-had-bigger-brains…` | `["arc"]` | ENOENT on `blocks.json`, in `generateArc` |

The stack is `serveAuthenticatedApi → advanceJobWith → walkClaim → runStep → Object.run →
generateTweets`. Full-pipeline ingest jobs in the same window ran fine.

**It is invisible in `get_runtime_errors`.** A failed step is caught and the request answers 200,
so Sentry's and Vercel's uncaught-error views show nothing. The only record is the runtime log.
Sentry itself was not checked — it needs a browser session and the Chrome extension is not
connected here.

## The root cause

Two halves of every late step ask two different places the same question.

`dataRoot()` on a deployed instance is `/tmp/spideryarn/<owner>/<job>/`, scoped to **one job**
deliberately, so a failed job's half-built artefacts can never be served as the next job's
([`src/store/data-root.ts`](../../src/store/data-root.ts) § *Why the deployed root is scoped by
job*). A job created as `POST /api/jobs { slug, steps: ["tweets"] }` contains exactly one step, so
`fetch`, `extract`, `blocks` and `toc` never run and never write. That directory is empty and
always will be. The article's blocks are in Postgres, where the ingest that made them published
them.

The step then does this:

```
stamp: async (ctx, store) => { const inputHash = await inputHashFor(ctx, store); … }
                                                                        ^^^^^ the store
run:   async (ctx) => generateTweets({ dir: ctx.dir, … })
                                            ^^^^^^^ a path
```

`generateTweets` opens `path.join(opts.dir, "blocks.json")` and dies. So does `generateArc`,
`generateGlossary`, `generateSummaries`, `generateIdeas` and `sketch` — every stage from 5a on
reads `opts.dir` directly. `blocks` (stage 3) is the one stage that already reads through the
store, and it is the shape the rest should take.

**Why nobody caught it locally.** `dataRoot()` on a laptop is the repository root, so
`data/<slug>/blocks.json` is a file the last ingest left lying about. Every one of these stages
works there, from the CLI and from the queue, and always will.

**The second half, which matters just as much.** Fixing the stages alone fixes nothing in
production, because the store they would read is also empty. `claimSession`
([`src/jobs.ts:1004`](../../src/jobs.ts)) builds `fsStoreSession({ artifacts: pipelineStore })`
where `pipelineStore` is `fsArtifacts` — rooted at the same job-scoped `/tmp` — and
`publishingSession` passes `reads: inner.reads` straight through. So on Vercel *every* artefact
read a job makes, including `stamp`'s, goes to the empty directory. `stamp` returns `null`
("we cannot tell"), which correctly answers not-current, and the step runs and dies. The whole
job's view of the article is the scratch directory and nothing else.

### The one-sentence version

`SPIDERYARN_STORE=postgres` swaps **every reader store** through
[`src/store/index.ts`](../../src/store/index.ts) — `loadArticle`, `loadGlossary`, `loadTweets` and
the rest — which is why `GET /api/article/nagel-bat` answered 200 in the same session that the job
died. [`src/jobs.ts:57`](../../src/jobs.ts) does this instead:

```ts
import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";
```

The pipeline's artefact reads do not participate in that selection at all. The reader path was
migrated to Postgres and the writer path was not, and a late step is the one place a *writer* has
to read what a *reader* can already see.

### The same defect, minting block ids — verified 2026-08-30

Raised by `spideryarn2-fe`, checked against the code here rather than taken on trust. **It is the
same one-line defect as the ENOENT, and its consequence is the contract this repo is built on.**

`previousBlocksFrom` ([`src/blocks.ts`](../../src/blocks.ts)) carries block ids forward. It reads
the baseline through `store.read`, and when that comes back empty it asks the second question —
`hasEarlierBlocks` — which exists exactly to tell *"first ingest"* from *"there was an identity here
and I cannot see it"*. Sol hardened it on 2026-08-28 so that even a corrupt file counts as an
earlier run, because *"the one thing this must not do is guess."*

It is now guessing, and it cannot help it: `hasEarlierBlocks` calls `readOutcome(locate(slug), …)`,
`locate` is `fsLocations`, and `fsLocations` calls `dataRoot()` — the job-scoped `/tmp`. On a
deployed instance that directory is **empty by construction**, so `readOutcome` answers `absent`
and `hasEarlierBlocks` answers a confident **false**. The guard is not wrong about the state; it is
asking the wrong disk.

The chain, verified line by line:

1. `retryJob` builds a **new** job — `enqueue({ steps: old.steps.map((s) => s.name) })`, names only,
   so every step starts `pending` ([`src/jobs.ts`](../../src/jobs.ts) § `retryJob`).
2. A new job id means a new `/tmp/spideryarn/<owner>/<job>/`, empty.
3. `stepIsDone` reads that empty scratch, so **nothing reads as done and every step re-runs** —
   including `blocks`. (The docstring's promise that Retry "skips whatever already succeeded" is
   defeated by the same empty disk, which is a second and much cheaper symptom: Retry silently
   re-fetches, re-extracts and re-pays.)
4. `previousBlocksFrom` → `read` empty → `hasEarlierBlocks` false → returns `undefined`.
5. `assertIdsCarried(slug, undefined, produced)` opens with `if (!previous?.length) return;` and
   asserts **nothing**.
6. Stage 3 mints a fresh id for every paragraph of an article that already had one.

Every comment, highlight, note and saved reading position on that article then names an id that is
in `block_identities` and in no revision. Nothing throws, and the job reports success.

**So `blocks` is in scope, not only the six late stages.** Both consequences are the same missing
line — the pipeline's reads not joining the store selection — and a fix that closed the ENOENT while
leaving stage 3 reading the filesystem would leave the far worse half live.

## What I propose

Two changes that have to land together.

### A. The job's reads see Postgres, with the scratch in front

Make `claimSession`, under `SPIDERYARN_STORE=postgres` only, build its `reads` as a two-layer
chain: **the filesystem scratch first, Postgres behind it.** A read that the scratch answers is
answered from the scratch; a read it has nothing for falls through to
`readsPgArtifacts(ref, db)`, which already exists
([`src/store/artifacts-pg.ts:1356`](../../src/store/artifacts-pg.ts)) and already implements the
whole `ArtifactReads` interface.

Why layered rather than simply Postgres:

- **A job that runs several steps in one claim must read what it just wrote.** A
  `blocks → toc → tweets` job has `toc`'s output on disk and not in Postgres — the copy into a
  draft happens once, at publication. Making the reads purely Postgres would break the path that
  currently works.
- **It changes nothing about the working path.** With the scratch answering first, a full ingest
  behaves byte-for-byte as it does today. Only the miss case is new.
- **The staleness objection does not apply here, and it is worth saying why.** Layering usually
  risks a stale near-layer shadowing a fresh far one. It cannot here: the scratch is scoped to one
  job, so the only files in it are ones *this job* wrote in *this claim*. That argument depends
  entirely on the job-scoping, which is why it is written down rather than assumed.

The open question is **which Postgres ref the far layer binds to**, and I do not think the answer
is obvious:

- **A1, the job's own draft** (`openOrBeginJobDraft`). Correct — carry-forward means the draft
  already holds the published revision's blocks, tree and step runs. But drafts are opened
  *lazily, at publication*, precisely so a job that fails never mints one
  ([`src/store/publish-session.ts`](../../src/store/publish-session.ts)); opening one at claim
  time reverses that decision and leaves `sweepAbandonedDrafts` a draft per failed job.
- **A2, the current published revision.** No draft is minted and no decision is reversed, but it
  needs a ref built from `articles.current_revision_id` rather than from a job, and I have not
  worked out what `readBaseline` and `hasEarlierBlocks` should mean against it.

I lean A2 and want this reviewed.

### B. The late stages take their inputs from the store

`generateArc`, `generateTweets`, `generateGlossary`, `generateSummaries`, `generateIdeas` and
`sketch` stop opening `blocks.json`, `tree.json` and `meta.json` off `opts.dir` and take the
blocks, the tree and the meta as arguments, read by the step's `run` through the `ArtifactReads`
it is already handed. This is the seam the interface already has and `blocks` already uses; it is
not new machinery.

**They keep writing to `ctx.dir` for now.** Converting the write half is D3–D5 of
[delete-the-importer.md](delete-the-importer.md) and is not this. Keeping the writes where they
are also keeps the guard in `publishAndFinish` — *refuse a copy that moved nothing* — honest,
because the scratch still holds only what this job produced.

**Their CLIs keep working.** Each `main()` reads the three files off the directory it was given
and passes them in, so `npm run tweets -- data/writes` is unchanged. That is the same split
`generateGlossary`'s `previous` already has.

### What I rejected

**Hydrating the scratch** — copying the published revision's artefacts into `ctx.dir` before the
job runs, which `copyArtefacts` would do in reverse for about four lines. It is the smallest
change and it is wrong twice. It is a second door into storage that the store exists to be the
only one of. And it *defeats the guard that matters most*: `publishAndFinish` refuses to publish a
copy that moved nothing, because a copy that moved nothing means the scratch was empty or on
another instance and publishing would republish the old article while reporting the job done. Seed
the scratch and that guard can never fire again.

## The failing test

`tests/late-step-on-a-cold-instance.test.ts`, in the tree now and red. It gives the store a real
article (a copy of `example/`) and the step context an empty directory — the deployed shape — and
asks `STEPS.tweets.run` and `STEPS.arc.run` to run. The model is stubbed, so the real stages run
end to end and nothing reaches the network. A first assertion checks the store really does hold
the blocks, so that the other two are testing *unreachable* rather than *absent*.

```
× tweets runs from the store rather than the job's empty directory
  Caused by: ENOENT … /spya-scratch-Uls3CU/data/nagel-bat/blocks.json
    ❯ generateTweets src/tweets.ts:395:5
× arc runs from the store rather than the job's empty directory
  Caused by: ENOENT … /spya-scratch-Uls3CU/data/nagel-bat/blocks.json
    ❯ generateArc src/arc.ts:355:5
```

It covers B. It does **not** cover A, and a test that does needs a database — the parity suites'
shape.

## What I want reviewed

1. **A1 or A2**, and whether A2's `readBaseline`/`hasEarlierBlocks` semantics against a published
   revision are coherent. If neither is right, what is.
2. **Whether the layered read is a trap I have talked myself out of.** The staleness argument
   rests entirely on `/tmp` being job-scoped. Is there a path — a retry, a resumed claim, a warm
   instance serving a second advance of the same job — where the scratch holds something the
   Postgres layer has a better version of?
3. **`glossary`'s append.** It reads its previous artefact through `previousGlossaryFrom(store, …)`
   already, so under A it would start finding the published glossary where today it finds nothing.
   That is the correct behaviour and it is also a behaviour change on the deployed path: "find more
   terms" would begin appending where it has been silently replacing. Worth confirming that is
   what we want, and that `passes` and the entry ids come out right.
4. **Whether B should convert all six stages at once** or start with `tweets` and `arc`, the two
   with production failures against them.
5. **What else is reading a path where it should be reading the store.** `articleExists` and
   `urlForSlug` were fixed for exactly this class on 2026-08-30
   ([delete-the-importer.md](delete-the-importer.md)); this is the same bug arriving through a
   different door, which suggests there are more doors.
