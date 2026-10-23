You are reviewing a plan, read-only, before a one-off production write in the Spideryarn repo (this checkout). Do not edit anything.

The plan is docs/plans/261023c-re-read-the-order-of-time-from-its-pdf-in-production.md. The driver it describes is at docs/plans/261023c-refresh-prod-driver.ts.txt (a copy; it runs from the session scratchpad and imports this worktree's src by absolute path). Its dry run printed: Target aws-0-eu-west-2.pooler.supabase.com:6543 (production), owner Greg, the article is Greg's, Live jobs [].

Review for:
1. whether the driver does exactly what the shelf's Refresh from source does for an uploaded PDF (src/web/ShelfEntry.tsx, POST /api/jobs in src/routes.ts, enqueue/cascadeForce/advanceJob in src/jobs.ts), and anything it misses or adds;
2. environment-loading hazards: could any module, despite the pinning, talk to the local database, local storage, or another account (src/env.ts loadEnvLocal/applyEnvFile/pinnedNames, src/store/blobs.ts, src/db/client.ts)?
3. concurrency with production's own job runners, or with Greg's browser driving the same job;
4. anything that could lose Greg's comments, notes, reading position or block ids (docs/project/block-ids.md);
5. the cost estimate;
6. whether driving the labels/matter successors from here is right;
7. gaps in the verification list.

Give numbered findings, each with a severity (blocker / should-fix / note), the evidence (file:line) and the fix. End with a verdict: RUN, RUN WITH CHANGES, or DO NOT RUN.
