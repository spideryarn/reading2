- **F6 — P1, established, fixed:** [daemon.ts:1653](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/tools/overseer/daemon.ts:1653). A throwing fallback logger rejected settlement before lock release. The new regression failed with `EPIPE`, then passed after containing that throw; it also verifies lock removal.

- **F7 — P0 under your ownership scale, established, inherited:** [daemon.ts:2241](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/tools/overseer/daemon.ts:2241). `stopHere()` writes `daemon-stopped` after losing the lock. A temporary assertion reproduced the unwanted note. This exists on `origin/dev`; left unchanged as outside the stage.

Eight assertions went red under mutations covering ownership, settlement, source wake-up, second-git admission and abandoned-pass restoration.

I would keep the generator for this stage, while preferring a plain async drain eventually. The three bounded negative waits remain defensible; removing settlement made all three fail.

Validation: 140 scoped tests passed; typechecking passed through the direct Node invocation. Full-suite database setup and two synchronous subprocess fixtures were blocked by sandbox restrictions.

[Full review](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/plans/261004g-report-drain-code-review-sol.md) · [Postmortem](/home/greg/code/spideryarn2/.claude/worktrees/overseer-report-drain-async/docs/postmortems/261004j-a-fallback-logger-rejects-the-promise-that-shutdown-must-settle.md)

Changed the daemon, its regression test and those two docs. No commits, restarts or deployment. The verdict covers this candidate; F7 remains a wider issue.

VERDICT: land after fixes (made)