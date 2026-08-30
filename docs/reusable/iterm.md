# Driving iTerm2 tabs from a shell

How an agent with `Bash` can **list, create and close iTerm2 tabs** on macOS without disturbing the
tabs it did not create. Not about this project — carry it anywhere.

Everything here was executed against **iTerm2 3.6.6, macOS 26.6.2 (Darwin 25.6.0)**, in a window
holding a dozen live agent sessions while a human worked in the same window. Claims are qualified to
what was observed; the two places where the evidence runs out say so.

Most of this doc is traps. The happy path is four commands; the reason it's long is that four
separate guards on the close path each looked correct and were not.

## The one rule

**Address a session by its UUID. Never by index, never by tty.**

| Handle | Why not |
|---|---|
| `$ITERM_SESSION_ID`'s `wNtNpN` prefix | frozen at shell launch — mine said `w5t11`, I was at window 1, tab 12 |
| AppleScript window/tab index | shifts whenever anyone opens or closes anything |
| `index of tab` | declared in the dictionary; raised `-1728` every time it was read here |
| tty (`/dev/ttys041`) | **recycled** — a new tab was handed a just-closed tab's tty number |

`id` of a session is that UUID, and `unique ID` returns the identical string (verified equal). It is
stable for the life of the session.

Note it identifies a **session, i.e. a pane** — not a tab. A split tab holds several, and closing one
session closes that pane, not the tab. Everything below assumes one session per tab and does not
handle splits.

Your own UUID is the part of `$ITERM_SESSION_ID` after the colon:

```bash
ITERM_SESSION_ID='w5t11p0:486E9CEB-9FBE-420F-8B7E-941FB35360DC'
self=${ITERM_SESSION_ID#*:}
```

The `w5t11` is a window/tab coordinate recorded when the shell started. Environment variables are
fixed at process launch and iTerm doesn't re-inject them when a tab moves, so the numbers cannot
track anything — which is exactly why the UUID was added.

### Make the self-check fail closed

`ITERM_SESSION_ID` is not always there and not always yours. It is absent under `launchd` and `cron`;
and it is **inherited**, so inside `tmux` it names the tab the tmux server was started from, and
across `ssh` it describes the machine you came from.

That matters because the obvious self-check breaks in silence:

```bash
me=$(self_uuid)                    # "" when the variable is unset
[ "$sid" != "$me" ] || refuse      # "anything" != "" is TRUE, so this never fires
```

An empty `me` doesn't make the guard refuse — it makes it *approve everything*, including your own
tab. Demand a UUID of the right shape that resolves to a live session, and refuse outright in any
environment where the variable cannot mean what you need it to mean:

```bash
[ -z "${TMUX:-}${STY:-}" ]                || refuse   # tmux/screen
[ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ]  || refuse   # ssh
[ -n "$me" ]                              || refuse   # unset or malformed
session_exists "$me"                      || refuse   # stale
[ "$sid" != "$me" ]                       || refuse   # finally, the actual check
```

iTerm's `tmux -CC` integration deserves its own warning: there, closing an iTerm tab can kill the
corresponding tmux window. Treat every tmux mode as unsupported.

## The dictionary is the spec

Don't guess at property names — iTerm publishes no property table, and its AppleScript docs are
marked deprecated (working, but frozen; the Python API is the forward path). Dump the real thing:

```bash
sdef /Applications/iTerm.app > /tmp/iterm.sdef
```

What matters:

- `window` — `id`, `visible`, `current tab`, `tabs`. Here `id` is an **integer** (`456`) and
  `alternate identifier` is the string form (`"window-2"`). Older write-ups describe `id` as
  `"window-12"`; on 3.6.6 that is `alternate identifier`.
- `tab` — `current session`, `sessions`. (`index` is declared. It does not work.)
- `session` — `id` / `unique ID` (the UUID), `tty`, `name`, `contents`, `text`, `is processing`,
  `is at shell prompt`
- commands — `create tab with default profile` (on a window), `close`, `select`, `write ... text`

`close` accepts a session, a tab, or a window — all three verified.

## Listing

