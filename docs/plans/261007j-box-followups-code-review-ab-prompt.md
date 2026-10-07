# Code review: `/tmp` at 7 days, and the Overseer unit (stages A and B)

You are reviewing commit `e5c28bf09` in this worktree (`git show e5c28bf09`), built from the plan
`docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md`, which you reviewed
before it was built (your answer: `docs/plans/261007j-box-followups-plan-review-sol.md`; the plan's
last section says what was done about each finding).

**Fix what you find inside this commit's files**, narrowly, each fix red-first with a test that
reproduces it. **Report, do not fix,** anything wider. Do not touch `scripts/compress-screenshots.ts`,
`tests/screenshots-compressed.test.ts` or `docs/project/browser-control.md`: another reviewer is in
those. Do not commit; do not run anything with `sudo`; do not install, start, stop or restart any
systemd unit; do not touch `/etc`, the tmux sessions, or the running Overseer daemon. The caller will
run the box-level checks.

Context you cannot see: Ubuntu 24.04, systemd 255, one user `greg` (uid 1000) with passwordless sudo,
about twenty agent sessions. A live Overseer daemon runs in tmux holding the store lock in
`/home/greg/.overseer`. `/etc/overseer-secrets.env` now exists (root 0600, one key line, created by
the caller and checked: a transient unit running as greg with that `EnvironmentFile=` saw a key of
the source's length). `/etc/overseer.env` does not exist. `/etc/tmpfiles.d/tmp.conf` is not
installed yet. The caller ran `sudo bash infra/hetzner/test-overseer-restart.sh` in all three modes
and each exited 0 (disk full: 10 restarts, never failed, stable recovery; `--env`: the same; `--old`:
failed after 10 with "Start request repeated too quickly", stayed down). A dry run of
`sudo npx tsx scripts/overseer-activate.ts --disarm` printed the unit's store `/home/greg/.overseer`,
found the tmux daemon's pid as the lock holder, and (before the key file existed) refused with the
key-file blocker.

Look hardest at:

1. `scripts/overseer-activate.ts`: the key-file checks and the post-restart `attention: off` check
   (can it pass when attention is in fact off, or fail when it is on: when does the daemon print that
   line relative to its first checkpoint, and does `journalctl --since @<epoch>` cut correctly?);
   the store read from the unit; the order of effects in `--apply --disarm` on this box. Can any path
   print the key?
2. `infra/hetzner/systemd/overseer.service` and its heredoc: `StartLimitIntervalSec=0`,
   `RestartSec=30s`, two `EnvironmentFile=` lines. Anything systemd 255 does differently from the
   comments?
3. `infra/hetzner/test-overseer-restart.sh`: does it test what it says, can it pass while the
   property it claims is false, and does its cleanup always run?
4. `infra/hetzner/tmpfiles.d/tmp.conf`, its heredoc and the behavioural test in
   `tests/systemd-units.test.ts`: glob semantics of `e` and `x` lines under a `D` parent, and
   whether the test's path and age rewriting could make it pass for a rule the real file would
   apply differently.
5. `provision.sh`: the install of the tmpfiles file and the two new verify checks.
6. `scripts/overseer-watchdog.ts`, `scripts/overseer-tools/tick.sh`, the docs changed in the commit
   (`docs/project/hetzner-remote-server-box.md`, `docs/project/worktrees.md`,
   `infra/hetzner/README.md`): anything untrue.

Run `npx vitest run tests/systemd-units.test.ts tests/overseer-schedules.test.ts
tests/overseer-watchdog.test.ts` and `npm run typecheck` after any fix. Number each finding, give it
P0/P1/P2, file and line, and say fixed or reported. End with a one-line verdict.
