I found two serious correctness issues. The OSC 6 bytes themselves are correct: iTerm documents the three decimal RGB sequences, BEL termination, and `*;default` reset exactly as implemented. [iTerm2 escape-code documentation](https://iterm2.com/documentation-escape-codes.html)

1. **High — Ctrl-C can permanently leave the tab violet.** [scripts/gjd-remote.ts:455](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:455), [scripts/gjd-remote.ts:1852](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:1852)

   `unpaint()` only runs after `spawnSync` returns. A foreground-process-group SIGINT kills both the child and Node parent; Node’s `exit` event does not run. I reproduced this with Node 26: no code after `spawnSync`, and no `exit` listener, executed. This is the documented shutdown path for `tunnel`—“ctrl-c closes the tunnel”—not just `kill -9`. A stale violet indicator is actively misleading, so it is worth fixing.

   Smallest robust fix: run the interactive child asynchronously, restore on child exit and caught `SIGINT`/`SIGTERM`/`SIGHUP`, then preserve the child’s exit/signal status. Add a process-group SIGINT test.

2. **High — the guard admits PTY recorders, so escape bytes do land in files.** [scripts/gjd-remote-tab.ts:88](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-tab.ts:88)

   `script(1)` creates a TTY and preserves `TERM_PROGRAM`. I reproduced `process.stdout.isTTY === true`, `TERM_PROGRAM === "iTerm.app"`, with neither `TMUX` nor `STY`; `canColourTab` therefore returns true. `script` records everything printed to that pseudo-terminal, including these OSC bytes. The same predicate approves local CI under a PTY and an interactive SSH shell if `TERM_PROGRAM` was forwarded or preserved; a stale value can then target a non-iTerm outer terminal.

   Smallest immediate fix: reject `SSH_CONNECTION`, `SSH_TTY`, and `CI`, and detect `script` ancestry. If the absolute “never enter a recording” guarantee matters, environment inspection is insufficient: validate that stdout’s tty is the tty of the live `ITERM_SESSION_ID`, failing closed when that lookup is unavailable. Redirected stderr alone is safe because the bytes only go to stdout. `tmux -CC` is covered by `TMUX`.

3. **Medium — host-resolution failure can occur after painting.** [scripts/gjd-remote.ts:455](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:455), [scripts/gjd-remote.ts:1834](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:1834), [scripts/gjd-remote.ts:1852](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:1852)

   `HOST()` is evaluated inside the spawn arguments, after `markTabRemote()`. If Terraform-state lookup calls `die()`, the child never starts and the tab remains violet. `attach()` has the same path when transport is forced, because `chooseTransport()` then returns without resolving the host.

   Smallest fix: build `attachCmd(...)` or resolve `const target = HOST()` before painting.

4. **Medium — an invalid cosmetic setting aborts useful work after side effects.** [scripts/gjd-remote.ts:429](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:429)

   For `new-claude` and `new-shell`, the remote tmux session has already been created before the invalid colour is noticed. Auto transport may also spend 15 seconds probing first. Aborting access to the box is disproportionate.

   Smallest fix: warn explicitly, skip colouring, and continue. That is fail-closed for the colour and not silent success. If aborting is retained, validation must happen before any network or session creation.

5. **Medium — the tests do not cover the lifecycle or any call site.** [tests/gjd-remote-tab.test.ts:29](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/gjd-remote-tab.test.ts:29)

   The pure parsing/byte tests are good, but all three `markTabRemote()` calls could be deleted and the suite would remain green. It also cannot catch findings 1 or 3. The seven mutations do not establish coverage of the wrapper, interruption, ordering, or all five advertised commands.

   Smallest fix: one PTY integration test with a fake `ssh` that asserts set-before-child, reset-after-exit, and reset-after-process-group SIGINT; add route assertions for `attach`, `ssh`, and `tunnel`.

6. **Low — two documentation claims are false or unauditable.** [docs/plans/260831ae-gjd-remote-iterm-tab-colour.md:67](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831ae-gjd-remote-iterm-tab-colour.md:67), [scripts/gjd-remote-tab.ts:21](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-tab.ts:21)

   “Nothing can read a tab’s current colour back” is false: iTerm’s Python API reads `session.async_get_profile().tab_color`. [Official preserve-tab-colour example](https://iterm2.com/python-api/examples/copycolor.html). Qualify it as “OSC cannot read it back without using the Python API.” Likewise, the claimed photographs are not retained or linked, so that live verification is not independently auditable—though the official escape-code documentation confirms the bytes.

Review only; I changed nothing. `npx tsc --noEmit` passed. Vitest could not start in the read-only sandbox because Vite attempted to create `node_modules/.vite-temp`.