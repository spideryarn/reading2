# Review request: docs/reusable/iterm.md

You are reviewing a **reference doc** (not a plan, not shipping code) that tells an AI coding agent
how to list, create and close iTerm2 tabs from a shell without disturbing tabs it did not create.
The doc is `docs/reusable/iterm.md`, reproduced in full below, together with the raw evidence that
produced each claim.

The audience is another AI agent with `Bash` access, running inside one of many iTerm tabs on a
machine where a human and a dozen other agents are working **at the same time**. The cost of a wrong
claim is that an agent closes somebody's live work.

## What I want from you

Be adversarial about the **factual claims** and the **safety guards**. Specifically:

1. **Wrong or overstated claims.** Anything I assert that my evidence does not actually support. I
   care much more about this than about prose.
2. **The `tty_busy` guard.** It decides whether a tab is safe to close. Where does it give a false
   "idle" (the dangerous direction)? Consider at least: a backgrounded job (`sleep 60 &`), a process
   in a different session on the same tty, a suspended job (`^Z`), `ps` output where `comm` contains
   spaces or a path, a tty that no longer exists, an agent whose shell is not in my allow-list, a
   tmux/screen session inside the tab, and an SSH session sitting at a remote prompt.
3. **The self-identification.** `self=${ITERM_SESSION_ID#*:}` — when is `ITERM_SESSION_ID` absent,
   stale or wrong? What happens inside `tmux`, inside `ssh`, in a shell spawned by a launchd agent,
   or in a tab that was restored from a saved window arrangement? If `self` comes back empty, does
   my `close` guard still refuse to close my own tab? (I believe there is a real bug here — check.)
4. **Shell-injection / quoting.** The script interpolates `$sid` and `$text` directly into
   AppleScript source via a heredoc. What breaks or misbehaves with a quote, a backslash, a newline,
   or a `"` in a command passed to `run`? Is that worth fixing or worth documenting?
5. **The one thing I could not test.** See "Does closing prompt?" — on this machine the per-profile
   `Prompt Before Closing 2` is `0`, so I cannot distinguish "AppleScript bypasses the prompt" from
   "the prompt is disabled here". Is my hedge honest and is my mitigation adequate? If you know the
   answer from iTerm2's source or docs, say so and cite it.
6. **The Permissions section** is the least verified part of the doc — written from general macOS
   knowledge, not tested (Automation permission was already granted on this machine, so I never saw
   the consent dialog or error `-1743`). Correct it if it is wrong.

Please give findings as a numbered list, each with a severity (blocker / should-fix / nit) and a
concrete correction. If a claim is right, don't restate it.

## Evidence — what was actually run and observed

All on iTerm2 3.6.6, macOS Darwin 25.6.0, with ~50 sessions across 6 windows.

**Self-identification mismatch.** `ITERM_SESSION_ID=w5t11p0:486E9CEB-9FBE-420F-8B7E-941FB35360DC`.
Walking the AppleScript object model found that UUID at **window index 1, tab index 12** (window
`id` 456). So `w5`/`t11` do not correspond to live indices.

**`index of tab` fails.** `index of (current tab of window 1)` →
`execution error: iTerm got an error: Can't get index of tab 3 of window id 456. (-1728)`.
The property is declared in the sdef (`prop index type=integer access=rw`).

**`me` is reserved.** `set me to "486E..."` → `syntax error: Can't set me to "...". Access not
allowed. (-10003)`.

**`tab` is shadowed.** Inside `tell application "iTerm2"`, `... & tab & ...` produced output whose
bytes were literally `t a b` (verified with `od -c`): `456tabA5734C24-...tab..indstoneRebel (-zsh)`.
Replacing with `character id 9` bound outside the tell block produced real tab characters.

**tty recycling.** A session on `/dev/ttys041` was closed; a newly created tab was then assigned
`/dev/ttys041`, while its login banner read `Last login: ... on ttys052`.

**`is processing` is unreliable — the key finding.**
- Immediately after `echo AGENT-MARKER-...` completed at an idle prompt: `is processing = true`.
- While `sleep 40` was genuinely running in the tab: `is processing = false`, and my guard
  `if is processing of s then error ...` did **not** fire — the busy tab was closed.

