Verdict: **accept after fixes**.

- **F41 — P2 — fixed:** `trajectory.md` still described the current v1 button as behind Experimental. It now says it appears in every owner’s bar. I also clarified that only the generated panel is owner-mounted; visitors receive the explanatory band.
- No remaining P0–P3 findings in 5f.

Verified:

- Dock and command bar share `visibleModes`; no other live Trajectory-specific experimental gate remains.
- Reintroducing Trajectory only into `BEHIND_THE_SWITCH` caused the expected 6 test failures.
- Changing only `POLICY.trajectory` to `available` caused 5 visitor-protection failures, including three rendered network-trace cases.
- Client visitor tests assert no POST for signed-out and signed-in non-owner readers.
- Server ownership is covered generically by [enqueue-owns-the-article.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/tests/enqueue-owns-the-article.test.ts:108): 404 plus no queued row. It requires Postgres and was not run here.
- Requested suite: **5 files, 225 tests passed**.
- Doc links: **14 passed**.
- Typecheck: all four projects passed via the direct script invocation. The npm wrapper itself hit a sandbox IPC `EPERM`.
- Biome lint passed for the changed TypeScript files.
- No commit made.

Two unrelated workspace additions appeared during review and were untouched: `src/trajectory.ts` gained concurrent Stage 6 work, and the review-prompt file is untracked.