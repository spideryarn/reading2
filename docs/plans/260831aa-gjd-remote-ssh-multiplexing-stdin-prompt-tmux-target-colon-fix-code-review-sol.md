Verdict: **do not land yet**. Three failure paths can still report a plausible success with the wrong state.

## Findings

1. **P1 — tmux failure is still silently reported as “no sessions.”**  
   [`buildSessionScript()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-tmux.ts:48) pipes `tmux ls` into `while`. If tmux is missing, inaccessible, or otherwise fails, the empty `while` exits 0. `ssh()` therefore succeeds and [`sessions()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:406) returns `[]`.

   I reproduced this by running the generated script with `tmux` unavailable: status 0, empty stdout and stderr. This affects `ls`, `new`, `shell`, `resume`, and `doctor`. The comment at lines 423–428 correctly describes the bug; it still needs fixing here. Emit an explicit success/sentinel record only after distinguishing tmux’s ordinary “no server/no sessions” result from actual failure.

2. **P1 — `confirmStarted()` can print green while Claude has already failed.**  
   The job checks only that `claude` exists, then invokes it and unconditionally falls through to `exec bash -l` ([lines 724–738](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:724)). [`confirmStarted()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:562) proves only that tmux still exists. Any immediate Claude failure—bad option, authentication/configuration error, session-id rejection, or `E2BIG`—leaves a live login shell and produces `✓ started`.

   Large prompts expose this directly: the transfer itself can handle them, but `claude "$(cat …)"` turns the whole prompt into one Linux argv string. Linux limits one argument to 32 pages, commonly about 128 KiB; exceeding it fails `execve()` with `E2BIG`. [Linux `execve(2)`](https://man7.org/linux/man-pages/man2/execve.2.html)

3. **P1 — concurrent same-name `new` calls can silently start the wrong job.**  
   The existence check at [line 681](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:681) is not a reservation. Prompt, job and `.part` paths are all name-based ([lines 221–229](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:221), [693–694](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:693)).

   Two processes can both see the name free. Because generated jobs differ mainly by same-length UUIDs, process A’s byte-count check can validate process B’s file, rename it, and start it. A’s tmux environment then records session ID A while the job runs Claude session ID B. A can print green, while title discovery is permanently pointed at the wrong transcript. Seconds in the default name do not remove this race.

   Give each invocation UUID-keyed remote artifacts, and preferably reserve the tmux name atomically before publishing them.

4. **P2 — the master is not fully process-scoped.**  
   Normal return and `die()` cleanup work, and synchronous `spawnSync()` is appropriate inside an `exit` listener. But Node’s `exit` event covers explicit `process.exit()` and event-loop exhaustion—not signal termination. My direct probes showed the handler ran for `process.exit()` and uncaught exceptions, but not when the process received `SIGINT` or `SIGTERM`. [Node process documentation](https://nodejs.org/api/process.html)

   Consequences around [lines 154–182](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:154):

   - A signal delivered only to Node can orphan the background `ssh -M -N -f`.
   - If its socket is removed, later clients correctly fall back to fresh connections, but `-O exit` can no longer reach the original master. OpenSSH documents that fallback behavior. [OpenSSH configuration manual](https://man.openbsd.org/ssh_config)
   - A network can still blackhole during one multi-command invocation. `ConnectTimeout` does not bound a mux request, while `ServerAliveInterval` defaults to zero.
   - Failed master startup leaks its newly created directory and is retried on every later call because failure is not memoized.

5. **P2 — the session framing is not actually strict.**  
   [`parseSessionLine()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-tmux.ts:74) accepts both of these as settled sessions:

   ```text
   a|1788190336|0|1
   a|1788190336|0|1|garbage|
   ```

   So missing or invalid provisional state silently becomes `false`, contrary to the agreed validation.

   A legitimate tmux name containing `|` also shifts every field. `s=${row%%|*}` targets the wrong session, parsing fails, and nearly every session command becomes unusable. Failing closed is preferable to silently omitting that session, but this avoidable delimiter choice creates a denial of service. Use unambiguous encoding/framing and require all expected fields.

## Specific questions

- `/dev/tty`: the implementation is sound. A numeric stdio entry shares that open parent fd as the child’s fd 0, as intended. [Node child-process documentation](https://nodejs.org/api/child_process.html) It is opened once, reused, never double-closed, and the OS closes it at process exit. I reproduced the consumed-stdin success path under a pseudo-terminal and the spawned child saw fd 0 as a TTY.
- Closing before `moshProbe()`: safe. The probe does not use `sshMasterOpts()`, and installed mosh disables sharing with `-S none`; the SSH fallback deliberately starts independently.
- `wc -c`: correct and locale-independent for this purpose; `-c` counts bytes. [POSIX `wc`](https://man7.org/linux/man-pages/man1/wc.1p.html)
- `shq`: covers shell path characters, including quotes and newlines. NUL cannot be represented in a shell argument, but current paths are absolute paths built from validated slugs.
- `spawnSync` input: no prompt-sized pipe deadlock found. I passed 16 MiB through it successfully. Node’s `maxBuffer` applies to captured stdout/stderr, not input. [Node documentation](https://nodejs.org/api/child_process.html)
- `mv -f`: atomic here because `.part` and destination are in the same directory; it is not crash-durable without syncing. [POSIX `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)
- UTF-8: valid text is counted and transferred correctly. It is not binary-preserving because stdin is decoded to a JS string. Bash command substitution also removes trailing newlines before Claude receives the prompt.
- Failed-transfer cleanup: best effort only. If the shared connection is blackholed, the cleanup attempt can itself hang; if the socket disappeared it may reconnect independently. Cleanup correctness should not be part of the guarantee.

Verification note: no files were edited. `git diff --check` passed. The full Vitest and project typecheck wrappers could not start in this read-only sandbox because they create temporary Vite/tsx files; direct parser, shell-status, signal, large-input, and pseudo-terminal probes were run instead.