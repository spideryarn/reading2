# Plan review: 261004f, big PDFs and long documents import reliably up to the stated limits

You are reviewing a plan, read-only. Do not edit files. Repo is TypeScript/ESM; this is a git
worktree on branch `worktree-fbbac46a-big-pdfs-up-to-our-limits`, base `a4f99dbb8`. Nothing is
built yet; the plan is the only change.

Read `docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md`
first, then what it leans on:

- `src/uploads.ts` (`MAX_UPLOAD_BYTES`, `MAX_PAGES`, `uploadLimits`)
- `src/token-budget.ts` (`budgetFor`, `MODEL_MAX_TOKENS`), `src/structure.ts`
  (`estimateStructureTokens`, `wholeDocumentRequest`, `STRUCTURE_HEADROOM`), `src/labels.ts`,
  `src/relations.ts`
- `src/store/artifacts-pg.ts` § `writeBlocks`, and `loadArticle`
- `src/pdf-read.ts` (`planChunks`, `runPdfExtract`, `MAX_ENCODED_BYTES`, `CHUNK_CONCURRENCY`, the
  `reader` seam), `src/pdf.ts` § `pass0`, `src/pipeline.ts` § `refuseAnOverlongPdf`
- `src/jobs.ts` (`STEP_BUDGET_MS`, `LEASE_MS`, `REQUEUE_BUDGET`), `src/blocks.ts`, `src/fetch.ts`
  (`DEFAULTS.maxBytes`)
- `docs/project/structure-step.md` (§ The budget, § Longer pieces),
  `docs/project/content-extraction.md`, `docs/project/ingest-queue.md`
- `docs/plans/260904b-*.md` (the 142-page run) and
  `docs/plans/260928b-pdf-chunk-too-big-for-one-request.md`

The plan's "What we already know" list came from a read-only survey and nothing was executed. The
plan says so. Checking those seven items against the code is the most useful thing you can do.

Do an independent pass first. Grade findings P0 (data loss, exploitable security, wrong charging,
service unusable), P1 (user-visible wrong behaviour, or an authoritative contract violated), P2
(design or maintainability risk), P3 (prose). Give every finding an ID, F1, F2, ..., with file:line
references, say whether each is established (direct evidence) or reasoned, and end with a one-line
verdict: BUILD AS WRITTEN, BUILD WITH CHANGES, or DO NOT BUILD.

Then these, which are my own suspicions and worth less:

1. Are items 2 and 3 of "What we already know" true as stated? Work the arithmetic: at what block
   and heading counts does `wholeDocumentRequest` throw, and at how many rows does the
   `revision_blocks` insert pass 65,535 parameters? Is there any other statement on the import
   path (labels, tree, assets, checkpoints, cost ledger) with the same unbatched shape?
2. What big-document failure does the plan's stage 1 NOT measure that it could measure for free?
   Name the step and the seam.
3. Is a synthetic document a fair instrument for M1 to M5, or does some measurement share an
   assumption with the code it tests so that it cannot fail?
4. Stage 3 spends up to $10 on one real PDF. Is that the best use of the money, and is "ingest
   steps only" the right boundary given the reader-visible modes that run after import?
5. Options A to D: is one of them plainly right and small, such that sending it to Greg is a
   waste of his time? Is there a fifth the plan missed, in particular one already half-built
   (`SPIDERYARN_DEEPEN_STRUCTURE`, the cascade)?
6. Is the plan the afternoon-sized version, or is something in it that should be deferred?
