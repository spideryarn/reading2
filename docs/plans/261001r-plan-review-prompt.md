# Plan review: Trajectory becomes Skim (261001r)

You are reviewing a PLAN, read-only. Do not change any file. Repo: this worktree.
The plan is the untracked file docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md.
Read CLAUDE.md (house rules), docs/project/database.md sections "That rename question needs a terminal" and
"What no lock can cover", docs/project/deployment.md "Deploying", and the code the plan names
(src/modes.ts RETIRED_MODES / modeFromParam, src/mode-catalog.ts, src/db/schema.ts article_revisions and
revision_step_runs_step, tests/db-step-constraint.test.ts, src/trajectory.ts PROMPT_VERSION, src/store/pg.ts
loadTrajectory and the freshness check, src/feedback-payload.ts, src/web/params.ts, src/web/last-view.ts,
src/web/Dock.tsx withMode/acceptDockMode, src/routes.ts /api/trajectory).

Note: another agent is concurrently editing src/web/stop-card.ts, src/web/TrajectoryPanel.tsx and
src/web/modes/trajectory/TrajectoryMode.tsx (stage 1, removing FAQ snippets) — ignore churn there.

Questions, most important first:
1. The database choice: one rename-in-place migration (proposed) vs expand-now/contract-later. Weigh it
   against the repo's rules and the shared local DB. Is the list of persisted spellings complete?
   Look for anything else that stores the string "trajectory" in Postgres or in a reader's browser
   (jsonb fields in other tables, public share snapshots, reading-position or profile rows keyed by mode,
   feedback rows, job reset payloads, cost categories) that the migration or read-time code must handle.
2. Will renaming the prompt version tag trajectory/7 -> skim/7 plus rewriting stored versions keep every
   stored route fresh (sourceHash, profile hash, generator, any cache keyed on the version string)?
3. Old ?mode=trajectory links: is RETIRED_MODES really consulted by every path (server read address,
   client param, Dock, last-view, keyboard, public/visitor reader)? Anything else?
4. Anything the rename will miss or break that the plan does not name.
5. Is anything in the plan wrong, overbuilt, or missing a simpler route?

Severity scale: P0 (ships broken / data loss), P1 (real defect likely), P2 (worth fixing), P3 (nit).
Give each finding an ID (F1, F2, ...), file:line evidence, and a concrete fix. End with a one-line verdict.
