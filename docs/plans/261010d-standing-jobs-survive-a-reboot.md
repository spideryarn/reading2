# The box's repeating jobs survive a reboot

> In an ideal world, I think probably we'd make sure those repeating jobs are pretty robust so that
> even if we reboot the server or if they, you know, we run out of memory, or even if we reprovision
> the server, we can be sure that they'll exist. And perhaps the best thing would be, you know, if
> they don't have anything to report, that they don't—maybe they don't need to actually inject
> anything into the overseer's context. […] They'd probably also report on box health, so hard disk
> space, RAM, swap, CPU load. […] something just added it, I think, to your Claude session in a
> loop. But that's not as good. We want this to be something that's permanent and robust.
>
> — Greg, 2026-10-09, report `spya-q2qb7q` (#523), queue item `qi-vyxxb5k8`

**Status:** built on `dev`, 2026-10-10, **not yet installed on the box** — that is the Overseer's
step, § Install. Orchestrator work, so the middle robustness tier
([overseer-direction.md § A higher bar](../project/overseer-direction.md#a-higher-bar-for-robustness-here-than-elsewhere-and-its-ceiling)).
Plan review by GPT Sol: [261010d-plan-review-sol.md](261010d-plan-review-sol.md) (REWORK; every
finding is answered in § What the plan review changed). Code review: below.

## What already ran, and what survived what (read 2026-10-10 01:40 BST on the box)

Greg suspected some of this existed. Some did — but not the jobs he named.

| job | ran as | reboot | OOM kill | rebuilt box |
|---|---|---|---|---|
| Overseer daemon (records the fleet; its scheduler is **off**, `OVERSEER_JOBS_ENABLED=0`, both pins stale) | `overseer.service`, `Restart=always` | yes | yes | unit yes¹ |
| Overseer watchdog — daemon, pacer heartbeat, prod lag, every 5 min | `overseer-watchdog.timer` | yes | yes | unit yes¹ |
| Disk tidy, hourly; `/tmp` ages out after 7 days | `box-tidy.timer`; `tmpfiles.d` | yes | yes | yes |
| Fleet dashboard, which also **collects box health** every minute (`tools/fleet/health.ts`) | `fleet-dashboard.service`, enabled by hand | yes | yes | **no**: provisioning installed it disabled |
| Queue pacer, 3-hourly check, daily renewal (+ the worktree sweep since `64741d2c0`) | Overseer **session** `CronCreate` | no | no | no |
| Feedback sweep, every 3 h, Claude Opus via `run-claude` | tmux loop running an **old `/tmp` copy** of `scripts/overseer-tools/feedback-sweep-loop.sh` | no | no | no |
| Dashboard refresh, hourly: merge `origin/dev` into the primary, restart the dashboard if its inputs changed | tmux loop running an old `/tmp` copy of `dashboard-refresh.sh` | no | no | no |
| Readiness loop (dev's tests, for deploys) | tmux loop, entrypoint in the `readiness-checks` worktree | no | no | no |
| **Telling anyone** that health went bad, or that a timer failed | nothing: a dashboard tile, the Overseer's hand-run `tick.sh`, the launch gate, the journal | — | — | — |

¹ The unit comes back; the job works only once the checkout, its `node_modules`, the secrets and the
logins are restored too — § A rebuilt box.

So the permanent half was the daemon, the watchdog and the tidy. **Everything Greg named — the
worktree sweep, the feedback sweep, box-health reporting — was not**, and box health was measured
well but delivered nowhere: the watchdog's own plan says its verdict reaches "the journal and the
exit status and nowhere a person looks day to day"
([261008g](261008g-watchdog-alarms-for-a-stopped-pacer-and-production-lagging-dev.md)).

## What this builds

Four systemd timers, in the shape `box-tidy` and `overseer-watchdog` already have: a **system unit
with `User=@USER@`** (a user unit does not start at boot without lingering), `Type=oneshot`, no
`Restart=`, only the timer enabled, the readable copy under `infra/hetzner/systemd/`, the heredoc in
`provision.sh`, `tests/systemd-units.test.ts` holding the two equal. That shape answers all three of
Greg's cases: a reboot (`timers.target`), an OOM kill (a oneshot that dies is run again at the next
tick; there is nothing to restart), a rebuilt box (`provision.sh` installs and enables them).

| unit | when | what | tells the Overseer |
|---|---|---|---|
| `box-health` | every 10 min | `scripts/box-health.ts`: the dashboard's own `collectHealth` and `RESOURCE_POLICY`, plus `systemctl is-failed` over the box's units | when its alarm set changes; daily while one lasts |
| `worktree-sweep` | daily 06:30, `Persistent=true` | `scripts/worktree-sweep-daily.ts`: `classifyAll` + `removeAll`, i.e. `worktree:sweep --remove` | only trees somebody must judge |
| `dashboard-refresh` | hourly | `scripts/overseer-tools/dashboard-refresh.sh`, the checked-in body, hardened | never itself; a failed run is a `failed` unit, which box-health says |
| `feedback-sweep` | 3 h after the last ended | `scripts/overseer-tools/feedback-sweep-once.sh`: one sweep, the loop's body | a failed run, the same way. **Installed, not enabled: Greg's question** |

### box-health measures nothing of its own

The dashboard already collects load, memory, swap, swap movement, `/` and `/home` against cutoffs
kept in one place (`tools/fleet/resource-policy.ts`). box-health calls the same `collectHealth` and
reads the same verdict; what was missing was delivery. **What counts as an alarm** is a choice made
on evidence: over the dashboard's own history, 2026-10-02 to 10-10, 7,446 of 9,886 samples were
`strained` (nearly all "actively swapping") and the level changed 2,586 times, so `strained` is not
an alarm. `critical` (40 samples in eight days) and `unknown` are; so is either disk at the policy's
`strained` cutoff, because a disk fills one way and does not flap; so is any of the box's units in
`failed` — `overseer`, `fleet-dashboard`, `overseer-watchdog`, `box-tidy`, `worktree-sweep`,
`dashboard-refresh`, `feedback-sweep`. That last makes box-health **the one path by which every job
reports a failure**, and closes the watchdog's journal-only gap without a second notifier.

**Change-only.** The alarm is a set of keys. A key not in the last message is said at once; a
smaller or empty set only after three runs in a row (half an hour), so a flapping reading is one
message; an unchanged set once a day. Nothing alarming and nothing said: silence. The journal gets
a line every run.

### How a job tells the Overseer, exactly once

Through the dashboard's one audited write path, `POST /api/steer/message`, the same route
`gjd-remote tell-overseer` uses: `overseerTarget` picks the row, every pane check stays on the
server. `scripts/box-notify.ts` calls it with `fetch` on 127.0.0.1.

**A fourth speaker, `box`**, whose prefix says *"A scheduled job on the box — not Greg, not a
session"*. It is accepted on the message route only (`parseMessageSpeaker`); queued actions and
broadcasts keep `parseSpeaker` and refuse it. The receipt journal's and the browser's speaker lists
are now `Record<Speaker, true>`, so a fifth speaker does not compile until both are told.

**Every message carries a `requestId`**, and an uncertain post is retried with the same envelope,
which the dashboard answers from its receipt rather than typing again. box-health writes the
envelope into its state file *before* posting, so a run killed in between leaves it for the next
run; the sweep, which runs daily, retries within its run. The route checks an unknown id only
within an hour of minting, so after that the answer is *abandoned* and the message is never resent.

### The sweep's in-use trees

As the renewal job had it, a tree "in use … that no live session owns" is for the Overseer. A tree
whose lock names a live Claude session is owned and silent; one held only by processes — a dev
server or job a finished session left — is said once, on the second daily sweep in a row that
finds it. The readiness loop's tree is such a tree, permanently: one message, ever.

## What the plan review changed

GPT Sol's verdict on the first plan was REWORK. Each finding, and what became of it:

1. **P0, `box` would be refused at the receipt journal**, which has its own speaker list. Fixed, and
   both lists made exhaustive; an end-to-end test drives a `box` message through the real journal
   and was watched failing with the old list.
2. **The feedback sweep was left out.** Built: one sweep per run, a timer, the same body the loop now
   calls. **Enabling it waits for Greg**, because the brief for this work names a job that runs
   Claude unattended on a schedule as his decision; Sol's view, that it only makes durable a spend
   he already approved, is the recommendation in the question.
3. **The dashboard already measured health; the plan invented a second policy.** Dropped mine;
   box-health reuses `collectHealth` and `RESOURCE_POLICY`.
4. **"Survives a rebuilt box" was overstated.** The table now says unit versus working; provisioning
   now enables `fleet-dashboard.service` (the alarms go through it, and the tmux dashboard that kept
   it disabled is long gone); § A rebuilt box lists what is still by hand.
5. **Recording "uncertain" as sent could lose an alarm or type it twice.** Request ids and the
   write-before-post, above.
6. **dashboard-refresh failed silently.** Every failure now exits 1; a failed `npm install` stops the
   restart; the fetch names its ref; the refresh and the sweep share a `flock` on
   `~/.overseer/primary-checkout.lock`. Not taken: refusing any dirty primary — the primary always
   carries peers' uncommitted work, so that would stop the refresh for good, and `git merge` already
   refuses to overwrite it. Not taken: `FETCH_HEAD`, which a peer's fetch in the same `.git` can
   overwrite; the explicit refspec is the watchdog's own answer.
7. **The checkout model.** Network ordering added; the red-dev risk is the existing units' accepted
   risk, now written in § Residuals. Not taken: a bounded retry for a sweep killed mid-run — a
   missed day costs a day's disk, which box-health watches.
8. **Silently dropping in-use trees.** Fixed, above.
9. **Six-hourly reminders.** Daily now.
10. **Inventory facts.** Corrected in the table: the scripts were already checked in (the loops run
    stale `/tmp` copies), `/tmp` is tidied, and the daemon also has a rules-only path.

## Not built here, and why

- **The readiness loop** stays a tmux job for the reasons in
  [260909f](260909f-readiness-checks-recorded-and-run-periodically.md). A reboot-surviving form is
  queued, not built.
- **The Overseer session itself, and its crons.** The pacer and the 3-hourly check are judgement,
  which is what the session is for; the watchdog alarms when the pacer stops, and box-health now
  carries that to the Overseer. **After a reboot nothing restarts the Overseer session**: that is
  step 9 of the rebuild sequence in infra/hetzner/README.md, by hand, and stays so.

## Simpler options passed over

- **The Overseer daemon's scheduler.** It survives reboots and has a deterministic rules path; but
  it is disarmed by a switch whose purpose is stopping paid work at 3am, and a disk alarm must not
  stop with it. Systemd keeps each job independent of the daemon it might be reporting on.
- **One timer for everything.** One failure would hide the rest, and the cadences differ.
- **A file the Overseer polls.** Needs a session cron to poll it: the thing Greg asked to get away from.

## Residuals, stated

- **The units run the primary checkout's code**, as `overseer.service` and the watchdog do: a red or
  half-merged dev can break a run. It shows as a `failed` unit, which box-health reports — unless
  box-health itself is what broke, which its own journal shows and nothing else does.
- **box-health depends on the dashboard to deliver.** If the dashboard is down the alarm cannot
  reach the Overseer; box-health exits 1 every ten minutes and its journal says why. An off-box
  alarm (A27 in overseer-direction.md) is still open.
- **The steer route refuses an Overseer started as `claude --resume Overseer`.** It verifies the pane
  by the conversation uuid in Claude's argv, and a resume by name carries none: measured
  2026-10-10 03:00, every `tell-overseer` answered `no-claude-in-pane`. While the Overseer runs that
  way, box-health's messages are `not-sent`, retried each run, and its unit exits 1 — loud in the
  journal, silent in the Overseer's pane. Starting the Overseer with `--resume <uuid>` (or
  `--session-id`) restores the channel.
- **An abandoned message is assumed delivered**: one that truly never arrived is lost, and the next
  change or the daily reminder says it again.

## A rebuilt box

`provision.sh` installs all eight units and enables three timers for the next boot (and now the
dashboard). What it cannot restore, and each job needs: the primary checkout and its `node_modules`
(all four), GitHub credentials in `/etc/github-tokens` (the sweep's and the refresh's fetch),
`/etc/overseer-secrets.env` (the daemon), and the Claude login with its Sentry MCP sign-in in
`~/.claude` (the feedback sweep). `/home` is the persistent volume, so on a rebuilt *server* the
last three survive; on a new volume they are steps 5 to 9 of infra/hetzner/README.md.

## Install — the Overseer's step, once this is on `dev`

The primary must carry these files first: the hourly refresh merges them, or `git merge origin/dev`
there by hand. Then:

```
cd /home/greg/code/spideryarn2
for u in box-health worktree-sweep dashboard-refresh feedback-sweep; do for x in service timer; do
  sudo install -m 0644 -o root -g root <(sed 's/@USER@/greg/g' infra/hetzner/systemd/$u.$x) /etc/systemd/system/$u.$x
done; done
sudo systemctl daemon-reload
# The dashboard must be restarted onto the `box` speaker before box-health can be heard.
sudo systemctl restart fleet-dashboard    # or let the refresh do it: tools/ changed
# The tmux loop the refresh timer replaces: stop it first, never run both.
tmux kill-session -t dashboard-hourly-refresh-1401-2497753; tmux ls | grep -c dashboard-refresh   # 0
sudo systemctl enable --now box-health.timer worktree-sweep.timer dashboard-refresh.timer
systemctl list-timers box-health.timer worktree-sweep.timer dashboard-refresh.timer
sudo systemctl start box-health.service; journalctl -u box-health -n 5 --no-pager
sudo systemctl start dashboard-refresh.service; journalctl -u dashboard-refresh -n 10 --no-pager
```

The sweep's first run is 06:30; to see one sooner, `sudo -u greg /home/greg/code/spideryarn2/node_modules/.bin/tsx scripts/worktree-sweep-daily.ts --dry-run`
from the primary. **`feedback-sweep.timer` is not enabled here**: on Greg's yes, kill the
`feedback-sweep-loop4` tmux session *between* sweeps (its log's last line is an `exit=` line) and
`sudo systemctl enable --now feedback-sweep.timer`, which starts one sweep at once.

The renewal job in `scripts/overseer-tools/standing-jobs.md` skips its worktree sweep once
`systemctl is-enabled worktree-sweep.timer` says `enabled`.
