## Your zone: the pipeline and the import queue

`src/pipeline.ts` (5.5k lines), `src/jobs.ts` (4.8k), `src/store/pg-jobs.ts`, `src/store/jobs.ts`,
`src/fetch.ts`, the extraction stages, `src/structure.ts` and its deepen / slices siblings,
`src/simple-summary.ts`, `src/ai-call.ts`, `src/messages.ts`, `src/messages-stream.ts`,
`src/transport-retry.ts`, `src/models.ts`, the article-images / assets stage, the draft sweep, and
`src/web/AddPage.tsx` + `src/web/useJobs.ts` only for the contract they share with the queue.
Read `docs/project/architecture.md` (§ Conventions, § Stage ownership) and
`docs/project/ingest-queue.md` first.

Prior doc: `docs/investigations/261003b-fifth-sweep-data-and-pipeline.md` and its Opus review
`261003b-fifth-sweep-review-opus-on-data-and-pipeline.md`.

Zone-specific questions:

- **Steps as siblings.** One row per pipeline step: its freshness decider (which hash input), draft
  revision ownership, what a crash mid-step leaves, its retry / attempt fence, how it reports
  failure to the job row and to the reader, cost attribution, cancellation. Where do they differ
  without a written reason?
- **The job state machine.** Every state, every writer of each transition, and whether the database
  or only the code refuses an illegal transition. A lease or heartbeat that can be stolen; a job
  row that can be left "running" for ever; two workers publishing one revision.
- Much changed on 2026-10-04..06 (read-while-importing, long documents structured in slices, the
  per-article job queue, open-before-structure). New code written fast beside old code is where two
  mechanisms for one job appear: look there hardest.

Finding IDs: PQ1, PQ2, ...
