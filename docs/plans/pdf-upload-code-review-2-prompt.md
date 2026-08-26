# Review: uploading a PDF, end to end

You are reviewing **built code**, not a plan. Weight this higher than a plan review would be
weighted: a plan-stage review cannot find a regex that accepts thirty-six hyphens, and the two
previous reviews of this feature (yours) found exactly that class of thing.

Read-only. The repo is at the working directory. Do not edit anything.

## What was built

A reader can now choose a PDF off their own machine and it becomes an article, running through the
same ingest queue a pasted URL already used. Three requests:

```
POST /api/uploads  {filename, bytes, sha256}  →  {uploadId, url, expiresAt, slug}
PUT  <signed url>  the whole file                straight to Supabase Storage, NO credentials
POST /api/jobs     {uploadId}                 →  the queued job
```

The bytes never pass through our server, because on Vercel they cannot: a function refuses a body
over 4.5 MB and two of the three PDFs in this project's own eval set are bigger than that.

The plan and its two earlier reviews (yours) are `docs/plans/pdf-upload-and-storage.md` — read it,
including the two "what Sol said" sections, because several things below are deliberate departures
from it and I want to know if any of them is wrong.

The PDF extraction pipeline it feeds is `docs/plans/pdf-ingestion.md`; the ingest queue is
`docs/project/ingest-queue.md`.

## The code

`scratchpad/upload-code.txt` (in this same directory as this prompt) has every new file in full and
a diff for the modified ones. **The modified files also carry other agents' uncommitted work** —
this repo has several agents in one working tree — so ignore hunks that are plainly not about
uploads (`advanceJob`, `ingest-resume`, glossary underlines, auth). Read the files on disk too;
the dump is for convenience, not a boundary.

The files that are mine:

- `src/store/blobs.ts`, `blobs-fs.ts`, `blobs-supabase.ts` — the object-store seam
- `src/upload-records.ts` — one upload attempt's state, on the filesystem
- `src/pipeline.ts` → `acquireUpload` and the `fetch` step's branch
- `src/jobs.ts` → `freeUploadSlug`, `slugIsSpokenFor`, `EnqueueRequest.upload`, `sameWork`
- `src/routes.ts` → `mintAnUpload`, `queueAnUpload`, `parseJobRequest`'s upload shape, dispatch
- `src/fetch.ts` → `RawManifest` gains `origin`/`uploadId`/`filename`, and `url` became optional
- `src/web/upload.ts`, `UploadPicker.tsx`, `AddPage.tsx`, `router.ts`, `useJobs.ts` — the client
- `src/source.ts` and `src/uploads.ts` are **another agent's**, already reviewed by you; I only
  consume them. Say so if I am consuming them wrongly.

## Deliberate departures from the plan — are any of them wrong?

1. **No Postgres `uploads` / `raw_sources` tables.** The plan specifies them. I put the upload
   record on the filesystem (`data/_uploads/<id>.json`) instead, because **the queue it sits beside
   is also filesystem-backed**: `src/jobs.ts` writes `data/_jobs/` and the `jobs` table in
   `src/db/schema.ts` is unused pending `docs/plans/job-queue-rethink.md`. The state machine is in
   `src/source.ts` and is storage-agnostic, so I claim this is a change of adapter later, not a
   rewrite. Is that reasoning sound, or does something about uploads specifically need the
   transactional store now?

2. **The acquisition step is the existing `fetch` step with a branch**, not a new `acquire` or
   `verify-source` step name. `StepName` is a union in `src/types.ts` that is persisted into job
   records on disk, so renaming breaks resume of in-flight jobs. The step's *label* is dynamic
   ("Checking the file"). Your earlier review's requirement — that it be a real step inside
   `beginStep`/`finishStep`/cancellation/`assertProduced` — is met. Is the shared name a problem?

3. **There is no filesystem grant issuer.** `RawSourceStore` and `UploadGrants` are separate
   interfaces (your suggestion) and only Supabase implements the second. An installation with no
   Supabase credentials simply cannot take uploads and says so. Local dev uses the local Supabase
   container.

4. **Staging objects are never deleted.** Measured: deleting an object *re-arms* any grant still
   live over its key. So promotion copies to `sha256/<hash>.pdf` and leaves `staging/<uploadId>`
   alone; a sweep after `SWEEP_GRACE_MS` is not built.

## What I want most

Bugs in code, of the kind only reading it finds. Especially:

- **Anything a caller can do that we did not intend.** The load-bearing rule is *never accept a
  client-supplied object path*. Is that actually true of every path through
  `parseJobRequest`/`queueAnUpload`/`mintAnUpload`? What can a signed-in stranger reach?
- **Races.** Two tabs, a double-clicked button, a reload of `/add/upload/<id>`, Retry, cancel
  mid-download, `advanceJob` walking the step list twice. `claimUpload` uses a create-only file as
  its CAS; `freeUploadSlug` allocates inside `enqueue`. Where is there still a gap?
- **Failure modes that report success.** This repo has a whole document about that pattern
  (`docs/reusable/silent-success.md`) and it is the single most valuable thing you can find.
  Note in particular that Supabase Storage answers **HTTP 400** for both "missing" and "duplicate",
  with the real status in the body as a string — `src/store/blobs-supabase.ts` handles that; check
  I have not missed a place where it matters.
- **Tests that would pass while the thing they name is broken.** You called four decorative last
  time and were right about all four. Do it again.
- **The client.** `src/web/upload.ts` uses `XMLHttpRequest` for upload progress. Abort handling,
  the `onload`-fires-for-4xx trap, `crypto.subtle` availability, a File that changes on disk
  mid-upload.
- **Anything in `docs/plans/pdf-upload-and-storage.md` that the code now contradicts**, since the
  plan has not been updated yet and I am about to update it.

## Two things I already know and do not need told

- The slug for an upload comes from the filename, so `source.pdf` becomes the slug `source`. The
  plan's alternative — provisional id, run pass 0, reserve from the title — is a rename, and
  `docs/project/block-ids.md` is about why renames here are expensive. I am writing it down as an
  open question for the owner. Tell me only if you think the *current* behaviour is unsafe rather
  than merely ugly.
- There is no sweep for abandoned uploads or staging objects. Named as not-in-v1.

## Format

For each finding: **what is wrong**, **the file and line**, **how to reproduce or why it follows**,
and **how confident you are**. Rank by severity. Say plainly if something I flagged as deliberate is
in fact fine — a confirmation is worth as much as a finding here. Put the verdict last.
