# The remote box, and `gjd-remote`

A Hetzner server that runs Claude Code sessions in tmux so they keep working when the laptop sleeps.
You drive it from **[`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts)**, and if you read one
thing here, make it `gjd-remote --help`, which is the reference and stays current.

> Ideally I want a single command I can run on my laptop that automatically SSH's in, sets up a new
> Claude session, etc. … so that we can create parameters for that command to automatically start a
> [session]
>
> — Greg, 2026-08-31

This page is the map. Everything below is a signpost; the detail lives in the doc or the file named.

## The shape, in one paragraph

The **server is disposable and the volume is not**. A separate volume is bind-mounted over `/home`,
so checkouts, `~/.claude` and everything else survive destroying and recreating the machine. One
tmux session per Claude session, because mosh cannot reattach and a client that dies would otherwise
leave a session nobody could get back into. Sessions start under a placeholder name — `s-260831-192843`,
`yyMMdd-HHmmss` on the laptop's own clock — and adopt Claude's own title for the work at the next
`gjd-remote ls`. The seconds are in it because two `new` runs in the same minute minted the same name
and tmux refused the second one; on a box meant to hold many parallel sessions that is not an edge case.

## Where things are

**The CLI**

- [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — all of it: `ls`, `new-claude`,
  `new-shell`, `resume`, `kill`, `doctor`, `clone`, `push-env`, `ssh`, `tunnel`, `forget-key`.
  `--help` is long on purpose.
- [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) — what `push-env` is allowed to send.
  The file on the box is **built from an allowlist**, never copied; `HETZNER_CLOUD_API_TOKEN` (can
  delete the box) and `SUPABASE_ACCESS_TOKEN` (can delete the production Supabase project) are
  deliberately off it. Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
- [`scripts/gjd-remote-mcp.ts`](../../scripts/gjd-remote-mcp.ts) — which MCP servers the box should
  be holding, and whether it is. Split out to be testable without a network:
  [`tests/gjd-remote-mcp.test.ts`](../../tests/gjd-remote-mcp.test.ts).
- [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) — reading the box's session list.
  Split out so it can be tested without a network:
  [`tests/gjd-remote-tmux.test.ts`](../../tests/gjd-remote-tmux.test.ts).
- [`scripts/gjd-remote-tab.ts`](../../scripts/gjd-remote-tab.ts) — which iTerm tabs are on the box,
  below. Split out so the byte sequences and the guards can be tested without a terminal:
  [`tests/gjd-remote-tab.test.ts`](../../tests/gjd-remote-tab.test.ts). The paint/un-paint lifecycle
  is tested through the real CLI in a real pty, Ctrl-C included, in
  [`tests/gjd-remote-tab-lifecycle.test.ts`](../../tests/gjd-remote-tab-lifecycle.test.ts).
- [`scripts/gjd-remote-run.ts`](../../scripts/gjd-remote-run.ts) — turning what you typed into what
  runs on the box: `--wait`'s durations and the argv for `ssh <command>`. Split out for the same
  reason as the rest — `gjd-remote.ts` calls `main()` at import time, so nothing in it can be
  unit-tested at all: [`tests/gjd-remote-run.test.ts`](../../tests/gjd-remote-run.test.ts).
- [`scripts/gjd-remote-log.ts`](../../scripts/gjd-remote-log.ts) — the append-only record of what was
  asked for, and the verdict that says which launches never ran. Tested in
  [`tests/gjd-remote-log.test.ts`](../../tests/gjd-remote-log.test.ts); see [The log](#the-log).

**The machine**

- [`infra/hetzner/README.md`](../../infra/hetzner/README.md) — Terraform and cloud-init: first run,
  what to check before every apply (`npx tsx scripts/check-cloud-init.ts`), the noVNC tunnel, and why
  the disposable-server/persistent-volume split exists.
- [`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs) — the committed proof
  the browser stack works. `gjd-remote doctor` copies it up and runs it every time, so it is never a
  stale copy.
