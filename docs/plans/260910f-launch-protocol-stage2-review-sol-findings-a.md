# Stage 2 launch-protocol review findings

## F20 — P1 — established

Closing a `run-claude` tmux pane during the authentication probe still leaves no `exit.json`, contrary to property 6 and the broader "one final exit on every ending" contract. In committed `scripts/run-claude.ts:608-615`, `probeAuth()` calls `runChild()` without the launch's `onHangup`; committed `scripts/subagent-cli.ts:340-350` consequently re-raises SIGHUP after killing/waiting for the probe without calling `launch.hangup()`. A signal-re-raised Node process does not reach the wrapper's `process.on('exit')` finaliser. The Stage 2 status names the omission at plan lines 553-554, but calls it a gap even though it is a direct exception to required property 6.

(a) Test/input: launch `run-claude --launch-dir <valid-attempt>` in tmux with a stand-in `claude` whose `auth status --json` blocks and records its pid; wait for that pid, kill the tmux session, then assert the probe pid is gone **and** `<attempt>/exit.json` exists with `ending: signalled` / cause `hangup`. The current real-tmux test waits until the paid CLI child is running, so it cannot detect this branch.

(b) Smallest fix: pass the same launch-aware hangup callback into the auth-probe `runChild` call (e.g. add an optional `onHangup` argument to `probeAuth` and pass `launch?.hangup`), then add the probe-phase tmux test. If the record needs to distinguish probe from paid work, its existing `not-run` + `hangup` representation already does so.
