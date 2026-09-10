## Verdict

Request changes. Excluding accepted F20, I found one P0, two P1s, and one P2. The full findings were written to [260910f-launch-protocol-stage2-review-sol-b-findings.md](/tmp/260910f-launch-protocol-stage2-review-sol-b-findings.md).

### Findings

- **F22 — P0, reasoned: tests can invoke the real `claude` or `codex`.**  
  The tests prepend fake binaries to `PATH`, but the wrappers subsequently call `loadRepoEnv()`. A `.env.local` containing `PATH` can replace the fake path unless `SPIDERYARN_ENV_PINNED` includes it. The preflight in `tests/overseer-launchers.test.ts:711-714` happens before that reload, so it does not establish what the launched wrapper will resolve.
  - Showing input: run under a repo environment whose `.env.local` assigns `PATH`. The preflight sees the fake binary, then the wrapper can resolve the real one.
  - Smallest fix: pin `PATH` through `SPIDERYARN_ENV_PINNED` in every spawned wrapper environment, along with any test-controlled account-routing variables. Make the safety preflight use the same environment-loading path as the wrapper.
  - No real CLI ran during this review: the present `.env.local` does not assign `PATH`.

- **F21 — P1, established: failed `run-codex` answers are left in a temporary directory.**  
  In `scripts/run-codex.ts:655-657`, the launch journal records the attempt’s temporary `outFile`. Failure exits at lines 671-693 occur before the durable copy at lines 696-704. Thus `exit.json` can point to `/tmp/run-codex-…/output-N.txt`, while the promised launch-directory `answer.md` is absent.
  - Showing input: I ran an isolated committed copy with a fake Codex that wrote two whitespace bytes. The wrapper exited 1; `start.json`, `exit.json`, and the transcript existed, but `answer.md` did not, and `exit.json` named the temporary output.
  - Smallest fix: on launched runs, copy the last attempt output to the requested/default durable answer path and journal that path before evaluating the failure ladder. Add assertions for empty, invalid, and non-zero outcomes.

- **F23 — P1, established: several post-start `gjd-remote` failures never write `exit.json`.**  
  The committed job script writes `start.json` at `scripts/gjd-remote.ts:2734`, but the only exit write is after Claude at line 2801. The directory guard, missing-CLI check, account validation, identity check, and “started” bookkeeping can all take `failTo` exits before reaching it.
  - Showing input: an invalid remote directory or missing `claude` produces `start.json`, then exits 1 without `exit.json`.
  - Smallest fix: install an `EXIT` trap immediately after the successful start write. On the normal path, write the explicit result and disable the trap before subsequent bookkeeping/`exec`. Test at least the invalid-directory and missing-CLI paths.

- **F24 — P2, established: `run-codex` pane-close behavior is untested.**  
  The production hook at `scripts/run-codex.ts:523` appears correct, but removing `onHangup: launch?.hangup` leaves every `run-codex` test green. Only `run-claude` receives an end-to-end SIGHUP exercise.
  - Showing change: delete that hook; the focused `run-codex` suite still passes.
  - Smallest fix: add a direct wrapper-subprocess SIGHUP test using a fake child. It need not use tmux. Apply F22’s environment pinning first.

### Six-property assessment

| Property | Result | Test assessment |
|---|---|---|
| Correlation ID in the first external effect | Pass | Exact tmux arguments, hostile values, and the first-process environment are checked. `-e SPIDERYARN_LAUNCH_ID=…` is part of `new-session`, not a later mutation. |
| Durable start before work; final exit on every ending | Fail | Atomic-file fault injection and wrapper outcome coverage are good, but F23 leaves ordinary `gjd-remote` guard failures unfinished. F20 remains the known auth-probe exception. |
| No-`--launch-dir` compatibility | Pass | Routing, auth, stdin, environment sanitisation, output validation, and Codex fallback behavior retain coverage. The only intentional behavioral change is SIGHUP child cleanup. |
| Exact pinned prompt | Pass | Launchers create a private snapshot; launched wrappers reread it and compare its hash immediately before constructing/spawning the CLI attempt. Tests exercise mutation and mismatch cases. |
| Quoting across shell/SSH/tmux | Pass | Shell-interpreted values use quoting helpers; direct process boundaries use argument arrays. Hostile-path tests cover the important layers. |
| Pane close kills the child and leaves an exit | Partial/fail | `runChild`’s active-child path forwards SIGHUP, waits, runs the finalizer, and re-raises. F20 breaks the auth-probe path; F24 shows Codex’s wiring is not protected by a test. |

### Admitted-gap audit

The tmux-server race, signal representation as `128+n`, 96 KiB `gjd-remote` prompt cap, early account reservation, and weakness of source-text placement checks are described honestly. The prompt cap has a negligible newline-boundary detail but is not materially understated.

The status paragraph does not disclose F21 or F23. F23 is especially more serious than the stated “source-text placement” weakness: the order is correct for the successful Claude path, but several real post-start failure branches bypass the exit writer entirely.

### Answers to your questions

1. **Yes, the committed successful-path ordering is correct.** `start.json` is emitted after the two environment exports, before the directory guard and before Claude. After Claude, `_gjd_claude_status=$?` is immediately followed by the exit-writing lines. The defect is that earlier `failTo` branches never reach those lines.

2. **Only SIGHUP semantics changed.** SIGINT and SIGTERM still use the existing `onSignal` path. Without `--launch-dir`, SIGHUP is still ultimately restored and re-raised as before; it now first forwards the signal to the child process group and waits for cleanup. With no launch finalizer, no additional journal behavior occurs.

I attempted the requested focused suite in both the worktree and an isolated archive. This sandbox reported 165 passing and 65 containment failures: nested `tsx` IPC sockets, `spawnSync`, and tmux socket creation were denied. These were infrastructure failures rather than assertions. The safe F21 reproduction used only a fake Codex binary; no real `claude` or `codex` was invoked. No repository file was changed.