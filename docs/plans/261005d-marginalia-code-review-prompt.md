# Code review: Marginalia out of the experimental switch (261005d)

You are reviewing code that has been built and committed (623f4793b) in this worktree, before it is pushed to the shared trunk.

- The plan, with the plan review's findings and what was done about each: docs/plans/261005d-marginalia-out-of-the-experimental-switch.md
- Your earlier plan review: docs/plans/261005d-marginalia-plan-review-sol.md
- The scoped diff: docs/plans/261005d-marginalia-code-review.diff (the same as git diff HEAD~1 HEAD)

What to check:

1. Is the change correct and complete? Anything that still says or assumes Marginalia is behind the experimental switch, or that its relation words are made only on a press: source, comments, tests, reader-facing copy (/help, /features, tooltips), docs.
2. The conclusion, not only the code: the plan claims (a) queueing the relations step on every import is safe, (b) a visitor's press of the toggle starts nothing and requests nothing private, (c) arriving by the first-open default spends nothing. Try to break each claim.
3. The tests: is any of the edited tests now weaker than it was, or passing for the wrong reason? In particular tests/public-network-trace.test.tsx (the visitor's two presses), tests/dock-experimental-modes.test.tsx, tests/dock-mode-order.test.ts, tests/dock-corner-controls.test.tsx, tests/publication-queues-the-main-modes.test.ts.
4. The first-open default (src/web/last-view.ts): with the switch argument gone, is the effect still right, including its dependency list and the StrictMode case?

You may fix what you find inside this change's scope, in this worktree: edit files, and run the affected tests with npx vitest run <file> and npm run typecheck. Do not run the whole suite. Do not commit, push, or run any git command that changes history or the index. Do not touch .env.local, infra/, or anything outside this worktree. Do not write a quotation attributed to Greg: his words are only what the plan already quotes. Anything wider than this change, report and leave.

Finish with: each finding as P0/P1/P2/P3 with file and line and whether you fixed it; the list of files you changed; and one last line: VERDICT: approve | rework | reject.
