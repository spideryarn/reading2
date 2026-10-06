# Box disk hygiene as a timer, and a box we could rebuild

Up: [plans.md](../project/plans.md) · the box is
[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)

Greg, 2026-10-06:

> Yes, old screenshots (>1w) can be deleted - you have permission going forwards. Perhaps add this
> and other measures to keep the hard disk fullness down to some routine daemon/service
>
> And in general make sure we have this and everything else documented/scripted as appropriate so
> that we could easily rebuild this box pretty much the same way.

Two jobs on the Hetzner box. The first turns the disk tidying the Overseer does by hand, from a
script in `/tmp`, into a service. The second finds what is on the box and not in the files that
build the next one.

## What was found (2026-10-06, measured on the box)

**Disk.** `/home` is the 49 GB volume (53% used today, 100% on 2026-10-05); `/` is 301 GB (83%).

| What | Size today | What a tidy would free today |
| --- | --- | --- |
| `~/.codex/sessions` | 4.1 GB | 0.19 GB (57 files older than 7 days; the Overseer cleared the rest on 10-05) |
| primary checkout `logs/` | 341 MB | 0.10 GB (503 files older than 7 days) |
| `~/.npm` cache | 1.3 GB | 1.3 GB, only when `/home` is tight |
| Docker images | 11.1 GB, 13 of 14 in use | 26 kB (nothing dangling) |
| Docker volumes | 17.5 GB | never touched: the local database lives there |
| tracked images under `docs/` | 871 files, 145 MB per checkout, about 20 checkouts | stage 2 measures the week-old share |
| `~/.codex/thread_history_1.sqlite` | 2.2 GB | not covered by any permission; reported only |
| `~/.claude` | 5.9 GB | not covered (Greg excluded Claude's transcripts); reported only |

So today's box is not tight and a tidy frees little. The value is that it runs when nobody
remembers, and that the next fill is seen before it reaches 100%.

**The Overseer daemon died of the full disk and nothing noticed.** It stopped at 2026-10-05T00:18Z
with `ENOSPC` and was down 46 hours. It runs in tmux from a launch script in `/tmp`.
`overseer-watchdog.timer`, which checks its heartbeat every five minutes, is in `provision.sh` and
was never installed on this box, because **`provision.sh` last ran here on 2026-09-03**. Its verdict
would only have reached the journal anyway.

**The fleet dashboard already measures disk, but only `/`.** `tools/fleet/health.ts` runs `df -k /`
and raises *strained* at 90% and *critical* at 97% (`RESOURCE_POLICY.diskUsed`). The Overseer's tick
(`overseer.ts tick`, `cli-tick.ts`) and the launch gate read that verdict. `/home`, the disk that
fills, is not in it.

**Rebuild gaps** (a read-only audit by a subagent; the full table goes into the box doc in stage 3):
`gh` and `pngquant` installed by hand; the Overseer's working scripts and three tmux loops live only
in a `/tmp` scratchpad; `/etc/github-tokens` is on the disposable disk and the rebuild steps do not
say to restore it; `.env.prod`, the Vercel CLI login and the Stripe CLI have no written restore
step; `fleet-dashboard.service` is enabled on the box and left disabled by `provision.sh`;
`overseer.service` the reverse.

## Stage 1: the tidy service, and `/home` in the health verdict

**`scripts/box-tidy.ts`**, run by `box-tidy.timer` hourly (and two minutes after boot). Each step is
independent: one failing is logged and the rest still run. It prints to stdout, so the log is the
journal (`journalctl -u box-tidy`), which is on `/` and still writable when `/home` is full. A log
file under `/home` would fail at the moment it mattered. `--dry-run` prints what each step would
remove and deletes nothing.

Steps, in order, and whose words permit each ([overseer.md § Keeping `/home` from filling](../project/overseer.md#keeping-home-from-filling)):

1. **Codex transcripts** older than 7 days: `rollout-*.jsonl` under `~/.codex/sessions`, then the
   directories left empty. Always.
2. **Old job logs**: regular files older than 14 days under the primary checkout's `logs/`, then
   empty directories. Never a file a running process has open, and never the newest file of a
   `*.log` a loop is appending to (an appended file has a fresh mtime, so the age test covers it).
3. **Dead sessions' scratchpads**: a directory `/tmp/claude-<uid>/<project>/<session-id>` whose
   session id appears in no running process's command line **and** whose newest file is older than
   7 days. Both conditions, because the Overseer's own scratchpad is 28 days old and in daily use.
4. **npm cache**, only when `/home` is at or above 80%: `npm cache clean --force`.
5. **Docker**: `docker image prune -f` (dangling images only) and `docker builder prune -f`. Never
   `-a`, never `volume` or `system prune`. *Passed over:* `image prune -a`, which would also remove
   the Supabase images whenever the local stack happened to be stopped. That buys 11 GB once and a
   long re-pull for whoever starts the stack next, and `/` is not the disk in trouble.
6. **Worktrees: report only**, when either disk is at or above 80%. Runs the existing
   `worktree:sweep` classification (read-only) and prints its verdicts for the Overseer. Removal
   stays `worktree:check` plus `worktree:remove`, by a session.
7. **A closing line** with both disks before and after, and the bytes each step freed.

The planning (which paths, given a listing and a clock) is pure functions, tested with a temporary
directory; the test for each step is seen red first. The unit is a system unit with `User=@USER@`,
like the others, installed and enabled by `provision.sh`, with the readable copy under
`infra/hetzner/systemd/` and `tests/systemd-units.test.ts` holding the two copies equal. On this box
the unit is installed with the same commands `provision.sh` runs for it, not by running
`provision.sh`.

**The alert uses the channel that exists.** `health.ts` runs `df -k / /home` and the verdict names
whichever mount crosses a threshold (`/home is 91% full`). That reaches the dashboard's Box health
strip, the Overseer's tick and the launch gate with no new mechanism. `/home` absent (a laptop) is
one mount, not an error. *Passed over:* a status file of its own written by the tidy timer; it would
be a second reading of the same number, an hour stale.

**The daemon that stopped.** Three small things here, and one proposal for Greg:

- `scripts/overseer-daemon-launch.sh` in the repo: the `/tmp` launch script, unchanged in behaviour
  (reads `OPENROUTER_API_KEY` from `.env.local`, refuses without it, never prints it).
- Install `overseer-watchdog.timer` on this box with the commands `provision.sh` already has for it.
  It is a read-only check every five minutes.
- The Overseer's tick status script (stage 3 moves it into the repo) prints the watchdog's last
  result and the tidy timer's last run, so a stopped daemon is seen at the next half-hourly tick.
  **That is what would have alerted within the hour.**
- **For Greg, not built:** run the daemon under `overseer.service` with
  `EnvironmentFile=/etc/overseer-secrets.env` (root-owned, mode 0600, holding the one key).
  `Restart=always` would then have restarted it as soon as there was room. It involves a secret, so
  it is his yes.

## Stage 2: old screenshots, as a script the Overseer runs

**`scripts/prune-old-screenshots.ts`**. Lists tracked image files (`png jpg jpeg webp gif`) under
the five dated folders (`docs/plans`, `investigations`, `postmortems`, `research`, `user-feedback`)
whose **last commit** is more than 7 days old. Not `docs/project`, `docs/tutorials` or
`docs/reusable`, whose images are part of a living page. With no flag it prints the list and the
bytes. With `--apply` it deletes them and makes one commit by name with the house recipe
(`git commit -F <msg> --pathspec-from-file=<list>`); it refuses if any of those paths has
uncommitted changes, and it does not push. A daemon must not commit in the shared checkout, so this
is the Overseer's to run, weekly or when the disk is tight; `overseer.md` gets the line. Links to a
deleted image go dead, which Greg accepted.

It is run once for real in this job's worktree, as the test that it works.

**For Greg, not built: keep new screenshots out of git at all.** The files stay in history for ever,
so the pack (398 MB today) grows by every screenshot ever committed, in every clone. The question
and a recommendation go in the debrief.

## Stage 3: the rebuild gaps

- **`provision.sh`**: `gh` from GitHub's apt repository and `pngquant`, each with a line in the
  verify block; the `box-tidy` units from stage 1.
- **The Overseer's tooling into `scripts/overseer-tools/`**: `queue-status.sh`, `release.sh`,
  `mkq.cjs`, `mkfb.sh`, plus the scripts behind the two loops that are running now
  (`feedback-sweep-loop.sh`, `ov-dashboard-refresh.sh` and its loop). The hard-coded scratchpad path
  becomes `OVERSEER_SCRATCH`. `queue-status.sh` loses its own Codex delete, which is step 1 above.
  A line each in `overseer.md`.
- **A rebuild checklist** in `infra/hetzner/README.md`'s rebuilding section, signposted from the box
  doc: every step that needs a secret, a browser or Greg, in order, with where each secret lives and
  how it comes back, by name and never by value. It includes the things a reboot loses today: the
  daemon, the three tmux loops, the VNC stack.
- **Written down, not changed:** this box has not been provisioned since 2026-09-03 and what a
  re-run would change (`overseer.service` enabled, both unit files refreshed, the second swap file
  left alone); `~/gjd-remote/sessions.mjs` exists only on the volume; the stale token backup file
  and two stale credential copies in `~`, which are Greg's to delete.

## What done looks like

`npm test` and `npm run typecheck` green; `systemctl list-timers` shows `box-tidy.timer` and
`overseer-watchdog.timer` on this box; `journalctl -u box-tidy` shows one real run; the health
verdict names `/home`; a Sol code review per stage; pushed to `dev`; nothing deployed and neither
the dashboard nor the daemon restarted by this job. The dashboard picks up the `/home` reading at
its next restart, which is the Overseer's.

## Log

- 2026-10-06: surveyed, measured, plan written.
