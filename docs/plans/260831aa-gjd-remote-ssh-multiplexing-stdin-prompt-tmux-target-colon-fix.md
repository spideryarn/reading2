# gjd-remote: SSH multiplexing, a stdin prompt, and the tmux target colon

## Goal, context

Greg asked for `gjd-remote new -p "…multi-line prose, possibly with double quotes…"`. That
already exists ([`scripts/gjd-remote.ts:387`](../../scripts/gjd-remote.ts)) and the prompt already
travels as a file, so quoting is safe past the local shell. What he actually noticed is the
**delay**:

> I note that it seems to take 10s or so just for `gjd-remote shell`.

So the work is three things, in order of value:

1. **Make `gjd-remote` fast.** Every subcommand opens several *fresh* SSH connections, and each one
   costs ~2s of handshake on a good link and 8–10s on a bad one.
2. **Fix a silent bug found while measuring.** `sessions()` builds its tmux target without the
   trailing colon, so every session's `AGE` and `ATT` column is wrong.
3. **Add `-p -`** so a prompt can come from stdin/heredoc, sidestepping local shell quoting
   entirely.

### The measurements

Taken 2026-08-31 against the live box (188.245.166.213), at a healthy 78ms RTT unless noted.

| what | measured | why |
|---|---|---|
| one fresh `ssh … true` | **~2.0s** | ~15 network round trips of handshake; the command is free |
| `gjd-remote ls` | **2.8s** | 1 connection + 0.4s tsx startup |
| `gjd-remote new --no-attach` | **12.3s** | 6 fresh connections |
| one mosh bootstrap | **6.0s, 6.8s** | measured twice through a real pty |
| 3 fresh connections | **5.12s** | the sequence `shell` runs before attaching |
| master handshake + 3 multiplexed | **2.80s + 1.21s** | same three commands over a shared socket |
| `scp` of a 3-byte file, fresh | **7.08s** | sftp handshake on top of the SSH handshake |

The link is jittery: within one minute `ping` reported RTT from 74ms to 660ms (stddev 217ms). At the
bad end a single connection took 8–10s and `ls` alone took 12.5s. The network is the multiplier; the
round-trip count is ours.

### Where `gjd-remote shell`'s ~10s goes

Five separate connections, three SSH and two mosh:

1. `sessions()` — [`scripts/gjd-remote.ts:271`](../../scripts/gjd-remote.ts)
2. `sessionDir()` — [`scripts/gjd-remote.ts:338`](../../scripts/gjd-remote.ts)
3. `tmux new-session` — [`scripts/gjd-remote.ts:490`](../../scripts/gjd-remote.ts)
4. `moshProbe()` — [`scripts/gjd-remote.ts:138`](../../scripts/gjd-remote.ts), a **complete mosh
   bootstrap whose result is thrown away**
5. the real mosh attach — the same bootstrap again

Step 4 is the single worst item. It answers "does mosh work on this network?" by doing the whole
expensive thing, so every attach pays the mosh bootstrap twice: ~13s of the ~10–20s total.

`new -p` is 7 SSH connections (the prompt adds an `scp`) plus probe plus attach — roughly 25s before
Claude's first token.

### The tmux bug

`sessions()` runs `tmux display -p -t "=$s" '#{session_created}|…'`. On the box (tmux 3.4) that
returns `||` — all three fields empty. With the colon, `-t "=$s:"`, it returns `1788192264|0|1`.
Verified on the live box 2026-08-31.

Two visible consequences:

- `AGE` is computed from `Number("") === 0`, i.e. the epoch, so every row reads `20696d`.
- `attached !== "0"` is **true** for `""`, so `ls` reports `ATT yes` for every session — including
  one created detached one second earlier.

This is the identical trap already written up in `attachCmd`'s own comment at
[`scripts/gjd-remote.ts:178`](../../scripts/gjd-remote.ts): `set-option -t` takes a target *pane*,
and the `=` exact-match prefix is only recognised on the session part when a colon follows. The
comment is 200 lines below the code that gets it wrong.

## References

