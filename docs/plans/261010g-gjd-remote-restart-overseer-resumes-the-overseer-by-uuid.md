# `gjd-remote restart-overseer`: resume the Overseer by uuid, not by name

Status: built 2026-10-10. Queue item `qi-d66em72h` ("Steer route cannot reach an Overseer resumed by
name").

## Why

The Overseer is a long-lived Claude session in the tmux session `Overseer`. When its `claude` exits,
the pane falls back to the login shell that `new-claude`'s job script `exec`s, and Greg brings it back
by typing a resume into that shell. Twice he typed `claude --resume Overseer`: Claude accepts a
name, but the fleet dashboard's steer route (and so `tell-overseer`) trusts a pane only when the
`claude` command line carries the conversation's uuid, so it refused every message with
`no-claude-in-pane` until the Overseer was restarted with `claude --resume <uuid>`.

The uuid is not something to remember: it is whatever is in the session's tmux environment as
`CLAUDE_SESSION_ID`, which is what `gjd-remote ls` reads (`Session.claudeId`) and what the steer
route compares the command line against. So the right command is always derivable, and the fix is to
have the tool type it.

## What

`gjd-remote restart-overseer [--no-attach]`:

1. Lists the box (`sessions()`) and asks `overseerClaim` who holds the claim. Anything but exactly
   one holder is a refusal, with the same sentence `ls` would print.
2. Takes that session's `claudeId` — the same `CLAUDE_SESSION_ID` the steer route checks — and
   refuses if it is not a lower-case uuid (the shape `claude-argv.ts` accepts after `--resume`).
3. Takes its launch directory from `GJD_REMOTE_DIR` (`meta.dir`); a legacy session with no metadata
   is refused, because the resume should run where the session was launched — that directory
   carries the project's settings and is where its transcript lives.
4. Refuses unless the pane is **at its shell with nothing running** (`proc: none`). A live Claude,
   a `claude --resume Overseer` (which `ls` reads as `busy`), a pending `--wait`, or an unreadable
   process table all refuse, naming what to do: `/exit` the Claude in the pane, then run this again.
   **It never kills anything.**
5. On the box, in one ssh round trip, it types only with **positive evidence of an empty bash
   prompt**: exactly one pane, not dead, not in copy mode, `bash` in the foreground; `pgrep -P` finds
   no child (only its exit 1 counts as "none" — an error refuses); the claim, `CLAUDE_SESSION_ID`
   and `GJD_REMOTE_DIR` still say what the listing said; and the cursor's row is a whole, unwrapped,
   ASCII default bash prompt (`user@host:dir$ ` or `bash-N$ `) with nothing after the cursor or
   below it. Anything else refuses, and the refusal prints the line to type by hand. Then it types

   ```
   cd -- '<dir>' && claude --resume <uuid> --permission-mode auto
   ```

   then Enter — exactly what Greg would type, into the interactive login shell that already holds the
   job's environment. Then it attaches, unless `--no-attach`.

`--permission-mode auto` because that is what every `new-claude` launch passes, for the reason
written beside it there (a `default` session stalls with nobody watching), and because
`claude --resume <uuid> --permission-mode auto` is the shape `claude-argv.ts` documents as readable.

## Options passed over

- **Teach the steer route to accept `--resume <name>` by resolving the name to a uuid.** The name
  would have to be matched against transcript titles under `~/.claude/projects/`, which is a second
  way of finding the uuid, and titles are not unique (any session can be `/rename`d "Overseer"). A
  guess inside a safety check is the wrong place for one. Removing the footgun at the point where the
  command is typed is simpler and leaves the route's rule — the uuid is on the command line — intact.
- **`tmux respawn-pane -k` with `bash -lc 'claude --resume …; exec bash -l'`.** Deterministic, but it
  kills the pane's shell and starts a non-interactive login shell, which does not source the parts of
  `.bashrc` behind its interactive guard, and loses the environment the job script exported before its
  `exec bash -l` — the shape of the 2026-09-08 "OpenRouter key absent from `/proc/<pid>/environ`"
  incident. Typing into the existing shell is what Greg does by hand, with the same environment.
- **Killing a running Claude first, so it is a true "restart".** Simpler to use, but it would
  interrupt an Overseer mid-turn — mid-deploy, possibly. A refusal that says "`/exit` it first" costs
  one keystroke sequence and cannot lose work.
- **Printing the command for Greg to paste.** Less code, but leaves the typing — the footgun — with
  him.

## GPT Sol's plan review, and what changed

No P0. The uuid design and passing over name-resolution were upheld, and Sol checked that
`claude --resume <uuid> --permission-mode auto` as faithful argv reads as an interactive session for
that uuid in `claude-argv.ts` and `isClaudeForSession` returns `match: "yes"`. The P1s were all
about typing into a shell, and all were taken:

- **"No children" is not "idle prompt"** (a builtin `read` has none; vi mode and a backslash
  continuation defeat `C-e C-u`). The first draft cleared the line; it now refuses any state it
  cannot prove is an empty primary prompt, rather than trying to clear it.
- **`pgrep` failing open**: any non-1 exit permitted typing. Now only exit 1 does.
- **Control bytes in the directory**: `shq` makes them one shell word, but `send-keys -l` still
  delivers a Ctrl-C to the terminal. `overseerResumeLine` throws on any.
- **The check-then-type race** cannot be closed without the shell's cooperation. Accepted: the
  window is milliseconds, it needs a person to start a Claude in that pane in exactly that window,
  and the worst outcome is a line delivered as a message, not a kill.
- P2, the directory: current Claude finds a uuid's transcript from other directories, so "a resume
  from the wrong directory finds nothing" overstated it. The `cd` stays because the launch directory
  carries the project's settings and is what the session was started in.

## GPT Sol's code review, and what changed

No P0. Sol fixed, with regressions that failed against the earlier code: a prompt *suffix* check
that `read x # ` typed after a real prompt passed (now the whole default prompt must match); wrapped
and non-ASCII rows evading the cursor-column slice (now `LC_ALL=C`, ASCII only, rows below the
cursor checked); the listing going stale before the box acts (the claim, uuid and directory are
re-read on the box, exit 5, and no stale manual line is printed); a success read off a loose
substring (now exit 0 *and* exactly `GJD_TYPED`); and a part-sent line (exit 4 says look before
retrying).

Two of its changes were wrong on a real tmux, which its sandbox could not run, and were fixed after:
its wrap check refused whenever the row above was full width — which is what Claude Code leaves when
it exits, so it would have refused the ordinary case — and is now tmux's own wrap flag
(`capture-pane -J` returns the two rows as one line only when they wrapped); and a cursor on a blank
row past the last printed one read as a coordinate fault rather than as a blank row.

Left as accepted, Sol's remaining P1: **`read -p` or a customised `PS2` can draw something
identical to the primary prompt**, and nothing on the screen can tell them apart. Proving shell state
needs the shell's cooperation (a hook writing its state somewhere), which is more machinery than a
command Greg runs a few times a month earns. Somebody would have to leave the Overseer's pane in that
state deliberately.

## The test that reached the live Overseer, 2026-10-10

The first version of the real-tmux test started its panes with `tmux new-session -e PATH=<stub>:…`
and used the live Overseer's uuid as its fixture. In the pane, `claude` resolved to the **real**
binary, so the test resumed the Overseer's conversation in a disposable tmux server for about five
seconds before `kill-server` ended it. Nothing was typed to it, and the live Overseer process was not
touched, but its startup appended two `task-notification` records (marking a background agent and a
background shell "stopped") with `cwd` in the test's temp directory to
`606cb12a-….jsonl`, branching off the live chain. They are left in place: editing a live transcript
is riskier than a stray branch the next resume will not pick as its leaf.

The class is **a stand-in that silently falls through to the real thing**: a stub on `PATH` that is
not first on `PATH` is no stub. The test now has three independent guards — a uuid that exists
nowhere, panes started under `env -i` with `PATH` holding only the stub and `HOME` a scratch
directory, and a positive check that the pane's `command -v claude` *is* the stub before anything is
typed.

## Known limits

- **"Typed" is not "started".** Like `tell`, success means the keys went in. It attaches by default,
  so the person who ran it sees whether Claude came up.
- **An in-process `/clear` or `/resume` changes the conversation without changing
  `CLAUDE_SESSION_ID`.** The steer route has the same blind spot (hetzner-remote-server-box.md says
  so). This command resumes the uuid the route will check, which is the consistent choice.
- **After a reboot there is no tmux session and no claim**, so there is nothing to restart in place;
  that path stays `new-claude` + `claim-overseer`, with the uuid from `gjd-remote log`.
- `ls`'s process probe does not recognise `--resume <uuid>`, so a resumed Overseer shows `busy`
  rather than `claude` there. The dashboard's reader does recognise it. Not changed here.

## Tests

`tests/gjd-remote-restart-overseer.test.ts`: the decision against parsed listings (every refusal
arm, and the happy path), the command builder's validation, and a real-tmux run on a disposable
socket where the pane's `claude` is a stub on `PATH` that records its argv and working directory — so
the typed line is proved to arrive as `claude --resume <uuid> --permission-mode auto` in the right
directory — and each refusal (half-typed line, text after or below the cursor, continuation,
builtin `read`, foreground and background children, copy mode, `pgrep` failing, two panes, a
released claim, a changed directory, a wrapped or non-ASCII prompt) is proved to type nothing. Every
guard was removed in turn and its test watched going red.
