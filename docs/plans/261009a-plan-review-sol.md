**Verdict: build with changes.** The per-run root is a good approach. The plan overstates lifecycle guarantees and needs protection against repeated config evaluation. No P0 findings.

I checked the installed **Vitest 4.1.11** implementation. This review was read-only; I did not run the suite.

1. **P2 — Config evaluation is not “once per run.”**  
   [vitest-worker-caps.test.ts](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/tests/vitest-worker-caps.test.ts:102) repeatedly calls `createVitest()` with the real config **inside one worker**. Each evaluation would create another root under the previous `TMPDIR`, change the worker’s environment, and register another exit listener. Watch-mode config reloads have the same nesting problem.

   Make allocation idempotent across config reloads and recognise an inherited run root. Workers and nested Vitest instances should reuse it; only its owner should delete it.

2. **P2 — `exit` usually runs here, but it is not a guarantee that the run and its descendants have finished.**  
   For this version’s ordinary CLI invocation:

   | Outcome | Config process’s `exit` listener |
   |---|---|
   | Successful or failed tests | Runs |
   | Config/admission or setup error, after registration | Runs through CLI termination |
   | Ordinary SIGINT/Ctrl-C or SIGTERM | Runs: Vitest’s logger installs signal handlers that call `process.exit()` |
   | SIGKILL, fatal OOM, default SIGHUP termination | Cannot be relied upon |

   The proposed **synchronous** `rmSync` is suitable inside `exit`; asynchronous deletion would not be. [Node exit documentation](https://nodejs.org/api/process.html#event-exit).

   The supported orderly lifecycle hook is [globalSetup teardown](https://vitest.dev/config/globalsetup.html), but it does not cover every signal or startup failure. Also, in 4.1.11, global teardown runs **before pool closure**, while `onClose` callbacks run **concurrently with pool closure**. Neither is automatically an “all processes are gone” hook.

   If strict signal handling and cleanup ordering are required, use a parent wrapper that forwards signals and waits for termination. No in-process hook survives SIGKILL.

3. **P2 — A dead owner PID does not prove the directory is unused; the sibling sweep also introduces startup failures.**  
   Two ordinary concurrent runs are safe: each owner PID is live. PID reuse is conservative: it retains stale directories rather than deleting a live run’s root. Only `ESRCH` should mean dead; the helper currently handles that correctly.

   The missing cases are:

   - Detached workers or children can survive their owner and still use its root.
   - In shared `/tmp`, another user’s matching directory may be inaccessible. The current unguarded `rmSync` can abort the new suite; a privileged invocation could delete that user’s directory.
   - Concurrent sweeps and active writers can cause removal errors.
   - macOS usually isolates users’ default temp directories, but custom `TMPDIR` values can remove that isolation.

   **I would omit the sweep initially.** Normal-exit cleanup addresses the main volume problem. If crash leftovers warrant scavenging, restrict it to verified same-user directories, add a grace period, and make individual failures nonfatal. PID checks alone cannot establish descendant inactivity.

4. **P2 — “Short root” does not establish that every socket path fits.**  
   Direct `tsx` IPC under the proposed root fits a typical macOS temp path. Other paths add more components. For example, a representative path through `fleet-child-server-XXXXXX/tmux/tmux-501/default` is **113 bytes**, beyond macOS’s usual usable limit. Repeated config evaluation makes this worse.

   Validate complete paths, including child-specific `TMPDIR` overrides and tmux paths. The practical pathname limits are typically **107 bytes on Linux and 103 on macOS**, allowing for termination. [Node IPC documentation](https://nodejs.org/api/net.html#ipc-support).

   This is a compatibility risk identified from path construction, not a reproduced macOS failure.

5. **P2 — There are actual fixed `/tmp` writes, and the proposed measurement will miss them.**  
   These are not merely fixtures:

   - [run-codex.test.ts](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/tests/run-codex.test.ts:840) writes `/tmp/unused`, `/tmp/unused-stdin`, and `/tmp/run-codex-gc.txt`.
   - [run-claude.test.ts](/var/tmp/spideryarn-worktrees/qi-4b5598e2-test-tmp-cleanup/tests/run-claude.test.ts:775) writes `/tmp/run-claude-env-probe.txt`.

   They escape cleanup, and fixed names can collide between concurrent suites. Move these outputs under test-owned temp directories. Counting leftovers only beneath a custom `TMPDIR` cannot detect literal `/tmp` writes.

6. **P3 — The planned tests cover too little of the lifecycle claim.**  
   A successful helper child exiting proves synchronous deletion on ordinary exit. It does not prove cleanup after failed tests, config/setup errors, interruption, or repeated config loading. Add focused subprocess coverage for those cases and for two concurrent owners. Verify the root’s owner identity, rather than only matching its basename.

On environment propagation: **yes for all three existing projects**. Vitest builds worker environments from `process.env`, then overlays global/project `test.env`; both fork and thread workers receive that result, as do the VM variants. The default pool is [forks](https://vitest.dev/config/pool.html). Ordinary children inherit it. Exceptions include explicit replacement/override environments, environment scrubbing, login-shell resets, and custom pools. `TMPDIR` alone also does not redirect Windows’s `os.tmpdir()`. [Node temp-directory precedence](https://nodejs.org/api/os.html#ostmpdir).

The fleet owner’s dirname check should **continue to pass**: its root is created beneath the worker’s `tmpdir()`, and `accountNeutralEnv()` preserves `TMPDIR`. I found no clear assertion requiring an actual generated temp directory to start with `/tmp`; most such assertions are fixtures. Existing realpath-aware tests generally account for macOS aliases.

The simplest useful design is: **one inherited root, idempotent config allocation, owner-only synchronous exit cleanup, no sibling sweep, and fixes for the few literal writes**. Keep existing child-process cleanup, and describe abrupt termination as a remaining limit. If guaranteed interruption cleanup is a requirement, move ownership into a small Node wrapper and route test entry points through it.