- [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — the whole surface. Key spots: `SSH_OPTS`
  (line 57), `ssh()` (107), `scpTo()` (118), `moshProbe()` (130), `attachCmd()` (171),
  `chooseTransport()` (203), `sessions()` (254), `sessionDir()` (335), `cmdNew()` (360),
  `cmdShell()` (475), `main()` (1163).
- [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) and
  [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts) — the house pattern for this
  script: pure logic in a sibling module, tested against fixtures, never against the live box.
- [`docs/research/260831c-remote-server-tmux-mosh.md`](../research/260831c-remote-server-tmux-mosh.md)
  — why tmux + mosh at all.
- [`docs/plans/260831x-remote-box-dev-environment.md`](260831x-remote-box-dev-environment.md) — the
  plan this script came out of.
- [`docs/reusable/silent-success.md`](../reusable/silent-success.md) — the tmux bug is a textbook
  case: empty output parsed as a valid answer.

## Principles, key decisions

- **Fewer round trips beats a faster round trip.** We cannot fix the network. We can stop paying for
  the handshake six times per command.
- **Multiplexing first, batching later.** `ControlMaster` is a few lines in one constant and helps
  every subcommand at once. Collapsing `cmdNew`'s six connections into one heredoc is a real
  refactor of the code that starts sessions — more risk, less payoff per line. **Simplest version
  first**; batching is out of scope unless multiplexing disappoints.
- **The mosh probe stays for now.** Deleting it is tempting (it is the biggest single item), but it
  exists for a real reason recorded in the code: mosh retries forever when UDP is blocked, and a
  ferry's satellite link is the case that prompted it. Instead, hand mosh the shared SSH socket so
  the probe's *SSH* half becomes nearly free. Getting rid of the second bootstrap is a separate
  decision for Greg, not something to slip in.
- **Simpler option passed over:** telling Greg to set `GJD_REMOTE_TRANSPORT=ssh` and live with it.
  That trades away mosh's whole benefit (a session that survives a lid close) to fix a startup cost.
- **Test the pure parts, smoke-test the rest.** Multiplexing cannot be unit-tested without a
  network; the tmux format string can be, and that is the bug that actually shipped.

## Stages & actions

Revised after GPT Sol's plan review (`…-review-sol.md`), which changed three things: the shared
10-minute master became a process-scoped one, the mosh `--ssh=ControlPath` step was dropped, and
`-p -` turned out to break the attach.

### Stage: the tmux target colon (the actual bug) — done

- [x] Extract the listing into `scripts/gjd-remote-tmux.ts`: `SESSION_FIELDS`, `buildSessionScript`,
      `parseSessionLine`, `parseSessions`.
- [x] **Failing test first.** Written against the OLD lenient parse and watched go red: 4 failures,
      including `expected { name: 's-0831-1554', …(5) } to be null`.
- [x] Not the colon — **no target at all.** `tmux ls -F` fills every field for every session in one
      command, so the mistake is unavailable rather than fixed. Sol independently recommended the
      same. Verified on the box: `chat-markdown-formatting-and-tools|1788190336|1|1`.
- [x] Fail closed. `parseSessions` returns `{ sessions, unreadable }` and `sessions()` dies if
      anything is unreadable — Sol's point, and a good one: a silently short list makes `new` think
      a taken name is free and `resume` attach to the wrong "most recent".
- [x] Live check: `ls` now shows real ages and `ATT no` for a detached session.

### Stage: SSH connection multiplexing — done

- [x] **Process-scoped master, not `ControlPersist`.** This is the one real reversal from the plan.
      A persistent master would also make the *next* command instant, but Sol named the failure it
      buys: a master whose TCP connection has been blackholed by a sleep or a network change still
      completes the local mux handshake, and the client then waits forever for a session that will
      never open — `ConnectTimeout` does not bound that request. On a tool where every other pause
      is the network, an unbounded hang is indistinguishable from a slow link. A master that dies
      with the command cannot outlive the network it was made on.
- [x] Socket at `mkdtempSync("/tmp/gjdr-") + "/s"`, not under `$TMPDIR`. macOS caps `sun_path` at
      104 bytes, `$TMPDIR` here is already 48, and OpenSSH first binds the master at
      `<path>.<16 random chars>` — so the limit applies to a name 17 bytes longer than the one we
      write. The chosen path is ~35 bytes with the suffix.
- [x] A master that will not start is not fatal: `sshMasterOpts()` returns `[]` and every command
      goes on its own connection, slowly. Turning a speed-up into an outage would be worse.
- [x] Torn down before `attach()` — an attach lasts hours and a `-N` master idling beside it is a
      connection nobody is watching — and again on `process.exit`.
- [x] **Dropped: passing the socket to mosh.** Sol found that mosh 1.4.0's default
      `--experimental-remote-ip=proxy` appends `-S none` to its own ssh command line *after*
      anything in `--ssh`, so sharing is switched off whatever we ask for. Confirmed at
      `/opt/homebrew/bin/mosh` line 407, with the default set at line 73. It would have looked like
      it worked.
- [x] `SSH_OPTS` split into `SSH_OPTS` and `SSH_OPTS_INTERACTIVE`. The `ssh`, `tunnel` and ssh-attach
      paths passed **no options at all**, so a rebuilt box met them with the raw host-key
      verification error that `accept-new` exists to avoid. They now get `accept-new` and
      `ConnectTimeout` but not `BatchMode`, which is right for a session you type into.
- [x] `host()` memoised — it shelled out to `tofu output` once per connection, six times for `new`.

### Stage: fewer round trips still — done, because the measurements asked for it

Sol said to defer batching until measured. Measured, over an **already shared** connection: a plain
command is 0.7–1.3s and an `scp` of a **3-byte file** is 3.87s, because sftp does its own handshake
on top. `new -p` did two of them.

- [x] `writeRemote(content, path, { exec })` replaces `scpTo` in `cmdNew`: the bytes go down the
      command's stdin, so there is no local temp file, no second protocol and no quoting. The
      `chmod +x` and the `mkdir -p` ride the same round trip.
- [x] It proves the write arrived: `cat > f.part && [ "$(wc -c < f.part)" -eq N ] && mv -f f.part f`.
      `cat` exits 0 on a stdin that ended early, so without the count a dead connection leaves a
      TRUNCATED job script that still starts a session — the wrong-tree failure by another route.
      **Verified by forcing a mismatch against the live box**: exit 1, nothing at the real path.
- [x] `push-env`'s own staged write is left alone. It is security-sensitive (umask 077, mode 600,
      read back and compared) and does not belong in this change.

