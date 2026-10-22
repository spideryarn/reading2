You are reviewing a plan, read-only, in the repo at the current directory (Spideryarn).

Plan: docs/plans/261022b-summary-thread-writes-only-when-pressed.md. Read it first, then check it
against the code: src/auto-mode-steps.ts, src/web/auto-modes.ts, src/store/pg-main-modes.ts,
src/store/pg-revisions.ts (queueMainModesIn / autoModeJobs callers), src/web/useTweets.ts,
src/web/modes/summary/SummaryMode.tsx, src/web/activation.ts (activationForSummary),
src/preparable-modes.ts, src/jobs.ts (reset/regenerate).

The request (Greg, product owner): Summary's Brief and Fuller keep being made eagerly on import, but
the Thread sub-mode (step `tweets`) should be made only when someone presses it.

Questions:
1. Is removing `tweets` from AUTO_MODE_STEPS and DELEGATED_MODE_STEPS.summary sufficient? Is there
   ANY other path that makes the thread without a press (imports, gifts, MCP, Guide, ingest,
   reset, batch scripts, cron-like jobs, the add page)? Search the repo.
2. Does pressing Thread on an owned article reliably start the job when no thread exists (including
   for a gift recipient after ownership transfer, and a phone)? Any case where it relied on the
   import having queued it (e.g. an "in progress" state shown from the queued import job)?
3. Any test or doc the plan misses.
Answer with a list of findings (severity, file:line, why), then a one-line VERDICT: approve /
approve-with-changes / reject.
