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
2. **Production behind dev.** After fetching `dev` and `main` into their explicit remote-tracking
   refs, take the oldest commit in `origin/main..origin/dev` by committer time. Older than 12
   hours is unhealthy. The same line says how long dev has been undeployable — since the last
   commit the readiness loop showed ready stopped counting — and a lower bound on how long its head
   has been red. Both replay `readinessVerdict` over the readiness store's records. An unreadable
   store is unknown; a head the loop has not reached yet is `unsettled`, which is not an input
   failure and leaves the check ok within the threshold.

Only records from the exact readiness runner path count, matching the deploy evidence boundary.

Each of the three states (`ok`, `unhealthy`, `unknown`) prints differently, and `unknown` — a
heartbeat that will not parse, a tmux that cannot be asked, a failed fetch, an unreadable readiness
record — never prints as `ok` ([silent-success.md](../reusable/silent-success.md)). A proved stale
pacer or excessive lag still alarms even if another input is unknown. Any state but `ok` makes the
run exit 1.

## Choices, and the simpler options passed over

- **No new alert channel.** The watchdog's verdict reaches the journal and the exit status and
  nowhere a person looks day to day; that is a known gap, written in the watchdog's header, and
  fixing it is separate work. This adds checks to the channel there is.
- **Commit times, not this box's reflog of `origin/dev`.** The reflog would say when dev moved here,
  which is closer to "how long has this waited", but it depends on how often something fetched. A
  long-lived branch merged today carries yesterday's commit times, so the lag can read high; it errs
  towards alarming, which is the direction we want.
- **"Undeployable since" is when the last ready commit stopped counting, not when it passed.**
  The first version measured from the pass, and GPT Sol showed what that gets wrong: a pass
  yesterday and a failure an hour ago do not make a day undeployable, and a 72-hour window holding
  one failure does not make 72 hours. So a ready commit counts until it fails a rerun or until the
  loop first runs another commit (dev has moved, since the loop only tests dev's head). With no
  ready commit in the window, the line says that and gives no duration. Sol's own fix reported only
  the current head's red interval; that is kept as a second figure, but alone it stays small while
  dev keeps moving and nothing is deployable for a day, which was the incident. An exact figure
  would need a history of when dev moved, which nothing keeps.
- **A head the loop has not reached is `unsettled`, not `unknown`.** The review made it unknown,
  which would have failed the watchdog for half an hour after every push. Only an input that could
  not be read makes the check unknown.
- **The watchdog fetches.** Without it, a stopped readiness loop (the only other fetcher of `dev`)
  leaves `origin/dev` frozen and the lag reads as zero. Explicit ref destinations also avoid a
  successful fetch that does not refresh the refs under a narrowed remote fetch mapping. Fetches
  retry once on failure; exhausted retries are `unknown`. The watchdog does not write FETCH_HEAD.
- **The unit file changes only in wording.** Git, tmux and the GitHub credential helper are already
  on the box; nothing new is installed.

## Status

Built and live-run on the box on 2026-10-08 (it reported production 20 hours behind, and the pacer
fresh). Reviewed by GPT Sol, which fixed four findings
([postmortem 261008c](../postmortems/261008c-partial-observations-do-not-prove-health-or-failure-duration.md));
the plan review was folded into that code review, since the brief was specific and the change is
one file of checks. Two of its readiness changes were revised afterwards, as above.