- [`.mcp.json`](../../.mcp.json) — the `supabase`, `vercel` and `sentry` MCP servers, at project
  scope so they arrive with the clone rather than with provisioning. The two OAuth logins, the deny
  list that makes it harder for an agent to buy things (a guard rail, not a wall — an agent that can
  edit the repo can edit the list), and why Supabase needs no credential are in
  [infra/hetzner/README.md § MCP servers](../../infra/hetzner/README.md#mcp-servers).

**Doing things on it**

- [browser-control.md](browser-control.md) — **read this before any browser work.** Which mechanism
  goes with which machine, and the answer is not a preference: Claude in Chrome cannot follow you to
  a headless box, so it is Playwright there.
- [../reusable/iterm.md](../reusable/iterm.md) — driving iTerm tabs from a shell, for one tab per
  session. Mostly traps; four separate guards on the close path looked correct and were not.

**Why it is the way it is**

- [../research/260831a-remote-server-for-claude-code.md](../research/260831a-remote-server-for-claude-code.md)
  — which machine, what it costs, what was ruled out.
- [../research/260831c-remote-server-tmux-mosh.md](../research/260831c-remote-server-tmux-mosh.md) —
  mosh, tmux, and why tmux is not optional.
- [../research/260831d-gjd-remote-cli.md](../research/260831d-gjd-remote-cli.md) — why there is no
  argument-parsing library, recorded because the decision went **against** the researched
  recommendation.
- [../plans/260831x-remote-box-dev-environment.md](../plans/260831x-remote-box-dev-environment.md) —
  the plan the box came out of.
- [../plans/260831aa-gjd-remote-ssh-multiplexing-stdin-prompt-tmux-target-colon-fix.md](../plans/260831aa-gjd-remote-ssh-multiplexing-stdin-prompt-tmux-target-colon-fix.md)
  — the timings below, and the bugs found underneath them.

## Which tabs are on the box

A dozen tabs in one window look identical, and the difference that matters is invisible until you
type into the wrong one. So everything that hands the terminal over — `new-claude`, `new-shell`,
`resume`, `ssh`, `tunnel` — paints the iTerm tab violet while it holds it, and hands the colour back
to your profile when it lets go. `GJD_REMOTE_TAB_COLOUR=off`, or a `#rrggbb` for a different one.

It is skipped, silently, anywhere the sequence might be printed instead of obeyed: stdout is not a
terminal, the terminal is not iTerm, you are inside tmux or screen, you came in over ssh, or `CI` is
set. The sequence goes to
`gjd-remote`'s own stdout, because `gjd-remote` runs **in** the tab it is colouring — mosh and ssh
replace this terminal's contents rather than opening a new one. There is no AppleScript route:
iTerm 3.6.6 has no tab-colour property in its dictionary at all.

The reasoning, the options passed over, and how it was checked against a live terminal are in
[../plans/260831ae-gjd-remote-iterm-tab-colour.md](../plans/260831ae-gjd-remote-iterm-tab-colour.md).

## Starting a session with a prompt

`-p` takes the prompt as an argument; `-p -` reads it from stdin, which is what you want for prose,
because a heredoc needs no escaping at all:

```
gjd-remote new-claude -p - <<'EOF'
anything at all — "quotes", `backticks`, $VARS, newlines
EOF
```

The prompt travels as a **file**, never on a command line, so the only escaping in play is your own
local shell's. Two limits, both deliberate:

- Over 96KB is refused. The job runs `claude "$(cat …)"`, so the whole prompt becomes one argv
  string, and Linux caps that at about 128KB with `E2BIG` — a failure that happens on the box, where
  it would leave a live session and print a green tick here.
- `-p -` spends stdin on the prompt, so the attach reopens `/dev/tty`. With no controlling terminal
  you get told to use `--no-attach` and `resume`, rather than a hang.

## Starting it later: `--wait`

`gjd-remote new-claude --wait 2h -p - <<'EOF' … EOF` makes the session now and starts Claude in two
hours. Units are `s m h d`, and **one is required** — `--wait 2` is refused rather than guessed at,
because seconds and hours are both fair readings of it and they are 3600× apart.

> I wonder if it would be simpler for me to gauge how much there is currently to run, and simply
> specify a `--wait num_hours` … or even just add "Run unix sleep for num_hours…" to the beginning
> of the prompt
>
> — Greg, 2026-08-31

It is a `sleep` in the job script, before the `claude` line — **not** an instruction in the prompt,
which was the other half of that suggestion. Putting it in the prompt makes Claude start, spend a
paid call reading it, and decide whether to obey; the session and its usage are gone before the
waiting begins. Three things follow from where the sleep is:

- **The guards run before it, not after.** The job checks it can enter the directory and that
  `claude` is on its PATH, *then* sleeps. Reversed, a box with a stock PATH would say nothing for
  two hours and then end the session, at the one moment nobody is watching. Verified by reading the
  generated job back off the box rather than by reading the source that writes it.
- **It does not attach**, and says so. There is nothing to watch but a sleep.
- **It says `✓ created`, never `✓ started`.** Claude has not started, and the tick that says it has
  is the one this tool has had to earn back twice.

Two things it is not. **It is not a queue** — nothing counts how many sessions are running, and ten
`--wait 2h` jobs all start at once, two hours from now. And **a waiting session does not survive the
box rebooting**; nothing does, and there is no replay. What there is instead is a record: [The log](#the-log) below, and
`gjd-remote log --lost`. Why neither was built, and what would have to
be true to build them, is in
[../plans/260901a-gjd-remote-wait-duration-and-ssh-command.md](../plans/260901a-gjd-remote-wait-duration-and-ssh-command.md).

The pane and the laptop print the deadline in **different time zones**, each naming its own: the box
is Europe/London, and the laptop is wherever Greg is. Both are right. The sleep is a duration, so no
clock can affect how long it actually waits.

## `gjd-remote ssh` takes a command

`gjd-remote ssh 'free -g; tmux ls'` runs it on the box and prints what it said; `gjd-remote ssh` on
its own is still a shell. No pty when there is a command, like ssh itself, so the output pipes
cleanly and the exit code is the command's.

Until 2026-09-01 the arguments were **dropped on the floor**: the case ignored its positionals,
opened a login shell, printed the MOTD and exited 0. Asking the box a question and being handed a
welcome banner is [silent-success.md](../reusable/silent-success.md) in one line — the exit code
said the command had run, and it had never existed. Everything after `ssh` now goes through
unparsed, because a command's own flags are not ours to read.

## The log

Every `gjd-remote` command appends one line to
`${XDG_STATE_HOME:-~/.local/state}/gjd-remote/gjd-remote.ndjson` — `gjd-remote log --path` prints
where, `GJD_REMOTE_LOG_DIR` moves it. Launches add a second, richer line, and
**`gjd-remote log --lost` says which of them never became a Claude**, exiting non-zero if any did
not.

> My only worry is that we might schedule a prompt with a long wait period, and then something
> happens (e.g. the remote server gets rebooted) and it gets lost.
>
> — Greg, 2026-09-01

That is what it is for. A `--wait` job is a `sleep` in a tmux session, and **a session that a reboot
ate looks exactly like one that finished** — both are simply absent. So the evidence comes from two
places: the laptop records the intent, and the job script on the box appends one line to
`~/gjd-remote/log/starts.ndjson` the instant before it execs Claude. `/home` is a separate volume,
so that line outlives the machine being rebuilt, not merely rebooted.

Four things about it, each of which is a decision rather than a detail:

- **The transcript cannot answer this**, and was the first design. A session started with no prompt
  had **no** `~/.claude/projects/*/<uuid>.jsonl` after 45 seconds while its process was running,
  because the file is written from the first message; with a prompt one appeared within 15 seconds.
  So a transcript proves Claude ran and its absence proves nothing — the wrong way round.
- **A job you killed is not a loss.** Kills are recorded too, and matched **by uuid**, because `ls`
  renames a session to Claude's title and the name you kill is usually not the name it was launched
  under.
- **It is not in the repo**, though "git-ignored" is what was asked for: worktrees would split the
  record across checkouts, and the repo is inside Dropbox, so an append-only file there syncs on
  every command.
- **It never holds the prompt** — no argv field, no prompt field, only the length and the path on
  the box. It does hold the session *name*, and for an unnamed session that name is the first five
  words of the prompt, so the file is `0600` in a `0700` directory and is not as harmless as it
  looks.

[../plans/260901c-gjd-remote-log-for-lost-waited-jobs.md](../plans/260901c-gjd-remote-log-for-lost-waited-jobs.md)
has the reasoning, GPT Sol's review, and the four things it deliberately does not do — including the
per-uuid remote manifest and the box identity that a v2 would want.

## How slow it is, and why

Nothing here is CPU-bound. **The cost is ssh handshakes** — about fifteen network round trips each,
so ~2s at a healthy 78ms RTT and 8–10s when the link is bad. Measured 2026-08-31; RTT to the box
swung from 74ms to 660ms inside one minute, so treat any single number as the shape rather than the
value.

| | |
|---|---|
| `gjd-remote ls` | ~2s — one connection |
| `gjd-remote new-claude --no-attach` | ~7s — one handshake, then five cheap commands |
| attaching | **~13s on top**, and see below |

Every subcommand opens **one** ssh master and runs everything down it. The master is scoped to the
process, not persisted across invocations, and that is the interesting decision: a `ControlPersist`
master whose TCP connection has been blackholed by a sleep or a network change still completes the
local mux handshake, and the client then waits forever for a session that will never open —
`ConnectTimeout` does not bound that request. On a tool where every other pause is the network, an
unbounded hang is indistinguishable from a slow link. See `sshMasterOpts()` in
[`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) for the rest, including why the cleanup is
`ControlPersist=30` on the master rather than a signal handler.

**Attaching costs two mosh bootstraps, ~6s each**, because the probe answers "does mosh work on this
network?" by doing the whole thing and throwing it away. It is not an oversight — mosh retries
forever when UDP is blocked, and there is no honest cheap probe: UDP has no handshake, mosh's port is
allocated per session, and caching success goes stale exactly when the network changes. Skip the
probe with `--ssh` on a network you already know is bad. Removing the second bootstrap is a real
product decision, not an optimisation, and it is still open.

## Getting the app running on a new box

`gjd-remote clone` deliberately runs nothing, so a fresh checkout is code and no database. Three
commands from there, and the middle one is the whole of it:

```
gjd-remote push-env                 # from the laptop: .env.local, allowlisted keys only
gjd-remote new-shell -d ~/code/spideryarn2
npm ci && npm run setup             # on the box
```

`npm run setup` starts Docker's Supabase, applies the migrations and seeds the accounts, stopping at
the first failure with what to do — [`scripts/setup-local.ts`](../../scripts/setup-local.ts). It is
the same command on a laptop, on purpose: a setup path only the box uses is one only the box can
break.

**Then sign in.** `npm run db:admin-password` prints the email and the password this box generated
for itself; there is no Google step, which matters here because a browser on the box means the noVNC
tunnel and Google Cloud Console blocks agents twice over.
[supabase-local.md § Signing in](supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach)
is the detail, [260831ab](../plans/260831ab-seed-local-admin-user-for-remote-box.md) the reasoning.

Two things this does **not** do, and both are known:

- **Article fixtures are not in git.** `data/` and `output/` are gitignored, and about nineteen test
  files want an article that a fresh clone does not have —
  [260831x](../plans/260831x-remote-box-dev-environment.md) found it and it is still open.
- **`push-env` rebuilds `.env.local` rather than merging.** Anything you want on the box has to be on
  the allowlist in [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts); a line typed on the
  box is gone at the next push. The box's admin password is deliberately not in that file at all — it
  lives in `~/.config/spideryarn/`, so it is per-machine and survives both the push and a rebuild.

## tmux keeps sessions alive and does nothing else

> I pretty much only want it to keep my sessions alive, and it keeps trapping keyboard shortcuts
> that I'm used to using in weird, confusing ways.
>
> — Greg, 2026-08-31

So `~/.tmux.conf` on the box has **no prefix and no key bindings at all** — every keystroke belongs
to Claude Code. The file is a managed block written by
[`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh), which is where the reasoning for
each line lives; re-provision to change it, or edit outside the markers, which are left alone.

The measurement, on the box's own tmux 3.4: type `Ctrl-B H E L L O` into `cat -v` through a real
pty and stock tmux delivers **`ELLO`** — the prefix eats `Ctrl-B` *and* the key after it — while
this config delivers **`^BHELLO`**.

Two things worth knowing:

- **`unbind -a` with no `-T` clears the prefix table only**, taking the same default as `bind-key`.
  All four tables have to be named, and a check that only counts one of them passes on a box that
  still binds three.
- **With nothing bound, you detach by closing the tab** — the session survives, verified. From
  another shell on the box, `tmux detach-client -s NAME`. `gjd-remote resume` brings you back.
  If you want a key for it, `bind -n F12 detach-client` is one line; no TUI here sends F12.
- **The file being right and the keyboard being right are two facts.** A tmux server reads its
  config once, at start, and the box's server outlives provisioning by weeks — so provisioning
  rewrites `~/.tmux.conf` and changes nothing about the keyboard until somebody sources it. Both
  ends are now covered: provisioning reloads a running server (skipping it, loudly, if any pane is
  in copy-mode, because unbinding out from under one strands it), and `gjd-remote doctor` counts
  both numbers every run as **`tmux keys`**.

[../research/260831c-remote-server-tmux-mosh.md](../research/260831c-remote-server-tmux-mosh.md)
proposed a much larger `.tmux.conf` — mouse on, scroll bindings, a bigger history limit. That was
written before the keys turned out to be the problem, and it is superseded here.

## Traps

- **`gjd-remote` will not tell you a session exists when it cannot see the list.** A `tmux ls`
  piped into a `while` loop exits 0 with no output when tmux is missing — byte-for-byte what an idle
  box looks like — and every caller reads that emptiness as an answer. The remote script signs off
  with a marker and a reply without it is a failure. Same reasoning as
  [../reusable/silent-success.md](../reusable/silent-success.md), which is the general case.
- **`display -p -t "=name"` is not how you ask tmux about a session.** `display` takes a target
  *pane*, and the `=` exact-match prefix is only honoured on the session part when a colon follows.
  Without it tmux 3.4 returns empty fields and exits 0 — which is how `ls` came to report every
  session as attached and 56 years old. Prefer `tmux ls -F`, which takes no target at all.
- **A rebuild puts a new machine on the old address**, so ssh refuses with a changed-host-key error
  that reads as an alarm. `gjd-remote forget-key` is the answer; `accept-new` deliberately does not
  auto-accept a *changed* key.
- **The box is shared by many agents running as one user with passwordless sudo.** Anything that
  reaches it reaches all of them. That is the whole reason `push-env` builds from an allowlist.
- Sessions and their artefacts are keyed by Claude session id, not by name — two concurrent `new`
  runs could otherwise start each other's job. `cmdNew` in
  [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) says why.

## Known hole

`confirmStarted()` proves that tmux still has a session, not that Claude is running in it. An
immediate Claude failure — a bad option, an auth problem — leaves a live login shell and still
prints `✓ started`. Undecided; raised with Greg 2026-08-31.
