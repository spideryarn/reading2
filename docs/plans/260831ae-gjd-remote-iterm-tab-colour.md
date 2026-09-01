# Colour the iTerm tab while it is on the box

> Can we make `gjd-remote` automatically colour the iTerm tab purple whenever creating a new
> shell/Claude/etc?
>
> — Greg, 2026-08-31

A dozen tabs in one iTerm window look identical, and the difference that matters — is this shell on
the laptop or on the Hetzner box? — is invisible until you type into the wrong one. So every
`gjd-remote` command that hands the terminal to the box paints the tab violet while it holds it, and
hands the colour back when it lets go.

## What was built

- [`scripts/gjd-remote-tab.ts`](../../scripts/gjd-remote-tab.ts) — the colour, the byte sequences and
  the guards. Its own file so all three can be tested without a terminal, the same reason
  `gjd-remote-tmux.ts` and `gjd-remote-mcp.ts` are their own files.
- `runOnTheBox()` in [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — the one place that runs
  the thing which takes the terminal over: paint, spawn, un-paint, exit the way it exited. Used by
  `attach()` (so `new-claude`, `new-shell` and `resume`), `ssh` and `tunnel`.
- [`tests/gjd-remote-tab.test.ts`](../../tests/gjd-remote-tab.test.ts) — 13 tests of the bytes, the
  env parsing and the guards, with no terminal involved.
- [`tests/gjd-remote-tab-lifecycle.test.ts`](../../tests/gjd-remote-tab-lifecycle.test.ts) — 3 tests
  that run the real CLI in a real pty, including a real Ctrl-C.

Default `#a78bfa`, Tailwind violet-400. The first attempt was a saturated purple and Greg looked at
it:

> I was looking for the slightly more faded/violet fill
>
> — Greg, 2026-08-31

`GJD_REMOTE_TAB_COLOUR=off` switches it off; a `#rrggbb` picks something else. Anything that is
neither is refused by name rather than falling back to the default, because a mistyped colour that
still paints violet is a setting that looks honoured and is not.

## Why an escape sequence written to our own stdout

`gjd-remote` **runs in the tab it is colouring**. mosh and ssh replace this terminal's contents; they
do not open a new one. So `process.stdout.write` reaches exactly the right tab, with no session
lookup, no Automation permission, and none of the ways addressing a tab goes wrong in
[../reusable/iterm.md](../reusable/iterm.md).

There is no AppleScript route anyway. **iTerm 3.6.6's dictionary has no tab-colour property** —
`sdef /Applications/iTerm.app | grep -i 'tab color'` prints nothing. It has `background color`,
which is the pane fill, a different thing that would tint the text area rather than the tab.

### The simpler options that were passed over

- **AppleScript.** Not simpler; not possible. See above.
- **iTerm's Python API** (`LocalWriteOnlyProfile.set_tab_color`) is the only way to colour a tab from
  *outside* it. It needs *Enable Python API* ticked, a WebSocket handshake and a Python runtime, and
  buys nothing here, because we are inside the tab already.
- **`OSC 1337 ; SetColors=tab=RRGGBB`** does the same job in one sequence instead of three. Not
  chosen only because OSC 6 is what was verified against the live terminal, and three short writes is
  not a cost anyone pays. Either would work; don't rewrite it without re-doing the check below.
- **Colouring from the box** — a hook in the remote shell emitting the sequence up through mosh.
  Rejected: it needs configuration on the box as well as here, and iTerm's own escape-code docs say
  its proprietary sequences may not survive tmux, which every remote session runs inside.
- **A separate iTerm profile for remote tabs.** More machinery, and it cannot follow `resume` into a
  tab that already exists.

### Where it deliberately does nothing

`canColourTab` fails closed five ways — not a TTY, not iTerm, inside tmux or screen, over ssh, or
under `CI`. The first matters most: `gjd-remote ls | grep foo` must not put escape bytes in the pipe.
tmux is because iTerm's proprietary codes may not survive a multiplexer (and it covers iTerm's own
`tmux -CC`); ssh and tmux share a second reason, which is that `TERM_PROGRAM` is an ordinary
inherited variable and can say `iTerm.app` when the terminal in front of you is something else —
the same reasoning [../reusable/iterm.md](../reusable/iterm.md) already applies to `ITERM_SESSION_ID`.

What it deliberately does **not** detect is a pty recorder such as `script(1)`, which keeps
`TERM_PROGRAM` and hands you a real tty, so the sequence both reaches the terminal and lands in the
recording. A terminal recording is made of escape sequences, and gjd-remote already writes colour
codes into one through every `dim()` and `green()` it prints. Sniffing for an ancestor process would
be machinery bought for nothing.

### The reset cannot restore, only default

Nothing we can reach from here reads a tab's current colour back — there is no OSC query for it, and
iTerm's Python API can (`session.async_get_profile().tab_color`) at the cost of the whole Python-API
setup. So "put it back" can only mean "hand it to the profile". Paint and un-paint therefore live in
one function, `runOnTheBox`: you cannot get the reset without having done the paint, so a reset that
wipes a colour somebody else set is not writable by accident.

