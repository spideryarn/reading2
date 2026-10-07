# Plan review: `/tmp` at 7 days, the Overseer under systemd, compressed screenshots

You are reviewing a plan before anything is built. Findings only; do not edit files.

Read `docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md` (the plan), then
what it leans on: `docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md` (the
previous plan, its "Decided 2026-10-07" paragraph is the approval, and its Sol reviews explain why
box-tidy's `/tmp` step is report-only), `infra/hetzner/systemd/overseer.service`,
`infra/hetzner/provision.sh` (§ box services from about line 1395, the arming file near line 2273,
and the verify block), `scripts/overseer-activate.ts`, `scripts/overseer-watchdog.ts`,
`scripts/overseer-tools/tick.sh`, `scripts/overseer-tools/daemon-launch.sh`,
`tests/systemd-units.test.ts`, `scripts/prune-old-screenshots.ts`, `infra/hetzner/README.md`
(§ the rebuild sequence).

Context you cannot see from the repo: the box is Ubuntu 24.04, systemd 255, about twenty agent
sessions as one user (`greg`, uid 1000) with passwordless sudo. `/tmp` is on `/` (ext4, relatime),
150 GB in 824,000 top-level entries. Live tmux loops run scripts from
`/tmp/claude-1000/<project>/<session-id>/scratchpad/`. The tmux socket is
`/tmp/tmux-1000/default`, mtime 2026-08-31. `/etc/overseer.env` does not exist on this box. The
running daemon (tmux) has `OPENROUTER_API_KEY` in its environment and no `OVERSEER_JOBS_ENABLED`.
Infra here has a higher bar than app code: the job must not take down the dashboard, the daemon or
running sessions. The author tested `systemd-tmpfiles --clean` with a scratch config: an `e` line
for a child path keeps its own age inside a `D` parent in both directions, and an `x` line keeps a
socket.

Please look hardest at:

1. **The tmpfiles override.** Does `/etc/tmpfiles.d/tmp.conf` replace the packaged line as
   claimed? Is anything else in `/tmp` live for more than 7 days idle that the table misses (a
   Chrome profile under a long-lived MCP browser, a lock, a socket, a `docker` or `supabase` CLI
   file, Claude Code's own files outside the scratchpad)? Is the first manual `--clean` over 150 GB
   safe to run on a busy box? Does tmpfiles really not cross mount points, and does it follow
   symlinks?
2. **The restart settings.** Do `StartLimitIntervalSec=0`, `RestartSteps`, `RestartMaxDelaySec`
   behave as the plan says on systemd 255 (when does the step counter reset; does a failure to load
   `EnvironmentFile=` count as a start failure that `Restart=always` retries)? Is the transient-unit
   test faithful to the real unit, and does it see red?
3. **The secret.** Is a root 0600 `EnvironmentFile` without `-` the right call? Any way the copy or
   the checks print the value (`systemctl show -p Environment` does not show EnvironmentFile
   contents, but check)? Anything the key can leak through: `/proc/<pid>/environ` is readable by
   the same user, which is every agent; is that a regression from the tmux daemon, which has the
   same?
4. **The cut-over steps** for the Overseer: in the right order, and does `overseer-activate.ts
   --apply --disarm` do what the plan says when `/etc/overseer.env` is missing?
5. **The screenshot gate.** Is a vitest test the right mechanism, given commits use
   `git commit -- <paths>`? Will it break anyone (the primary checkout has untracked PNGs from other
   agents)? Is the `tEXt` marker sound, and does pngquant `--strip` or a later recompression lose
   it? Is `--quality=70-95` safe for text?
6. **A simpler version** of any of the three that gives nearly the same.

Number each finding, give it P0/P1/P2 and a file and line, and end with a one-line verdict.