**The `ps` replacement, both directions observed.**
```
idle tab (ttys046):        busy tab (ttys046, sleep 40 running):
Ss  ...ShellLauncher       Ss   ...ShellLauncher
S+  -zsh                   S    -zsh
                           S+   sleep 40
```
`tty_busy` returned IDLE for the first and BUSY for the second, and `close` then printed
`refusing: 30F17E7C-... (/dev/ttys046) has a foreground job: S+ sleep 40` and exited 1.

**Guards observed refusing (each made to go red, not merely to pass):**
- own UUID → `refusing: that is my own session`, exit 1
- bogus UUID `DEAD-BEEF-0000` → `refusing: session ... not found`, exit 1
- busy session → refused as above
- last tab of a window → `refusing: last tab of its window (would leave an invisible husk)`, exit 1

**Husk.** `close` on the only session of a window left `window id 2129` with `tabs=0`,
`visible=false`, still enumerable; `close (window id 2129)` did nothing. By contrast `close (window
id 2449)` on a window that still had its tab removed it cleanly, leaving no invisible window.

**Focus theft (observed).** `create tab` selects the new tab. The human was typing `claude` at the
time; the agent's `write s text "sleep 25"` landed on the same input line, producing
`zsh: command not found: clasleep`. Capturing `current tab` *before* the create and `select`ing it
afterwards was verified to restore selection (`selected in my window is now: 218B8EC4-...`, the
pre-existing tab, not the new one).

**Note on an earlier bug in my own script:** `select (current tab of targetWin)` placed *after* the
create is a no-op, because `current tab` is by then the new tab. It looked like a working restore
and was not.

**Moving tree.** Between two calls a minute apart, the window's tab count read 12 then 11, because a
peer agent closed a tab. Session counts moved from 50–53 throughout, driven by other sessions.

**Full cycle regression.** `list` → 50 sessions; `new`; `run ... 'echo REGRESSION-OK'` (marker found);
`close`; `list` → 50 sessions. All seven sessions created during the whole investigation were
verified closed afterwards, and the six pre-existing visible windows were unchanged.

**Preference read.** `defaults read com.googlecode.iterm2 | grep -i prompt` →
`"Prompt Before Closing 2" = 0;` and `PromptOnQuit = 1;`.

## The doc under review

