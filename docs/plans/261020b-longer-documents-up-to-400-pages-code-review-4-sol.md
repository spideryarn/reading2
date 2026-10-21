# Code review 4: narrow check of C3-F1 and C3-F2 (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol
(gpt-5.6-sol, effort high, `--sandbox review`), 2026-10-20, on `6477bd85e`; prompt in
[the prompt file](261020b-longer-documents-up-to-400-pages-code-review-4-prompt.md). Verbatim.

1. **C3-F1 — closed.**

   - A first charge now returns `pending` exactly when there is no prior ingest charge, no live reservation price, and no published revision: [pg-billing.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1720).
   - Once Retry exists, its original slot weight is carried forward: [admission.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/billing/admission.ts:458). `switchOnHighPower` then charges the maximum of that live weight and any charged ingest: [pg-billing.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-billing.ts:1733).
   - No remaining sequence was found that charges fewer slots than the later import.
   - Ordinary paths remain open:
     - A published pre-billing article bypasses the null-revision guard and retains the one-slot fallback at line 1733.
     - Administrators bypass charged switching entirely: [routes.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/routes.ts:11553).
     - A minimal paper is refused only while still minimal: [routes.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/routes.ts:11547). *Read this* flips it to full and publishes at [pg-revisions.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-revisions.ts:2535), with the ingest settlement in the same transaction at [pg-session.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/store/pg-session.ts:623).

2. **C3-F2 — closed, and it terminates.**

   - Each request records whether it was sent after settlement: [add-high-power.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:201).
   - Only a pre-settlement request receiving 404/409 after settlement triggers the direct resend: [add-high-power.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:224).
   - The resend is created with `sentSettled = true`, so another 404/409 cannot re-enter that branch. With the completed job no longer alive, it schedules no timed retry. `drain()` also follows the replacement `inFlight` promise: [add-high-power.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/src/web/add-high-power.ts:181).
   - The 404 and 409 cases, plus a final post-completion 409, are pinned at [add-high-power.test.ts](/var/tmp/spideryarn-worktrees/fbp5x9wy-long-pdfs-slots/tests/add-high-power.test.ts:334).

No C4 P0/P1 findings.

The 27 client tests passed. Database-focused tests could not start because local Postgres was unavailable. No files changed.

**Verdict: approve.**