### Stage: `-p -` for a stdin prompt — done

- [x] Reads stdin to EOF when `--prompt` is exactly `-`; empty stdin is an error, not "no prompt".
- [x] Runs in `main()` before `cmdNew`, so `provisionalName()` sees the prompt and not the literal `-`.
- [x] **The attach problem, which the plan missed and Sol caught.** The heredoc *is* stdin, so once
      the prompt is read fd 0 is an exhausted pipe, and everything downstream quietly does the wrong
      thing: `moshProbe` sees a non-TTY and reports mosh unavailable, then `ssh -t` declines to
      allocate a pty. Both confirmed against the box. `-t -t` forces the pty but leaves stdin spent,
      so tmux sees EOF and detaches — worse, because it looks like it worked.
- [x] Fixed by reopening `/dev/tty`, which is the controlling terminal whatever fd 0 was redirected
      to, and handing that fd to the probe and the attach. Sol's simpler v1 (require `--no-attach`)
      was passed over because it takes the feature away from the case Greg asked for.
- [x] No controlling terminal ⇒ a clear message naming `resume` and `--no-attach`. **Exercised**:
      the success path could not be, because this session has no controlling terminal — Greg's
      terminal is where that gets confirmed.
- [x] Help text and EXAMPLES updated.

### Stage: what the code review found — done

GPT Sol's second review (`…-code-review-sol.md`) said **do not land yet** and named three P1s and
two P2s. All five are fixed, and each one was reproduced before it was.

- [x] **P1: a broken tmux read as an empty box.** `tmux ls | while read` exits 0 with no output when
      tmux is missing — byte-for-byte what an idle box looks like — and every caller reads that
      emptiness as an answer. **Reproduced on the box** with tmux off the PATH: exit 0, empty
      stdout. Fixed with a completion marker the script prints last and a `failure` the caller dies
      on. tmux's own "no server running" is translated as the one genuine empty case. Verified both
      ways: `GJDERR tmux is not on this box` / exit 3, and a clean empty list against a dead socket.
- [x] **P1: two concurrent `new` runs could start each other's job.** The name check is a look, not
      a reservation, and the prompt and job paths were name-keyed. Generated jobs differ mainly by a
      same-length UUID, so A's byte count validates B's file, renames it and runs it — A's tmux
      environment then holds session id A while Claude runs as B, and title discovery points at the
      wrong transcript forever. Fixed by keying the remote artefacts on the session id.
