# Plan review: the fleet collector's this-box check under systemd

You are reviewing a **plan**, read-only. Do not change any file.

## The candidate

A live, uncommitted candidate in this worktree. Base: the commit `HEAD` names. One untracked file:

- `docs/plans/261006h-fleet-selfcheck-gets-an-anchor-that-works-under-systemd.md` — the plan.

Read it, then the code it is about. Start with these; they do not limit scope:

- `tools/fleet/collect.ts` — `panes`, `PaneListing`, `tmuxServerPid`, `selfCheck`, `collect`,
  `FleetSnapshot`, `snapshotFrom`.
- `tools/fleet/state.ts`, `tools/fleet/wire.ts`, `tools/fleet/server.ts` (`statePayload`, `refresh`,
  `lastError`), `tools/fleet/refresh.ts`.
- `tools/fleet/web/src/types.ts` — the page's parser of `/api/state`.
- `tests/fleet-collect.test.ts` — the `selfCheck` tests and the source-text guards.
- `docs/postmortems/260910b-a-later-check-reads-an-earlier-fallback-as-evidence.md`.
- `infra/hetzner/systemd/fleet-dashboard.service`.
- Other callers of `collect(`, `panes(` and readers of `list-panes` output: grep for them, including
  `scripts/fleet-collect-bench.ts`.

The dashboard is held to a higher robustness bar than the rest of the repo
(`docs/project/overseer-direction.md`): it is what people look at when something else is broken.

## What to do

Attack the plan independently first. In particular, say whether each of these statements in it is
**accurate**:

1. "A process outside tmux reaches tmux through `${TMUX_TMPDIR:-/tmp}/tmux-<uid>/default`", for
   tmux 3.4 on Linux, and whether `#{socket_path}` prints that path in a form `realpath` makes
   comparable.
2. "Under tmux, nothing changes."
3. "Once the listed socket path equals the expected one the pid reported on that socket is that
   server's by construction."
4. That adding a fifth field to the `list-panes` format cannot disturb any existing parser of that
   output.
5. That adding a required `selfCheck` field to the served state cannot break the page's parser or
   any other consumer of `/api/state`.

Then: what does the plan miss, what would you cut, and is one stage the right size?

You have no network and no tmux server you should talk to. Reason from the source and from tmux's
documented behaviour, and say which findings are established and which are reasoned.

## Format

Give every finding an ID `F1`, `F2`, … and a severity:

| | |
|---|---|
| **P0** | data loss, exploitable security, or the dashboard broadly unusable |
| **P1** | wrong behaviour an operator would see, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | prose or comment defect |

End with one line: `VERDICT: build as written` / `VERDICT: build with changes (list the IDs)` /
`VERDICT: do not build`. Refuse only on an established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: *the new `absent` arm cannot fire in
  production unless the listing really came from another socket.*
- Whether logging on error **change** belongs in this stage or is scope creep.
