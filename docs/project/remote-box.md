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

- [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — all of it: `ls`, `new`, `shell`, `resume`,
  `kill`, `doctor`, `clone`, `push-env`, `ssh`, `tunnel`, `forget-key`. `--help` is long on purpose.
- [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) — what `push-env` is allowed to send.
  The file on the box is **built from an allowlist**, never copied; `HETZNER_CLOUD_API_TOKEN` (can
  delete the box) and `SUPABASE_ACCESS_TOKEN` (can delete the production Supabase project) are
  deliberately off it. Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
- [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) — reading the box's session list.
  Split out so it can be tested without a network:
  [`tests/gjd-remote-tmux.test.ts`](../../tests/gjd-remote-tmux.test.ts).

**The machine**

- [`infra/hetzner/README.md`](../../infra/hetzner/README.md) — Terraform and cloud-init: first run,
  what to check before every apply (`npx tsx scripts/check-cloud-init.ts`), the noVNC tunnel, and why
  the disposable-server/persistent-volume split exists.
- [`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs) — the committed proof
  the browser stack works. `gjd-remote doctor` copies it up and runs it every time, so it is never a
  stale copy.

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

## Starting a session with a prompt

`-p` takes the prompt as an argument; `-p -` reads it from stdin, which is what you want for prose,
because a heredoc needs no escaping at all:

```
gjd-remote new -p - <<'EOF'
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

## How slow it is, and why

Nothing here is CPU-bound. **The cost is ssh handshakes** — about fifteen network round trips each,
so ~2s at a healthy 78ms RTT and 8–10s when the link is bad. Measured 2026-08-31; RTT to the box
swung from 74ms to 660ms inside one minute, so treat any single number as the shape rather than the
value.

| | |
|---|---|
| `gjd-remote ls` | ~2s — one connection |
| `gjd-remote new --no-attach` | ~7s — one handshake, then five cheap commands |
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
gjd-remote shell -d ~/code/spideryarn2
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
