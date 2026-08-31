# `gjd-remote new-claude --wait`, and `gjd-remote ssh <command>`

Two small additions to [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts), landed 2026-09-01.
The interesting part of this doc is not either of them — it is the much larger thing Greg asked for
first, and why almost none of it was built.

Reference: [remote-box.md](../project/remote-box.md). Cross-family review by GPT Sol before the
build, quoted throughout.

## What was asked

> What I'd ideally like to do would be to run something like
> `gjd-remote new-session --add-to-queue """A long prompt here"""` … MUST-HAVE it would start up a
> new Claude Code session, and start work. SHOULD-HAVE if my laptop goes to sleep or I lose the
> internet connection, it should automagically reconnect & resume … SHOULD-HAVE if the agent has
> questions, I can answer them interactively … NICE-TO-HAVE if the agent determines with high
> confidence that everything has completely finished … it can close down the session and tab …
> NICE-TO-HAVE the optional `--add-to-queue` would first check how many other sessions we have
> running, and if above some configurable number, would hold off …
>
> Actually, on thinking this through, I wonder if it would be simpler for me to gauge how much there
> is currently to run, and simply specify a `--wait num_hours` … or even just add "Run unix sleep
> for num_hours…" to the beginning of the prompt
>
> — Greg, 2026-08-31

## What was built

