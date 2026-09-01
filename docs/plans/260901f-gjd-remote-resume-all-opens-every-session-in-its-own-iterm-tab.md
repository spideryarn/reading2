# `gjd-remote resume-all` — every session in its own iTerm tab

Written 2026-09-01, built the same day.

> Write a gjd-remote `resume-all` command that opens all the sessions, each one in its own new
> (purple-coloured) iTerm tab
>
> — Greg, 2026-09-01

Coming back to the laptop, the box holds a handful of tmux sessions and getting into all of them is
`gjd-remote resume <name>` typed into a tab you opened by hand, once per session. `resume-all` does
that: one new iTerm tab each, each attached to its own session.

## What it does

```
gjd-remote resume-all
    skipped fix-the-toc — already attached — --include-attached to take it over
    ✓ granularity-zoom
    ✓ referee-mode
    2 tabs — each attaches on its own; they go violet as they connect.
```

- [`scripts/gjd-remote-resume-all.ts`](../../scripts/gjd-remote-resume-all.ts) — the guards, the
  AppleScript, and which sessions get a tab. Split out from `gjd-remote.ts` for the reason all its
  siblings are: `gjd-remote.ts` calls `main()` at import time, so nothing in it can be unit-tested.
- [`tests/gjd-remote-resume-all.test.ts`](../../tests/gjd-remote-resume-all.test.ts) — 20 tests, and
  every guard was watched refusing rather than allowing (below).
- `cmdResumeAll` in [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — the ordering, and the
  one `osascript` helper.

## The decisions, and the simpler thing each one passed over

**The colour comes from the existing mechanism, not a new one.** Each tab is handed the ordinary
`gjd-remote resume <name>` command line, and that paints itself violet exactly as it does when you
type it — [`scripts/gjd-remote-tab.ts`](../../scripts/gjd-remote-tab.ts). The alternative was to
colour each new tab from here, which needs `write`-ing a `printf` of escape codes into somebody
else's tab, and gives two places where "this tab is on the box" could be decided differently. The
cost of the choice, and it is real: a tab is its profile colour for the second or two between opening
and mosh connecting.

**AppleScript, which `gjd-remote-tab.ts` deliberately avoids.** That file says at length why an
escape sequence beats AppleScript — it runs *in* the tab it is colouring, so there is no tab to
address. That reasoning does not carry here, because this opens tabs it is not running in, and there
is no escape sequence for "open a tab". So every trap in
[../reusable/iterm.md](../reusable/iterm.md) applies, and the file is written against it.

**Two shapes of script, and only one of them may be retried.** A walk over `every window` can be
invalidated mid-flight by a peer closing a tab: AppleScript raises `-1719` and aborts the whole
script, and the only cure is to run it again. That cure is poison for a script that *creates* a tab —
a retry is two tabs for one session. So the read-only walks (find my window; select a tab) are
retried, and the one mutating script addresses the window directly as `window id 456`, with no
enumeration in it for the race to spoil. `tests/gjd-remote-resume-all.test.ts` asserts that script
contains no `repeat with`, which is the structural version of the rule.

**The keyboard is put back, and the capture happens first.** `create tab` selects the new tab, so
capturing "where I was" afterwards returns the new tab and the restore is a no-op that looks exactly
like a working restore — the bug iterm.md records from the first version of its own script. Here the
capture is in a different `osascript` invocation from the create, so it cannot drift: the resolve
script reads the window id and the selected tab's session UUID together, before anything is made.
The restore is by UUID, because AppleScript objects do not survive between `osascript` processes.
It is partial by nature and iterm.md says so: it restores the *window's* selected tab, not a
different frontmost window, and it overwrites a newer choice you made while it worked. Hence the note
in `--help` to let it finish before typing.

**Attached sessions are left alone by default.** `resume` runs `tmux attach -d`, which detaches
whatever client is already there. Opening a tab for an attached session would quietly blank the tab
you already had it in, or drop a session you are watching from another machine. `--include-attached`
says you meant it. The simpler option — open everything — was passed over for that reason alone.

**`write ... text` into a shell, not `create tab ... command "…"`.** iTerm's `create tab` does take a
`command` parameter, and it looked like the tidier route. It runs the command *as* the session's
program, so a command that dies immediately takes its tab and its error message with it — a failure
you would see as tabs flashing and vanishing — and the program is not a login shell, so `gjd-remote`
need not be on its PATH at all.

**The `gjd-remote` typed into the tab is an absolute path.** The new tab gets a fresh login shell
whose PATH is not necessarily this one's. `resumeBin()` prefers `$GJD_REMOTE_BIN`, then whatever
`command -v gjd-remote` resolves to, and falls back to running this checkout the way the `~/bin` shim
does — absolute both times, because `npx tsx` resolves `tsx` from the current directory and a new tab
starts in the home directory.

**It refuses rather than degrading.** The colour is cosmetic and skips itself silently where the
bytes might be printed instead of obeyed; this is not cosmetic, so the same conditions are a refusal
with a sentence saying which one. `ITERM_SESSION_ID` and `TERM_PROGRAM` are ordinary inherited
variables: inside tmux they name the tab the tmux server was started from, and across ssh they
describe the machine you came from. Opening a dozen tabs in somebody else's window is not a mistake
you can take back.

## How it was checked

Unit tests do not prove a terminal was driven, so both halves were done.

**Every guard was made to refuse**, by mutating the source and watching the right test go red — a
guard you have never seen refuse is not evidence ([../reusable/silent-success.md](../reusable/silent-success.md)):

| Mutation | Went red |
|---|---|
| drop the `SSH_CONNECTION` / `SSH_TTY` clause | "refuses where ITERM_SESSION_ID is inherited from somewhere else" |
| put a `repeat with win in windows` into the tab-creating script | "addresses the window by id in the one script that must not be retried" |
| drop the oldest-first sort | "orders oldest first" and "takes them when asked" |

**The AppleScript was run against a live iTerm 3.6.6** on 2026-09-01: the resolve script returned
`456` and this session's own UUID as the selected tab, parsed by `parseHere` into
`{ windowId: 456, selectedSession: "65BF2B51-…" }` — so the window lookup, the `character id 9`
separator and the strict parse all work on the real thing rather than on a fixture. Then the whole
command was run for real and the tabs inspected.

## Known holes

- **One session per tab.** A split tab holds several sessions; the restore selects the tab holding
  the session that was current, not the pane. iterm.md's scripts make the same assumption.
- **Time-of-check to time-of-use.** A session can be attached from elsewhere between reading the list
  and opening its tab, in which case that tab detaches it after all.
- **The tab is uncoloured until `resume` connects.** See the first decision above.
