# The Hetzner remote server box, and `gjd-remote`

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
  `new-shell`, `resume`, `resume-all`, `kill`, `doctor`, `provision`, `clone`, `push-env`, `ssh`,
  `tunnel`, `forget-key`. `--help` is long on purpose.
- [`scripts/gjd-remote-provision.ts`](../../scripts/gjd-remote-provision.ts) — whether provisioning
  actually succeeded, which is not the same question as whether it exited 0. Split out for the same
  reason as the rest: [`tests/gjd-remote-provision.test.ts`](../../tests/gjd-remote-provision.test.ts).
  See [Building a box](#building-a-box).
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
- [`scripts/gjd-remote-resume-all.ts`](../../scripts/gjd-remote-resume-all.ts) — `resume-all`: one
  new iTerm tab per session, each attached to its own. The AppleScript, and which of it may be
  retried. Split out so the scripts and the guards can be asserted without a terminal:
  [`tests/gjd-remote-resume-all.test.ts`](../../tests/gjd-remote-resume-all.test.ts). The reasoning
  is in [../plans/260901f-gjd-remote-resume-all-opens-every-session-in-its-own-iterm-tab.md](../plans/260901f-gjd-remote-resume-all-opens-every-session-in-its-own-iterm-tab.md).
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
- **Claude Code itself** is installed **as `greg`**, by Anthropic's native installer, into
  `~/.local/share/claude/versions/` with `~/.local/bin/claude` pointing at it — so it can update
  itself without sudo. `/usr/local/bin/claude` is a symlink to that, and it is **load-bearing, not
  cruft**: every context that runs work here (the tmux job scripts, `ssh <box> claude mcp list`,
  cron) gets a stock PATH with no `~/.local/bin` in it. Installing it the obvious way instead — `sudo
  npm install -g` — is what
  [260902c-a-claude-that-could-never-update-itself.md](../postmortems/260902c-a-claude-that-could-never-update-itself.md)
  is about.
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

## Building a box

`tofu apply` gives you a **bootstrapped** box, not a built one. cloud-init makes the user, installs
the packages and hardens sshd; then:

```
npx tsx scripts/gjd-remote.ts provision
```

copies [`provision.sh`](../../infra/hetzner/provision.sh) up and runs it. Safe to re-run — that is
how a change to the script, or a moved pin, reaches the box.

The split exists because `user_data` is capped at 32 KiB by the Hetzner API and that script is 67 KiB
base64'd. It used to fit, and stopped when the script was carved out of the YAML on 2026-08-31; a
rebuild would have been rejected at the API, and nothing could see it, because Terraform stores only
a hash of `user_data` and the script is normally re-run over ssh where there is no limit. The four
cheaper fixes and why none works are in
[../plans/260901d-split-provisioning-out-of-cloud-init-to-fit-the-user-data-cap.md](../plans/260901d-split-provisioning-out-of-cloud-init-to-fit-the-user-data-cap.md).

**The verdict is not the exit code.** The status file on the box holds the *last* run's answer, so a
run that dies before `provision.sh` starts leaves the previous `PROVISION OK` in place, looking
exactly like this one's. Every run therefore carries an attempt id that the script writes into the
file, and the answer needs all four of: the wrapper exited 0, the status file names **this** attempt,
its `script-sha256` matches what we sent, and it says `PROVISION OK` with no `FAIL` lines.

Two things follow, and both are in
[infra/hetzner/README.md § Why provisioning is a separate command](../../infra/hetzner/README.md#why-provisioning-is-a-separate-command):
`cloud-init: done` now means *bootstrapped*, and cloud-init owns the bootstrap dependencies forever,
because it is baked into the machine at creation and never runs again.
## Running `gjd-remote` from the box

`gjd-remote` is written to run **from the laptop**, and for a while that was the only place it ran.
An agent working on the box had neither of the two things it needs: no `tofu`, so the address could
not come out of Terraform state, and no private key at all — `~/.ssh` held `authorized_keys` and
nothing else. Every command died at `Permission denied (publickey)`, so the tool that manages the
sessions was the one tool a session could not use.

Provisioning now gives the box a keypair that reaches **only itself**, and sets `GJD_REMOTE_HOST`
in `/etc/profile.d/`. So from any session on the box, `gjd-remote ls` and the rest just work.

It grants nothing. Anyone who can read `~/.ssh/id_ed25519_loopback` already has a shell here, which
is all the key can get them; the box still has no key to GitHub, to the laptop, or anywhere else.
To undo it, delete the key, its line in `authorized_keys`, and the `gjd-remote-loopback` block in
`~/.ssh/config`.

Three separate things have to be true at once — the key, the `authorized_keys` line, and a `Host`
block, because ssh will not **offer** a non-default key name on its own and `gjd-remote` passes no
`-i`. Each can be present while the connection still fails, so `provision.sh` checks the connection
rather than the files, and checks `GJD_REMOTE_HOST` separately: the ssh can be perfect and
`gjd-remote ls` still die on the address. Both are in `doctor`'s report by way of the verify block.

The `~/.ssh/config` block is **appended behind a marker, never written whole**. `/home` is the
persistent volume, so a config Greg adds by hand outlives the server that provisioning rebuilds, and
a `cat >` would eat it on a re-run — at the one moment nobody is looking.

## What `gjd-remote ls` is telling you

```
NAME                                     AGE   ATT  STATE          TITLE
gjd-remote-ls-status-indicators          17m   yes  ? needs you    gjd-remote ls status indicators
worktrees-migration-history              3h    yes  - idle         Worktrees migration history
database-move-completion                 18h   yes  * working      Database move completion
run-git-commit-changes-md-then-pull      20m    no  z waits 3h39m  (no title yet)
— 1 needs you · 2 idle · 5 working · 1 waiting to start
```

**The rows are sorted by who is being waited on**, not alphabetically. `needs you` is a session
parked on a permission prompt or a question, going nowhere until somebody answers it, and it costs
you the whole time it sits there — so it goes at the top. Then `idle`, which has finished and nobody
has looked. Everything getting on with itself sorts below both.

| | |
|---|---|
| `needs you` | a permission prompt or a question is on screen, and nothing happens until you answer |
| `idle` | Claude is up and has finished its turn — it is waiting for you to type |
| `working` | Claude is busy |
| `waits 3h39m` | [`--wait`](#starting-it-later---wait) is still counting down; Claude has not started |
| `no claude` | the box looked at the pane and found no Claude — it exited, or never got that far |
| `shell` | a `new-shell` session, which never had one — see the limitation below |
| `unknown` | something could not be determined, and a line under the table says which row and why |

**Two sources, and neither is trusted alone.**

`claude agents --json` prints one record per live session — `sessionId`, `pid`, `cwd`, `status` —
and `status` is `busy`, `idle` or `waiting`. It joins to us on `sessionId`, which is the uuid
`new-claude` already pins into the tmux environment. It is the only thing that can tell busy from
idle from parked-on-a-question.

**But being absent from that list does not mean not running**, and that was measured here before this
column existed: a session started with `--dir ~` had a live `claude --session-id <uuid>` for at least
35 seconds and `agents --json` matched it zero times, twice
([260901a](../plans/260901a-gjd-remote-wait-duration-and-ssh-command.md#claude-agents---json-and-the-trap-in-it)).
So the JSON says *listed*, not *running*. The second source is the process table: **one** checked
snapshot (`ps -eo pid=,ppid=,etimes=,args=`) joined against **every** pane of every session
(`tmux list-panes -a`), looking for a `claude --session-id <this uuid>`. A session that is running
but unlisted comes out `unknown` — never `no claude`, which would be a confident lie about a session
that is working.

Three details in that sentence are each a bug the first version had, all found in review or while
testing the fix for the one before it: it is **every pane**, because `#{pane_pid}` is only the active
pane of the current window; the snapshot's **exit status is checked**, because `ps --ppid` exits 1
for "no children" and a per-session call could not tell that from a failure; and the **pane process
counts as well as its children**, because `tmux new-window 'claude …'` makes Claude the pane itself.

**It is deliberately not screen-scraping**, and that was a decision rather than the first idea. The
panes really do say `✽ Herding… (2m 32s · ↓ 7.0k tokens)` while working and
`✻ Sautéed for 1h 13m · done 10:29 AM` when finished, and matching those off `capture-pane` was
version one. `cmux`, which orchestrates terminal agents for a living, records terminal-UI matching as
its single largest source of bugs — dozens of detection issues, each arriving the day Claude changed
how it draws a spinner. Hooks (`PermissionRequest`, `Stop`) are more precise still and are what the
tmux-dashboard projects use, but they have to be configured before a session starts, so they cannot
answer for the eleven sessions already running — which is the whole job of `ls`.

**The countdown comes off the `sleep` itself**: the same snapshot finds the `sleep N` the job script
is sitting in, and `N` minus its elapsed seconds is what is left. The laptop's own log already
records a `waitUntilMs` and would have been easier, but the sleep is the clock the wait is actually
kept by, and it answers for a session launched from another machine, which the log cannot.

**A sleep only counts if one of our own job scripts is the thing sleeping** — its path is under
`~/gjd-remote/jobs/`. Once Claude exits, the job `exec`s a login shell, and somebody typing
`sleep 900` into it would otherwise be reported as a scheduled job that had never started. And
`--wait` is read *before* the agents list, so the countdown still works on a box where
`claude agents` is missing or broken.

**It fails closed, and that is the part worth knowing.** Every emptiness in this reply is also what
something broken looks like, so none of them is allowed to be an answer:

- **`claude agents --json` missing, too old or broken** would make every session look like one with
  no Claude in it. The script says which of the two happened rather than leaving it to be inferred
  from an empty reply.
- **One unreadable record in that JSON fails the whole reply.** Skipping bad records looks careful
  and is the opposite: rename `sessionId` in some later Claude Code and every record is skipped,
  leaving a healthy-looking empty map — which means "nothing is running anywhere", wrong on every
  row at once.
- **A listing shorter than the one tmux sent is a failure**, not a shorter list. `ls` had been
  silently dropping the last session since it was written; see
  [260901b](../postmortems/260901b-the-session-that-was-never-listed.md).
- **`ps` failing, or tmux naming no pane for a session**, says so rather than reading as "nothing is
  running in there".

See [silent-success.md](../reusable/silent-success.md), and the tests in
[`tests/gjd-remote-tmux.test.ts`](../../tests/gjd-remote-tmux.test.ts) — every one of these was
watched going red.

**One thing it gets wrong on purpose.** A `new-shell` where you then type `claude` yourself still
says `shell`. There is no `CLAUDE_SESSION_ID` in that session, so there is no uuid to join on and no
way to tell that Claude from anyone else's. The row is dim and sorts last, so the cost is small, and
the alternative is a state that means "there might be a Claude in here somewhere". Start it with
`new-claude` and it is tracked properly.

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

`gjd-remote resume-all` opens one new tab per session on the box and types `gjd-remote resume <name>`
into each, so every tab paints itself by the mechanism above rather than a second one — which is why
a tab is its profile colour for the second or two before mosh connects. It has to drive iTerm rather
than write to its own tab, so AppleScript is unavoidable there, and everywhere the colour merely
skips itself, `resume-all` refuses outright and says which condition it was. It leaves
**already-attached** sessions alone, because `resume` runs `tmux attach -d` and taking a session over
blanks the tab you already had it in; `--include-attached` says you meant it.

## The status line

The box shows the same status line as the laptop — model, directory, git branch, and a ten-cell bar
for how much of the context window is gone, yellow from 70% and red from 90%. Auto-compaction lands
around 80%, so the colour arrives before the loss does.

The script is a heredoc inside [`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh)
rather than a file of its own, because that is the file you re-run on a live box; a second copy is
the copy that goes stale. Being a heredoc makes it invisible to `bash -n`, so
[`tests/statusline.test.ts`](../../tests/statusline.test.ts) carves it back out and runs it, and
`provision.sh` re-runs it on the box itself. Why it is arranged that way, and the unterminated
heredoc that ate forty lines while every check stayed green, are in
[infra/hetzner/README.md § The status line](../../infra/hetzner/README.md#the-status-line).

A session already running keeps the status line it started with — settings are read at launch — so
an existing tmux session needs a restart to pick it up.

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
  record across checkouts. It was also inside Dropbox when this was written, so an append-only
  file there synced on every command; that half stopped being true on 2026-09-01 and the first
  half still holds.
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
| `gjd-remote ls` | ~3s — one connection, and see below |
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

**`ls` got about 0.65s slower on 2026-09-01**, and it is worth knowing where it went: that is
`claude agents --json` starting up, which is what fills the [STATE column](#what-gjd-remote-ls-is-telling-you).
It is a fixed cost, not one per session — median of five on the box, the remote script goes from
1.20s to 1.85s. **Only `ls` pays it.** `new-claude` checking a name is free, `resume` and `kill` want
the list and nothing else, so they send the script without that block — which also means they cannot
hang on it.

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

**And a browser can sign itself in with the same credential**, which is what makes UI checks possible
here at all — `npx tsx scripts/browser-sign-in.ts`, and
[browser-testing-playwright.md § Signing in](browser-testing-playwright.md#signing-in).

`npm run setup` ends by saying whether `SPIDERYARN_OWNER_ID` is set to the account you sign in as. It
should be, and it arrives with `push-env` rather than being typed here — unset, everything the CLI
ingests lands on a shelf nobody signs in as and the library reads empty with nothing looking wrong
([supabase-local.md § One shelf](supabase-local.md#one-shelf-and-how-to-get-there)). A box that has
just been built needs only the variable; one that has already ingested things needs
`npm run db:reown -- --apply` first.

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

## Known holes

`confirmStarted()` proves that tmux still has a session, not that Claude is running in it. An
immediate Claude failure — a bad option, an auth problem — leaves a live login shell and still
prints `✓ started`. Undecided; raised with Greg 2026-08-31.

**The fresh-boot path has not been run since provisioning was split out of cloud-init**
(2026-09-01). `gjd-remote provision` has been exercised against the live box; what has not is a
server built from the new `cloud-init.yaml`, because that needs creating one. Until somebody
rebuilds, or spends a few cents on a throwaway box, the bootstrap half is verified only by the
preflight and by reading.