**`--wait DURATION`** on `new-claude`. Units `s m h d`, one required. The session is created now and
`claude` starts later, from a `sleep` in the job script. Behaviour, and why, is in
[remote-box.md § Starting it later](../project/remote-box.md#starting-it-later---wait).

**`gjd-remote ssh <command>`.** It ran a login shell and ignored its arguments, so
`gjd-remote ssh 'free -g'` printed the MOTD and exited 0.

The pure halves of both are in [`scripts/gjd-remote-run.ts`](../../scripts/gjd-remote-run.ts),
tested in [`tests/gjd-remote-run.test.ts`](../../tests/gjd-remote-run.test.ts), because
`gjd-remote.ts` calls `main()` at import time and nothing in it can be unit-tested at all.

## What was deliberately not built

**The MUST-HAVE and both SHOULD-HAVEs already existed** before any of this. `new-claude -p -`
starts a session with a prompt; mosh reconnects across sleep and roaming on its own; tmux plus
`gjd-remote resume` covers the terminal dying; the session is an ordinary attached tab, so questions
are answered by typing. No new subcommand, and no rename.

**The queue.** Sol's objection is the one that decided it: the proposed design — every job polling
"are there fewer than N running?" every thirty seconds — *is not a queue*. Ten sleepers wake
together and race, so the newest can win. A real one needs `flock` on N token files (the kernel
releases the lock when the process dies, which survives `kill -9`, a tmux kill and a reboot; a
marker file survives none of them), and admission has to be atomic because count-then-launch is the
same race that already made two concurrent `new-claude` runs able to write each other's files.

It would earn that complexity when three things are true together: Greg regularly submits several
jobs at once, their runtimes are unpredictable enough that fixed delays overlap badly, and box RAM
has actually become the binding constraint. Measured on 2026-09-01 with six sessions live: 31GB
total, 16GB still available, and the `claude` processes were ~0.5GB each — the two big ones were
4.7GB and 3.6GB of `node` doing builds and tests. **So a cap on session count is a weak proxy for
RAM**, and no proxy at all for usage credits, which are per-account and include whatever is running
on the laptop, which the box cannot see.

**"Run sleep for N hours" in the prompt**, the other half of Greg's own suggestion. Claude has to
start, spend a paid call reading the instruction, and choose to obey it — the session and some of
the usage are gone before the waiting begins. The `sleep` costs a bash process.

**Auto-finish.** The sketch was: the agent runs `gjd-finish`, which re-checks the objective
conditions and only then ends the session — the model's judgment as the trigger, a machine as the
gate. The conditions were the problem. "Tree clean, pushed, tests green" passes when the agent did
nothing at all; a push here is not a deploy ([version-control.md](../project/version-control.md));
and **this is a shared tree**, so another agent's uncommitted edit makes "tree clean" fail perfectly
good work, and "no leftover worktree" cannot mean no worktrees globally. What survives is narrower:
bind the result to a commit SHA, prove that SHA is contained in `origin/main`, run the gates against
it in an isolated checkout, and look only at this session's own artefacts.

On hooks, per Sol reading the current reference and **not yet verified here**: `Stop` fires at the
end of every turn *including one that asks you a question*, so a bare `Stop` hook that ends the
session is unsafe; `SessionEnd` fires after the fact and cannot block; `Notification`'s idle event
is ~60s without input, which is not success. The shape that would work is three steps —
`gjd-finish` validates and writes an `approved` marker, the agent writes its last message, and a
`Stop` hook ends the session only if that session already has the marker.

**The reconnect loop.** Worse than nothing. Attaching runs `tmux attach -d`, which kicks off any
other client, so a loop in a stale tab and a deliberate `resume` in a fresh one steal the session
back and forth. And mosh does not exit on network loss — it waits — so the loop fixes almost
nothing.

**Auto-closing the iTerm tab.** [iterm.md](../reusable/iterm.md) documents four plausible close
guards that were all wrong and a modal that can block iTerm from a script. If it is ever wanted, the
route that avoids all of it is to open the tab *with* the command, so iTerm ends the session when
the command exits — no AppleScript, no ownership bookkeeping. Unverified.

## `claude agents --json`, and the trap in it

Claude Code has grown `claude --bg`, `attach`, `logs`, `stop`, `respawn` and `agents` since this box
was built. `claude agents --json` needs no TTY, lists interactive sessions as well as background
ones, and reports the `sessionId` — which `gjd-remote` already pins with `claude --session-id`. That
is a machine-readable answer to "is my session actually running", and the obvious fix for the known
hole where `confirmStarted()` proves tmux has a session rather than that Claude is in it.

**But it does not list every running session.** Measured on 2026-09-01, twice: a session started in
`~` with `--dir ~` had a live `claude --session-id <uuid>` process for at least 35 seconds and
`claude agents --json` matched it **zero** times, while the same launch in the repo checkout matched
once within 25 seconds. The likeliest reason is that a session in a directory Claude has not been
trusted in stops before it registers. So the JSON says *listed*, not *running*, and anything built
on it has to treat "not listed" as "no answer" rather than "not there" — which is the same
[silent-success](../reusable/silent-success.md) shape as `tmux ls` returning nothing.

This is worth knowing before the readiness check is built on it, which is still open.

## The evidence

Unit tests: 19, and every guard was **watched going red** by mutating it — the label check that
keeps shell metacharacters out of the job script, the bare-number refusal, the whole-seconds
refusal, the dropped `ssh` command, the pty rule.

Against the box, 2026-09-01 (`--wait 5s` and `--wait 20s`, in `~` and in the checkout):

- the launch says `✓ created`, never `✓ started`, and names the local time zone
- the generated job, read back off the box: `cd`(4) and `command -v claude`(5) **before**
  `sleep 20`(9) **before** `claude`(11)
- five seconds in: the pane says what it is waiting for and until when; no Claude process
- after the deadline: `claude --session-id <our uuid>` is running, listed by
  `claude agents --json`, and the pane shows the Claude Code UI under the session's own name
- `-p -` and `--wait` together do not fight over the terminal — with the prompt on stdin there is
  nothing to attach to, and `--wait` does not attach anyway
- `kill` on a waiting session ends it with nothing having run
- `ssh 'echo …; hostname; nproc'` prints all three; `ssh 'exit 7'` exits 7; a failing command exits
  2; `ssh ''` is refused rather than quietly becoming a shell; output pipes with no pty bytes in it

Three probes in the first smoke run were wrong and reported failures that were mine, not the code's:
the job directory is `~/gjd-remote`, not `~/.gjd-remote`; `pane_current_command` says `bash` either
way, because the job script is the pane's process and `claude` is its child; and macOS `cat` has no
`-A`. Each was rewritten until it was reading the thing it claimed to read. **A failing probe is
cheap; a passing one that reads nothing is what this repo keeps being bitten by.**

## Still open

- The readiness check — `confirmStarted()` still proves only that tmux has a session, and the
  `claude agents --json` route needs the caveat above designed into it.
- A `WAITING` state in `gjd-remote ls`. Sol asked for it and it is right: a waiting session is
  indistinguishable from a running one in the listing today. It needs an eighth field in the session
  record, whose parser deliberately refuses any line that does not have exactly seven.
- Whether `claude --bg` makes part of the tmux layer redundant. Not investigated.
