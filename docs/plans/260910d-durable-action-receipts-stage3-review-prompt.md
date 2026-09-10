# Review: Stage 3 of plan 260910d — enacted plans and the broadcast

Repo: /home/greg/code/spideryarn2/.claude/worktrees/durable-action-receipts, branch
worktree-durable-action-receipts. TypeScript + ESM, tsx, vitest. **You have 30 minutes; write your
answer file — the full report, not a pointer to it — before the last five.** The Stage 1b review ran out
of time before writing one, and the Stage 2 review's answer file pointed at itself.

## The candidate

Committed: the commit whose subject begins "Stage 3 of 260910d" — `git log -1 --format=%H
--grep='^Stage 3 of 260910d'`. `git show --stat <sha>` lists its paths; `git show <sha> -- tools/
tests/` is the code. Implemented by an Opus subagent from
`docs/plans/260910d-durable-action-receipts-stage3-task.md`. Start with `boxRoute`, `killRoute`,
`broadcastRoute`, `sessionRoute`'s run branch and `runPlan` in `tools/fleet/routes-actions.ts`,
`fanOut` and `run` in `tools/fleet/routes-broadcast.ts`, and the new ops, `progress` record and
nullable target in `tools/fleet/receipt-journal.ts`.

## What it is meant to do

The spec is `docs/plans/260910d-durable-action-receipts-for-the-fleet-dashboard.md` — § The receipt's
states, § Write-ahead, § The crash points and § Stage 3 are authoritative, and the Stage 2 review
record under § Stage 2 explains why the route is part of the fingerprint (do not re-file that). In one
paragraph: a keyed enacted run (a worktree removal, a session kill, a box kill) or broadcast is looked
up before any current-execution check and replayed rather than re-run; `accepted` lands before the
first `await`, `attempted` before `runPlan` or the first recipient, a `progress` record per completed
step; a crash mid-plan comes back `outcome-unknown` with the steps known to have completed; a
broadcast has one parent receipt and a child per recipient; the queued half carries the queue's
`durable` bit through (Stage 1b review F36). **No automatic retry; a receipt never installs, extends or
ends a hold.** `FLEET_ACT_ENABLED` stays off on the box; everything is tested on fake `ActionIo`.

## What you may change

You may edit this worktree: fix what is inside Stage 3, each finding red-first with the test that
reproduces it; report anything wider. Do not commit or change the index or history. Do not edit
`send-coordinator.ts`, `steer.ts`, `server.ts`, `tools/overseer/` or `tools/fleet/web/`. List every
file you changed. My gate results are at `logs/dar-s3-gates.txt`.

## Attack it

Independently first. Find a sequence of requests, restarts, preview expiries, write failures and
frozen disks after which:

1. **an enacted plan runs twice** for one intention — a confirmed kill or worktree removal whose
   response was lost, re-posted before or after a restart, including when its preview no longer exists;
2. a plan step runs with no durable `attempted`, or a keyed run has an effect with no durable
   `accepted`;
3. a crash mid-plan reports more steps completed than completed, or fewer than it can prove without
   saying so;
4. a broadcast re-sends to a recipient after a crash or on a replay, or reports a recipient *queued*
   whose queued receipt is not durable, or a parent `completed` while a child is unknown;
5. a box-scoped receipt carries an invented session target, or a child has no parent link;
6. message text reaches the journal, a log line, a `progress` record or a replay body.

For each finding: an ID continuing from F40, severity (P0 data loss / exploitable security / service
broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design
risk; P3 prose), established or reasoned, (a) the input or mutation, (b) your change or the smallest
change. Refuse only on an established P0 or P1. End with one line: "land", "land with the fixes
above", or "rework".
