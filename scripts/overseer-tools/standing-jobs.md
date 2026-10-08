# The Overseer's standing scheduled jobs

The Overseer session's recurring prompts: the queue pacer, the 3-hourly check and the renewal
that keeps both alive. They are Claude Code scheduled jobs (`CronCreate`), so they are **session
memory only**. They vanish when the session exits, and **a recurring job is deleted 7 days after it
was created**. That second fact is what stopped them on the night of 2026-10-07/08: the pacer made
on 2026-09-30 expired at 23:15 UTC, and production went 17 hours without a deploy. Greg,
2026-10-08: *"Why haven't there been any deploys in 17h?"*

**So the renewal job deletes and recreates all three every day, itself included.** No job is ever
older than a day. After any restart of the Overseer session, create the three below by hand,
exactly as written. `CronList` should then show three jobs. A tick also checks that
`~/.overseer/pacer-heartbeat` is fresh, and the watchdog alerts when it is not (see overseer.md).

`$SP` below is the Overseer's scratch directory; set it to the current session's scratchpad path.

## 1. Queue pacer, cron `12,37 * * * *`

```
Queue pacer (Greg, 2026-09-30: "yes, ideally bring the queue forward - but use your judgment and adapt if you notice problems"; "Let's not stress tooooo much about Codex usage limits…"; and 2026-10-01: "just keep on ploughing through it all, proceeding autonomously as per docs/reusable/engineering-manager.md gates etc, at whatever pace is sustainable. I'll check in to see how things are going every day or so."). First `date -u +%FT%TZ > ~/.overseer/pacer-heartbeat`. Run $SP/queue-status.sh (SP=<scratch dir>). 1) Close finished sessions: idle, with a final debrief saying the work landed on dev and the worktree was removed (check the pane; if the worktree still exists, run worktree:check first; never kill one mid-work or holding unpushed work). Collect any decisions a debrief leaves for Greg into one batched message, each with a recommendation. 2) Count the working Claude sessions (ignore codex/tmux-job helpers like *-plan-review-*, *-code-review-*, *-fullsuite-*, *-full-*, *-suite-*, *-sol-*). If fewer than 6, release the soonest waiting ones with $SP/release.sh NAME, at most 2 per tick, prioritising by a combination of ease and value, and only if memory available is at least 9 GB, swap used is under 24 GB, and the 1-minute load is under 20. Codex is not a gate unless its weekly usage reaches 95% or a session reports a Codex rate-limit refusal — Sol running out stops work, never Luna. If a gate fails, hold, and say why in one line. 3) Readiness: if the readiness loop's last two outcomes are both fail, dispatch the fix now (overseer.md § Deploying step 5). 4) Stay silent unless you released, closed, held or dispatched something; then one short line.
```

## 2. The 3-hourly check, cron `17 */3 * * *`

```
Overseer 3-hourly check. A) FEEDBACK: new Feedback reports since the last check (Sentry org greg-detre, issue.category:feedback, unresolved; and the feedback-sweep loop's latest debrief). Skip any already covered by a session (grep ~/gjd-remote/prompts for the short id). Delegate the rest per docs/project/feedback-reports.md. B) DEPLOY per docs/project/overseer.md § Deploying: if origin/main..origin/dev holds finished, reviewed work, prepare the notes and deploy (`--ready` when the loop has a green commit carrying the notes, else plain), then verify. Production should not lag dev by more than about six hours of finished work. C) Tell Greg in plain words what went where and what was deployed; one line if nothing new.
```

## 3. Renewal, cron `43 6 * * *`

```
Overseer renewal of the standing scheduled jobs (recurring jobs expire after 7 days). Read scripts/overseer-tools/standing-jobs.md. CronList; CronDelete every job whose prompt starts "Queue pacer", "Overseer 3-hourly check" or "Overseer renewal"; then CronCreate the three from that file, exactly as written, with $SP filled in. CronList again and confirm three. One line.
```