- [x] **P1: an oversized prompt gave a green tick over a Claude that never started.** The job runs
      `claude "$(cat …)"`, so the prompt is one argv string, and Linux caps that at ~128 KiB with
      E2BIG — which happens on the box, where the fallthrough to `exec bash -l` leaves a live
      session while the laptop prints `✓ started`. `-p -` makes this easy to hit by accident.
      Refused at 96KB before anything touches the network.
- [x] **P2: the master was not cleaned up on Ctrl-C — and the obvious fix does not work.** I wrote
      `process.on("SIGINT")` handlers, then **probed them**: a process blocked inside `spawnSync`
      taking SIGINT ran neither the signal handler nor the `exit` handler. It simply died, leaving
      `ssh -M -N -f` behind. gjd-remote is inside `spawnSync` essentially all the time, so that
      cleanup would have been code that looks like it runs and does not. The handlers were deleted
      and `ControlPersist=30` put on the master instead: it bounds an orphan's life without needing
      us to be alive. **Verified**: `kill -9` mid-command orphans a master, and it is gone 35s
      later. This cannot cause the stale-master reuse Sol warned about in the plan review, because
      the socket path is a fresh `mkdtemp` per process — no later invocation can find it.
      `ServerAliveInterval=15` bounds a blackhole arriving mid-command.
- [x] **P2: the framing was not actually strict.** `parseSessionLine` took a four-field line, and
      any junk in the provisional slot silently became `false` — the flag deciding whether `ls` may
      rename a session out from under whoever named it. **Reproduced**, then fixed: the field count
      is exact, every field must be one of the values it is allowed to be, and the timestamp is
      checked as a string (`Number("17e9")` is a fine integer and tmux has never emitted one).
- [x] The delimiter denial-of-service Sol also found — a `|` in a session name shifting every field
      — is gone too. The record now leads with `#{session_id}` (a dollar and digits, which the shell
      can split off safely), the name is pulled off the tail with parameter expansion rather than a
      second `tmux display` call, and both free-text fields travel base64. There is no free text on
      the wire, so no input can make the parse quietly wrong.

Not taken: Sol's point that `confirmStarted()` proves only that tmux still exists, so any immediate
Claude failure still prints green. True, and it is a real hole — but it is a peer's function and a
different bug from this one. **Left for Greg to decide**; the E2BIG route into it is closed.

### Stage: finish

- [x] `npm run typecheck` clean; `npm run lint` clean on both new files.
- [x] `npm test` — 7080 passing, one unrelated failure each run from peers' concurrent runs against
      the shared local Postgres (`run-lock`, then `admin-store`); each passes on its own, and I
      touched no database code.
- [x] Live smoke throughout: `ls`, `new`, `new -p -`, `kill`, the prompt byte-exact on the box, the
      job UUID-keyed and executable, no `.part` left behind, no orphaned masters.
- [ ] **For Greg:** confirm `gjd-remote new -p - <<'EOF'` attaches from a real terminal. It is the
      one path that could not be tested here — this session has no controlling terminal, so only
      the failure branch was exercised.
- [ ] Update `docs/project/` with the timings and the multiplexing behaviour.

## Results

| | before | after |
|---|---|---|
| `gjd-remote new --no-attach` | 12.3s at 78ms RTT | **6.75s at 307ms RTT** |
| `gjd-remote ls` | 2.8s | 1.9–2.8s |
| connections opened by `new -p` | 7 fresh handshakes | 1 handshake + 5 cheap commands |

The remaining floor is one handshake, 2–5s depending on the link. The attach still costs two mosh
bootstraps at ~6s each; that is untouched, and it is the next thing worth attacking if Greg wants
`resume` faster. Sol's assessment stands: there is no honest cheap probe for "does mosh work here" —
UDP has no handshake, mosh's port is allocated per session, and caching success goes stale exactly
when the network changes. So the options are to try mosh directly and let Greg pass `--ssh` on
known-bad networks, or to cache failures only. Both are separate decisions.

## What this cost, and what it bought

Three of the five things fixed here were **silent successes**: a tmux listing that reported an empty
box when tmux was gone, a parse that turned missing fields into "attached, aged 56 years", and a
green tick over a Claude that never started. None of them would have been found by looking at the
output, because in every case the output looked exactly like the right answer. The performance work
is what made anyone look.
