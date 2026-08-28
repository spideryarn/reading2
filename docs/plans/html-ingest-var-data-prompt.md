# Input round: HTML ingest on Vercel dies at `mkdir '/var/data'`

You are reviewing a **diagnosis and a choice of next move**, not a built change. Nothing has been
written yet, and Greg has asked to discuss before anything is changed. What I want from you is
whether the diagnosis is complete, whether the option I lean towards is the right one, and above all
**whether any of the cheap interim fixes I list can actually work** — I believe they cannot, and I
want that belief attacked rather than agreed with.

## What happened

Greg pasted an article URL into the live site (https://www.spideryarn.com) and got an error
mentioning `/var/data`. The URL was:

    https://writings.stephenwolfram.com/2025/05/what-if-we-had-bigger-brains-imagining-minds-beyond-ours/

## The evidence

**1. The production log.** Vercel runtime logs, project `spideryarn-reading2`, deployment
`dpl_6bqFxSqZpvmmDLt6di2PXsWVQsAp` (commit `2ba408a`, built 2026-08-28T11:19Z). Two of Greg's
attempts, verbatim:

    ### 12:39:52 POST /api/jobs/spya-xbe8a9/advance 200 [info/serverless]
    {"level":"error","component":"jobs","jobId":"spya-xbe8a9",
     "slug":"what-if-we-had-bigger-brains-imagining-minds-beyond-ours",
     "err":{"type":"Error","message":"ENOENT: no such file or directory, mkdir '/var/data'",
     "stack":"Error: ENOENT: no such file or directory, mkdir '/var/data'
        at async mkdir (node:internal/fs/promises:859:10)
        at async Object.beginStep (file:///var/task/api-dist/vercel.js:43206:4)
        at async runStep (file:///var/task/api-dist/vercel.js:54800:19)
        at async advanceJob (file:///var/task/api-dist/vercel.js:55148:20)
        at async serveAuthenticatedApi (...)",
     "code":"ENOENT","errno":-2,"syscall":"mkdir"},
     "step":"fetch","ms":17,"msg":"step failed: fetch — what-if-we-had-bigger-brains-..."}
    {"level":"info","component":"jobs","status":"error","msg":"job error: what-if-we-had-bigger-brains-..."}
    {"level":"info","component":"http","method":"POST","path":"/api/jobs/spya-xbe8a9/advance","status":200,"ms":46}

A second attempt on the `constitution` slug failed identically at step `ideas` rather than `fetch`,
because that article already had earlier artefacts.

**2. Where `/var/data` comes from.** [`src/store/artifacts-fs.ts:48`](../../src/store/artifacts-fs.ts):

    const ROOT = path.resolve(import.meta.dirname, "..", "..");

On Vercel the bundle is a single file at `/var/task/api-dist/vercel.js`, so `import.meta.dirname` is
`/var/task/api-dist` and `../..` is `/var`. Hence `/var/data`. On a laptop the same expression
resolves to the repo root, which is why this cannot fail locally. The string is not a
misconfiguration; it is the bundle layout.

**3. The pipeline is still bound to the filesystem store.**
[`src/jobs.ts:57`](../../src/jobs.ts), with its own comment saying so:

    /* ... the stages still write files themselves, so this is the filesystem one until
       step 11 half B moves the writes behind the seam, at which point this is the
       single line that picks Postgres instead. */
    import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";

**4. A job is not one process run.** From `src/jobs.ts`, the comment on `jobSpend`:

    A job is not one process run: `advanceJob` runs some steps and returns, and
    the browser calls it again, so there is no frame that spans a job.

The logs confirm it: one `POST /api/jobs/<id>/advance` ran exactly the `fetch` step and returned.

**5. Health is otherwise fine.** `GET /api/health` returns `ok:true`, `store: {name: "postgres",
articles: 5}`, 17 tables, no missing columns, SSL verified, every required env var present. Reading
works in production. Only ingest is broken.

**6. This is a known wall, already written down.** `docs/project/deployment.md` § "What does not work
in production yet" records the same `mkdir '/var/data'` string, confirmed live on 2026-08-27, and
points at `docs/plans/transactional-stage-runner.md`.

**7. There is an in-flight plan that fixes exactly this**, being built by another session right now:
`docs/plans/delete-the-importer.md`. Its status line as of 2026-08-28: landings **C2–C7 are done and
reviewed** — the Postgres artefact adapter exists for everything except `raw`, `beginStepRun` /
`finishStepRun` are written, the corpus is backfilled, three test suites are off the importer.
**Not started: B3, then D (the demolition), then E.** D is the landing that deletes the per-stage
`mkdir`s and makes the stages write through the seam instead of to `data/<slug>/`. The plan also
already records, from an earlier Sol round that returned NO-SHIP, the exact trap:

    every pipeline stage still writes data/<slug>/*.json, stepIsDone reads those files ...
    So invocation A writes raw.json to an ephemeral disk and invocation B finds nothing
    and runs fetch again. A durable job row does not make a filesystem pipeline durable.

**8. The article itself is fine.** I ran stages 1 and 2 locally against Greg's Wolfram URL, into a
scratch directory. Stage 1 fetched 172.9 KB of HTML. Stage 2 extracted 79,670 characters with the
correct title ("What If We Had Bigger Brains? Imagining Minds beyond Ours") and a sensible excerpt.
Zero footnotes detected, which is correct for that page. So nothing is Wolfram-specific and nothing
is HTML-specific: the wall is the filesystem, and it would stop any URL and any PDF equally.

## My reading

HTML ingest on Vercel has never worked, is not a regression, and is not specific to HTML or to that
URL. It is the same single unfinished thing: the pipeline stages write to a local disk, and a
serverless function does not have one that persists. Landing D of `delete-the-importer.md` is the
fix, and it is already the next thing on another agent's list.

## The interim fixes I think cannot work — please attack these

Greg may reasonably ask "can we unblock this today?". I believe every cheap option fails, and I want
you to check my reasoning rather than accept it:

1. **Point `ROOT` at `/tmp`.** `/tmp` is writable on Vercel (~512 MB). I claim this does **not**
   work, because of evidence 4: each `advance` is a separate function invocation, possibly a
   separate container, so step 2 will not find what step 1 wrote, and `stepIsDone` reads those same
   files. Worse, it might *appear* to work whenever two steps happen to land on the same warm
   instance, giving an intermittent bug rather than a clean failure. Is that right? Is there any
   Vercel guarantee about instance affinity within a job that would change this?
2. **Run the whole pipeline in one invocation** (loop all five steps inside a single `advance`).
   `/tmp` would then survive across steps. I claim this fails on the function timeout and on
   memory, and that it also throws away the whole point of the queue — but I have not measured how
   long a full ingest takes. Is this worth measuring, or is it a dead end on design grounds alone
   (it would be a second mechanism to keep alive, and D deletes it again in a week)?
3. **Ship landing D early / rush it.** Another session is mid-flight on this plan and has six peer
   sessions' worth of uncommitted work in the same tree. I think the right move is to leave it
   alone. Do you agree, or is there a genuinely small subset of D that unblocks HTML specifically?

## What I actually want from you

- Is the diagnosis complete, or is there a second failure waiting behind `/var/data` that this
  analysis has not reached? Specifically: once the artefact writes go through the seam, is there
  anything *else* in the ingest path that still touches the filesystem — the `output/<slug>.html`
  debug page that stage 3 writes block ids into, for instance? Evidence 2's `ArtifactLocations`
  mentions both `data/<slug>` and `output/<slug>.html`.
- **The route returned HTTP 200 on a failed job.** Is that right or wrong? It means the Vercel
  runtime-errors dashboard shows nothing for this class — I only found it by full-text-searching
  raw logs. My instinct is the 200 is correct (the advance *did* run and recorded a step failure;
  the job state carries the error) but the observability consequence is bad. What is the right
  answer?
- Anything I should tell Greg that I have not thought to ask.

Be concrete, cite the file and line, and say NO-SHIP on anything you think is wrong.
