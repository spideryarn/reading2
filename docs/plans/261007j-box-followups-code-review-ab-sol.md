1. **P1 — Reported:** [overseer-scheduled-dispatch.test.ts:850](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/tests/overseer-scheduled-dispatch.test.ts:850). Two calls omit the newly required attention field, breaking typecheck. Outside the commit’s files; left untouched.

2. **P1 — Fixed:** [overseer-activate.ts:578](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/overseer-activate.ts:578). Empty journals could falsely confirm attention; rounded timestamps could include an old warning. Verification now requires startup evidence from the current invocation and preserves milliseconds.

3. **P1 — Fixed:** [overseer-activate.ts:129](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/scripts/overseer-activate.ts:129). A valid key line could hide later assignments that empty the key or override the store or arming. Preflight now requires exactly one key assignment and mode 0600, without printing its value.

4. **P2 — Fixed:** [tmp.conf:30](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/infra/hetzner/tmpfiles.d/tmp.conf:30). The broad Claude glob preserved cwd files indefinitely: the parent skips matching paths, while `e` cleans directories only. Narrowed to UID directories. [Systemd 255 implementation](https://raw.githubusercontent.com/systemd/systemd/v255/src/tmpfiles/tmpfiles.c).

5. **P2 — Fixed:** [systemd-units.test.ts:718](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/tests/systemd-units.test.ts:718). The live socket survived independently of its exclusion. Tests now use idle ordinary files, preserve paths under `--root`, and verify eventual expiry. Removing the tmux exclusion produces the expected failure.

6. **P2 — Fixed:** [provision.sh:2864](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/infra/hetzner/provision.sh:2864). Verification accepted shadowed rules and failed readers with plausible output. It now rejects duplicates and checks producer failure using the actual provisioning wrapper.

7. **P2 — Fixed:** [overseer.service:22](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/infra/hetzner/systemd/overseer.service:22). Systemd 255 accepts legacy `StartLimitBurst` in `[Service]`; misplaced `StartLimitIntervalSec` warns. Corrected the mirrored comments. [Upstream parser](https://raw.githubusercontent.com/systemd/systemd/v255/src/core/load-fragment-gperf.gperf.in).

8. **P2 — Fixed:** [test-overseer-restart.sh:75](/var/tmp/spideryarn-worktrees/box-followups-tmp-overseer-pngs/infra/hetzner/test-overseer-restart.sh:75). Recovery can wait six minutes; one final sample cannot establish “never failed.” Corrected both claims.

All fixes were red-first. Requested suites: **146 passed**. Shell syntax and diff checks passed. `npm run typecheck` hit sandbox IPC restrictions; the same runner through Node checked all projects and found only finding 1’s two errors. No commit or service changes.

**Verdict: scoped fixes complete; changes requested for the outside-scope typecheck fixture before landing.**