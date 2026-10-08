# 261008e — Watchdog alarms for a stopped pacer and production lagging dev

> Why haven't there been any deploys in 17h? … ideally improve so it's less likely to break going
> forwards, and update provisioning instructions accordingly.
>
> — Greg, 2026-10-08

## What broke

The Overseer session's queue pacer is a Claude Code scheduled job, and a recurring one is deleted 7
days after it is made. It expired on 2026-10-07 at 23:15 UTC. Nothing outside the session noticed,
so production went 17 hours undeployed while a red test sat on dev. The Overseer fixed the session
side the same day: [standing-jobs.md](../../scripts/overseer-tools/standing-jobs.md), a daily
renewal job, and a pacer tick that writes `~/.overseer/pacer-heartbeat`.

This plan is the alarm **outside** the session, so the next silent stop is noticed by something that
does not depend on the thing that stopped.

## What we're doing

Two more checks in [`scripts/overseer-watchdog.ts`](../../scripts/overseer-watchdog.ts), which
`overseer-watchdog.timer` already runs every five minutes. Same channel as its daemon check: one line
each in `journalctl -u overseer-watchdog`, and a non-zero exit, which `tick.sh` and
`systemctl is-failed` show.

1. **Pacer heartbeat.** `~/.overseer/pacer-heartbeat` older than 90 minutes (the pacer runs at :12
   and :37, so that is three missed ticks), or missing while a tmux session holds the Overseer claim
   (`GJD_ROLE=overseer`), is unhealthy, and the line says what to do: recreate the jobs from
   standing-jobs.md.
2. **Production behind dev.** After a `git fetch origin dev main`, the oldest commit in
   `origin/main..origin/dev` by committer time. Older than 12 hours is unhealthy. The same line says
   how long dev has been undeployable: the time since the readiness loop last showed any dev commit
   ready, computed by the existing `readinessVerdict` over the readiness store's own reader, not by
   parsing logs.

Each of the three states (`ok`, `unhealthy`, `unknown`) prints differently, and `unknown` — a
heartbeat that will not parse, a tmux that cannot be asked, a failed fetch, an unreadable readiness
record — never prints as `ok` ([silent-success.md](../reusable/silent-success.md)). Any state but
`ok` makes the run exit 1.

## Choices, and the simpler options passed over

- **No new alert channel.** The watchdog's verdict reaches the journal and the exit status and
  nowhere a person looks day to day; that is a known gap, written in the watchdog's header, and
  fixing it is separate work. This adds checks to the channel there is.
- **Commit times, not this box's reflog of `origin/dev`.** The reflog would say when dev moved here,
  which is closer to "how long has this waited", but it depends on how often something fetched. A
  long-lived branch merged today carries yesterday's commit times, so the lag can read high; it errs
  towards alarming, which is the direction we want.
- **"Undeployable" is time since the last ready commit, not time since the first failure.** It needs
  no new definition of red: `readinessVerdict` already says what ready means, and a loop that has
  stopped running reads as undeployable too, which is true.
- **The watchdog fetches.** Without it, a stopped readiness loop (the only other fetcher of `dev`)
  leaves `origin/dev` frozen and the lag reads as zero. A fetch that fails is `unknown`.
- **The unit file changes only in wording.** Git, tmux and the GitHub credential helper are already
  on the box; nothing new is installed.

## Status

Built in this plan's commit; reviewed by GPT Sol (the plan review was folded into the code review,
since the brief was specific and the change is one file of checks).
