# The Overseer's working scripts

Small shell and node scripts the Overseer session runs by hand or in a tmux loop. They lived in
its `/tmp` scratchpad until 2026-10-07, where a reboot would have lost them. The runbook that says
when each is used is [docs/project/overseer.md](../../docs/project/overseer.md).

All of them run against the **primary checkout**, `~/code/spideryarn2`. The ones that read or write
working files (briefs, `reports.txt`, `pause-state.md`, sweep debriefs) need `OVERSEER_SCRATCH` set
to the directory that holds them, and refuse to run without it:

```
export OVERSEER_SCRATCH=/path/to/the/overseer/working/directory
```

| Script | What it does |
| --- | --- |
| `standing-jobs.md` | Not a script: the exact text of the Overseer session's three scheduled jobs (pacer, 3-hourly check, daily renewal), to recreate after any restart. |
| `tick.sh` | The half-hourly tick's screen: `overseer.ts tick`, usage, the pause state, sessions stuck on a dialog or an API error, and whether the watchdog and tidy timers are running. |
| `queue-status.sh` | `fb*` sessions that are waiting or started, then memory, swap, load and free disk. |
| `release.sh SESSION...` | Ends a `gjd-remote --wait` early so Claude starts now, thirty seconds apart. |
| `mkq.cjs` | Writes the brief for a session taking items off the queue. |
| `mkfb.sh` | Writes the brief for a feedback-report session. |
| `daemon-launch.sh` | Starts the Overseer daemon in tmux with the OpenRouter key from `.env.local`; its header has the command. |
| `feedback-sweep-loop.sh` | One feedback sweep every three hours, as a `run-claude` job; the prompt is `prompt-feedback-sweep.md` beside it. |
| `dashboard-refresh-loop.sh` | Hourly: merge `origin/dev` into the primary and restart the fleet dashboard only if its inputs changed (`dashboard-refresh.sh`). |

Start a loop with `npx tsx scripts/tmux-job.ts`, so it has a log and a session name. **An `export`
in your shell does not reach a tmux job**, which gets the tmux server's environment, so put the
variable in the command:

```
npx tsx scripts/tmux-job.ts env OVERSEER_SCRATCH=/path/to/dir bash scripts/overseer-tools/feedback-sweep-loop.sh
```

None of the
loops survives a reboot; the list of what to restart afterwards is in
[infra/hetzner/README.md](../../infra/hetzner/README.md).

Disk tidying is not here. It is `infra/hetzner/box-tidy.mjs`, run hourly by `box-tidy.timer`.
