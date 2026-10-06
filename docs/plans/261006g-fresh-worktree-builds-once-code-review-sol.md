No established P0/P1 in this stage. Findings continue after the plan’s F1–F3:

- **F4 — P2, established, fixed:** listing tests ignored `spawnSync.error`; capture returned `EPERM` alongside status 0. Added file-backed capture and error checking.
- **F5 — P2, established, fixed:** a `--list` regression could launch the real check recursively. The new guard blocks subprocesses. Mutation control: **56 stand-in npm calls before, zero after**.
- **F6 — P3, established, fixed:** docs/comments overstated who reads `SUITE_BUILDS`, setup’s success guarantee, and readiness’s double-build frequency.
- **F7 — P2, established, not fixed; outside stage:** typecheck fails on unused `writtenAsB` in [feedback-dialog-has-its-reader.test.tsx](/var/tmp/spideryarn-worktrees/fresh-worktree-build-reds/tests/feedback-dialog-has-its-reader.test.tsx:126).

Validation: **185 tests passed across five files**. Hiding build output made all five build-reading files fail; output was restored. Removing the fleet step failed every flag combination. Cycles passed; lint reported existing complexity advice. The requested `npx tsx … --list` hit sandbox IPC restrictions; `node --import tsx … --list` succeeded. Fresh-setup/fleet positive evidence remains your supplied run.

Changed: `tests/check-steps.test.ts`, comments in `scripts/deploy-checks.ts` and `scripts/readiness-loop.ts`, `docs/project/worktrees.md`, the stage plan, and a [postmortem](/var/tmp/spideryarn-worktrees/fresh-worktree-build-reds/docs/postmortems/261006l-a-zero-child-status-does-not-prove-output-capture-succeeded.md). No commits or prohibited commands.

VERDICT: approve