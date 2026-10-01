You are reviewing a PLAN, read-only. Do not change any file.

Repo: this worktree. Candidate: commit 20abc337 (one commit on top of dev), files:
- docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md  (the plan; read it first)
- evals/pdf/minimal-metadata/no-model-spike.mjs, cheap-model-spike.mts (the two spikes behind its numbers)

The request is Greg's own (the product owner), quoted at the top of the plan: bulk upload of
possibly thousands of papers, a near-free "minimal" import level, import levels chosen at import,
and a billing change so the slot limit counts only AI-processed papers. The plan builds only the
batch-upload half (through today's normal import, one slot per file) and proposes the minimal level
plus billing change for Greg, on the grounds that the billing change is a defence that only Greg may
approve and that the minimal level is worthless without it.

Code to check the plan against (start here; it does not limit scope):
- src/web/uploadEngine.ts, src/web/upload.ts, src/web/UploadPicker.tsx, src/web/AddArticle.tsx
- src/web/auto-modes.ts, src/web/jobEngine.ts, src/web/useJobs.ts
- src/routes.ts (POST /api/uploads ~5260-5300, POST /api/jobs {uploadId}, checkUploadOrigin, withIngestSlot ~9331)
- src/upload-records.ts, src/store/ (raw_sha256 on article_revisions; upload records), src/db/schema.ts
- src/billing/admission.ts, docs/project/billing.md § The quota, docs/project/ingest-queue.md § Uploading a PDF, § Concurrency, § The browser is the worker
- src/jobs.ts DEFAULT_JOB_CONCURRENCY

Questions, independent pass first:
1. Is the scoping right? Is batch upload through the full import a real stepping stone toward Greg's
   goal, or should the stepping stone instead be the minimal level (with slots still charged until
   Greg decides)? Is there a smaller or better 80/20 that I missed?
2. Is the proposed minimal design ("a to-read list, not an article", upgrade via the admitting
   ingest route) sound, and is anything in it a bypass of the quota or a privacy/security problem?
3. Stage 1, `POST /api/uploads/known`: correct definition of "already have" (archived articles,
   in-flight uploads, a failed upload of the same hash, another owner's article)? Any way it leaks
   another reader's data or lets a stranger probe whether someone holds a file? Does `raw_sha256`
   really equal the browser's sha256 for every uploaded file kind (PDF and HTML), including when
   stage 1 rewrites or re-encodes anything? Indexing at scale?
4. Stage 2, the browser queue: is "two in flight until the import finishes" right given the job
   engine, the article line, the auto-modes jobs it may queue, quota refusals (402) and sign-out?
   What breaks if the reader navigates (the engine is a module singleton bound to the reader) or
   if two tabs run batches? Any interaction with the existing single-upload engine's
   ONE_UPLOAD_AT_A_TIME or with the /add/upload/<id> page?
5. Anything that would make this a P0/P1 once built.

My own suspicions, worth less, spend most of the run elsewhere: whether auto-modes per paper in a
batch should be allowed at all (cost); whether 200 files per drop is sensible; whether HTML files
should be in the batch.

Severity: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1
user-visible wrong behaviour or an authoritative contract violated; P2 design risk, no wrong
behaviour today; P3 prose. Give each finding an ID (F1, F2, …), a severity, evidence (file:line),
and whether it is established or reasoned. End with a verdict: proceed / proceed with changes /
rethink.
