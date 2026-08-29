# Review request: making article imports work on Vercel

You are reviewing a **plan, before anything is built**. Be adversarial. I would rather find out now
that the shape is wrong than after two stages.

Project: Spideryarn, an AI-assisted reading app. TypeScript + ESM, Node, deployed to Vercel, with
Postgres (Supabase) and Supabase Storage. Repo root is the working directory.

## The situation

Every article import on production (spideryarn.com) fails. Measured 2026-08-29 while signed in: the
shelf says "9 earlier imports · 9 failed", and every one stopped at step 1 with

    ENOENT: no such file or directory, mkdir '/var/data'

Production was running the same commit as the local tree.

## What I believe the causes are

**Layer 1.** `src/store/artifacts-fs.ts` has

    const ROOT = path.resolve(import.meta.dirname, "..", "..");

which is right for a file at `src/store/` in the source tree. But this ships bundled into
`api-dist/vercel.js` (see `vite.api.config.ts`), so at runtime `import.meta.dirname` is the bundle's
directory and two levels up is `/var`. `src/pipeline.ts` computes its own `ROOT` with one `".."`, so
the two disagree inside the same bundle.

**Layer 2.** `src/web/useJobs.ts` says "The browser is what moves a job along. POST
/api/jobs/:id/advance runs one [step]". So a five-step ingest is five HTTP requests and therefore
five serverless invocations, each with its own ephemeral disk. Every step writes `data/<slug>/*.json`
and the next step reads it back; `stepIsDone` (`src/jobs.ts:321`) decides whether a step already ran
by looking for those files. `src/jobs.ts:57` hardcodes `fsArtifacts as pipelineStore`.

## The plan

Read `docs/plans/durable-artefacts-on-vercel.md` in full. In short: fix the ROOT arithmetic, then add
a **third `ArtifactStore` adapter** backed by the Supabase Storage blob seam that already works in
production for PDF uploads (`src/store/blobs.ts`, `src/store/blobs-supabase.ts`, `storeRawSource`),
selected at the single line `src/jobs.ts:57`. Explicitly NOT building the Postgres artefact store
(`src/store/artifacts-pg.ts`) — another session owns that and is weeks away.

## What I want from you

Please actually read the code, not just the plan. The files that matter most are
`src/store/artifacts.ts` (the interface), `src/store/artifacts-fs.ts` (the existing adapter and its
`PATHS` table), `src/store/blobs.ts` and `blobs-supabase.ts` (the seam I want to build on),
`src/pipeline.ts` and `src/jobs.ts` (the callers), `src/blocks.ts`, `src/extract.ts`, `src/toc.ts`,
`src/fetch.ts`, `src/pdf-read.ts`.

Answer these specifically:

1. **Is the diagnosis right?** Both layers. If the `/var/data` arithmetic does not work out the way I
   claim, say so and give the real derivation. If there is a third cause I have missed, name it.

2. **Is a blob-backed ArtifactStore the right move**, given the constraint that I must not get ahead
   of the Postgres artefact work? Or is there a simpler thing that gets imports working — and if so,
   what does it cost later?

3. **How much of the ingest path bypasses the `ArtifactStore` seam?** This is my biggest worry. Find
   every filesystem read/write on the ingest path (URL and PDF) that does not go through the store —
   I already suspect `previousBlocksInFile` in `src/blocks.ts`, the pdf-chunks cache in
   `src/pdf-read.ts`, `meta.json` in `src/extract.ts`, `output/<slug>.html`. Which of these fail
   **quietly** when the disk is empty rather than loudly? A quiet one is what would make this whole
   plan report success while doing nothing.

4. **Latency.** Five steps, each now doing blob round-trips instead of local file I/O, with a person
   watching. Is this going to be too slow, and if so where — and does anything need batching or
   caching within a single invocation?

5. **Atomicity.** `fsArtifacts` has no cross-key transaction and neither would mine. Is there
   anywhere in the pipeline that actually depends on two artefacts appearing together? The
   `artifacts-fs.ts` header says `blocks` has two destinations and the HTML has one path and two
   kinds — does that create a torn-state problem over a network store that a local filesystem hid?

6. **What breaks that I have not thought of.** Concurrency between the browser's advance loop and the
   lease; retries and `stepIsDone` now consulting a remote store; the 4.5 MB Vercel request body
   limit; Supabase Storage rate limits, object size limits, or eventual consistency. Anything where
   "it worked once by luck" is a plausible outcome.

7. **Are the four stages cut in the right places?** Each is supposed to end with a green suite and a
   deployable tree. Tell me if stage 3 is really where all the risk is, and whether stage 2 is
   testable on its own.

Give me a clear verdict — SHIP / SHIP WITH CHANGES / NO-SHIP — and rank your findings by severity,
criticals first. For each finding, cite the file and line, and say concretely what to do instead. If
you think the whole approach is wrong, say that plainly and say what you would do.
