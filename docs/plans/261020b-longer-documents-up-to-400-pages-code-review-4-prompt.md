# Narrow check 3: plan 261020b, C3-F1 and C3-F2 fixes (read-only)

Do not change any file. Discovery is closed. Check only whether your C3 findings
(`docs/plans/261020b-longer-documents-up-to-400-pages-code-review-3-sol.md`) are closed by commit
`6477bd85e` (`git show 6477bd85e`), each with a verdict and file:line evidence:

1. C3-F1: `switchOnHighPower` in src/store/pg-billing.ts answers `pending` on a first charge with no
   charged ingest, nothing in flight, and `current_revision_id` null. Is there still a sequence
   that writes a High-powered row for fewer slots than the import that later runs under it? Can it
   wrongly refuse an ordinary reader path (a published article added before billing, an admin, a
   minimal paper after *Read this*)?
2. C3-F2: src/web/add-high-power.ts resend-once of a pre-completion 404/409. Closed, and does it
   terminate?

IDs C4-F1…. Only P0/P1 findings, please. End with a verdict.
