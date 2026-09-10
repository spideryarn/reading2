# Narrow check: 260910e work reports — the two fixes in Stage 3c

You are checking two fixes, and nothing else, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/work-reports`. **20 minutes. Write each finding, as you find
it, to `docs/plans/260910e-work-reports-stage3c-check-sol-findings.md`** — not to the answer file, which
`run-codex` overwrites with your closing message. At 15 minutes, stop, and put your verdict in that file
and in your closing message. Fix only what is inside these two fixes, narrowly and red-first; report
anything else.

This is the sixth and last Sol run for this plan. Discovery is closed: do not re-review Stages 1, 2, 3a or
3b. Your earlier Stage 3 findings are `docs/plans/260910e-work-reports-stage3-review-sol-findings.md`.

## The two fixes (commit `53ee5bcb`, and its follow-up FOLLOWUP_SHA — `git show` both)

The follow-up applies the same rule to the two places 3c's builder flagged: the daemon never deletes from
`report-refused/` either (its prune-to-200 listed and sorted the whole directory on every refusal), and
the `report-processing/` replay — at the start of every pass, and in the lost-log branch — is read lazily
under the drain's `scanEntries` cap. Check those under question 1 below.

1. **WR-S3-4 (was P0).** The drain no longer deletes anything from `report-quarantine/` (the decided
   route, instead of a budgeted cleanup protocol: moving an entry there costs no disk, and emptying it is a
   person's act). Check: is there now **no** path in the daemon's loop that deletes, lists without a cap,
   or recurses into `report-quarantine/` or anything else an untrusted writer controls? Is the quarantine's
   size and oldest age visible, and capped, as the brief
   `docs/plans/260910e-work-reports-stage3c-task.md` requires?
2. **WR-S3-5 (was P1).** `readInbox` reads each directory lazily under a cap, and every count says
   `exact` or `atLeast` through the route, the wire (reports payload schema 2), the client, the panel and
   the CLI. Check: can a flooded `~/.overseer/` still make `GET /api/reports` or `overseer reports` do work
   proportional to the flood? Can any capped count reach a person looking exact?

Your sandbox refuses `spawnSync("git")`; a real-git test failing only with EPERM is environment. Typecheck
as `node --import tsx scripts/typecheck.ts`.

## Format

Findings `WR-S3C-1`… with severity (P0 a wedged daemon or server; P1 must fix before landing; P2; P3),
file:line, what is wrong, and if fixed the red test and the fix. Then a one-line verdict per fix, and one
overall: **approved to land** or **not**.