Filter on `visible`. A closed window can linger as an invisible husk (see
[Closing the last tab](#closing-the-last-tab-leaves-a-husk)).

```applescript
on run argv
  set selfId to item 1 of argv
  set TC to character id 9
  tell application "iTerm2"
    set out to ""
    repeat with win in windows
      if visible of win then
        repeat with tb in (tabs of win)
          repeat with ss in (sessions of tb)
            set mk to "  "
            if (id of ss) is selfId then set mk to "* "
            set out to out & mk & (id of win) & TC & (id of ss) & TC & (tty of ss) & TC & (name of ss) & linefeed
          end repeat
        end repeat
      end if
    end repeat
    return out
  end tell
end run
```

Two syntax traps are dodged there, and both cost a round trip:

- **`tab` is shadowed.** Inside `tell application "iTerm2"`, `tab` resolves to iTerm's `tab` *class*,
  not AppleScript's tab character. `& tab &` silently concatenates the literal string `"tab"`, so
  output looks like `456tabD44EB5D5tab…` — confirmed with `od -c`. Use `character id 9`, bound
  **outside** the `tell` block.
- **`me` is reserved.** `set me to …` fails with `-10003 Access not allowed`. (This one bit twice:
  once as a variable name, then again as an `on run argv` parameter name.)

## Creating a tab

Create it in *your own* window — the one containing your UUID — not the frontmost window, which may
belong to someone else.

```applescript
set prevTab to current tab of targetWin          -- capture BEFORE the create
set newTab to (create tab with default profile of targetWin)
set newSess to id of (current session of newTab)
select prevTab                                   -- give the keyboard back
```

### Creating a tab steals the keyboard

`create tab` **selects** the new tab, so a human's next keystrokes land in it. Not hypothetical:

> Note that I'm working at the same time, so the occasional keystroke may make it into your
> experiments
>
> — Greg, 2026-08-30

The agent found a tab of its own containing `clasleep 25` — Greg had typed `cla` toward `claude`, and
the agent's scripted `sleep 25` was appended to the same input line.

`prevTab` must be captured *before* the create. Afterwards `current tab` is already the new tab, so
`select (current tab of targetWin)` is a no-op that looks exactly like a working restore. That bug
shipped in the first version of this script and was only caught by checking which tab was selected
afterwards.

This restore is partial and not atomic: it returns the *window's* selected tab, not a different
frontmost window or the active pane in a split, and if the human changed tabs during the operation
it overwrites their newer choice.

## Closing a tab

Four things must hold, and each one has to fail closed:

1. **you created it** — an agent that may close anything is not "not disturbing other tabs"
2. **it isn't you**
3. **it isn't the last tab of its window**
4. **it's idle**

Then **verify the session is gone** rather than trusting the absence of an error.

Guard 1 is the one that carries the doc's promise, and it needs bookkeeping rather than cleverness:
record each UUID `new` returns in a file keyed to your own session, and refuse anything not in it.
Don't add a force flag to that guard — the whole point is that it cannot be bypassed.

### `is processing` is not a busy check

It is the obvious choice and it is wrong. Measured on one session:

| Moment | `is processing` |
|---|---|
| 0.5s after an `echo` finished, idle at the prompt | `true` |
| 3.5s idle at the prompt | `false` |
| 4s into a running `sleep 12` | **`false`** |

It means "produced output in the last ~2 seconds", which is a screen-activity flag, not a job flag.
A `sleep` is busy and silent, so it reads idle — and a guard built on it closed a tab with a live
job. A [silent success](silent-success.md): the check ran, said safe, and was simply wrong.

`is at shell prompt` is not the fix either — it requires iTerm's Shell Integration and otherwise
always returns `false` (it did here).

### The `+` flag is not enough either

The natural repair is to ask the OS for the tty's *foreground* process. That is still wrong, and
dangerously so — it was caught in review and then reproduced:

```
$ sleep 300 &          # backgrounded
Ss   login
S+   zsh
SN   sleep             ← no "+", so a foreground-only test calls this idle
```

The foreground-only guard **closed that tab.** A stopped job (`^Z`, state `TN`) hides the same way.
`+` means "in the foreground process group", not "this tty has no work on it".

So look at **every** process on the tty and refuse anything that isn't the shell itself:

```bash
# Busy unless the tty holds nothing but its own login/shell processes.
# Fails CLOSED: ps error, empty output, or an unrecognised name all mean busy.
tty_busy() {
  local t="${1#/dev/}" out
  [ -n "$t" ] || return 0
  out=$(ps -t "$t" -o ucomm= 2>/dev/null) || return 0
  [ -n "$out" ] || return 0
  printf '%s\n' "$out" | awk '
    { name = $0
      sub(/^[ \t]+/, "", name); sub(/[ \t]+$/, "", name); sub(/^-/, "", name)
      if (name != "" && name !~ /^(login|ShellLauncher|zsh|bash|sh|tcsh|fish|csh|ksh)$/) extra = 1 }
    END { exit !extra }'
}
```

Details that matter:

- **`ucomm`, not `comm`.** `ucomm` is the short accounting name macOS `ps` documents as dependable;
  `comm` can be a path or contain spaces, and picking `$2` out of it truncates the name — which is
  both a false negative and a way to spoof an allow-listed name.
- **Fail closed.** `ps -t nosuchtty` exits 1. Returning "not busy" on that would make a missing tty,
  a permission failure or an unexpected `ps` into permission to close. Verified: `ps -t zzz9` exits 1.
- **It over-refuses, deliberately.** Your own tab always looks busy (the agent is running in it),
  and so does any tab running anything. That is the right direction to be wrong in.

What it still cannot see: a shell running a **builtin** is indistinguishable from a shell at a
prompt using process data alone. Without Shell Integration there is no fix for that — so treat this
as a strong last line of defence, not proof, and rely on ownership as the real boundary.

### Closing the last tab leaves a husk

Closing a window's **only** session leaves a window object with `tabs = 0` and `visible = false`
still in the `windows` collection, and `close` on that husk does nothing. It is invisible, so it
harms nothing but your enumeration — which is why every loop above filters on `visible`. (It is
reaped eventually; the one seen here was gone minutes later. Don't wait for it, don't count on it.)

If you want the window gone, **close the window, not its last session**. `close (window id N)` on a
window that still has its tab removed it cleanly.

### Does closing prompt?

iTerm has a per-profile **Prompt Before Closing** setting — Never / Always / *if there are jobs
besides* — stored as `"Prompt Before Closing 2"` in the profile dict:

```bash
defaults read com.googlecode.iterm2 | grep -i 'prompt before closing'
```

On this machine it is `0`, and `close` on a session running `sleep 40` went through silently.
**That single observation cannot tell you whether AppleScript respects the setting or bypasses it**
— with the prompt disabled, both hypotheses predict exactly what was seen, and no primary source
settles it either way. The integer encoding isn't documented anywhere I could find; read your own
plist rather than trusting a mapping.

Assume it *can* prompt. A modal blocks iTerm and leaves `osascript` waiting.

- **The real defence is not attempting it**: `tty_busy` above, plus ownership.
- **`with timeout of N seconds` is not a defence against the modal.** It bounds how long *your
  script* waits; per Apple's own reference it does not cancel the operation, so the dialog can sit
  there blocking iTerm after your script has given up. Useful for not hanging your agent; useless
  for protecting the user.
- The only documented way to force a close is the **Python API** — `Session.async_close(force=True)`
  / `Tab.async_close(force=True)`. AppleScript has no equivalent flag. That needs *Enable Python API*
  ticked plus a WebSocket handshake, so it's a real step up in setup cost.

## Running a command and reading the output

`write … text` types a line into a session; `contents` reads the visible screen back.

### Pass data as `argv`, never by interpolation

Building AppleScript by pasting a shell variable into a quoted literal is an injection hole: a `"`
in the command closes the literal and the rest runs **as AppleScript**. Backslashes get read as
AppleScript escapes, and a newline can submit extra shell lines.

```bash
osascript - "$sid" "$text" <<'APPLESCRIPT'
on run argv
  set wanted to item 1 of argv
  set commandText to item 2 of argv
  -- static AppleScript only; argv carries the data
end run
APPLESCRIPT
```

Verified: with `argv`, `echo A" & (do shell script "touch /tmp/pwned") & "B` reached the shell as
literal text and `/tmp/pwned` was never created.

### Reading output is screen-scraping

```applescript
write s text commandText
delay 1.5
return contents of s
```

You get the prompt, the echoed command, trailing blank lines, and whatever was already on screen.
And **neither `contents` nor `text` reaches the scrollback** — after `seq 1 500` in a fresh tab both
returned the identical 2517 characters, one screenful. Anything that scrolled past is gone, and
there is no return code.

So this is fine for a smoke test and useless for capturing real output: have the command redirect to
a file and read the file with your normal tools.

`write` also appends to whatever is already on the input line, including half-typed human input.

## Permissions

Sending Apple events needs macOS Automation permission (System Settings → Privacy & Security →
Automation), recorded against the *responsible* application — the app macOS holds accountable for
the process, typically the terminal or the GUI app that spawned your shell, not `osascript` itself.

The first attempt *may* raise a one-time consent dialog. It won't if permission was already decided,
or where policy, sandboxing or the absence of a GUI context rules it out. Once denied, there is no
further dialog: every attempt fails with `-1743` *Not authorized to send Apple events*, on stderr
with exit status 1. So `-1743` means **authorization was denied or unavailable**, not simply "the
prompt hasn't been answered yet" — the fix is a human visiting Automation in System Settings.

An agent cannot click that dialog. Treat the first `osascript` call in a fresh environment as a setup
step needing a person.

There is a non-triggering preflight —
`AEDeterminePermissionToAutomateTarget(..., askUserIfNeeded: false)` — but it is a C API, not a shell
one-liner, and `tccutil` only offers destructive `reset`, never a query.

**This section is the one part of this doc not observed here**: permission was already granted, so
neither the dialog nor `-1743` ever ran. Everything else above was executed and watched.

Nothing here needs iTerm's Python API or *Enable Python API* — plain AppleScript suffices, except for
the force-close noted above.

`tell application "iTerm2"` is the current name; `"iTerm"` is the pre-3.0 legacy identity that still
resolves. Errors come back attributed to `"iTerm"` either way — don't chase it.

## The tree moves under you

Tabs open and close *between* your calls. Here the window's tab count read 12, then 11 a minute
later, because a peer agent closed one; the total moved between 50 and 53 throughout.

- never cache an enumeration across calls — re-resolve the UUID each time
- have `close` verify the session is actually gone afterwards
- treat "session not found" as ordinary, not an error worth retrying

This also means the idle check is **time-of-check to time-of-use**: a job can start after `tty_busy`
passes and before the close lands, and the tab count can change between counting and closing. Nothing
here makes that atomic. It is another reason ownership, not idleness, is the real boundary.

### A walk can be invalidated mid-flight

Worse than stale data: a tab closing *during* your enumeration invalidates it, and AppleScript
aborts the whole script.

```
execution error: iTerm got an error: Can't get item 7 of every tab of item 6 of
every window. Invalid index. (-1719)
```

That happened here on a routine `close`. It failed safe — nothing was closed — but it also left the
tab the agent was trying to clean up still open, and a caller that treats any error as "already
gone" would leak tabs forever.

There is no way to make one pass atomic, so **retry the whole script**:

```bash
osa_retry() {
  local script="$1"; shift
  local i out rc
  for i in 1 2 3; do
    out=$(printf '%s\n' "$script" | osascript - "$@" 2>&1); rc=$?
    case "$out" in
      *-1719*|*"Invalid index"*|*-1728*) sleep 0.4; continue ;;
    esac
    printf '%s\n' "$out"; return $rc
  done
  printf '%s\n' "$out"; return 1
}
```

Note this folds stderr into stdout, so any helper built on it must **validate the shape** of what
comes back. A `session_tty` that just returns the output would treat the text of a `-1743`
permission error as a tty and report the session as existing. Match `/dev/*` or fail.

## Whole script

Tested end to end — `list` → `new` → `run` → `close` returns the session count to where it started —
and every guard was made to refuse before being believed. The AppleScript traversal is built once as
a shell function and interpolated, rather than writing the triple-nested `repeat` five times.

One structural note: macOS ships **bash 3.2**, which mis-parses a heredoc nested inside `$( )`. Build
the script with a function that `cat`s it and pipe that into `osascript -`, rather than
`x=$(osascript - <<EOF …)`.

```bash
#!/bin/bash
# iterm.sh — list / create / run / close iTerm2 tabs, touching only tabs this agent created.
#
# Safety model, in order: only sessions this agent created are mutable; never
# your own; never the last tab of a window; never a tty with anything on it but
# its own shell. Every check fails CLOSED — an error, empty output or an
# unrecognised environment means "refuse", never "proceed".
set -uo pipefail

# ---------------------------------------------------------------- identity ---

# The UUID half of ITERM_SESSION_ID (w<N>t<N>p<N>:UUID). Empty unless it matches
# that shape, so a truncated or foreign value can never be mistaken for identity.
self_uuid() {
  local v="${ITERM_SESSION_ID:-}"
  case "$v" in
    w*t*p*:?*) printf '%s' "${v#*:}" ;;
    *)         printf '' ;;
  esac
}

owned_file() { printf '%s/iterm-owned-%s.list' "${TMPDIR:-/tmp}" "$1"; }

# ITERM_SESSION_ID is inherited, so it lies inside tmux/screen (it names the tab
# the server was started from) and across ssh (it describes the local machine).
# Refuse to mutate anything in those environments rather than guess.
require_self() {
  local me
  if [ -n "${TMUX:-}${STY:-}" ]; then
    echo "refusing: tmux/screen — ITERM_SESSION_ID is not this pane's identity" >&2; return 1
  fi
  if [ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" ]; then
    echo "refusing: ssh — ITERM_SESSION_ID describes the originating machine" >&2; return 1
  fi
  me=$(self_uuid)
  if [ -z "$me" ]; then
    echo "refusing: ITERM_SESSION_ID unset or malformed — cannot tell my own tab apart" >&2; return 1
  fi
  if ! session_exists "$me"; then
    echo "refusing: ITERM_SESSION_ID ($me) matches no live session" >&2; return 1
  fi
  printf '%s' "$me"
}

# ------------------------------------------------------------------- busy ----

# Busy unless the tty holds nothing but its own login/shell processes.
# Counts background (`sleep 60 &`) and stopped (^Z) jobs, which a foreground-only
# test using ps's "+" flag silently misses. `ucomm` is the one name macOS ps
# documents as dependable, and it is the whole line here so spaces cannot split it.
tty_busy() {
  local t="${1#/dev/}" out
  [ -n "$t" ] || return 0
  out=$(ps -t "$t" -o ucomm= 2>/dev/null) || return 0
  [ -n "$out" ] || return 0
  printf '%s\n' "$out" | awk '
    { name = $0
      sub(/^[ \t]+/, "", name); sub(/[ \t]+$/, "", name); sub(/^-/, "", name)
      if (name != "" && name !~ /^(login|ShellLauncher|zsh|bash|sh|tcsh|fish|csh|ksh)$/) extra = 1 }
    END { exit !extra }'
}

# ------------------------------------------------------------- applescript ---
# Every script takes its data through `argv`, never through string interpolation:
# a `"` in a command would otherwise close the AppleScript literal and let the
# rest of the argument run as AppleScript.

# Walk every visible window/tab/session with win/tb/ss bound to BODY.
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

# The window/tab tree can change *during* a walk — another agent closing a tab
# invalidates the enumeration and AppleScript raises -1719 "Invalid index".
# That aborts the whole script, so a close can fail with its tab left open.
# Re-run from scratch rather than trying to make one pass atomic.
osa_retry() {
  local script="$1"; shift
  local i out rc
  for i in 1 2 3; do
    out=$(printf '%s\n' "$script" | osascript - "$@" 2>&1); rc=$?
    case "$out" in
      *-1719*|*"Invalid index"*|*-1728*) sleep 0.4; continue ;;
    esac
    printf '%s\n' "$out"; return $rc
  done
  printf '%s\n' "$out"; return 1
}

as_tty() { cat <<EOF
on run argv
  set wanted to item 1 of argv
  tell application "iTerm2"
$(walk '          if (id of ss) is wanted then return tty of ss')
  end tell
  return ""
end run
EOF
}

# Prints the tty and succeeds only for a session that really exists. An
# AppleScript or permission failure (e.g. -1743) must NOT read as "found" — nor
# be silently swallowed into "not found", which would hide a broken setup.
session_tty() {
  local out
  out=$(osa_retry "$(as_tty)" "$1") || { echo "iterm lookup failed: $out" >&2; return 1; }
  case "$out" in
    /dev/*) printf '%s' "$out" ;;
    "")     return 1 ;;
    *)      echo "iterm lookup returned something unexpected: $out" >&2; return 1 ;;
  esac
}

session_exists() { [ -n "$(session_tty "$1")" ]; }

# ---------------------------------------------------------------- commands ---

cmd_list() {
  local me; me=$(self_uuid)
  osa_retry "$(as_list)" "$me"
}

as_list() { cat <<EOF
on run argv
  set selfId to item 1 of argv
  set TC to character id 9
  tell application "iTerm2"
    set out to ""
$(walk '          set mk to "  "
          if (id of ss) is selfId then set mk to "* "
          set out to out & mk & (id of win) & TC & (id of ss) & TC & (tty of ss) & TC & (name of ss) & linefeed')
    return out
  end tell
end run
EOF
}

cmd_new() {
  local me sid
  me=$(require_self) || return 1
  sid=$(osa_retry "$(as_new)" "$me") || { echo "$sid" >&2; return 1; }
  case "$sid" in
    ????????-????-????-????-????????????) ;;
    *) echo "unexpected result from create: $sid" >&2; return 1 ;;
  esac
  printf '%s\n' "$sid" >> "$(owned_file "$me")"
  printf '%s\n' "$sid"
}

as_new() { cat <<EOF
on run argv
  set selfId to item 1 of argv
  tell application "iTerm2"
    set targetWin to missing value
$(walk '          if (id of ss) is selfId then set targetWin to win')
    if targetWin is missing value then error "own session not found"
    -- capture prevTab BEFORE the create, or \`current tab\` is already the new
    -- tab and the restore below is a no-op that looks like a fix.
    set prevTab to current tab of targetWin
    set newTab to (create tab with default profile of targetWin)
    set newSess to id of (current session of newTab)
    select prevTab
    return newSess
  end tell
end run
EOF
}

require_owned() {
  local me="$1" sid="$2" f
  f=$(owned_file "$me")
  if [ ! -f "$f" ] || ! grep -qxF "$sid" "$f"; then
    echo "refusing: $sid was not created by this agent" >&2; return 1
  fi
}

cmd_run() {
  local sid="$1" text="$2" me
  me=$(require_self) || return 1
  require_owned "$me" "$sid" || return 1
  osa_retry "$(as_run)" "$sid" "$text" "${ITERM_RUN_DELAY:-1.5}"
}

as_run() { cat <<EOF
on run argv
  set wanted to item 1 of argv
  set commandText to item 2 of argv
  set waitFor to (item 3 of argv) as number
  tell application "iTerm2"
    set s to missing value
$(walk '          if (id of ss) is wanted then set s to ss')
    if s is missing value then error "session not found"
    write s text commandText
    delay waitFor
    return contents of s
  end tell
end run
EOF
}

cmd_close() {
  local sid="$1" me tty
  me=$(require_self) || return 1
  [ "$sid" != "$me" ] || { echo "refusing: that is my own session" >&2; return 1; }
  require_owned "$me" "$sid" || return 1

  tty=$(session_tty "$sid")
  [ -n "$tty" ] || { echo "refusing: session $sid not found" >&2; return 1; }
  if tty_busy "$tty"; then
    echo "refusing: $sid ($tty) is not idle:" >&2
    ps -t "${tty#/dev/}" -o stat=,command= >&2
    return 1
  fi

  osa_retry "$(as_close)" "$sid"
}

as_close() { cat <<EOF
on run argv
  set wanted to item 1 of argv
  tell application "iTerm2"
    set s to missing value
    set owner to missing value
$(walk '          if (id of ss) is wanted then
            set s to ss
            set owner to win
          end if')
    if s is missing value then error "session vanished"
    if (count of tabs of owner) is 1 then error "refusing: last tab of its window"
    close s
    delay 0.3
$(walk '          if (id of ss) is wanted then error "close failed; session still present"')
    return "closed " & wanted
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

Each guard was confirmed by making it refuse, not by watching it allow:

| Attempt | Result |
|---|---|
| close a session this agent didn't create | refused |
| close own UUID | refused |
| close under `TMUX` / `SSH_TTY` | refused |
| close with `ITERM_SESSION_ID` unset or malformed | refused |
| close a session running `sleep 300 &` (background) | refused, job named |
| close a session with a `^Z`-stopped job | refused |
| close the only tab of a window | refused |
| `ps` against a nonexistent tty | exits 1 → treated as busy |
| `"`-bearing AppleScript payload via `run` | inert; reached the shell as text |
| a peer closing a tab mid-walk | `-1719`, nothing closed; retried |

…and a **control** alongside them: with every guard in place, creating a tab, running a command in
it and closing it still works, and the session count returns exactly to where it started. A guard
that refuses everything passes the same tests as a guard that works.

Two of the guards above — `is processing`, and the foreground-only `+` test — passed every casual
check and still closed a busy tab. Both were caught only by constructing the state they were supposed
to catch. If you have never seen a guard refuse, you don't have evidence it works —
[silent-success.md](silent-success.md).
