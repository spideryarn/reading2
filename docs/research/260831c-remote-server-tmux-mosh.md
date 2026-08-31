# Reaching the box: mosh, tmux, and one iTerm tab per session

How to **connect from iTerm to the always-on server** and find your Claude Code sessions still
running. The server itself — which machine, what it costs, how it is provisioned — is
[260831a-remote-server-for-claude-code.md](260831a-remote-server-for-claude-code.md) and
[`infra/hetzner/`](../../infra/hetzner/README.md). Browser work on the box, once you are in, is
[playwright-browser-control.md](../reusable/playwright-browser-control.md), because Claude in Chrome cannot
follow us to a headless machine.

The ask, from Greg (2026-08-31):

> The key idea is that it runs when my laptop is asleep/offline, and it's easy to reconnect, ideally
> one iTerm tab per session, works robustly with dodgy internet.

**Status: research, nothing built here yet.** But it is not speculation either — the design below is
lifted from a working system Greg already runs, `remote-agent-fleet` in the MindstoneRebel repo
(`coding-agent-instructions/`, dated 2026-08-16), which does exactly this against a Hetzner box.
Where this doc quotes code, it is that code. Where it departs from it, it says so and why.

## The shape, in one paragraph

**One tmux session per Claude Code session on the box. One iTerm tab per tmux session. mosh as the
transport, with ssh as an automatic fallback. A small CLI on the Mac so you never type any of it and
never touch a tmux keybinding.** Each layer earns its place by surviving something the others don't:

