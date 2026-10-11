# Plan review: would smaller PDF chunks (more shards) make extract faster?

You are reviewing a plan, read-only. Plan: docs/plans/261011u-more-pdf-shards-faster.md (untracked file in this worktree). Code: src/pdf-read.ts — read `planChunks`, the docblocks over `MAX_CHUNK_PAGES`, `CHUNK_WORDS`, `MAX_CHUNK_BYTES`, `ATTEMPTS`, `CHUNK_CONCURRENCY`, and `runPdfExtract` (the fan-out, the re-ask loop, the checkpoints, the page-by-page recover). Prior measurement: docs/investigations/261004b-big-document-imports-at-the-limits.md.

Question for you:
1. Is the plan's framing right — that concurrency (100) already exceeds any chunk count we accept, so only chunk size is a lever? Is anything else in runPdfExtract (scoring passes, recover, serial re-asks, WidthGate, cutting) a bigger wall-clock factor that the measurement must separate?
2. Is the stage-2 experiment sound: chunk sizes, two docs, two runs each, no checkpoints, threshold for "yes" in stage 3? What would make its result misleading (e.g. checkpoints or a cache replaying, a provider-side cache, warm vs cold, re-ask variance dominating)? Is there a cheaper design that answers the same question (e.g. timing chunk calls in isolation as scripts/spike-pdf-width.ts does)?
3. Does smaller chunking have quality costs the plan does not mention (seams, context page per chunk, summarising drift going the other way, the check's failure rate per chunk)?
4. Anything that would make the stage-3 change unsafe.

Severity scale: P0 (plan would produce a wrong conclusion or break prod), P1 (material flaw), P2 (improvement), P3 (nit). Give every finding an ID (F1, F2…), a severity, and the evidence (file:line). End with a one-line verdict: "proceed", "proceed with changes", or "rethink".