`````markdown
# Driving iTerm2 tabs from a shell

How an agent with `Bash` can **list, create and close iTerm2 tabs** on macOS without disturbing the
tabs it did not create. Not about this project — carry it anywhere.

Everything below was run against iTerm2 3.6.6 on macOS 15 (Darwin 25.6.0), in a window holding a
dozen live agent sessions. Several of the traps are recorded because they bit during that run.

## The one rule

**Address a tab by its session UUID. Never by index, never by tty.**

Every other handle you might reach for is wrong:

| Handle | Why not |
|---|---|
| `$ITERM_SESSION_ID`'s `wNtNpN` prefix | creation-time labels, not live indices — see below |
| AppleScript window/tab index | shifts whenever anyone opens or closes anything |
| `index of tab` | in the dictionary, but raises `-1728` when you read it |
| tty (`/dev/ttys041`) | **recycled** — a new tab is handed a dead tab's tty number |

The UUID is stable for the life of the session and is the only thing that is.

Your own UUID is the part of `$ITERM_SESSION_ID` after the colon:

```bash
ITERM_SESSION_ID='w5t11p0:486E9CEB-9FBE-420F-8B7E-941FB35360DC'
self=${ITERM_SESSION_ID#*:}   # 486E9CEB-9FBE-420F-8B7E-941FB35360DC
```

That `w5t11` says window 5, tab 11. The session was actually **window 1, tab 12**. Those numbers are
stamped when the session is created and never updated, so they are worse than useless — they look
authoritative and they are stale. Find your own window by searching every window for your UUID.

## The dictionary is the spec

Don't guess at property names. Dump the real one:

```bash
sdef /Applications/iTerm.app > /tmp/iterm.sdef   # then read it, or open iTerm's Script Editor dictionary
```

The parts that matter:

- `window` — `id` (integer), `visible` (boolean), `current tab`, and `tabs`
- `tab` — `current session`, `sessions`. (`index` is declared. It does not work.)
- `session` — `id` (text, the UUID), `tty`, `name`, `contents`, `text`, `is processing`
- commands — `create tab with default profile` (on a window), `close` (on anything), `select`,
  `write ... text`

## Listing

Filter on `visible`. A closed window can linger in the `windows` collection as an invisible husk
(see [Closing the last tab](#closing-the-last-tab-leaves-a-husk)).

```applescript
on run
  set TC to character id 9
  tell application "iTerm2"
    set out to ""
    repeat with win in windows
      if visible of win then
        repeat with tb in (tabs of win)
          repeat with ss in (sessions of tb)
            set out to out & (id of win) & TC & (id of ss) & TC & (tty of ss) & TC & (name of ss) & linefeed
          end repeat
        end repeat
      end if
    end repeat
    return out
  end tell
end run
```

Two syntax traps are already dodged there, and both cost a round trip:

- **`tab` is shadowed.** Inside `tell application "iTerm2"`, the word `tab` resolves to iTerm's
  `tab` *class*, not AppleScript's tab character. Writing `& tab &` silently concatenates the
  literal string `"tab"`, so your output looks like `456tabD44EB5D5tab…`. Use `character id 9`, and
  bind it **outside** the `tell` block.
- **`me` is reserved.** `set me to "…"` fails with `-10003 Access not allowed`.

## Creating a tab

Create it in *your own* window — the one containing your UUID — not in the frontmost window, which
may belong to someone else.

```applescript
on run
  tell application "iTerm2"
    set targetWin to missing value
    repeat with win in windows
      if visible of win then
        repeat with tb in (tabs of win)
          repeat with ss in (sessions of tb)
            if (id of ss) is "SELF-UUID" then set targetWin to win
          end repeat
        end repeat
      end if
    end repeat
    if targetWin is missing value then error "own session not found"
    set prevTab to current tab of targetWin   -- capture BEFORE creating
    set newTab to (create tab with default profile of targetWin)
    set newSess to id of (current session of newTab)
    select prevTab                            -- give the keyboard back
    return newSess
  end tell
end run
```

### Creating a tab steals the keyboard

`create tab` **selects** the new tab. If the human is typing, their next keystrokes land in your
tab. This is not hypothetical — it happened during the run this doc came from:

> Note that I'm working at the same time, so the occasional keystroke may make it into your
> experiments
>
> — Greg, 2026-08-30

The agent found a tab of its own containing `clasleep 25`: Greg had typed `cla` toward `claude`, and
the agent's scripted `sleep 25` was appended to the same input line. Capture `current tab` before
creating and `select` it afterwards, so focus lands back where the human left it.

Note that `prevTab` must be captured *before* the create. Afterwards, `current tab` is already the
new tab, and `select (current tab of targetWin)` is a no-op that looks like a fix.

## Closing a tab

```applescript
close s   -- s is a session; close also accepts a tab or a window
```

Guard it. Refuse to close (a) your own session, (b) a session that is not found, (c) the last tab of
a window, and (d) anything with a job running. Then **verify the session is gone** rather than
trusting the absence of an error.

### `is processing` is not a busy check

It is tempting, and it is wrong in both directions. Measured:

| State | `is processing` |
|---|---|
| idle shell, moments after an `echo` | `true` |
| `sleep 40` actually running | `false` |

It tracks recent terminal *output*, not running jobs. A guard built on it closed a tab with a live
job — a [silent success](silent-success.md): the check ran, reported safe, and was simply wrong.

Ask the OS instead. On an idle tab the foreground process (`+` in `STAT`) is the shell itself; on a
busy one it is something else:

```bash
# busy if any foreground process on the tty is not the shell
tty_busy() {
  ps -t "${1#/dev/}" -o stat=,comm= 2>/dev/null | awk '
    $1 ~ /\+/ { c = $2; sub(/.*\//, "", c); sub(/^-/, "", c)
                if (c !~ /^(zsh|bash|sh|login|tcsh|fish|ShellLauncher)$/) busy = 1 }
    END { exit !busy }'
}
```

```
idle:  Ss  /usr/bin/login …ShellLauncher      busy:  Ss  /usr/bin/login …ShellLauncher
       S+  -zsh                                      S    -zsh
                                                     S+   sleep 40
```

### Closing the last tab leaves a husk

Closing a window's **only** session leaves a window object with `tabs = 0` and `visible = false`
still in the `windows` collection, and `close` on that husk does nothing. It is invisible, so it
harms nothing but your enumeration — which is why every loop above filters on `visible`.

If you want the window gone, **close the window, not its last session**. `close (window id N)` on a
window that still has a tab removes it cleanly, husk and all.

### Does closing prompt?

iTerm has a per-profile **Prompt Before Closing** setting (`"Prompt Before Closing 2"` in the
profile dict of `~/Library/Preferences/com.googlecode.iterm2.plist`).

```bash
defaults read com.googlecode.iterm2 | grep -i 'prompt before closing'
```

On the machine this was written on it is `0` (never), so `close` on a session running `sleep 40`
went through silently. **That single observation cannot tell you whether AppleScript respects the
setting or bypasses it** — with the prompt disabled, both hypotheses predict exactly what was seen.
Assume it can prompt, because a modal blocks iTerm *and* leaves your `osascript` hanging. Two
defences:

- guard with `tty_busy` so you never try to close a busy session in the first place
- wrap scripts in `with timeout of N seconds … end timeout` so a modal costs you N seconds instead
  of the session

## Running a command and reading the output

`write … text` types a line into a session; `contents` reads the visible screen back.

```applescript
write s text "echo hello"
delay 1.5
return contents of s
```

This is screen-scraping, with all that implies: you get the prompt, the echoed command, trailing
blank lines, and whatever was already on screen. `text` gives the whole scrollback instead of the
visible screen. It is fine for a smoke test and a poor way to capture real output — redirect to a
file and read the file instead.

Note `write` appends to whatever is already on the input line, including half-typed human input.

## Permissions

Sending Apple events needs macOS Automation permission (System Settings → Privacy & Security →
Automation) for the process that runs `osascript` — the terminal app, or whatever spawned it. The
first attempt raises a consent dialog; denied, it fails with `-1743` *Not authorized to send Apple
events*. There is no way to pre-check without triggering it, so treat `-1743` as "ask the human to
grant it" rather than as a bug in your script. Nothing here needs iTerm's Python API or its
**Enable Python API** setting; plain AppleScript is enough.

`tell application "iTerm2"` is the name to use. Errors come back attributed to `"iTerm"`, which is
the same app — don't chase it.

## The tab tree moves under you

On a machine running a dozen agent sessions, tabs open and close *between* your calls. During this
run the window's tab count read 12, then 11 a minute later, because a peer closed one. So:

- never cache an enumeration across calls — re-resolve the UUID each time
- have `close` verify the session is actually gone afterwards
- treat "session not found" as ordinary, not as an error worth retrying

## Whole script

Tested end to end: `list` → `new` → `run` → `close` returns the session count to where it
started, and each guard was made to refuse. The AppleScript traversal is built once as a shell
function and interpolated, rather than writing the triple-nested `repeat` five times.

```bash
#!/bin/bash
# iterm.sh — list / create / close iTerm2 tabs without disturbing anyone else's.
set -uo pipefail

self_uuid() { printf '%s' "${ITERM_SESSION_ID:-}" | sed 's/^[^:]*://'; }

# Emit AppleScript that walks every visible window/tab/session, running BODY
# with `win`, `tb`, `ss` bound. Keeps the traversal in one place.
walk() { cat <<EOF
  repeat with win in windows
    if visible of win then
      repeat with tb in (tabs of win)
        repeat with ss in (sessions of tb)
$1
        end repeat
      end repeat
    end if
  end repeat
EOF
}

# Is a tty running something other than its own shell in the foreground?
tty_busy() {
  ps -t "${1#/dev/}" -o stat=,comm= 2>/dev/null | awk '
    $1 ~ /\+/ { c = $2; sub(/.*\//, "", c); sub(/^-/, "", c)
                if (c !~ /^(zsh|bash|sh|login|tcsh|fish|ShellLauncher)$/) busy = 1 }
    END { exit !busy }'
}

session_tty() {
  osascript 2>/dev/null <<EOF
tell application "iTerm2"
$(walk "          if (id of ss) is \"$1\" then return tty of ss")
end tell
EOF
}

cmd_list() {
  local me; me=$(self_uuid)
  osascript 2>&1 <<EOF
on run
  set TC to character id 9
  tell application "iTerm2"
    set out to ""
$(walk "          set mk to \"  \"
          if (id of ss) is \"$me\" then set mk to \"* \"
          set out to out & mk & (id of win) & TC & (id of ss) & TC & (tty of ss) & TC & (name of ss) & linefeed")
    return out
  end tell
end run
EOF
}

cmd_new() {
  local me; me=$(self_uuid)
  [ -n "$me" ] || { echo "ITERM_SESSION_ID unset — not running under iTerm2" >&2; return 1; }
  osascript 2>&1 <<EOF
on run
  tell application "iTerm2"
    set targetWin to missing value
$(walk "          if (id of ss) is \"$me\" then set targetWin to win")
    if targetWin is missing value then error "own session not found in any visible window"
    set prevTab to current tab of targetWin
    set newTab to (create tab with default profile of targetWin)
    set newSess to id of (current session of newTab)
    select prevTab
    return newSess
  end tell
end run
EOF
}

cmd_run() {
  local sid="$1" text="$2"
  osascript 2>&1 <<EOF
on run
  tell application "iTerm2"
    set s to missing value
$(walk "          if (id of ss) is \"$sid\" then set s to ss")
    if s is missing value then error "session $sid not found"
    write s text "$text"
    delay ${ITERM_RUN_DELAY:-1.5}
    return contents of s
  end tell
end run
EOF
}

cmd_close() {
  local sid="$1" me tty
  me=$(self_uuid)
  [ "$sid" != "$me" ] || { echo "refusing: that is my own session" >&2; return 1; }

  tty=$(session_tty "$sid")
  [ -n "$tty" ] || { echo "refusing: session $sid not found" >&2; return 1; }

  if [ "${ITERM_FORCE:-0}" != "1" ] && tty_busy "$tty"; then
    echo "refusing: $sid ($tty) has a foreground job:" >&2
    ps -t "${tty#/dev/}" -o stat=,command= | awk '$1 ~ /\+/' >&2
    return 1
  fi

  osascript 2>&1 <<EOF
on run
  tell application "iTerm2"
    set s to missing value
    set owner to missing value
$(walk "          if (id of ss) is \"$sid\" then
            set s to ss
            set owner to win
          end if")
    if s is missing value then error "session $sid vanished"
    if (count of tabs of owner) is 1 then error "refusing: last tab of its window (would leave an invisible husk)"
    close s
    delay 0.3
$(walk "          if (id of ss) is \"$sid\" then error \"close failed; session still present\"")
    return "closed $sid"
  end tell
end run
EOF
}

case "${1:-}" in
  list)  cmd_list ;;
  new)   cmd_new ;;
  run)   cmd_run "${2:?session id}" "${3:?command}" ;;
  close) cmd_close "${2:?session id}" ;;
  *) echo "usage: iterm.sh {list | new | run SID CMD | close SID}" >&2; exit 2 ;;
esac
```

## Check your guards go red

Every guard here was confirmed by making it refuse, not by watching it allow:

- close own UUID → refused
- close a bogus UUID → refused
- close a session running `sleep 40` → refused, and named the process
- close the only tab of a window → refused

The `is processing` version passed all the easy cases and still closed a busy tab. A guard you have
never seen refuse is not a guard — [silent-success.md](silent-success.md).
`````

