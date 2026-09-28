Verdict: **accept after fixes**. No P0/P1 findings. Fixes are applied but not committed.

- **F80 · P2 · Fixed:** opening `Summary` caused false positives, including an essay’s introduction or a subsection inside `Introduction`. Plain `Summary` now requires `Front Matter` ancestry or an immediately following `Introduction`. Numbering variants such as `(1) Abstract` and `2.3 — Abstract` are recognized. [trajectory.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/trajectory.ts:445)

- **F81 · P2 · Fixed:** Most-pass coverage used the raw Quotes count, including abstract quotes the route could never reach. It now uses the route’s stored `offered` count and says “quotes offered to this route.” [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/web/TrajectoryPanel.tsx:106)

- **F82 · P3 · Fixed:** abstract-only articles incorrectly said there were no quotes. They now receive a distinct actionable `[jb-only-abstract-quotes]` refusal. [messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/messages.ts:1379)

- **F83 · P3 · Fixed:** the prompt’s “Give the gist from the body” could discourage other opening material. It now conditionally explains the omission and explicitly keeps other opening quotes available. [trajectory.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/src/trajectory.ts:790)

- **F84 · P3 · Known limitation:** untitled and non-English abstracts remain undetected. This is documented and conservatively avoids deleting legitimate body material. [trajectory.md](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-flash-position-0928/docs/project/trajectory.md:97)

Hash/freshness looks sound: stamp, write, `stepIsDone`, and read all derive `trajectoryInputHash` from the same `trajectoryInput`. Excluded quote IDs correctly do not affect the hash because they never reach the prompt. Moving the boundary across a quote changes the offered records and hash; a new unit test pins this. An all-abstract re-cut returns a stale/blocked result rather than crashing.

Checks:

- Requested Trajectory suites: pass, 110 tests.
- Supplemental message/plain-word checks: pass.
- `node --import tsx scripts/typecheck.ts`: all projects pass.
- Postgres freshness test not run, as requested.
- Full `npm test` could not start because local Postgres is unavailable.
- Lint has the existing repository baseline; no new finding on edited lines.
- No commit made.