**Ctrl-C used to leak.** The un-paint runs after `spawnSync` returns, and a Ctrl-C goes to the whole
foreground process group — so it killed the child *and* this process, and nothing after `spawnSync`
ran. Reproduced on Node 26 before believing it. That is not an edge case: `tunnel`'s documented way
out is Ctrl-C, so the leak was the normal path. The fix is an **empty `SIGINT` handler**. Node cannot
run a JS handler while `spawnSync` has the loop blocked, but installing one flips the signal's
disposition from "terminate" to "caught", so the process survives to reach the reset. Only `SIGINT`:
it is a process-group signal, so the child gets it too and `spawnSync` returns. Catching `SIGTERM` or
`SIGHUP` would arrive at us alone and leave `gjd-remote` waiting on a child nobody had told to stop —
unkillable by a plain `kill`.

A `kill -9` still leaves the tab violet, which is cosmetic and unfixable by anyone.

### Where the colour is decided, and when

`GJD_REMOTE_TAB_COLOUR` is validated at the top of `main()`, before any command does anything. It was
validated inside the paint, which for `new-claude` meant the tmux session had already been created on
the box before a mistyped colour aborted the run — a cosmetic setting that can strand you. Refusing
still beats falling back to violet, which would make a typo indistinguishable from an honoured
setting; refusing *early* is what makes it proportionate.

For the same reason the host is resolved and the command built **before** the paint. `HOST()` reads
Terraform state and can `die()`, and a `die()` after the paint is a violet tab with nothing in it.

## How it was checked

Unit tests pin the exact bytes, and **every one of them was made to go red** by mutating the source:
dropping the BEL, dropping the ESC, letting a bad env value fall back to the default, deleting the
tmux guard, deleting the TTY guard, a typo in the default colour, and a literal control byte in the
source. Seven mutations, seven reds, all restored — and later two more, for the ssh and `CI` guards
that the review added, which nothing had covered until a mutation showed the tests staying green
without them.

The bytes being right is not the same as the feature working, and a reviewer put the gap plainly:
every call site could be deleted and that file would stay green. So the lifecycle tests run the real
CLI — a fake `ssh` first on `PATH`, a fake host, and `script(1)` for a pty — and read the recording
back. Five more mutations, five more reds: never painting, never un-painting, painting *after* the
child, dropping the TTY guard, and deleting the empty `SIGINT` listener (which reddens exactly the
interrupt test, which is how you know the listener is load-bearing and not dead code).

**The test passed for twenty seconds for the wrong reason.** It waited for the child by polling the
recording — and `script` buffers the recording and flushes it at exit, so the poll never saw anything
and the ^C fired on the fallback deadline every single time. Green here, and intermittently red on a
colleague's machine, which is how it was found: they ran the file three times and got two failures,
one failure, then a pass, with no code change in between. Under load, a deadline-timed keystroke can
land before the CLI has painted. The fix is that the fake `ssh` touches a **marker file** before it
does anything else — a file is not buffered — so the interrupt now arrives when the child is actually
running. The file went from 21 seconds to 1.6, and ten runs alongside a full `npm test` were green.
The lesson is the ordinary one: a test that always takes exactly as long as its timeout is not
waiting for what it says it is waiting for.

Getting a keystroke into `script`'s stdin took three attempts and they all hit one wall: `script`
calls `tcgetattr` on its stdin and dies with `Operation not supported on socket` unless it likes what
it finds. Node's `"pipe"` is a socketpair, so that fails — the same trap `moshProbe` already records
— and macOS `script` rejects a **FIFO** too, with the identical message. Only a real anonymous pipe
works, hence `cat <fifo> | script …`. Every one of those failures produced an *empty* recording,
which contains no escape sequence and so looks exactly like a feature that painted nothing; the
harness returns its own stderr alongside the recording for that reason.

Then the tab itself, watched by eye:

1. A scratch tab was created with the recipe in [../reusable/iterm.md](../reusable/iterm.md), and the
   iTerm window photographed with `screencapture -l <window id>` — which works on an **occluded**
   window, so nothing had to be brought to the front and Greg's focus was left alone.
2. `gjd-remote ssh` typed into it → the tab turned violet.
3. `exit` → the colour was gone.
4. **The control**: `GJD_REMOTE_TAB_COLOUR=#ff7700 gjd-remote ssh` → the tab turned **orange**.

Step 4 is the one that settles it. Several tabs in that window already carry a violet outline from
something other than this change, so "the tab is violet" on its own would have been agreement rather
than evidence — a colour nothing else in the window uses is what makes step 2 mean anything.

The screenshots were looked at live and not kept, so that part is a report rather than an artefact.
The method above is enough to redo it in a couple of minutes, and the lifecycle tests now cover the
same ground without a human eye.

## How it landed

`scripts/gjd-remote-tab.ts` and its unit tests went in on their own, ahead of their caller, because a
peer agent was holding `scripts/gjd-remote.ts` for their own `--wait` and `ssh <command>` work and
could not commit until the module they now import existed. They then took the `runOnTheBox` and
`requireTabColour` hunks and the `hetzner-remote-server-box.md` section along in commit `654b4e7`, naming whose they
were, because that file cannot be split. The lifecycle tests and this document followed once the
flake above was fixed.

## Loose end

Whatever already outlines those tabs violet — it tracks Claude Code sessions, not gjd-remote — means
the box tabs may not stand out as much as Greg wants. If not, change one constant.
