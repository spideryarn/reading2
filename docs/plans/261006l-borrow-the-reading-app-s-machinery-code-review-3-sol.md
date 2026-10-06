- **F21 — P1, established: render captured the wrong focused title.**  
  **(a)** The regression renders with alpha focused, moves focus to beta before DOM mutation, then rebuilds the list. The candidate restores alpha.  
  **(b) Fixed red-first:** a stable `TitleFocusContinuity` boundary captures focus in `getSnapshotBeforeUpdate` and restores it after child refs/layout effects, retaining the body/null guard.

  StrictMode double rendering alone is harmless; discarded renders run no restoration. A concurrent render that later commits can carry a stale sample, so the original precommit claim was unsound. The test demonstrates the interleaving deterministically, without claiming an actual scheduler yield. No introduced P0/P1 found after repair.

- **F22 — P2, established: the control test missed the postcommit guard.**  
  **(a)** Moving focus before render produces a null title snapshot, so deleting that guard cannot affect the original test.  
  **(b) Fixed:** focus now moves to a surviving control after the snapshot, before restoration. Removing the guard turns it red.

The **removed-row test stays unchanged**: falling back to the first surviving title turns it red.

**F18 passes:** omitted props preserve existing Tooltip behavior. Null/omitted references skip the setter; cleanup restores the trigger when an override disappears. Geometry tests pass under StrictMode. Passing null to the setter fails at `[0, 0]`; omitting cleanup leaves the old card geometry. All mutations are removed; `Tooltip.tsx` is unchanged.

Validation: **84/84 tests**, all typecheck projects, and fleet build passed. Typecheck used the equivalent Node entry point after npm’s entry point hit the sandbox IPC restriction. Lint reported informational findings only.

Files changed:

- [SessionsPanel.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/SessionsPanel.tsx)
- [fleet-session-preview.test.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tests/fleet-session-preview.test.tsx)
- [Focus postmortem](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/postmortems/261006r-logical-list-continuity-does-not-preserve-dom-focus.md)
- [Stage plan](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/plans/261006l-borrow-the-reading-app-s-machinery-for-the-fleet-dashboard.md)

No commit, network access, or attributed-quotation changes.

ship with my fixes