| Layer | What it survives | What it does not |
|---|---|---|
| **tmux**, on the box | your laptop sleeping, closing, going offline, rebooting | the *server* rebooting — see [below](#the-server-reboot-is-out-of-scope-on-purpose) |
| **mosh**, the transport | wifi→tethering roaming, a train tunnel, a changed IP, hours idle | a dead client: mosh has no reattach, so tmux is not optional |
| **one iTerm tab per session** | your attention | nothing; it is ergonomics, and it is the point |

Neither of the first two is sufficient alone, and the reason is worth stating because it is the load-
bearing fact. **mosh cannot reattach.** Session keys are negotiated once at bootstrap, so a client
that dies — laptop reboot, force-quit, flat battery — leaves a remote session nobody can ever get
back into. Server-side persistence is not a nice-to-have on top of mosh; it is what makes mosh usable
at all.

## The decision that shapes everything else: not `tmux -CC`

iTerm2 has native tmux integration. `tmux -CC attach` makes each remote tmux window a *real* iTerm
tab, with iTerm's own scrollback and search, and `Cmd-T` creates a window on the server. It is the
obvious answer to "one iTerm tab per session" and **we are not using it**, for two independent
reasons, either of which would be enough.

**1. It does not work over mosh.** This is a design incompatibility, not a bug awaiting a fix.
Control mode is a protocol *stream* that iTerm asks for by sending `DCS 1000p`; mosh's whole model is
synchronising screen *state*, and it does not relay that escape code. The symptom is a hang on
connect, or control-mode chatter printed as raw text.
[mosh#640](https://github.com/mobile-shell/mosh/issues/640) ·
[iterm2#5924](https://gitlab.com/gnachman/iterm2/issues/5924)

**2. Closing a tab kills the work.** Under `-CC`, closing an iTerm tab closes the remote tmux window
— iTerm's own [tmux integration docs](https://iterm2.com/documentation-tmux-integration.html) say so
plainly. There is a kill/hide confirmation dialog, and there is an Advanced setting that permanently
suppresses it. **We run scripts that close iTerm tabs** ([iterm.md](../reusable/iterm.md)), and that
doc's guards are built around ownership and idleness, not around "is there a day of agent work behind
this tab". A suppressed dialog plus a tab-closing script is a silent way to destroy a session.

So: **plain `tmux attach` in an ordinary iTerm tab.** iTerm then has no special relationship with the
remote session at all — closing the tab drops the connection and leaves tmux running, which is
exactly the failure mode we want. You give up iTerm-native scrollback inside the session and use
tmux's copy-mode instead. That is the trade, and it is cheap.

Eternal Terminal is the one real alternative — TCP-only, true reattach, and it *does* work with
`-CC`. It is not recommended: it buys back a feature we have just decided against, its maintenance
signal in 2026 is at best no better than mosh's, and it would need a daemon. Worth revisiting only if
UDP-blocked networks turn out to be common in practice.

## The transport: mosh, with ssh underneath

mosh's last release is **1.4.0, October 2022**, and there has been nothing since. Treat it as
*maintained but dormant*: every distro ships it, it works, and nobody should expect a fix for
anything you hit. Ubuntu 24.04 packages exactly 1.4.0, so `apt` loses you nothing against upstream —
which is what [`infra/hetzner/cloud-init.yaml`](../../infra/hetzner/cloud-init.yaml) installs.

What it gives: roaming across IP changes, surviving suspend, no idle timeout, and predictive local
echo so typing stays responsive. What it costs, in the order these will bite you:

- **No scrollback of its own.** It only syncs the visible screen. tmux supplies scrollback; this is
  the documented workaround, not a workaround we invented.
- **No port forwarding, no agent forwarding, no X11.** Still true, still deliberate upstream. This
  matters here: watching the browser needs `ssh -L 6080:localhost:6080`
  ([infra README](../../infra/hetzner/README.md)), so keep a plain ssh session alongside for tunnels.
- **UDP only**, ports 60000–61000 by default. Already open in
  [`infra/hetzner/main.tf`](../../infra/hetzner/main.tf), on both the Hetzner firewall and — if you
  ever enable it — `ufw`. Narrow with `mosh -p 60000:60010` if you'd rather not open a thousand ports.

Truecolor and mouse mode are fine (truecolor since 1.4.0). Emoji with variation selectors sometimes
render single-width — cosmetic, [mosh#724](https://github.com/mobile-shell/mosh/issues/724).

### Probing for mosh, and falling back

Networks that block UDP exist. The fleet CLI probes before every attach and silently uses ssh when
mosh cannot get through — with one non-obvious detail that took someone an afternoon:

```ts
// script(1)'s fake pty is 0x0, and mosh-server aborts on a zero-width client
// (assertion `s_width > 0', terminalframebuffer.cc) — the stty gives it a real size.
spawn('script', ['-q', '/dev/null', 'sh', '-c',
  `stty rows 40 cols 120; exec env LANG=C.UTF-8 mosh ${HOST} -- true`])
// 4s timeout, kill, resolve false — mosh retries forever on a UDP-blocked network.
```

> if mosh fails while nc UDP probes succeed, check terminal size first
>
> — `REMOTE_AGENT_FLEET.md`

A zero-width client crashes mosh-server instantly and the failure looks exactly like a blocked
firewall. Two very different causes, one symptom.

### The attach command

```ts
// mosh execs the remote command directly (no shell), so the || fallback needs an
// explicit sh -c — plain `mosh host -- 'a || b'` dies with
// "execvp: a || b: No such file or directory".
const remote = `sh -c ${shQuote(`tmux attach -d -t =${slug} || exec bash -l`)}`;
transport === 'mosh'
  ? `LANG=C.UTF-8 mosh ${HOST} -- ${remote}`
  : `ssh -t ${HOST} ${shQuote(`tmux attach -d -t =${slug} || exec bash -l`)}`;
```

Three things in that line are load-bearing:

- **`=${slug}`** — tmux target matching is a *prefix* match. `-t fix-login` also matches
  `fix-login-2`. The `=` prefix demands an exact name. Use it in every `attach`, `has-session` and
  `kill-session`, everywhere, always.
- **`-d`** — detach any other client first. Not stylistic: mosh-servers orphaned by a laptop reboot
  linger as invisible attached clients, and without `-d` you end up sharing a session with a ghost
  that is holding the window at its old size.
- **`LANG=C.UTF-8`** — mosh-server refuses to start without a UTF-8 locale, and ssh forwards *your
  Mac's* `LANG` to a server that may not have that locale generated. Setting it explicitly on the
  client makes it not matter what your Mac sends. The box also sets `locale: en_GB.UTF-8` in
  cloud-init, with a comment saying why; belt and braces.

## One iTerm tab per session

A tab is opened by AppleScript and told to run the attach command. Tabs are matched back to sessions
by **title**: tmux's `set-titles` renames the iTerm tab to the session name once attached, so the CLI
can list live tmux sessions, list open iTerm tab titles, and open a tab for every session that hasn't
got one.

On the box, in `~/.tmux.conf`:

```tmux
# propagate the session name to the terminal tab title
set -g set-titles on
set -g set-titles-string "#S"
```

On the Mac, the opener — the same `create tab with default profile` shape as
[iterm.md](../reusable/iterm.md), which has far more detail on driving iTerm safely and is worth
reading before you extend this:

```applescript
tell application id "com.googlecode.iterm2"
  if (count of windows) = 0 then
    create window with default profile
  else
    tell current window to create tab with default profile
  end if
  tell current session of current window to write text theCmd
end tell
```

Reconnecting after a laptop reboot is then one command that diffs the two lists — `tmux ls` against
the iTerm tab titles — and opens what's missing. Its one flaw is a race worth knowing: titles only
settle *after* tmux attaches, so running it twice within a few seconds opens duplicate tabs.

**Session names are slugs**, `^[a-z0-9][a-z0-9-]{0,40}$`, validated on both sides. They are tmux
session names and they get embedded in shell commands across an ssh boundary, so nothing surprising
should ever reach a shell.

### Do not share one session between two tabs

If two clients attach to the same tmux session viewing the same window, tmux sizes that window to the
*smallest* client — that is the default, `window-size smallest`. One tab per session sidesteps it
entirely. If you ever do want two views, use a **grouped session** (`tmux new-session -t existing`),
which shares the window set but gives each client its own current window, rather than fighting the
resize behaviour with `aggressive-resize`.

## Notifications: how you find out a session wants you

Greg picked this as the one thing to cover beyond tmux and mosh itself, and it is the gap in the
system we're copying: the current Mindstone fleet has **no notification mechanism at all** — status
is pull-based, you find out by looking. Its predecessor had one, an opt-in ntfy.sh push from a
per-session wrapper script. We can do better than either, because Claude Code now ships the thing.

**Primary: Remote Control.** It is built for precisely this — a headless box, a phone in your pocket
— and Anthropic's own docs for it tell you to run the session inside tmux, which is what we're doing.
Two independent toggles in `/config`: push when Claude decides (a long task finished), and push when
action is required (a permission prompt is waiting). It suppresses pushes while you are actually
looking at the terminal, reconnects across sleep and network drops, queues prompts in the meantime,
and lets you *answer* from the phone rather than only be pinged. It needs a `/login` session, not
`claude setup-token` — which the [infra README](../../infra/hetzner/README.md) already insists on for
other reasons — and it is outbound HTTPS only, so no inbound port on the box.

**Backup: a `Notification` hook**, so there is a channel that doesn't depend on Remote Control being
connected. The `matcher` filters by notification type; the two that mean "a human is needed" are
`permission_prompt` (a tool approval has been waiting ~6s) and `idle_prompt` (Claude finished ~60s
ago and you haven't typed). In `~/.claude/settings.json` on the box:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [{ "type": "command",
                    "command": "curl -sS --max-time 10 -H 'Title: Claude needs you' -d \"$CLAUDE_PROJECT_DIR\" https://ntfy.sh/YOUR-TOPIC >/dev/null || true" }]
      }
    ]
  }
}
```

`|| true` and a timeout, deliberately: a notification failing must never take a session down with it.
ntfy.sh needs no signup — pick an unguessable topic name, since a public topic is readable by anyone
who guesses it — and the free tier is 250 messages/day.

**And locally**, when you are at the laptop: Claude Code sends a desktop notification natively in
iTerm2, and it reaches your Mac over ssh. Two things must be true for it to escape a remote tmux:
`set -g allow-passthrough on` in `~/.tmux.conf`, and, in iTerm, Settings → Profiles → Terminal →
Notification Center Alerts → Filter Alerts → "Send escape sequence-generated alerts".

## `~/.tmux.conf` on the box

Everything above, plus the settings that make a long agent session bearable. Each line is here for a
reason; delete the ones whose reason you don't share.

```tmux
set -g set-titles on
set -g set-titles-string "#S"        # the iTerm tab is named after the session

set -g mouse on                      # scroll and click; hold Option to select text for the Mac clipboard
set -g history-limit 50000           # 2000 is thin for a session full of tool output; costs memory per pane
set -s escape-time 10                # tmux waits after ESC to see if a sequence follows; 500ms reads as lag
set -g focus-events on
set -g detach-on-destroy off         # killing one session moves you to another, not out to a bare shell

set -g allow-passthrough on          # or Claude Code's desktop notifications never leave tmux
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",xterm-256color:Tc,*:Tc"   # 24-bit colour end to end

# Mac trackpad momentum fires many wheel events per gesture and tmux scrolls 5
# lines per event, so scrollback flies past. tmux can only tune lines-per-event.
bind -T copy-mode    WheelUpPane   select-pane \; send-keys -X -N 2 scroll-up
bind -T copy-mode    WheelDownPane select-pane \; send-keys -X -N 2 scroll-down
bind -T copy-mode-vi WheelUpPane   select-pane \; send-keys -X -N 2 scroll-up
bind -T copy-mode-vi WheelDownPane select-pane \; send-keys -X -N 2 scroll-down
```

Claude Code's own docs also prescribe `set -s extended-keys on` and
`set -as terminal-features 'xterm*:extkeys'` so tmux can tell Shift+Enter from Enter. **Over mosh
that does not work** — see the next section.

## Traps

Ordered by how likely they are to cost you an afternoon.

### Shift+Enter submits instead of inserting a newline, and the documented fix doesn't apply

Claude Code's docs say to fix this in `~/.tmux.conf` with `extended-keys`. Over mosh that cannot
work: mosh 1.4's server-side terminal emulator drops extended-key negotiation, so the request for a
distinguishable Shift+Enter never reaches iTerm and the key arrives as a plain CR. **No server-side
config can fix it.** The fix is entirely on the Mac: iTerm → Settings → Keys → Key Bindings → add
`Shift+Return` → Send Hex Code → `0x0A`. Side effect: at a plain shell, Shift+Enter then behaves like
Enter. (Ctrl+J always inserts a newline regardless, if you'd rather not rebind anything.)

This is Mindstone's root-cause finding from practice, not something I verified against mosh's source.
The symptom and the fix are theirs and are known to work.

### Non-interactive ssh gets a stock PATH — no `.bashrc`, no `.bash_profile`

`ssh host 'some command'` sources **neither**. Not "bashrc returns early for non-interactive shells"
— neither file at all. So `~/bin` and `~/.local/bin` are simply absent, and anything you script over
ssh must use absolute paths or set `PATH` itself. This was verified by spike in the Mindstone repo on
2026-08-16, correcting an earlier draft of their own doc that had it wrong. Related, and the same
class: **the tmux server inherits its environment from whoever first started it**, so a job launched
into tmux cannot trust anything about the environment it lands in. Every job script sets its own
`PATH` and `LANG` explicitly.

There are two committed postmortems in that repo on the same root cause wearing a different hat:
`PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin'` — the `||` only fires when PATH is
*undefined*, never when it is set-but-incomplete, which is the shape cron and tmux actually hand you.
Always append, never substitute.

### Orphaned mosh-servers accumulate

A client that dies uncleanly leaves mosh-server running forever; for security reasons only the
matching client can end a session, so nothing reaps it. They show up as invisible attached clients
holding your window size hostage — which is what `tmux attach -d` is defending against above. Set a
ceiling on the box:

```
MOSH_SERVER_NETWORK_TMOUT=86400   # in /etc/environment
```

and occasionally `pkill -f mosh-server` for the stale ones. Newer mosh-servers warn about detached
servers when you ssh in, listing PIDs.

### Never emit a bare `export` line into a shell env file

From a real incident in the Mindstone repo: `export` with no arguments prints **the entire
environment, secrets included**, on every shell startup. If you script edits to `~/.bashrc` or an env
file, make sure you cannot write an argument-less `export`.

### The server reboot is out of scope, on purpose

tmux sessions are processes. A server reboot ends all of them, and nothing brings a running Claude
Code session back — `tmux-resurrect` restores pane layout and working directories, and re-launches
only a whitelist of programs (`vim`, `less`, `top`…) that a REPL will never be on. The honest
recovery story is `claude --resume` in a restored shell, by hand.

Greg de-scoped this already, on the previous system:

> It doesn't need to survive server reboots, because they don't happen very often
>
> — Greg, recorded in `REMOTE_AGENT_FLEET.md`

If that ever changes, the pieces are `loginctl enable-linger` plus a systemd *user* unit that starts
a tmux server at boot. Linger alone gets you survival-across-logout, not survival-across-reboot; they
are different problems and the linger docs are routinely misread as solving both.

### Unattended sessions stop when the login expires

Not a tmux or mosh problem, but it is how a box like this dies quietly: `/login` credentials expire,
Claude Code warns three days out, and a session nobody is watching just stops. Already noted in
[260831a-remote-server-for-claude-code.md](260831a-remote-server-for-claude-code.md#claude-code-on-the-box); repeated
here because this doc is the one you'll be reading when a session has been silent for a day.

### Things that only look like they worked

- A mosh session that silently fell back to ssh looks identical to one that connected — check
  `$MOSH_CONNECTION` or the tab title, not the fact that you got a prompt.
- `tmux attach -t name` attaching to the *wrong* session because of prefix matching looks exactly
  like attaching to the right one, until you wonder why your work is missing.

Both are [silent-success](../reusable/silent-success.md) shapes: the check ran, said fine, and was
answering a different question.

## Not verified

Carried forward honestly rather than guessed:

- **mosh + Claude Code's TUI specifically.** Nobody has written about it. Claude Code has its own
  redraw bugs on resize that would fire the same way over plain ssh, so a garbled screen is not
  evidence against mosh. If predictive echo does turn out to mangle the TUI, `mosh --predict=never`
  is the flag to reach for — though "this fixes tmux garbling" is folk remedy, not documented.
- **Whether mosh silently falls back to ssh** when `mosh-server` is not on the remote PATH. Sourced
  from one vendor blog. Not an issue on an `apt`-installed box, where it lands in `/usr/bin`.
- **The exact `preferredNotifChannel` values** beyond `auto` and `terminal_bell`.
- **Eternal Terminal's real maintenance state in 2026** — one positive report, one "it stopped
  working and nobody's home". Nobody has actually looked.
- **The iTerm preference wording** for suppressing the tmux kill/hide dialog. The setting exists and
  is in Advanced; we are avoiding `-CC` anyway, so it does not matter unless someone reintroduces it.

## Sources

The system this copies: `coding-agent-instructions/docs/REMOTE_AGENT_FLEET.md` and
`coding-agent-instructions/scripts/remote-agent-fleet/` in `MindstoneRebel`, plus the older
`docs/research/260507_cloud_droid_vm_setup.md` for the ntfy notification path and the shared-session
`.bashrc` auto-attach.

Primary sources for the rest: [mosh.org](https://mosh.org/) ·
[iTerm2 tmux integration](https://iterm2.com/documentation-tmux-integration.html) ·
[Claude Code terminal config](https://code.claude.com/docs/en/terminal-config) ·
[Claude Code hooks](https://code.claude.com/docs/en/hooks) ·
[Remote Control](https://code.claude.com/docs/en/remote-control) ·
[tmux advanced use](https://github.com/tmux/tmux/wiki/Advanced-Use) ·
[ntfy](https://docs.ntfy.sh/examples/)
