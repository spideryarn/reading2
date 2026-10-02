You are reviewing code that has been built and committed, in the repo at the current directory (TypeScript; React client under src/web). You may edit files to fix what you find **inside this change's scope**; report anything wider without fixing it. Do not commit, do not run git commands that change history or the index.

The plan: docs/plans/261002a-summary-generates-on-open.md (and your own earlier plan review, docs/plans/261002a-summary-generates-on-open-plan-review-sol.md).
The diff: docs/plans/261002a-summary-generates-on-open-code-review.diff (commit 3a9e040f4 against d5addd8cb).

What changed:
1. src/web/activation.ts — MODE_TARGET.summary is now { kind: "fixed", target: "simple" }; bandTarget's Summary special case was removed (the fixed row answers "simple").
2. src/web/Dock.tsx — useActivateMode / useActivateSubMode take `arms` and do not arm when the reader is a visitor (your plan-review P1).
3. src/web/SimplePanel.tsx — the owner's empty state hides "Nobody has asked…" while a job is running or starting.
4. Tests: every-mode-draws-its-surface SPENDS, command-bar GENERATES + a visitor-arms-nothing test, auto-modes counts, simple-panel, a-broken-mode (switched from Summary to Structure as the mode that arms nothing), last-view comment.
5. Docs: mode.md, summaries.md.

Check in particular:
- Is the visitor gate in Dock.tsx correct and complete? Is `isVisitor` the right signal at that point (prop vs drawer), and are there other arming sites a visitor can reach (CommandBar rows, sub-mode chips inside bands, Diagram chips, Remember's Quiz chip, Referee chips) that still arm? Do any of those leave an unclaimed token for a visitor? Fix in scope if small and clear; otherwise report.
- Does removing the bandTarget special case change ModeBoundary's retirement behaviour for Summary (a broken Summary band must still retire the "simple" token)?
- The SimplePanel condition: can `owner.job` be truthy for a finished/failed job, hiding the line wrongly after a failure? Check what JobProgress shows for failed.
- Any test that should exist and doesn't (a Summary press whose band throws retires the token; the command-bar Summary row; a press on Summary when simple is stored posts nothing).
- Stale comments or docs still saying Summary's press arms nothing (grep for them).

Run the relevant tests (npx vitest run <files>) and npm run typecheck after any edit. Report: numbered findings with P0/P1/P2, file:line, what you changed (if anything), and what you left for me.
