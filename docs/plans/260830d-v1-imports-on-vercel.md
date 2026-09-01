# A v1 where pasting a URL on spideryarn.com gives you an article

**Status: SHIPPED 2026-08-30. An article pasted on spideryarn.com is readable on spideryarn.com.**
See [§ What actually happened](#what-actually-happened-2026-08-30). Written 2026-08-29, re-cut after GPT Sol's second review
([260830a-v1-imports-review-sol.md](260830a-v1-imports-review-sol.md)) returned NO-SHIP on the first cut.**
Stages 0 and 1 are committed (`f3db91e`, `0fdd2fe`). Stages 3 and 4 moved to the D1b owner; stage 5
is cut. Supersedes
[260829l-durable-artefacts-on-vercel.md](260829l-durable-artefacts-on-vercel.md), which measured the problem
correctly and then proposed the wrong fix — GPT Sol returned NO-SHIP on it and was right.

> Look for simplicity, and getting to a v1 now, while being aware of the long-term-best eventual
> state and choosing stepping stones towards that.
>
> — Greg, 2026-08-29

## What is broken, measured

Every import on production fails. 9 of 9 historical, plus a fresh job queued today
(`spya-nygy0h`, slug `greatwork`) which failed in **16ms** at step 1:

```
ENOENT: no such file or directory, mkdir '/var/data'
```

Three causes, each confirmed against the code:

1. **A path that bundling invalidates.** `artifacts-fs.ts:55` and `import.ts:90` both derive a root
   from `import.meta.dirname`. Correct for files at `src/store/`; wrong once bundled into
   `api-dist/vercel.js`, where two levels up is `/var`. Vercel's filesystem is read-only except an
   ephemeral, per-invocation `/tmp`.
2. **Artefacts crossing invocations.** `useJobs.ts:91` — *"The browser is what moves a job along.
   `POST /api/jobs/:id/advance` runs one [step]"*. Six steps, six invocations, six disks.
3. **A finished job publishes nothing.** `publishRevision` is called only from
   `revisions.ts:226`, the fixture loader and tests — never from `jobs.ts` or `pipeline.ts`.
   Publication today is a human running `npm run db:import`.

## The decision

**Run the whole job in one invocation on an injected writable root, and publish by calling the
existing `importArticle` as a real pipeline step.** Decided with Fable, 2026-08-29.

Why not the alternatives:

- **Finish the D-series** ([260827aa-delete-the-importer.md](260827aa-delete-the-importer.md)) is the long-term-best
  end state and is 2–3 weeks, gated on D1b which is unstarted and the largest piece. Greg asked for
  a v1 now.
- **Convert only the six default steps** is the same answer on the axis that matters: still gated on
  D1b.
- **A blob-backed `ArtifactStore`** was NO-SHIPped. All ten steps still write their own files inside
  `run()` (`LEGACY_UNCONVERTED_STEPS`, `pipeline.ts:344`), so no adapter can intercept them until
  D3–D5 convert them. This plan does not fight that — it gives those files a disk that works.

The pieces already exist and are already tested: the filesystem pipeline (unchanged),
`importArticle` (one transaction, publishes, converges on re-run), and `exportArticle` — the
importer's inverse, which writes a full `data/<slug>/` back out of Postgres.
`tests/store-roundtrip.test.ts` holds the pair together.

### Two things a naive version of this gets wrong

**Slug identity must stop asking the filesystem, or this corrupts data.** `articleExists`
(`pipeline.ts:757`), `urlForSlug` (`pipeline.ts:780`) and `freeSlug`'s claim check all answer from
`data/<slug>/meta.json`. On Vercel that disk is empty, so `freeSlug` hands out a slug that already
names a published article. If it belongs to another owner, `importArticle` refuses **at the end** —
model money spent, then a wall. If it is the **same owner's** different article, the owner check
passes and the import replaces that article and deletes-and-reinserts its reader state
(`articleId = derivedUuid("article", slug)`, `import.ts:523`). Every write reports success.

**Re-publishing without hydrating deletes reader state.** `importArticle` reads comments, chat and
searches through loaders and treats *the files win* as its contract. Re-importing an article whose
`/tmp` has no `comments.json` deletes the reader's real comments and reinserts nothing. So v1
was going to publish **first ingests only**. **That guard was never written, and this document
claimed it existed** — see [§ The guard that was never written](#the-guard-that-was-never-written).

## Stages, and who holds each

Re-cut after Sol's second review and agreed with the D1b owner (spideryarn2-84) on 2026-08-30.

| # | What | Holder | State |
|---|---|---|---|
| 0 | lease, `maxDuration`, Fluid | this session | **done**, `f3db91e` |
| 1 | job-scoped scratch root | this session | **done**, `0fdd2fe` |
| 2a | slug checks ask Postgres | this session | **done**, `55e532a` |
| 2b | global slug reservation (`freeSlug`) | unclaimed | **not built** — two owners can still race one free slug |
| 3 | one claim walks the whole job | spideryarn2-84 | **done**, `ceec42f` |
| 4 | transactional job finalizer | spideryarn2-84 | **built** as `publish-session.ts`; `pg-session.ts` is the D1b end state and cannot run yet |
| 5 | hydration | — | **cut**, see below |
| — | the end-to-end test | this session | **not written** — v1 was verified by hand on production |

**Stage 0 — the time budget. Done.** `LEASE_MS` 420s, self-abort 400s, `maxDuration` 300 → 800.
The two must move together: raising the lease alone puts the self-abort past the platform's kill so
it never fires, trading a clean interrupted ending for a mid-step kill with a live lease.
[`tests/jobs-lease-budget.test.ts`](../../tests/jobs-lease-budget.test.ts) pins the relationship
rather than the numbers. Fluid Compute is confirmed on for the project
(`resourceConfig.fluid = true`), which `maxDuration: 800` requires — **but this is not finished
until the limit is read off a live deployment**, because a declared 800 silently clamped to 300
fails exactly like today and both states print a green deploy.

**Stage 1 — one job-scoped scratch root.** `dataRoot()`, resolved at call time, `SPIDERYARN_DATA_ROOT`
overriding, the repository root locally and `/tmp/spideryarn/<ownerId>/<jobId>/` when deployed. Two
call sites: `artifacts-fs.ts:55` and `import.ts:90`. Deployed **with no job scope it throws** rather
than guessing, because a deployed read with no job is a real bug and must be loud.

*Job-scoped rather than owner-scoped, which is Sol's Critical 4 and the nastiest finding in the
review:* job A builds artefacts for URL A and then fails; nothing was published so the slug still
reads free; job B for a **different URL** is handed that slug, finds A's valid files warm in `/tmp`,
skips those steps, and **publishes A's content under B's request**. A retry gets a new job id and
repurchases the work, which is the correct trade.

**Nothing a reader can see improves until stage 3.** Worth stating because the commit log implies
otherwise: stages 1 and 2 make production *more* obviously broken, not less. Stage 1 removes the
accidental cross-job warm cache that was the only thing that could rescue a job whose steps land on
different instances. The import begins working when the coordinator change lands, and not before.

**Stage 2 — global slug reservation.** Not merely an owned-article lookup. Article slugs are
globally unique (`schema.ts:129`) while active jobs reserve only `(ownerId, slug)`
(`schema.ts:1175`), so two owners can queue the same free slug and one pays for the whole pipeline
before publication refuses it. Use the existing global check
([`slug-is-taken.ts:45`](../../src/store/slug-is-taken.ts)) for existing rows plus a global
reservation for active ingests — without exposing another owner's URL while resolving the collision.

**Stage 3 — claim once and walk the job.** `advanceJobToCompletion` **inside the coordinator**, not
a loop at the route. Sol's Critical 3: every `advanceJob` claims, runs one step and releases, and no
route loop can close the gap between release and re-claim — two tabs on two instances alternate,
each restarting from its own partial scratch. **This is load-bearing rather than a refinement:**
without it each request may land on a different instance and step 2 finds nothing from step 1, so
the job cannot finish at all. Stage 1 makes this *stricter*, not looser, because it removes the
accidental cross-job warm cache that is currently the only thing that could rescue a multi-instance
job.

**Stage 4 is built, 2026-08-30, and it is a decorator rather than a new session.**
`src/store/publish-session.ts` wraps the filesystem session:
on a `done` ending it copies what the stages wrote into a fresh draft with
[`copyArtefacts`](../../src/store/copy-artefacts.ts) — promoted out of `tests/helpers/` because it is
production code now — publishes it, and finishes the job, all in one transaction.

`pg-session.ts` could not be it. That file asks `checkProduct` with an **empty** unconverted set, so
it refuses by name any step returning no `parts`, and all ten steps are still on
`LEGACY_UNCONVERTED_STEPS` writing their own files inside `run`. It is correct and it becomes the
publish path when D3–D5 land. So this is the vertical slice Sol asked for and not the artefact
conversion.

Three things it does that are not obvious, each with a test:

- **The wrapper, rather than a call in `walkClaim`.** A `done` ending reaches the store through
  `commit` *and* through `settleJob` — the last step ran, or every step skipped — and only one of
  those is visible from the coordinator. Worse, on the first the job row would already say `done`
  before a coordinator-level finalizer could run, which is the crash gap Critical 2 is about.
- **A copy that moved nothing is refused**, because a draft carries the published revision forward
  and publishing an empty one republishes the old article and reports success.
- **Gated on `STORE === "postgres"`.** With the filesystem store the session is byte-for-byte what it
  was, which is what every laptop runs.

**GPT Sol reviewed the built code and returned NO-SHIP; both findings are fixed**
([260830ad-v1-publish-finalizer-review-sol.md](260830ad-v1-publish-finalizer-review-sol.md), 2026-08-30). Neither was
about the design, and both are worth remembering:

- **A publication failure logged article content.** The compensating `failRevision` interpolated the
  caught error's message into its `reason`, and that message is very often a raw driver error
  carrying the failed statement's **bound parameters** — for `finishIn`, the whole `steps` array and
  the job's title, which is the article's. `guardDbStore` scrubs on the way *out*, which is after the
  logging. The reason is a fixed sentence now, and a cleanup failure logs the error's class rather
  than its message.
- **The all-skipped door left a failed job `running`.** `commit` has `runStep` to catch what it
  throws; `settleJob` has nothing — `walkClaim` re-raises anything that is not a `StaleAttemptError`,
  so the job kept its attempt and the **global** running slot until the 760s lease lapsed, telling
  every Retry `busy`. It now ends the job as `error` through the inner session before letting the
  failure go.

Sol also confirmed the two things worth confirming: there is no third door a `done` ending reaches
the store by, and a repeat publication does not delete reader state — it moves a pointer and carries
the previous revision's artefacts forward, where `importArticle` deleted wholesale.

**Stage 4 — a transactional finalizer, and not a pipeline step.** Sol's Critical 1: `checkProduct`
refuses `produces: []` by name — a step declaring no artefacts can never be done, because
`has([], …)` answers false, so it would re-run for ever. A `publish` step would therefore publish the
article successfully and *then* fail the job. And a "publish receipt" file is not a way round it: a
warm receipt could skip publication when Postgres does not contain it, which is the previous plan's
quiet success again. Publication and the fenced terminal settlement must be **one transaction**, or
a kill between them leaves the article published, the job failed, and Retry blocked by the
first-ingest guard.

## Known v1 limitations, found while building rather than guessed

**An upload retried on Vercel gets a new slug and pays again.** `slugIsSpokenFor` tells "this slug is
my own upload resuming" from "this slug is an article that already exists" by reading
`RawManifest.origin` / `uploadId` out of `raw.json` — and `readRaw` ([`src/fetch.ts:235`](../../src/fetch.ts))
is filesystem-only, with no Postgres version. Per
[`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts)'s own comment, `uploadId` is *"not
durably recoverable at all, because publication clears `jobs.draft_revision_id` and a job can be
deleted, so the revision keeps no link back."*

So under the Postgres store the retry-resume property **does not exist**. Stage 2a did not create
that hole; it made it the branch that gets taken. Before, `articleExists` short-circuited past it and
clobbered the existing article instead. **Trading silent data loss for a duplicate slug is the right
way round**, and the cost is stated here rather than discovered: a retried upload becomes `paper-2`
and re-pays for its transcription.

**A slug that collides with a *stranger's* article still costs a whole pipeline.** Owner-scoped
checks cannot see it, so the job runs, is paid for, and is refused at publication. Wasteful rather
than destructive, and it is the same gap `urlForSlug` leaves — both close together in the `freeSlug`
stage, which needs a return shape that can say *"taken, but not yours"* without disclosing what.

## Stage 5 is cut

Hydrating `data/<slug>/` from Postgres via `exportArticle` is unsafe, and two independent audits
agree. **That direction has no test at all** — `tests/store-roundtrip.test.ts` exercises
`data/` → Postgres → `data/` through a different function.

The worst of it: `exportArticle` writes artefacts first and reader-state files last, so any throw in
between leaves a directory `importArticle` happily accepts — it requires only `blocks.json` and
`tree.json` — which then runs five unconditional deletes and reinserts nothing. Every comment,
conversation, saved search, archive flag and reader-chosen title, gone, with both halves reporting
success and nothing on disk marking the directory partial. The inverse too: export never deletes, so
a stale `comments.json` resurrects deleted comments. Export is also not one snapshot — many queries,
no wrapping transaction — so a comment written during hydration is missed and then deleted.

> the data we CURRENTLY have in the database is unimportant and can be thrown away once. But as soon
> as we move the app from Alpha to Beta status (hopefully soon), we'll need to take great care of our
> data going forwards ever after.
>
> — Greg, 2026-08-30

So the **first-ingest guard is permanent**, not a v1 shortcut: it protects readers who have not
arrived yet. Re-ingest and refresh stay as broken as they are today until D1b removes the need.

## Decisions Greg made on 2026-08-30

- **Durability lands straight after v1, not in it.** v1 runs the whole job in one invocation on
  ephemeral scratch. The reason it is safe to defer: only `toc` and a little `pdf` cost money on the
  default path, and `arc` left `DEFAULT_INGEST_STEPS` on 2026-08-29 — so a re-run is nearly free,
  and "resume where it left off" and "do it again" differ by seconds rather than pounds.

  **`assets` did *not* leave the default, and an earlier draft of this document said it had.**
  Corrected on 2026-08-30 by spideryarn2-d7, and it matters more than a stale sentence. `assets`
  allows 200 images, 2 concurrent, 2 attempts, 15s each, so its worst case approaches **3,000s — on
  the default path, for every article**. That makes it the binding constraint on the whole ingest,
  ahead of `toc`'s 324s, and it needs a wall-clock budget before v1 can work at all.

  It also **cannot be fixed by taking it out of the default**, and the reason is a privacy property
  rather than a preference — the step's own comment: *"an article whose images are still hot-linked
  to the publisher announces the reader's IP to that publisher on every single read. That is the
  privacy leak this step exists to close, so closing it cannot be something somebody has to ask
  for."* So a budget trades privacy against completion on heavy articles, and that trade is Greg's
  to make rather than ours.
- **Publish once everything has run**, not as soon as the article is readable — getting to a working
  v1 beats latency, and latency comes after.
- **Where large artefacts belong**, when durability does land: structured JSON in Postgres, opaque
  bytes (raw HTML/PDF, images) in Supabase Storage. That split already exists and is right; do not
  add a third mechanism.

## The ceiling, and why Stage 0 is first

Measured from `data/_ai-calls.jsonl`. `durationMs` is **per model call**, and `toc` makes several
per article. Grouped into per-article step totals:

| slug | step | calls | total |
|---|---|---|---|
| (unattributed) | `toc` | 3 | **324.0s** |
| (unattributed) | `summarise` | 10 | 240.3s |
| `what-if-we-had-bigger-brains…` | `toc` | 1 | 163.1s |
| `what-if-we-had-bigger-brains…` | `labels` | 3 | 65.2s |
| `what-if-we-had-bigger-brains…` | `arc` | 1 | 10.4s |

`LEASE_MS = 4 * 60_000` with `DEADLINE_MARGIN_MS = 20_000` (`jobs.ts:131-132`), so **every step
self-aborts at 220s** — today, on a laptop too, for anything driven through the job path. A 324s
`toc` therefore **cannot complete through a job at all right now**; it only ever succeeded via the
CLI, which takes no lease. That is a live bug this plan inherits rather than causes, and it is why
the config bump leads rather than trails.

The account is **Vercel Pro** (`billing.plan = "pro"`, via the API), so `maxDuration` can rise from
300 toward 800. Worst-case default ingest — `fetch`, `extract`, `blocks`, `toc`, `assets`, `arc`,
of which only `toc` and `arc` call a model:

```
fetch ~10s + extract ~5s + blocks ~5s + toc 320.4s + assets ≤300s  ≈  640s worst, 490s realistic
```

**Corrected 2026-08-30, twice, and the second correction breaks something.** This line first read
`… + arc 31s ≈ 405s`, charging a step that had left `DEFAULT_INGEST_STEPS` the same day (`f42a877`),
and using a `toc` figure of 324s that was three unrelated runs summed. The real numbers are worse in
the direction that matters: `toc` is 320.4s **measured in a single call**, and `assets` can now spend
up to its 300s budget, so a worst-case job is ~640s and a realistic worst is ~490s.

That still fits the 800s invocation. **It does not fit a 400s claim**, which is what Stage 3's
claim-once coordinator gives it — the self-abort bounds the whole claim, not each step, so on today's
constants a job that would comfortably finish gets killed four fifths of the way through `toc`. Stage
0's 400s was sized for the current one-step-per-request shape, where every step gets a fresh 400s; it
is a per-step constraint carried into a per-claim world. Raised with the D1b owner before Stage 3 is
cut; the likely answer is `LEASE_MS` 760s with a 740s self-abort, still 60s under the platform kill. `LEASE_MS` rises to cover the longest single step.

## Risks, and the verdicts

- **Repeat model spend on retry.** A retry in a cold invocation re-runs everything. Accepted for v1
  and stated rather than discovered. On a warm instance `stepIsDone` resumes real artefacts for
  free, and it derives doneness rather than remembering it — `store.interrupted` first, `has()`
  parses rather than stats, late stages compare stamps. Both branches are correct by construction.
- **Stop gets slower.** The cancel POST lands on a different invocation whose `aborts` map has no
  controller (`jobs.ts:115`), so cancellation is read at the next step boundary rather than
  aborting mid-step. A reader stopping mid-`toc` waits for `toc`. Acceptable; said out loud.
- **A longer lease means a dead job is unreclaimable for longer** — `failExpired` (`jobs.ts:807`) is
  what reclaims it.
- **Warm `/tmp` from another owner** — closed by the owner-scoped root.
- **Warm `/tmp` older than the published revision** — cannot occur before Stage 5 (first ingests
  only), and is closed by unconditional hydration at Stage 5.

## Stepping stone or detour — the ledger

**Survives into the end state:** the store-backed slug checks (required once the files are gone);
the injected root (the fs adapters stay for laptops and tests); the **contract and its end-to-end
tests** — *a job that ends `done` has published a revision a reader can open, and readers see the
old or the new, never a mixture* — which is verbatim D1b's spec, so these become D-series acceptance
tests; and the **position** of publish inside the job machinery, since D1b replaces the step's body
with `publishRevision` inside the last step's transaction, at the same seam.

**Thrown away:** the route loop (~15 lines), the hydration call, and the publish step's
`importArticle` body — which was already scheduled for deletion. This extends the importer's life by
the weeks D1b takes.

The discarded part is glue. Everything expensive persists. That is the difference from the blob
adapter, where the discard would have been the machinery itself.

## Checked against two other workstreams, 2026-08-30

Neither collides, and both were checked rather than assumed.

**Image hosting** ([260829b-hosting-the-articles-images.md](260829b-hosting-the-articles-images.md)) is further along
than its own header says — that reads "plan, not built" while five of its eight stages are committed.
Its `assets` step was already in `DEFAULT_INGEST_STEPS` before this plan started, and is what
`ASSETS_BUDGET_MS` now bounds. The new `"out-of-time"` reason is a fourth member of an existing union
and needs nothing from them. Its remaining stages read images from Postgres and the Supabase bucket,
never through `fsLocations`, so Stage 1's job-scoped root does not reach them.

What the budget *does* cost them is a line in their own argument: on an article with enough images
the step can finish with some still hot-linked, so *"closing this cannot be something somebody has to
ask for"* is only partly true on heavy articles. That is a new limitation their plan predates, and it
is noted in their doc rather than left implicit here.

**Deferring the ToC** ([260830a-opening-an-article-before-the-toc.md](../research/260830a-opening-an-article-before-the-toc.md))
is research with nothing built, so there is no code to collide with. The conflict is a roadmap one
and worth writing down before either side builds: **this plan publishes once the whole job has run;
that research's entire premise is publishing something readable before it has, and upgrading in
place.** A provisional early publish is a *second* publish point, and Stage 4's finalizer exists
precisely to close the "publish succeeds, then the job fails" hole by making publication and terminal
settlement one transaction. Whoever turns that research into a plan should read Stage 4 first rather
than rediscover the collision after building the provisional-tree machinery.

**Deferring `arc`** ([260829f-defer-arc-and-rename-hierarchy.md](260829f-defer-arc-and-rename-hierarchy.md)) is built
and closed — `0aa30ac`, `837df17`, `f42a877`. Nothing outstanding.

## What actually happened, 2026-08-30

**It works.** `https://paulgraham.com/todo.html` pasted at spideryarn.com: fetched, extracted, split
into 10 blocks with fresh ids, ToC'd, published, and opened in the reading view with its summary
spine written. Verified through the API rather than from the screen — on the shelf, 10 blocks in both
the shelf row and the article payload, first block `spya-x9383n`, tree present. This morning the same
paste failed in 16 milliseconds, and 9 of 9 before it.

Production is `a63a5592`. Migrations `0030` and `0031` applied; `0029` was already there.

| | |
|---|---|
| `f3db91e` | lease and `maxDuration` — a step over 220s could not finish through a job on **any** machine |
| `0fdd2fe` | one writable root, scoped to a job |
| `55e532a` | slug checks ask Postgres, closing a silent data-loss path |
| `61109a3` `d8464b2` `3e8c42d` | the `assets` wall clock, measured |
| `38ea362` `2056066` | 760s lease; the disconnect behaviour pinned |
| `ceec42f` `a63a559` | **one claim walks the whole job, and a finished job publishes** — spideryarn2-84 |

### The bug it found within a minute

Opening the article starts an `arc` job, and that job fails:

```
ENOENT: /tmp/spideryarn/<owner>/spya-abehu7/data/todo/blocks.json
```

The job-scoped scratch working exactly as designed, biting the case § Stage 5 is cut predicted:
a late-stage job (`{steps:["arc"]}` from `useArc` when an owner opens an article) gets **its own job
id**, so its own empty scratch, and cannot see what the ingest wrote. The article is fully readable
without it — `TableView` falls back to the root gist — so this is a missing enrichment rather than a
broken import. The fix is hydration, which is cut for the reasons below, and the honest position is
that **re-running any single step against an existing article does not work on Vercel.**

### The guard that was never written

This document said v1 "publishes first ingests only, **guarded**". **No such guard exists anywhere on
that path**, and a second `done` job over an existing article republishes it. Found by
spideryarn2-84's agent, which believed the plan and went looking for the code.

The behaviour is safe, which is luck rather than design: `publishRevisionIn` moves a pointer and
`beginDraftIn` carries the previous revision forward, where `importArticle` deleted reader state
wholesale — and Sol independently confirmed that repeat publication does not delete reader data,
though a removed block may stop an annotation resolving. **A plan that admits there is no guard is
safe; a plan that claims one nobody wrote is how somebody later builds on it.**

### Every number in this document, and which kind it is

Three people were misled today by figures here, and all three were derived from constants rather than
observed. So, in the shape [`src/jobs.ts`](../../src/jobs.ts)'s `STEP_BUDGET_MS` already uses:

| Number | Kind |
|---|---|
| `toc` 320.4s | **MEASURED** 2026-08-30, one call, so no grouping argument applies |
| `assets` 7.1s | **MEASURED** 2026-08-30, the corpus's worst article, 10 images |
| `assets` cap 180s | **A CAP**, for a hanging publisher — not a cost |
| fetch/extract/blocks ~10/5/5s | **GUESSES**, generous, never measured |
| `summarise` 240.3s | **WRONG, WITHDRAWN.** Ten overlapping calls summed; wall time is 91.3s |
| `assets` 3,000s worst case | **DERIVED** from a 200-image policy ceiling no article approaches |

The trap that produced three of these is written up in
[ai-gateway.md](../project/ai-gateway.md#durationms-is-per-call-and-three-different-ways-of-adding-it-up-are-wrong).

## Kill-checks

| # | Check | Result |
|---|---|---|
| 1 | Vercel plan's `maxDuration` ceiling | **Pro** with Fluid, so up to 800s. `toc` is 320.4s measured, so Stage 0 is mandatory and moves first |
| 2 | `exportArticle` covers everything `importArticle` reads | in progress — Stage 5 depends on it |
| 3 | Collision with the D1b owner | Stages 3–4 touch `enqueue`, the advance route and `importArticle`'s guard, all seams D1b re-cuts. Coordinate before Stage 3 |
| 4 | Is the 228s `toc` a step total or one call? | **One call, 320.4s.** The "324s step" was three unrelated runs summed under a null slug — my error, not the note's |
