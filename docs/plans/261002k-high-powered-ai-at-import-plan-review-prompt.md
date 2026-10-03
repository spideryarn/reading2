You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only: do not edit any file.

The plan: docs/plans/261002k-high-powered-ai-at-import.md. Background: docs/project/high-powered-ai.md, docs/project/billing.md § "High-powered AI counts double", docs/project/ingest-queue.md § "The add page".

Code to check the plan's claims against: src/web/AddPage.tsx (offerAutoModes, the auto-modes tick box, the phases), src/web/HighPowerSwitch.tsx, src/jobs.ts (readStepPower, runStep's per-step power read, claimSession), src/store/pg-revisions.ts (openOrBeginJobDraft / lockOrCreateArticle), src/store/pg-billing.ts (switchOnHighPower), src/billing/admission.ts (chargeAndSwitchOnHighPower), src/routes.ts (PUT /api/article/:slug/high-power), src/pipeline.ts (DEFAULT_INGEST_STEPS), src/web/useJobs.ts.

Questions, answer each with file:line evidence:
1. Is it true that the article row exists once the job is `running` (claimed), for both URL and upload ingests, so the PUT will find it? Is there any window where a job reports `running` but the row is not yet there, or where the slug the page knows differs from the row's slug (e.g. freeSlug stepping aside)?
2. Is it true no capable-tier model call happens before `structure` in an ingest?
3. Is it true that a retry of a failed ingest does not charge High-powered AI again, and that a failed import leaves the article row (and the charge) in place?
4. Does reusing the existing PUT from the add page open any billing or security hole the Metadata page did not (e.g. the add page for an article already on the shelf, an article owned by someone else, a minimal paper, an admin)?
5. Is the client-side "intent until running" design sound, or is there a simpler or more robust option within the same no-server-change budget? Is the "late" detection (structure already started) feasible from the job data the page has?
6. Anything the plan gets wrong or misses. Keep it to findings that matter, ranked P0/P1/P2.

Write your findings to the output file. Lead with a one-line verdict.
