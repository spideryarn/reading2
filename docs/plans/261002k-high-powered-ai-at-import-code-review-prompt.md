You are code-reviewing one commit in the Spideryarn repo (this worktree), and you may fix what you find.

The plan: docs/plans/261002k-high-powered-ai-at-import.md (with your own earlier plan review beside it, -plan-review-sol.md). The diff under review: docs/plans/261002k-high-powered-ai-at-import-code-review.diff (commit HEAD). Background: docs/project/high-powered-ai.md, src/web/HighPowerSwitch.tsx (the Metadata switch this reuses), src/routes.ts (PUT /api/article/:slug/high-power).

Focus:
1. src/web/add-high-power.ts — the HighPowerIntent state machine. Any sequence of want/observe/settle/dispose and PUT answers that ends in a wrong state, a double charge request, a lost intent, a loop that never ends, or a settle() that never resolves or resolves before the PUT it should wait for?
2. src/web/AddPage.tsx wiring — the intent ref keyed by `wanted`, observe() inputs (slug, alive, lateRisk) across the three completions (job done; engine upload answered with an existing article; this page's own POST answered with an article), StrictMode, Retry of a failed job, a new address. Does any path queue main modes before the switch answers, or send the PUT for the wrong slug?
3. src/web/AddHighPower.tsx copy and states — honest in every state (never "on" when the server did not say so); admin line.
4. The /pricing and /help copy, and the doc changes — accurate against the code?
5. Tests: tests/add-high-power.test.ts and the new block at the end of tests/add-page-purpose.test.tsx — do they pin the behaviour, could any pass with the behaviour broken?

Rules: fix real defects in place inside this change's files (and add or adjust tests that would have caught them); do not commit; do not touch unrelated files, .env*, infra/ or any database. Run `npx vitest run tests/add-high-power.test.ts tests/add-page-purpose.test.tsx` and `npm run typecheck` after any fix.

First write your findings (P0/P1/P2, file:line, what you changed if anything, and anything wider you did not change) to the output file. Lead with a one-line verdict.
