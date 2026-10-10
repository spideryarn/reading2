You are reviewing a PLAN (not code) in the Spideryarn repo, read-only. The plan: docs/plans/261010d-standing-jobs-survive-a-reboot.md. Read it first.

Context: the always-on Hetzner box runs an agent fleet. Greg (owner) asked that repeating jobs (daily worktree sweep, 3-hourly feedback sweep, box health: disk/RAM/swap/load) be permanent and robust — survive reboot, OOM kill, reprovisioning — deterministic and silent unless they need the Overseer's judgement. This is the orchestrator's middle robustness tier (docs/project/overseer-direction.md § A higher bar). Agents cannot sudo; installing units is the Overseer's step.

Read the prior work the plan builds on and check the plan against it:
- infra/hetzner/systemd/* (box-tidy, overseer-watchdog, overseer units) and infra/hetzner/provision.sh, tests/systemd-units.test.ts
- docs/project/cron-scheduler.md, docs/project/hetzner-remote-server-box.md § The box's own services
- scripts/overseer-tools/standing-jobs.md
- scripts/worktree-sweep.ts (classifyAll, removeAll), scripts/worktree-remove.ts, scripts/worktree-inuse.ts
- scripts/gjd-remote-tell.ts, scripts/gjd-remote.ts cmdTell, tools/fleet/routes-steer.ts (parseSpeaker, message route), tools/fleet/actions.ts SPEAKER_PREFIX, tools/fleet/wire.ts Speaker, tools/fleet/notify-overseer.ts
- scripts/overseer-watchdog.ts
- The dashboard-refresh loop body is at /tmp/claude-1000/-home-greg-code-spideryarn2/606cb12a-ffc5-4df4-af3a-7dc881135b5f/scratchpad/ov-dashboard-refresh.sh (and ov-dashboard-refresh-loop.sh next to it)

Questions to answer, with file:line evidence:
1. Is the inventory table accurate? Anything already running that it misses or misstates?
2. Is the design sound for the three failure cases (reboot, OOM, reprovision)? Any hole — e.g. a timer running primary-checkout code while dev is red; the worktree sweep run as a systemd unit seeing liveness/in-use differently than an interactive run (box-tidy needed AmbientCapabilities to read /proc; lock semantics when the caller is no session); HOME/PATH; credentials for the fetch the sweep does?
3. The new `box` speaker on the steer route: is adding it to Speaker / SPEAKER_PREFIX / parseSpeaker correct and complete (what else switches on Speaker — exhaustive Records, the web client, the recent feed, drain, quarantine)? Does the route accept a message to a `working` Overseer? Message length and one-line limits?
4. Delivery semantics (sent / refused-then-retry / uncertain-recorded) — right? Any duplicate-typing risk?
5. Box-health thresholds and the change-only plus 6-hour-reminder policy — sensible? Simpler?
6. Moving dashboard-refresh into systemd: any trap (npm install, merging in the primary from a unit, fleet-restart.ts needing tmux or a TTY, overlap with the tmux loop)?
7. Anything simpler that gives Greg the same robustness?

Write findings numbered, each with severity (P0 blocker / P1 should fix / P2 nice), evidence, and the fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
