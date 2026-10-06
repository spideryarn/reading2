- **F11 — P1, established: saved scroll/focus outlived its navigation context.** Open A at one pane, widen then narrow, or follow an incoming link to B, then close: the page restored A’s obsolete position and focus. Changed width/order and vanished rows also produced stale scrolling. **Fixed**, with red-first tests: invalidate interrupted excursions, restore focus only to a surviving row, and restore pixels only when width, ordering, and membership still match.

- **F12 — P1, established: Attention cards bypassed scroll capture.** Your suspicion reproduces: open an Attention card at scroll 1200, close, and restoration never runs. **Fixed** by sharing `SessionsPanel`’s measured opening handler through a React ref. No DOM added.

- **F13 — P2, established: the original tests did not prove independent `hashchange` adoption.** Removing that subscription left **all 20 original history tests green**. **Fixed the coverage**: isolated tests for each incoming event supersede refused local state and verify subsequent mounted controls preserve the adopted parameters. The new `hashchange` test failed under the mutation.

- **F14 — P3, established: comments contradicted the implementation.** `mode.ts` still claimed “no history API” and described owned writes returning through `hashchange`. **Corrected** those comments and removed the unsupported promise about running after every native scroll restoration.

The quoted history statement holds in the tested cases. The refused-push consequence is explicitly accepted by the plan; I left it unchanged. Feed → session → close has the intended history behavior.

All ten candidate switch arms retained identical JSX and props. Removing `case "ideas"` failed typechecking at the `never` check. The edited registration doc and signposts match the code.

Validation: **31 history tests and 60 feed tests passed**; the full dashboard and doc-link suites also passed. `npm run typecheck` hit the sandbox IPC restriction; running its script through Node passed every project and coverage check. Lint reported informational advice only. Native Safari restoration timing remains unverified.

Changed files; no commits, network access, or attributed quotation edits:

- [App.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/App.tsx)
- [SessionsPanel.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/SessionsPanel.tsx)
- [mode.ts](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/mode.ts)
- [fleet-history.test.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tests/fleet-history.test.tsx)
- [Root-cause postmortem](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/postmortems/261006p-a-return-position-snapshot-outlives-the-excursion-that-made-it-valid.md)

ship with my fixes