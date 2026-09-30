Review complete and written to [260930h-code-review-sol.md](/home/greg/code/spideryarn2/.claude/worktrees/fb73-trajectory-controls-row/docs/plans/260930h-code-review-sol.md).

Found and fixed:

- 1 P1: stale-route cards promised movement that can be refused.
- 4 P2s: incomplete shortcut caveat, tooltip surviving disabled Next, weak DOM assertion, and inaccurate tooltip documentation.
- 1 wider P2 remains in the out-of-scope feedback note.

Checks:

- Trajectory tests: 96/96 passed.
- Combined requested run: 109/110 passed; doc-links is blocked only by the reported out-of-scope feedback-note link.
- Typecheck’s underlying script passed all projects; `npm run typecheck` itself could not start because the sandbox denied tsx’s IPC socket.
- Scoped lint exited 0 with two pre-existing advisory infos.

No commit was made.