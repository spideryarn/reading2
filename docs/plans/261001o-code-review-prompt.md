Short code review of two small, independent fixes. You may fix what you find inside these files only; report anything wider instead of changing it. Do NOT run the spike script for real (it spends money), and do not commit.

## Fix 1: tests/no-undeclared-spend.test.ts was red on evals/pdf/minimal-metadata/cheap-model-spike.mts
Plan: docs/plans/261001o-route-the-cheap-model-metadata-spike-through-the-gateway.md (and Sol's plan review, 261001o-plan-review-sol.md).
Diff: docs/plans/261001o-spend-diff.txt. The raw OpenRouter fetch became openRouterJson("eval", ...) inside withLedger("eval", ...).
Evidence: the guard was red with the old file (1 failed / 35) and is green with the new one (36/36); npm run typecheck is clean; tests/declared-spend, ai-spend, ai-call and doc-links pass.
Check: the script still does what the spike did apart from the reasoning effort (which the plan explains); spend is recorded and the printed total is honest for a BYOK key; the note added to 261001m is accurate; the result I report (the seam, not a declaration) is right.

## Fix 2: scripts/browser-sign-in.ts broke when /login got its own page (src/web/SignInPage.tsx, src/web/SignInControls.tsx)
Diff: docs/plans/261001o-signin-diff.txt. Removed the click on the "or use an email address" button (gone: the form is open on arrival), and the submit click was ambiguous because the Sign in / Create account switch also has a "Sign in" button; now it clicks `form:has(#signin-password) button[type="submit"]`.
Evidence: against this worktree's own dev server (port 5273, cwd checked) it printed "ok signed in as dev-admin@spideryarn.local ... GET /api/library -> 200 with 42 article(s)". Before the second change it failed with Playwright's strict-mode violation naming both buttons.
Check: the selector picks the right button in both tab states (sign-in vs create), and the other paths in the script (around the `#signin-email` check near the end, the --at mode) still hold. Is there anything in the script or its tests still assuming the old collapsed form?

Reply with numbered findings (P0-P3, file:line, what you changed if anything). Keep it short.
