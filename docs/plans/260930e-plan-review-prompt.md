You are reviewing a plan (read-only) in the repo at the current directory: docs/plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md

Context: Greg (the owner/admin) asked (1) remove the confirm step when pressing "Run it"/"Run it again" on per-mode rerun rows on /read/<slug>/metadata, and (2) fold "Start the whole article again" (the reset, src/web/ResetArticle.tsx) into the rerun section, e.g. as a button at the top.

Relevant code: src/web/Metadata.tsx (RerunSection, RerunRow, the RERUN_CONFIRM constants), src/web/ResetArticle.tsx, src/web/JobProgress.tsx, src/web/useStepJob.ts, tests/metadata-rerun-section.test.tsx, tests/metadata-reset-section.test.tsx, docs/project/billing.md, docs/project/ai-gateway.md, docs/project/security-map.md, docs/project/ingest-queue.md.

Please check:
- Is the claim that the per-mode confirm is NOT a security defence and spends no reader slot correct? Is anything server-side relying on the two-click flow?
- Double-press safety once the confirm is gone (useStepJob start / starting / JobProgress). Could one quick double click post two jobs? The Retry path too.
- Any information the confirm carried that would now be lost or become a lie (glossary appends, trajectory refusal, sketch/debate cost).
- The reset-as-first-row layout: any wiring issue (keepMounted, experimental gate, hooks), accessibility, tests that would break.
- Anything simpler.

Write findings as a numbered list, each with severity (P0-P3), evidence (file:line), and a concrete fix. End with a one-line verdict.
