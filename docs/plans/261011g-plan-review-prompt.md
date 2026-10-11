Review this plan before it is built: docs/plans/261011g-referee-claims-become-promises-and-starter-criteria-wait-for-the-referee-own.md

Context: Spideryarn, a reading app. Referee mode (behind an experimental switch) has a sub-mode "Claims" being renamed "Promises" all the way down (code, files, URL, route, job name, table and columns, docs) — see docs/reusable/rename-or-move.md and the precedent docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md (and its migration drizzle/20261010063350_reception_expand.sql). Part 2 holds Criteria's starter presets (src/web/CriteriaPanel.tsx CRITERION_PRESETS) back until the referee has a criterion of their own, and adds a group of starters from errors reviewers often miss.

Read the plan, then the code it names: src/referee-claims.ts, src/referee-claims-run.ts, src/store/pg-referee-claims.ts, src/web/ClaimsPanel.tsx, src/web/useClaims.ts, src/routes.ts (search refereeClaims), src/store/article-rows.ts, src/store/export.ts, src/store/export-bundle.ts, src/stale-notice.ts, src/db/schema.ts (referee claims, stale notice table), src/web/CriteriaPanel.tsx, src/web/auto-run-targets.ts, src/mode-catalog.ts, docs/project/referee-mode.md.

Look hardest for:
1. Deploy-window breakage: does the view approach really keep the OLD code working (inserts, updates, ON CONFLICT upserts, deletes, any constraint caught by name, the sweep)? Anything the old code does that a view cannot carry? Anything the NEW code reads that the old code writes in an incompatible way during the window?
2. Places the name lives that the plan misses (stored values, CHECKs, job names in other tables, rate-limit buckets, cost categories, chat origins, last-view memory, IndexedDB/cache keys, help corpus, command-pick catalogue).
3. Whether keeping the inner JSON key `claim` is right.
4. Part 2: is "at least one saved criterion" the right gate? Edge cases (loading state, a failed or refused criterion, criteria created by chat/MCP). Wording and honesty of the starters given the study's table was not read.
5. Anything simpler.

Read-only. Write findings as a numbered list, each with severity (P1/P2/P3), the evidence (file:line), and the fix. End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.
