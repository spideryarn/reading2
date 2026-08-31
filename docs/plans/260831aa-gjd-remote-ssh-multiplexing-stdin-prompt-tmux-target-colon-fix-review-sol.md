Verdict: **do not build this plan as written**. SSH multiplexing is reasonable, but the proposed socket path is likely too long, mosh disables the shared socket, and `-p -` conflicts with the default interactive attach.

## 1. `ControlMaster` / `ControlPersist`

**Verdict: use multiplexing, but prefer a command-scoped master over a shared 10-minute master.**

A master covering one `gjd-remote` invocation gets nearly all the benefit for `new` and `shell`, while avoiding sleep, network-change, rebuild, and cross-invocation races.

Specific findings:

- A fixed socket path is unsafe. It must include `%C` or `%h/%p/%r`; otherwise a changed `GJD_REMOTE_HOST` can reuse a master connected to the old machine. OpenSSH explicitly recommends this uniqueness and a directory not writable by other users. [OpenSSH configuration manual](https://man.openbsd.org/ssh_config)
- `$TMPDIR` is a bad location on this Mac. It is already 48 bytes. A plausible `gjd-remote-%C` path is about 100 bytes, but OpenSSH creates the master first at `ControlPath.<16-random-chars>`. That temporary path adds another 17 bytes and exceeds macOS’s 104-byte `sun_path`. The plan currently checks only the final path, which is insufficient. OpenSSH’s implementation confirms the temporary suffix. [OpenSSH mux implementation](https://raw.githubusercontent.com/openssh/openssh-portable/master/mux.c)
- Use something short such as `~/.ssh/gjd-%C`, or a private `mkdtemp` directory directly under `/tmp` for a command-scoped master.
- Concurrent `ControlMaster=auto` creation is handled reasonably: OpenSSH creates a temporary listener and atomically links it into place. The loser prints that multiplexing is disabled and continues with its own connection. It should cost an extra connection, not wedge. [OpenSSH mux implementation](https://raw.githubusercontent.com/openssh/openssh-portable/master/mux.c)
- A dead socket file with no listener is also handled: `auto` unlinks it on `ECONNREFUSED` and falls back.
- The dangerous case is a **live local master over a blackholed TCP connection** after sleep or a network change. The local mux handshake succeeds, then the client can wait indefinitely for the master to open the remote session. `ConnectTimeout` does not bound that later request. That looks like a hung remote command, hung tmux, or hung mosh—not “stale ControlMaster.”
- `ServerAliveInterval` defaults to zero. If you retain cross-invocation persistence, add bounded server-alive settings and test them on the bad link; otherwise one poisoned master can stall every command. [OpenSSH configuration manual](https://man.openbsd.org/ssh_config)
- `forget-key` must terminate the matching master before running `ssh-keygen -R`. Otherwise an existing master bypasses the next host-key check entirely.
- I found no reason to expect `ControlPersist` to keep macOS awake. It leaves one background process, TCP connection, and Unix listener; it does not normally assert a sleep prohibition. I also see no unbounded fd leak in the design. A hung client channel can legitimately keep the master beyond ten minutes, however.

`ControlMaster=auto` itself does not prompt on a non-interactive invocation; `autoask` does. But `auto` can still appear wedged in the live-master/dead-network case above.

## 2. Passing the socket to mosh

**Verdict: it will not work with the installed mosh configuration.**

`--ssh=` accepts an alternate SSH command, but mosh 1.4.0’s default `remote-ip=proxy` mode subsequently appends:

```text
-S none -o ProxyCommand=...
```

`-S none` disables connection sharing. It comes after the supplied `--ssh=` arguments, so it wins. This is visible both in the installed `/opt/homebrew/bin/mosh` and upstream source. [mosh bootstrap source](https://github.com/mobile-shell/mosh/blob/master/scripts/mosh.pl)

Changing to `--experimental-remote-ip=local` or `remote` may avoid that override, but that changes mosh’s address-discovery behaviour. It is not a harmless SSH optimisation and should not enter this plan without separate testing.

Even if multiplexing worked, it only removes the SSH part of the bootstrap. Mosh starts its server through SSH, closes SSH, then establishes UDP. [mosh design](https://github.com/mobile-shell/mosh#how-it-works) Given the measurements—2 seconds for SSH versus 6–7 seconds for mosh—the theoretical saving is roughly 2 seconds per bootstrap, not the full 6–7 seconds.

## 3. The double mosh bootstrap

**Verdict: leaving it alone is defensible for a scoped patch, but then the plan cannot claim to make `shell` fast.**

- A bare UDP “connect” or `nc -u` probe is not honest. UDP has no connection handshake, the mosh port is dynamically allocated, and there is no responder until `mosh-server` has been started with the corresponding key.
- Caching success per network creates a dangerous stale-success case: after a network change, the real mosh invocation can return to retrying forever. Reliably fingerprinting the current network is more machinery than this patch warrants.
- Running the real interactive mosh under a fixed timeout is not sufficient: success is a long-lived process, so the timeout would later kill a healthy session. An automatic fallback needs a way to detect the first successful UDP exchange while preserving terminal control.
- A failure-only cache is safe and could avoid repeated 15-second waits on a known-bad network, but it does nothing for normal-network startup.

My 80–20 recommendation is to keep the probe for now, explicitly record that attach still costs approximately two mosh bootstraps, and make elimination of the double bootstrap separate work. The alternative simplest product decision is “try mosh directly; Greg uses `--ssh` on known-bad networks,” rather than attempting unreliable automatic UDP detection.

I am unsure whether killing `script` on the existing 15-second timeout always reaps its mosh/ssh descendants. Add a process audit to the blocked-UDP smoke test.

## 4. Other wrong, missing, or over-built parts

**Verdict: multiplex before full batching, but fix several omissions first.**

The largest missing issue is `-p -`:

- A heredoc makes `stdin` non-TTY.
- `moshProbe()` therefore deliberately falls back to SSH.
- The subsequent interactive SSH attach inherits an exhausted pipe, not the terminal.
- A single `ssh -t` does not force allocation when there is no local TTY; multiple `-t` options are needed for that case, but stdin would still be the exhausted pipe. [OpenSSH `ssh` manual](https://man.openbsd.org/ssh)

The simple v1 is to require `--no-attach` with `-p -`, show that in the example, and tell the user to run `resume`. Reopening `/dev/tty` for probe and attach is possible, but it is a separate design choice.

Other issues:

- `attachCmd()`’s SSH branch does not use `SSH_OPTS` at all. The fallback attach therefore gets neither multiplexing nor `BatchMode`, `ConnectTimeout`, or `accept-new`.
- The parser must fail closed. Rejecting malformed `created` by silently dropping the session would let `cmdNew()` believe an existing session is absent. Validate `created`, `attached ∈ {0,1}`, `windows`, and provisional status, then surface an error.
- Test the missing colon itself, not only the malformed-output consequence.
- Read stdin before deriving the provisional name; otherwise `-p -` can derive its name from the literal `"-"`.
- Decide explicitly whether empty stdin is an error. Keeping downstream truthiness checks unchanged silently turns an empty prompt into “no prompt.”
- Resolve `host()` once per process rather than invoking `tofu output` for each connection.
- Make live smoke tests use a uniquely named disposable shell session, and kill only that session.

For batching: do not collapse all of `cmdNew` into one heredoc yet. A working command-scoped master already removes repeated authentication. After measuring, the low-risk follow-up is to combine `chmod` and `tmux new-session` into one remote command, and possibly transfer the prompt and job together. Full one-connection batching adds file-framing and error-reporting complexity for perhaps another 1–2 seconds.

## 5. The tmux target

**Verdict: `-t "=name:"` is correct for `display-message`/`display -p`, and correct on tmux 3.4.**

`display-message` takes a `target-pane`. The colon explicitly supplies the session portion and selects its current window/pane; the `=` makes the session match exact. Without `:` tmux is free to interpret the unqualified target according to the target type. [tmux target documentation](https://github.com/tmux/tmux/wiki/Advanced-Use#command-targets)

There is no portability concern for the stated box because it is already verified on 3.4. I would not broaden the claim to unknown older tmux versions without testing.

A cleaner listing implementation is:

```sh
tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}'
```

That avoids a target altogether. If the loop still needs per-session operations, capture `#{session_id}` and use the immutable `$id:` for target-pane commands. The existing `=$s:` fix is nevertheless sufficient.

## Concrete plan changes, most important first

1. Remove the proposed mosh `--ssh=ControlPath…` step; it is disabled by mosh’s default `-S none`.
2. Replace the 10-minute shared master with a short-path, command-scoped master and explicit cleanup. If persistence remains, add server-alive bounds and a poisoned-master recovery test.
3. Require `%C` for any shared path and include OpenSSH’s extra 17-byte temporary suffix in the macOS length check.
4. Make `forget-key` terminate the matching master first.
5. Define `-p -` as `--no-attach` only for v1, or explicitly add `/dev/tty` reopening as separate work.
6. Apply the common SSH options to the SSH attach, `ssh`, and tunnel paths—not only helper calls.
7. Make malformed tmux output fatal; test both the exact `=name:` builder and strict parsing.
8. Keep full batching deferred, but combine `chmod` and session creation if measurements show multiplexed channel setup still matters.
9. Add smoke cases for concurrent cold starts, a dead socket file, a live-but-dead master, sleep/network change, `forget-key` with a live master, the actual macOS path length, and blocked-UDP descendant cleanup.
10. Rewrite the performance claim: this work should materially speed `new --no-attach` and the pre-attach SSH phase, but it will not remove the dominant double-mosh cost.