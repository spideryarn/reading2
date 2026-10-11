Code review, write-capable: you FIX what you find inside this work, then report. Repo: Spideryarn (read CLAUDE.md). Worktree: this directory.

The plan: docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md (read it in full, including § After GPT Sol's plan review — your own earlier review, docs/plans/261011g-plan-review-sol.md; F1 was overruled on purpose, do not re-add a route alias).

The change: `git diff origin/dev HEAD` (saved as docs/plans/261011g-code-review.diff). Two parts:

1. Referee's Claims sub-mode renamed Promises all the way down, with migration drizzle/20261011025758_referee_promises.sql (table/column/constraint renames in place + a `referee_claims` compatibility view for the old code during the deploy window + the stale-notice CHECK widened), the `?referee=claims` lift (src/web/router.ts `liftLegacyRefereeClaims`), the RETIRED_JOBS alias, CSS `.clm-` → `.prm-`, export file names, tests.
2. Criteria's starter presets held back by a latch until the referee has a criterion of their own, plus a new "Worth a second look" group (src/web/CriteriaPanel.tsx `STARTER_GROUPS`, tests/referee-criteria-starters.test.tsx).

Look hardest for:

- The migration: correct SQL; the view truly auto-updatable for every statement the OLD store (`git show origin/dev:src/store/pg-referee-claims.ts`) issues; grants; its final check; snapshot and journal consistency (`npm run db:chain`, `npm run db:generate -- --allow-empty`).
- Does tests/referee-promises-expand-pg.test.ts prove anything — would it fail if the view lacked a column or were not updatable? It was never seen red. Make it go red (temporarily) if you can, and say what you saw.
- Wire and shape breaks: anything the new server sends or stores that the new client reads under another name; SSE frame names; the stored jsonb inner keys (`claim` and `claimWithheld` are kept on purpose); the export bundle; stale-notice reads of old `claims` rows.
- Missed renames in live code and docs (not history: docs/plans, postmortems, user-feedback, research, investigations, evals/results, applied migrations, the changelog ndjson, frozen evals/command-pick inputs). And over-renames: Sources' Claims (`sources-claims`, ReceptionAndClaimsPanel) and English "claim" must be untouched.
- Part 2: latch correctness (the setState-during-render pattern, remount, failed or refused drafts), honesty of the copy, accessibility.
- Reader copy in plain words.

Gates after your fixes: `npm run typecheck`; the touched test files (`npx vitest run <files>`); tests/doc-links.test.ts. Do not run anything against production, do not edit .env.local, do not commit, and do not use any git command that discards work.

Write your findings as a numbered list (severity P1/P2/P3, evidence file:line, what you changed or why you did not), then the list of files you changed, then a one-line verdict: LAND / LAND AFTER FIXES / DO NOT LAND.
