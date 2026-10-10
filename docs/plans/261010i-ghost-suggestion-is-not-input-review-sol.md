Found and fixed three issues:

- **P1 — fixed:** removing a dim prompt marker could make a typed `DRAFT❯` read as empty. Occupancy now uses the marker’s original column.
- **P2 — fixed:** colon-form SGR contaminated geometry and dialog parsing. Both readings now strip complete CSI sequences, including forms emitted by [tmux’s encoder](https://raw.githubusercontent.com/tmux/tmux/master/grid.c).
- **P3 — fixed:** unknown or incomplete SGR retained dim, contrary to the documented fallback. It now preserves subsequent text conservatively.

Capture-form threading is correct. Keeping `answerQuestion` on plain capture is appropriate.

Changed: [pane.ts](/var/tmp/spideryarn-worktrees/agent-a711e50baff7f954d/tools/fleet/pane.ts), [surface tests](/var/tmp/spideryarn-worktrees/agent-a711e50baff7f954d/tests/fleet-pane-surface.test.ts), [steer tests](/var/tmp/spideryarn-worktrees/agent-a711e50baff7f954d/tests/fleet-steer.test.ts), [pane test comment](/var/tmp/spideryarn-worktrees/agent-a711e50baff7f954d/tests/fleet-pane.test.ts), [plan](/var/tmp/spideryarn-worktrees/agent-a711e50baff7f954d/docs/plans/261010i-ghost-suggestion-is-not-input.md), and [postmortem](/var/tmp/spideryarn-worktrees/agent-a711e50baff7f954d/docs/postmortems/261010b-ghost-suggestion-read-as-typed-input.md).

**Validation:** all **287 tests passed** across the four requested files; regressions were observed failing before fixes. Typecheck passed using `node --import tsx scripts/typecheck.ts`; `npm run typecheck` was blocked by the sandbox’s tsx IPC restriction.

No tmux keys sent. No commit.