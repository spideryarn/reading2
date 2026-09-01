# Durable artefacts, so an import can finish on Vercel

**Status: NO-SHIP. Written and withdrawn the same day, 2026-08-29.**
The measurement in it stands and is the reason it exists. The plan it proposed does not —
[GPT Sol's review](260829k-durable-artefacts-review-sol.md) returned NO-SHIP, and was right.
Read [§ Why this plan was withdrawn](#why-this-plan-was-withdrawn) before anything below it.

> Use Claude-in-Chrome to check on spideryarn.com whether the import pipeline works (I'm happy
> for you to add test docs to my shelf, etc). Start with an HTML doc, and then a PDF. If you get
> errors, fix them locally as needed, then deploy, then try again on spideryarn.com
>
> — Greg, 2026-08-29

The answer to the question he asked is **no**, and this is the plan for making it yes.

## What was measured

Signed in at spideryarn.com on 2026-08-29, the shelf said **"9 earlier imports · 9 failed"**.
Every one of them stopped at step 1, "Fetching the page", with the same line:

```
ENOENT: no such file or directory, mkdir '/var/data'
```

Production was running `0b663ce`, which was `main` at the time — so this reproduces from the tree,
not from some stale deployment.

Reads are fine. The shelf renders articles out of Postgres and the reading view works. It is only
**ingest** that has nowhere to put anything.

## Two layers, and only fixing the second one helps

### Layer 1 — a path that is correct in the source tree and wrong in the bundle

[`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts):

```js
const ROOT = path.resolve(import.meta.dirname, "..", "..");
```

Two levels up is right for a file that lives at `src/store/`. But this code ships **bundled** into
`api-dist/vercel.js` (`outDir` and `entryFileNames` in
[vite.api.config.ts](../../vite.api.config.ts)), and `import.meta.dirname` is a fact about where the
file *ended up*, not where it was written. In the bundle, two levels up is `/var`. So the pipeline
tries to `mkdir /var/data`, which is not writable, and every article fails identically.

[`src/pipeline.ts`](../../src/pipeline.ts) computes its own `ROOT` with **one** `".."`, so inside
the same bundle the two constants disagree — pipeline gets `/var/task`, the artefact store gets
`/var`. Nothing notices, because nothing compares them.

**No local test can see this.** The arithmetic is right on a laptop and wrong in the bundle, so the
check and the thing it checks share the assumption. That is the same shape as the DOMMatrix outage
already written up in `docs/postmortems/`, and it is
[silent-success.md](../reusable/silent-success.md) again.

### Layer 2 — the pipeline passes artefacts through a disk that Vercel does not have

This is the one that matters, and fixing Layer 1 without it makes things **worse**, not better.

[`src/web/useJobs.ts`](../../src/web/useJobs.ts) says it plainly:

> The browser is what moves a job along. `POST /api/jobs/:id/advance` runs one [step]

So a five-step ingest is **five separate HTTP requests**, and on Vercel that is five separate
serverless invocations, each with its own ephemeral `/tmp` and no shared disk at all. Every step
writes `data/<slug>/*.json`; the next step reads those files back; and `stepIsDone`
([`src/jobs.ts:321`](../../src/jobs.ts)) decides "has this step already run?" by looking for them.

[`src/jobs.ts:57`](../../src/jobs.ts) picks the store, and its comment already says what is true:

```js
import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";
```

> the stages still write files themselves, so this is the filesystem one until step 11 half B moves
> the writes behind the seam, at which point this is the single line that picks Postgres instead

### Why not just point `ROOT` at `/tmp`

Because it would probably appear to work, and that is the problem. Sequential advances often land on
the same warm container, so imports would succeed in testing and fail unpredictably in use — and
when they failed, `stepIsDone` would find no artefacts and silently re-run a step that had already
been paid for. A reliable loud failure would become an intermittent quiet one.

This was flagged independently by the session that owns the Postgres migration, before it was
written down here:

> A fix that makes `mkdir` succeed against a writable `/tmp` would turn a loud failure into a quiet
> one — artefacts written where nothing reads them. On Vercel the filesystem is ephemeral, so "it
> now works" and "it now writes to a directory that vanishes" look identical from the outside.
>
> — spideryarn2-84, 2026-08-29

## The decision

Greg picked, on 2026-08-29, out of four options: **fix Layer 1 properly, and give the pipeline a
durable artefact store built on the Supabase Storage seam that already works in production.**

Not the Postgres artefact store. That is `artifacts-pg.ts`, it belongs to the transactional-session
work, and its owner puts it "weeks of stages away". This plan is deliberately **beside** that work,
not ahead of it: a third adapter behind an interface that already exists, selected at the one line
that already exists to select it. When `artifacts-pg.ts` is ready it replaces this at the same line.

The seam is already proven in production — `storeRawSource` and
[`src/store/blobs-supabase.ts`](../../src/store/blobs-supabase.ts) are how an uploaded PDF's bytes
get from the browser to the pipeline today, and that half works.

## Ownership, agreed with the other sessions on 2026-08-29

Five other sessions were working in this tree. Asked directly:

| Session | Lane | Overlap with this work |
|---|---|---|
| spideryarn2-84 | transactional session, Postgres artefacts | holds `src/jobs.ts`, `artifacts-pg.ts`, `pg-revisions.ts`. Said **`artifacts-fs.ts` is mine and `ROOT` is all mine** |
| spideryarn2-d7 | arc freshness, `Contents`→`Hierarchy` rename | in `src/pipeline.ts` right now; will be in `src/routes.ts` later and will warn first |
| spideryarn2-6c | public read-only links | no overlap; `src/api.ts` is shared, needs the private-index commit recipe |

## Why this plan was withdrawn

[GPT Sol's review](260829k-durable-artefacts-review-sol.md), asked for before anything was built, returned
**NO-SHIP** with three criticals. Each was checked against the code rather than accepted:

**1. Every default stage still writes its own files.** [`src/pipeline.ts:342`](../../src/pipeline.ts)
keeps an explicit list, and says so in as many words:

> The steps that still write their own artefacts inside `run`, and so are allowed to return a
> product with no `parts` in it. **All nine, today.** D3, D4 and D5 convert them a stage at a time.

So selecting *any* new store at `jobs.ts:57` makes `assertProduced` fail on every stage. This plan
had already written down the condition that should kill it — "if Stage 3 finds that most of the
ingest path bypasses the seam, this is not a store-adapter job" — and the condition was met.

**2. A finished job does not put an article on the shelf.** This is the one that decides it, and it
was missed entirely when the plan was written. `publishRevision` is called only by
`src/store/import.ts` and tests. **Nothing in
[`src/jobs.ts`](../../src/jobs.ts) or [`src/pipeline.ts`](../../src/pipeline.ts) calls it.** So even
with perfectly durable artefacts, a green ingest leaves the production shelf unchanged — Sol's
phrase is "the most dangerous quiet-success case". There is therefore **no route to working imports
that does not also build the publication bridge**, and that bridge is
[260827aa-delete-the-importer.md](260827aa-delete-the-importer.md)'s D-series.

**3. The blob seam has the wrong semantics.** [`src/store/blobs.ts`](../../src/store/blobs.ts) is
content-addressed and create-only (`putIfAbsent`), and artefacts need mutable, retryable,
attempt-fenced generations. `ArtifactStore.write` does not even receive the job attempt
([`artifacts.ts:783`](../../src/store/artifacts.ts)), so an expired claimant could overwrite a newer
attempt. Two traps worth keeping whatever happens next: `supabase/config.toml:195` allows PDF, HTML
and images but **no JSON**, and `blobs.ts:251` **silently falls back to the filesystem when
credentials are incomplete**, where production needs to fail closed.

Two smaller corrections to what is written above, both from the same review:

- The disagreement between the two `ROOT` constants is **narrower than § Layer 1 claims**.
  `pipeline.ts` delegates its stage paths to `fsLocations` ([`pipeline.ts:765`](../../src/pipeline.ts)),
  so they also land under `/var/data`. Its own one-`".."` root is only reached by `articleExists`
  and `urlForSlug` at lines 726 and 750. Real, but two call sites rather than a systemic split.
- The default ingest is **six** steps, not five — `assets` is in `DEFAULT_INGEST_STEPS`
  ([`pipeline.ts:143`](../../src/pipeline.ts)).

## What is actually true, and what to do instead

Making imports work on spideryarn.com **is** finishing
[260827aa-delete-the-importer.md](260827aa-delete-the-importer.md). There is no smaller thing that gets there. That is
also what Greg already decided, two days before this plan was written:

> Ok, great, proceed as per your recommendation. I don't care about preserving/importing existing
> data. Let's aim for the long-term-best approach.
>
> — Greg, 2026-08-27

Sol's own recommendation lands in the same place — *"Coordinate with the existing Postgres artefact
work and accelerate the smallest end-to-end slice"* — and says that a blob bridge built properly
"is not the small third adapter currently described, and much of it will later be discarded".

### The one piece worth keeping

`ROOT` in [`src/store/artifacts-fs.ts:55`](../../src/store/artifacts-fs.ts) is a real bug on the only
path that exists today, in a file the D-series owner has explicitly ceded. The fix in § Stage 1 above
was **also wrong**: one `".."` gives `/var/task/data`, which is still read-only. Sol's shape:

> Inject an explicit filesystem root. Use the repository root locally and invocation-scoped `/tmp`
> on Vercel. Do not derive production writable storage from a bundled module's location. Test exact
> roots, not merely "is not `/var`".

That is inert until the cutover happens, and then it is correct rather than wrong.

### Two things from the review worth carrying into the D-series

**The bypasses that fail quietly**, which are the ones that would let a cutover report success while
doing nothing: `articleExists` / `urlForSlug` turn every error into "not found" and can reuse a shelf
slug ([`pipeline.ts:728`](../../src/pipeline.ts)); `readRaw` catches everything and returns `null`
([`fetch.ts:235`](../../src/fetch.ts)); the pdf-chunks cache and the ToC label checkpoints go quiet
and silently re-buy model work; a missing `meta` quietly changes arc's prompt
([`arc.ts:349`](../../src/arc.ts)).

**The bar for the production smoke test**, which is more than a green job: a new owned shelf row
exists, the article opens, blocks are non-empty, the tree covers them, the PDF is still downloadable,
a retry cannot publish stale output, and two imports cannot collide on a slug.
