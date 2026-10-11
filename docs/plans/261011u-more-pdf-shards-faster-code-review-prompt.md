# Code review: 261011u, the PDF chunk-size measurement

Review commit 5411a9381 (`git show 5411a9381`) in this worktree. You may fix what you find inside
this commit's scope, narrowly; report, do not fix, anything wider. Do not run any paid script, and
do not touch any database (you have no network anyway).

What it is: Greg asked whether smaller PDF chunks / higher concurrency would make PDF import
faster. The plan (docs/plans/261011u-more-pdf-shards-faster.md, including your own plan review,
F1–F9) was followed; the measurement said no, so nothing changes in production. What lands:

1. src/pdf-read.ts: an experiment-only `chunking?: { maxPages; words }` on PdfExtractOptions, and
   `chunkWords` on planChunks. Claim: with the option omitted, behaviour is unchanged and
   production never passes it. Verify that (every runPdfExtract caller, planChunks callers,
   checkpoint keys).
2. scripts/eval-pdf-chunk-size.ts — the paid eval driver. Does it measure what the write-up says
   (first wave, tail, re-asks vs recoveries, front-matter/authors time)? Is its local-only guard
   sound (could loadEnvLocal change DATABASE_URL after the check, or does the check read a
   different variable from what getDb uses)? Is the ledger read correct?
3. docs/investigations/261011c-pdf-chunk-size-and-extract-speed.md — check every number against
   evals/results/pdf-chunk-size-2026-10-11/stage2.jsonl and stage2-ledger.json (compute the
   medians yourself with python). Are the conclusions justified by the data; is anything
   overclaimed? Stage 1's numbers come from evals/results/pdf-chunk-size-2026-10-11/stage1/analyse.py
   over production rows that are not committed; check the method in the script, not the numbers.
4. The plan's log entries.

Run yourself if the sandbox allows: `npx vitest run tests/pdf-chunk-concurrency.test.ts
tests/paid-cli-ledger.test.ts tests/no-undeclared-spend.test.ts`. I ran `npm run typecheck`
(green) and those plus tests/doc-links.test.ts (123 passed).

Severity: P0 (wrong conclusion, or breaks prod), P1 (material), P2 (improvement), P3 (nit). An ID
on every finding (C1, C2…), evidence (file:line), and what you fixed, if anything. End with a
one-line verdict: "land", "land after fixes (made)", or "do not land".
