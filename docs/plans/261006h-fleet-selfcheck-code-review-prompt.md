# Code review: the fleet collector's this-box check under systemd

You are the stage's reviewer **and fixer**. You may edit files in this worktree. Fix what is inside
this stage, narrowly, with a failing test seen red first for any defect. Report, do not fix, anything
wider. Do not commit, and do not touch `infra/`. Do not attribute any words to Greg in anything you
write: quote him only if the exact sentence is already in the tree.

## The candidate

Committed: exactly one commit, `24c9ed141`, on top of `f85c64777`.

    git show --stat 24c9ed141
    git diff f85c64777 24c9ed141

Changed paths (complete): `tools/fleet/collect.ts`, `tools/fleet/wire.ts`, `tools/fleet/state.ts`,
`tools/fleet/web/src/types.ts`, `scripts/fleet-collect-bench.ts`, `tests/fleet-collect.test.ts`,
eight one-line fixture edits in `tests/fleet-{drain,health-wiring,producer-stamp,quarantine,questions,receipt-restart,refresh}.test.ts`
and `tests/overseer-daemon-ordering.test.ts`, and three files under `docs/plans/261006h-*`.

Start with `tools/fleet/collect.ts` (`selfCheck`, `socketAnchor`, `tmuxSocketPath`, `panes`,
`collect`, `snapshotFrom`) and its call sites: `tools/fleet/server.ts` (the `collect(fleetProbeOwner)`
call, `refresh`, `statePayload`), `tools/fleet/refresh.ts`, `tools/fleet/state.ts`, and every reader
of `FleetSnapshot`. That list does not limit scope.

The plan is `docs/plans/261006h-fleet-selfcheck-gets-an-anchor-that-works-under-systemd.md`; your
own plan review is beside it, and its Log section records what was built and the live evidence.
**Read the Log as a reviewer of its conclusions, not only of the code.**

The dashboard is on a higher robustness bar than the rest of the repo
(`docs/project/overseer-direction.md`). The change turns a production path that never refused into
one that can.

## What to do

1. Attack the change independently.
2. Run `npx vitest run tests/fleet-collect.test.ts` yourself (it needs nothing outside the tree) and
   say what you saw. You have no network and should not talk to a tmux server.
3. Check that F1–F6 from the plan review are each actually closed in the code, by ID.
4. Check the new comments and the plan against the code: any sentence that is not true of the
   code as committed is a finding.

Live evidence I ran and you cannot (raw output, from the service's own twelve environment variables
under `env -i`, real tmux 3.4):

    TMUX=undefined TMUX_PANE=undefined TMUX_TMPDIR=undefined INVOCATION_ID set=true
    listing: read, 12 sessions with a pane, tmuxServerPid=132280, socketPath="/tmp/tmux-1000/default"
    VERDICT: {"kind":"socket-matches","socketPath":"/tmp/tmux-1000/default"}

## Format

New findings are numbered from `F7` (F1–F6 are the plan review's). Severity:

| | |
|---|---|
| **P0** | data loss, exploitable security, or the dashboard broadly unusable |
| **P1** | wrong behaviour an operator would see, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | prose or comment defect |

Say for each whether it is established or reasoned, and whether you fixed it. End with a list of
every file you changed and one line: `VERDICT: ship` / `VERDICT: ship with my fixes` /
`VERDICT: do not ship (IDs)`. Refuse only on an established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: *on the production path, `absent` can only be
  returned when the tmux child really answered from a socket other than this user's default.*
- `TMUX=""` with `TMUX_PANE` set now takes the socket anchor where it used to be `cannot-check`.
- Whether any consumer restores or persists a `FleetSnapshot` that predates the `selfCheck` field.
