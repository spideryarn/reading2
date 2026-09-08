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
[../reusable/gjd-remote.md](../reusable/gjd-remote.md) is the short version, for an agent standing in
another repo who only needs the commands and the two or three things that bite.

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
  `new-shell`, `resume`, `resume-all`, `kill`, `log`, `doctor`, `provision`, `clone`, `setup`,
  `push-env`, `upload`, `resolve`, `ssh`, `tunnel`, `forget-key`. `--help` is long on purpose.
- [`scripts/gjd-remote-repo.ts`](../../scripts/gjd-remote-repo.ts) — which repo you are standing in,
  and which directory on the box is that same repo. The box-side inventory script and its
  fail-closed parse live here too. See [Which repo, and where on the box](#which-repo-and-where-on-the-box)
  and [`tests/gjd-remote-repo.test.ts`](../../tests/gjd-remote-repo.test.ts).
- [`scripts/gjd-remote-flow.ts`](../../scripts/gjd-remote-flow.ts) — the decisions about clones,
  configs and setup runs, as pure functions and as generated shell: the box-read protocol, the setup
  specification two machines are compared on, both gates, and the locked clone transaction. Split
  out because `gjd-remote.ts` calls `main()` on import, so none of it could be tested where it was —
  [`tests/gjd-remote-flow.test.ts`](../../tests/gjd-remote-flow.test.ts) runs the real scripts
  against temporary git repositories. See [Cloning, and why it is one transaction](#cloning-and-why-it-is-one-transaction).
- [`scripts/gjd-remote-provision.ts`](../../scripts/gjd-remote-provision.ts) — whether provisioning
  actually succeeded, which is not the same question as whether it exited 0. Split out for the same
  reason as the rest: [`tests/gjd-remote-provision.test.ts`](../../tests/gjd-remote-provision.test.ts).
  See [Building a box](#building-a-box).
- [`scripts/gjd-remote-host.ts`](../../scripts/gjd-remote-host.ts) — **which address to ssh to, and
  which of the three sources said so**: `GJD_REMOTE_HOST`, then this machine's own
  `/etc/gjd-remote-host`, then Terraform state. The file is what lets the box drive itself without
  being told; the rule the tests hold is that only `ENOENT` means "no file", because a broad catch
  turns a bad line in `/etc` into an error message about Terraform.
  [`tests/gjd-remote-host.test.ts`](../../tests/gjd-remote-host.test.ts), and
  [Running `gjd-remote` from the box](#running-gjd-remote-from-the-box).
- [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) — what `push-env` is allowed to send.
  The file on the box is **built from an allowlist**, never copied; `HETZNER_CLOUD_API_TOKEN` (can
  delete the box) and `SUPABASE_ACCESS_TOKEN` (can delete the production Supabase project) are
  deliberately off it. Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
- [`scripts/gjd-remote-upload.ts`](../../scripts/gjd-remote-upload.ts) — putting a file on the box:
  where `upload` sends it, the local paths whose basename would escape that folder, and
  `remoteWriteScript`, the one `sh` recipe behind **every** `writeRemote` — prompts and job scripts
  included. Tested by running that script for real:
  [`tests/gjd-remote-upload.test.ts`](../../tests/gjd-remote-upload.test.ts). See
  [Getting a file onto the box](#getting-a-file-onto-the-box).
- [`scripts/gjd-remote-mcp.ts`](../../scripts/gjd-remote-mcp.ts) — which MCP servers the box should
  be holding, and whether it is. Split out to be testable without a network:
  [`tests/gjd-remote-mcp.test.ts`](../../tests/gjd-remote-mcp.test.ts).
- [`scripts/gjd-remote-tmux.ts`](../../scripts/gjd-remote-tmux.ts) — reading the box's session list,
  and **`resolveSession`, which is how a typed name becomes a session every command may act on** —
  see [Sessions nobody made on purpose](#sessions-nobody-made-on-purpose). Split out so it can be
  tested without a network: [`tests/gjd-remote-tmux.test.ts`](../../tests/gjd-remote-tmux.test.ts).
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

- [`scripts/tmux-job.ts`](../../scripts/tmux-job.ts) — **run one long command on the box in tmux**,
  with a log, and let the session end when it does. Not part of `gjd-remote`: it talks to local tmux
  and nothing else. This is what to use instead of hand-rolling a `tmux new-session`, and why is
  [Sessions nobody made on purpose](#sessions-nobody-made-on-purpose).
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

**`cloud-init status` is first-boot history, not news.** It never changes after that boot, and the
current box's first boot ran the old, pre-split `runcmd` and recorded `error` for good — so a
provision that waited on cloud-init's verdict alone could never run there, and on 2026-09-03 it
refused. `gjd-remote provision` now asks the box for the bootstrap artefacts themselves — the
same list `provision.sh` checks on its first lines — and that outranks the first boot's verdict.
(Not the provision status file: every run rewrites it as "started", so one failed re-run would
erase the evidence the next one needed.) Still refused: cloud-init still running, and a bad first
boot that left artefacts out. `cloudInitGate` in
[`scripts/gjd-remote-provision.ts`](../../scripts/gjd-remote-provision.ts).

**Steps that run as Greg run in a non-login shell** (`"${AS_USER[@]}"` in `provision.sh`), never
`su - greg -c`. A login shell runs `~/.bash_logout` on the way out, whose `clear_console -q` fails
without a console, and under `set -e` that became the step's exit status after the installer had
already succeeded —
[260903a-a-logout-hook-decided-the-exit-status.md](../postmortems/260903a-a-logout-hook-decided-the-exit-status.md).

## Which repo, and where on the box

`gjd-remote` drives **whichever repo you are standing in**, and there is no default repo any more.
The rules, in order:

1. **Identity is the git origin** of the cwd's toplevel, lower-cased to `owner/name` — never a
   folder name. So `reading2` on the laptop and `spideryarn2` on the box are one repo, a worktree is
   the same repo as its parent, and two repos may share a basename without colliding. Outside git,
   inside a submodule, or with an origin that is not GitHub, it refuses and offers `--repo
   owner/name` or `--dir`.
2. **The box is asked what is under `~/code`** — every entry, symlinks not followed, each with its
   realpath, whether it is a checkout, its origin and whether `HEAD` resolves. The reply is strict:
   a row count and a `GJDOK` sentinel, and anything short of that is a failure rather than an empty
   box. One directory with that origin is the answer. None is `absent`, two is `ambiguous`, and
   anything else in the way is `blocked` with a reason (`non-checkout`, `incomplete-checkout`,
   `symlink`, `unreadable`, `unrecognised-origin`, `other-repo`). Only `found` starts anything.
3. **`--dir` wins over both** and is an explicitly arbitrary path on the box — `-d ~` is the home
   directory and no repo at all, which is why it prints `repo: unknown`. For `push-env` it must be
   this repo's checkout, verified by origin, because that command carries this repo's credentials.

`GJD_REMOTE_REPO` still works and is **deprecated**: it is an alias for `--dir`, it says so every
time, and it refuses if the directory it names is not the repo you are standing in. An env var must
not quietly steer one repo's work into another repo's tree.

The repo and the box directory are printed before anything happens. `gjd-remote resolve` prints just
those and stops — one round trip, nothing created — which is what to run when a command refuses.

Three roots, and they are not the same directory:

| root | holds | resolved from |
|---|---|---|
| tool root | Terraform state, `provision.sh`, `remote-smoke-browser.mjs` | this checkout, from the script's own location |
| local target | the `.env.local` that `push-env` reads | the toplevel of the repo you are in |
| remote target | the session's cwd, `push-env`'s destination, `upload`'s `uploads/`, the `.mcp.json` `doctor` checks | the verified checkout on the box |

`gjd-remote doctor` is two halves for the same reason: the box's checks belong to no repo, and the
repo's checks — its checkout on the box, whether the box can still fetch it, its `.mcp.json`, what
setting it up would run — need to know which repo. Outside a repo it runs the box half and names the
ones it skipped. `--box-only` asks for that on purpose. `doctor --dir` takes a box path and verifies
it the way `push-env` does — same origin, not a symlink, a HEAD that resolves — before checking it.

**`push-env` takes one of two paths, and which one is decided by the slug.** Spideryarn's keys come
off the reviewed allowlist in [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) — a list
of key *names*, with the reason for each written beside it, and no prompt. Every other repo gets a
checklist: the names are read out of that repo's `.env.local`, the **capable** model sorts them, and
its answer is the checklist's starting state for a key you have not answered for before. Names only —
**a value is never sent to the model and never written to the ledger**, and the keys you tick are of
course sent to the box, which is the whole point. The capable model was chosen over the cheap one
knowing it costs eighteen times more, because the cheap one left a quarter of each file `unknown` and
twice missed a token that can delete the box
([260902b-env-key-proposal-spike.md](../research/260902b-env-key-proposal-spike.md)). **Both answers
are remembered** in `~/.config/gjd-remote/repos/` — the file records every name you decided about and
which of them you approved — so the next push starts from your answers, a key you unticked stays
unticked whatever a later model thinks of it, and no model is asked about a key you have already
decided. Two guards cannot be ticked past on either path: the two names that can delete
infrastructure, and any value that is a database URL not pointing at a loopback host — by value, so a
production database under a name nothing here has heard of is caught too.
[`scripts/gjd-remote-envpolicy.ts`](../../scripts/gjd-remote-envpolicy.ts) holds the whole of it,
`pushEnvPlan` included — the CLI is glue, so that one test can put a sentinel value in at the top and
check every sink it could come out of.

**That model call is billed to Spideryarn wherever you ran it from.** The OpenRouter key and the
ledger it is written to both come from *this* repo's configuration, resolved from the tool's own
location rather than the cwd ([`src/env.ts`](../../src/env.ts), [`src/cli-ledger.ts`](../../src/cli-ledger.ts)) —
so proposing keys for hellozenno spends Spideryarn's credit and shows up in `npm run cost` here,
under the `env-proposal` job ([ai-gateway.md](ai-gateway.md)). That is what makes the tool work from
a repo that has never heard of OpenRouter, and it is worth knowing before the invoice.

**A repo the box has never had is offered a clone and a setup**, and only by `new-claude` and
`new-shell` — one question, defaulting to No, naming the directory and the exact command; off a
terminal it refuses and names `gjd-remote clone` and `gjd-remote setup` instead. The command in the
question is the *laptop's* copy, because that is the one you can see, and **after the clone it is
re-read from the cloned commit**: a different answer asks again, and no setup command at all leaves
the clone in place with no session. **The session is created only for a `success` status file from
the attempt you just watched**, so `--no-attach` starts the setup and stops.

For a checkout that *is* there, the setup status is printed whenever it is not `success` — a yellow
line, and the session starts anyway, because `~/code/spideryarn2` was set up by hand long before this
tool existed and ten live sessions work in it. The plan's end state is to refuse anything but
`success`, held back by that one case; the policy is `foundGateDecision()` in
[`scripts/gjd-remote-flow.ts`](../../scripts/gjd-remote-flow.ts), so flipping it is one edit. The
hard refusals are a status file nobody can read, a box with no `flock`, a status about some other
tree, and a setup that is running right now and holding the lock.

**A session in a repo checkout is created on the box under that same setup lock**, against the very
bytes of the status file the decision was read from — so it cannot start in a tree a setup took over
while the question was on screen. `--dir` is the exception it always is: an arbitrary path is not a
repo and has no status to be admitted against.

The plan is
[../plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md](../plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md).

### Getting a file onto the box

`gjd-remote upload <file>` copies one file from this machine into **`uploads/` under that repo's
checkout on the box** — a screenshot, a log, a PDF, whatever an agent over there needs and cannot
fetch for itself. Run it from anywhere inside the repo, so you never have to know or type the box
path; the destination is resolved by origin like every other per-repo command, and printed before
anything happens.

- **It requires an identity**, and a `--dir` must be verified as this repo's checkout, exactly as for
  `push-env`. Here the repo *is* the address, and an upload is as likely to be a credential dump as
  `.env.local` is — a file meant for one repo's agent landing in another repo's tree is the thing to
  design out, not to notice afterwards.
- **It never replaces a file already there**, and the guarantee is `link(2)`'s rather than ours.
  Two uploads a week apart called `screenshot.png` are the ordinary case, and the second one quietly
  winning is how the first goes missing with nobody told. `--force` to mean it.
- **The bytes go down the ssh command's own stdin**, not over scp, and the staging, the size check
  and the publish are all one remote command:
  [`remoteWriteScript`](../../scripts/gjd-remote-upload.ts), which is the recipe behind *every*
  `writeRemote` in the tool and carries the reason for each of its steps. A `Buffer` goes through
  unconverted — re-encoding a PNG as UTF-8 gives a file of about the right size that nothing will
  open, and the byte count would then agree with itself about the mangled bytes.
- **A symlink is followed** — what you meant is the bytes at the end of it — and the real path is
  printed, because which file you actually sent is not a thing to find out later.
- **The file lands 0600**, and an `uploads/` this creates lands 0700. The reason this command
  verifies which repo it is standing in is that an upload may well be a credential dump, and `cat >`
  makes 0644 by default. An `uploads/` that already existed keeps whatever mode it has.
- **`uploads/` is ignored** by this repo's `.gitignore`, anchored to the top of the checkout, for the
  same reason `.claude/worktrees/` is: a dozen agents share the box's checkout and the commit recipe
  in [AGENTS.md](../../AGENTS.md) leans on the working-tree status being readable. Nothing there is
  source and nothing there is backed up.

The decisions, the options passed over and the two reviews that reshaped this are in
[260904c-gjd-remote-upload-puts-a-file-in-the-repo-folder-on-the-box.md](../plans/260904c-gjd-remote-upload-puts-a-file-in-the-repo-folder-on-the-box.md).

The tests **run** that script, against temporary directories, rather than asserting on its text —
[`tests/gjd-remote-upload.test.ts`](../../tests/gjd-remote-upload.test.ts). That is not ceremony: the
`-T` on `ln` and `mv` is load-bearing, because with a *directory* at the destination the plain forms
put the file **inside** it and exit 0, and a test that read the string would only have agreed with
whatever we already believed. Half of that bug was found by review and half by the test. `-T` is GNU
coreutils, so on a Mac that suite skips and says so.

### Setting a repo up: `gjd-remote setup`

One command, the repo's own, run inside its checkout **on the box** — from `.gjd-remote/config.toml`,
or an executable `.gjd-remote/setup`, or `npm ci && npm run setup` when the `package.json` has a
`setup` script. A repo with none of those is refused rather than called set up.

Three things about it are worth knowing before you read
[`scripts/gjd-remote-setup.ts`](../../scripts/gjd-remote-setup.ts), which is where the design is
written down:

- **The config that runs is the box's copy, not the one on your laptop.** Both are read and a
  disagreement refuses, naming each — because the two differ whenever a change is uncommitted,
  unpushed or unpulled, which is most of the time while somebody is editing one.
- **Readiness is the status file, never the checkout's presence.** A failed setup leaves a perfectly
  ordinary-looking directory behind. `~/gjd-remote/setup/<owner>--<name>.json` records which attempt
  wrote it and a hash of the whole specification below — not of the two command strings — so a cut
  stream cannot read as success and a repo whose setup changed since, *in the file behind the command
  as much as in the command*, is `config-changed` rather than ready. `gjd-remote setup --status`
  reads it, and `doctor`'s `setup status` check is the same question.
- **It is a tmux job under a per-repo `flock`**, because `npm ci` plus Docker pulls outlive an ssh
  from a laptop that sleeps. You are attached so you can watch, and detaching leaves it running.
  **The lock's lifetime is the work, not the pane**: the job closes fd 9 before it `exec`s the login
  shell that keeps the session readable, so a held lock means a setup is genuinely running. It did
  not until 2026-09-02, and the pane holding the lock after finishing made the next run fail as
  "the job did not survive starting" — the plan's Log has it.
- **A box with no `flock` refuses every run**, rather than starting a job that dies with exit 78 in
  a pane that then vanishes. There is no serialising to be had there, and two setups in one checkout
  is what the lock exists to prevent.

**What the two machines are compared on is a specification, not a command string.** `gjd-remote
setup` refuses when the box's copy of a repo and your laptop's disagree — and the comparison covers
the setup command, where it came from, the `check`, the warnings, the **sha256 of
`.gjd-remote/setup`** when a script is what runs, and the **`package.json` `scripts.setup` body**
when the convention is. Two entirely different setup scripts resolve to the same eight characters,
`./.gjd-remote/setup`, so comparing commands alone said they agreed. **The script's hash and the
package body travel whether or not `source` says they are what runs**, because a config may spell
out the same path the convention would have found. That one specification, hashed by
`setupFingerprint()`, is what the prompt, the status file, `--status`, `doctor` and the session gate
all ask their question of — and the setup job re-derives both file facts *inside the lock* before it
runs anything, so a `git pull` between the question and the job cannot slip different bytes past the
answer.

### Cloning, and why it is one transaction

`gjd-remote clone` — and the automatic clone inside `new-claude`/`new-shell` — is a single locked
script on the box, not a sequence of round trips. It takes a per-destination `flock`, **re-resolves
the destination under that lock**, reserves the staging name with `mkdir` (atomic, so a success is
proof we made it, which is what makes the one `rm -rf` in the tool safe), clones, verifies the
recorded origin and that `HEAD` resolves, renames with no-clobber, and **compares the `.git` inode
across the rename** — a rename that declined is otherwise a success with somebody else's checkout at
the end of it. A fresh checkout also **archives the setup status of whatever used to be at that
path**, because an old success names the same repo and the same directory.

Readiness is bound to the tree, not just the path: the status file records the checkout's `.git`
inode, so deleting a checkout and cloning it again at the same path makes the old success read as
`wrong-checkout` rather than as ready. Both guards were exercised on the box on 2026-09-02.

The decisions, the generated shell and its parser live in
[`scripts/gjd-remote-flow.ts`](../../scripts/gjd-remote-flow.ts), away from the CLI, because
`gjd-remote.ts` calls `main()` on import and so nothing in it can be unit-tested;
[`tests/gjd-remote-flow.test.ts`](../../tests/gjd-remote-flow.test.ts) runs the real scripts against
temporary git repositories.

## A change to the box is a change to a file

Anything you do to this box that should still be true next week — an apt package, a `sudo` install,
a key in `.env.local`, a config file, an MCP server, and plenty this list does not name — is a change
to **two** things: this box now, and the file that builds the next one. Do only the first and it is
gone at the next rebuild, and no box after this one ever has it.

**Ask Greg first, and offer both**: this box now, *and* every box after it. He may want only one;
what he should not have to do is notice that you did half.

The usual homes, not all of them:

| What you changed | Where it lives going forwards |
| --- | --- |
| A package, a tool, a config file | [`provision.sh`](../../infra/hetzner/provision.sh) — re-runnable, so the only file that reaches boxes that already exist |
| Something `provision.sh` needs before it can run | [`cloud-init.yaml`](../../infra/hetzner/cloud-init.yaml) — first boot only |
| The machine: size, volume, firewall, keys | [`main.tf`](../../infra/hetzner/main.tf), `variables.tf` |
| A key for `.env.local` | the allowlist in [`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) and [`.env.example`](../../.env.example) — `push-env` rebuilds the file, so a line typed on the box is gone at the next push |
| An MCP server | [`.mcp.json`](../../.mcp.json) |

Not everything is made permanent: a secret belonging to this machine alone stays in
`~/.config/spideryarn/`, and anything you were only trying out stays a trial. When in doubt, that is
the question to ask.

The failure mode this exists for is the second copy, not the missing one —
[The editor is `emacs -nw`](#the-editor-is-emacs--nw) is in `provision.sh` and deliberately not in
cloud-init's `packages:` list as well.

## Running `gjd-remote` from the box

`gjd-remote` is written to run **from the laptop**, and for a while that was the only place it ran.
An agent working on the box had neither of the two things it needs: no `tofu`, so the address could
not come out of Terraform state, and no private key at all — `~/.ssh` held `authorized_keys` and
nothing else. Every command died at `Permission denied (publickey)`, so the tool that manages the
sessions was the one tool a session could not use.

Provisioning now gives the box a keypair that reaches **only itself**, and writes
**`/etc/gjd-remote-host`** — one line, `127.0.0.1` — which
[`scripts/gjd-remote-host.ts`](../../scripts/gjd-remote-host.ts) reads when `GJD_REMOTE_HOST` is
unset, ahead of Terraform. So from any shell on the box, login or not,
`npx tsx scripts/gjd-remote.ts ls` and the rest just work. There is no `gjd-remote` on the box's
PATH, so the `npx tsx` form is the only one that runs.

**It was an export in `/etc/profile.d/` until 2026-09-05, and that was wrong for every agent.**
`/etc/profile.d/` is read by login shells only; an agent's tool shell is not one, so the variable
was unset, the address fell through to a `tofu` the box has not got, and the tool died reporting a
**Terraform** problem. That reads as "gjd-remote cannot run here", and it was believed twice — once
in an agent's memory, once in `feedback-reports.md`. The export is deleted, so there is one answer
to the question rather than two that disagree by shell.

The comment beside that export said a login shell was enough, "tmux sessions get one (`exec bash -l`
at the end of every job script)". They do not: that line runs **after** `claude` exits, so Claude
and every tool shell under it come from a stock-PATH non-login bash. It is the same class this file
already learned from `claude` on PATH a few lines down — **verifying the convenient path instead of
the path the work takes** — which is why provisioning now checks the file's contract and probes the
loopback **with the address read out of that file**, rather than with a second copy of `127.0.0.1`
that could quietly stop matching it.
[The plan](../plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md).

Neither the key nor the file grants anything. Anyone who can read `~/.ssh/id_ed25519_loopback` already has a shell here, which
is all the key can get them; the box still has no key to GitHub, to the laptop, or anywhere else.
To undo it, delete the key, its line in `authorized_keys`, and the `gjd-remote-loopback` block in
`~/.ssh/config`.

Three separate things have to be true at once — the key, the `authorized_keys` line, and a `Host`
block, because ssh will not **offer** a non-default key name on its own and `gjd-remote` passes no
`-i`. Each can be present while the connection still fails, so `provision.sh` checks the connection
rather than the files, and checks the address file separately: the ssh can be perfect and
`gjd-remote ls` still die on the address. Both are in `doctor`'s report by way of the verify block,
and `doctor` prints which of the three sources answered — `gjd-remote → 127.0.0.1 (from
/etc/gjd-remote-host)` — because the address is the first thing to doubt when a command talks to the
wrong machine.

The `~/.ssh/config` block is **appended behind a marker, never written whole**. `/home` is the
persistent volume, so a config Greg adds by hand outlives the server that provisioning rebuilds, and
a `cat >` would eat it on a re-run — at the one moment nobody is looking.

## What `gjd-remote ls` is telling you

```
NAME                                     REPO                 AGE   ATT  STATE          TITLE
gjd-remote-ls-status-indicators          spideryarn/reading2  17m   yes  ? needs you    gjd-remote ls status indicators
worktrees-migration-history              spideryarn/reading2  3h    yes  - idle         Worktrees migration history
database-move-completion                 gregdetre/hellozenno 18h   yes  * working      Database move completion
run-git-commit-changes-md-then-pull      (unknown)            20m    no  z waits 3h39m  (no title yet)
— 1 needs you · 2 idle · 5 working · 1 waiting to start
```

**`REPO` is what the launcher pinned into the session, not a guess from its directory.** One repo is
`reading2` on the laptop and `spideryarn2` on the box, so the path cannot answer the question. It is
dimmed and reads `(unknown)` for two kinds of session: one started with `--dir`, which is an
arbitrary path and belongs to no repo, and one started before this metadata existed at all. A
session that carries *half* the metadata is not shown as either — the whole listing is refused,
naming the session and the variable, because a partial list is one whose absences get reasoned from.

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
| `shell busy` | no Claude in it, and something is running — a job, or a shell part way through one |
| `shell idle` | no Claude in it, and nothing running: a `new-shell` waiting for you, or a husk |
| `unknown` | something could not be determined, and a line under the table says which row and why |

**`shell idle` means "at rest right now", never "finished".** It is one snapshot of the process
table, so a shell nobody has typed into yet looks exactly like one whose work is over — which is why
nothing sweeps them and there is no `--idle-shells` flag. It is there so you can see which shells
are doing something, and `kill` the ones that are not. Before 2026-09-05 both read `shell`, and
eight sessions accumulated on the box that nobody could tell apart
([§ Sessions nobody made on purpose](#sessions-nobody-made-on-purpose)).

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

## Sessions nobody made on purpose

**`ls` lists every tmux session on the box, not only the ones this tool made.** Agents run long
commands in tmux because a backgrounded `npm test` here is killed under load and reported as a
success ([testing.md](testing.md#run-the-suite-in-tmux-because-a-killed-run-and-a-passing-run-look-the-same)),
so hand-made sessions are normal and expected — they are the rows that read `shell`.

On 2026-09-05 eight of them were sitting there under names nobody recognised, and **two of them
could not be killed at all**:

> But there are a few that are weird, e.g. `stageDbase`, `gateA`. If I try and resume them, it says
> that the session doesn't exist. If I try and kill them, it doesn't work.
>
> — Greg, 2026-09-05

`kill` and `resume` were testing the typed name against `SLUG`, the lower-case grammar for names
this tool is willing to **mint**, and using it as the rule for names it is willing to **act on**. So
every hand-made name with a capital in it was listed by the tool and untouchable by it, and `kill`
answered with its usage string — which reads like "you forgot the argument". Three rules came out
of it, and they are held by tests:

- **A name that `ls` prints is a name every command must accept.** Existence in the live list is the
  guard, not a grammar — [`resolveSession`](../../scripts/gjd-remote-tmux.ts).
- **Commands address `Session.id`** (tmux's `$N`), never the name. Between reading the list and
  sending the kill, a session can end and another take its name.
- **Every name is `shq`'d before it reaches a shell, and escaped before it reaches a terminal.** A
  tmux name can hold quotes and control characters; `SLUG` was the only thing standing in for both.

The way they stop arriving is [`scripts/tmux-job.ts`](../../scripts/tmux-job.ts): it names the
session after the worktree, writes a log, and runs the command as the pane's own process so the
session ends with it. The husks existed because the old recipe hard-coded `-s gate` — the second
agent in a minute got `duplicate session` and improvised — and because a bare `bash -l` session,
which is what you get if you make one and then `send-keys` into it, never exits.

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
- **The pane you attach to is the pane Claude appears in.** The sleep and the `claude` line are
  consecutive lines of one job script in one tmux pane, so an attached client reads
  `waiting 15h before starting Claude`, then `the wait is over`, and then Claude takes that same
  pane over. Nothing is re-attached; there is only ever the one pane.
- **It says `✓ created`, never `✓ started`.** Claude has not started, and the tick that says it has
  is the one this tool has had to earn back twice.

### It attaches, and for a long wait you don't want that

`--wait` takes the same path every other launch takes: it attaches, unless you say `--no-attach`.
Until 2026-09-04 it did the opposite, on the grounds that there is nothing to watch but a sleep.

> I'm saying default = attach.
>
> — Greg, 2026-09-04

The reversal is right for a short wait, because of the bullet above: you sit in the pane, it tells
you how long it has left, and it becomes Claude in front of you. **For a long one, say
`--no-attach`** — and the reason is the tab, not the connection. mosh is the default transport and
rides through a closed lid, so the attach usually does survive; what it costs you is a terminal you
cannot use for fifteen hours, and the ability to queue several waited jobs from one shell. Whatever
happens to the client, the job on the box is untouched and `gjd-remote resume` returns to it.

Off a terminal altogether — a cron job, another agent's subprocess — it says there is nothing to
attach to and **exits 0**. Everywhere else that is a `die()` telling you to pass `--no-attach`,
which is right for a session that is running and wrong for one that is asleep: the session was
created exactly as asked, and only the watching is missing. That is the whole reason the decision
is a function, `waitHandover` in [`scripts/gjd-remote-run.ts`](../../scripts/gjd-remote-run.ts),
rather than an `if` at the call site.

**Whether there is a terminal is `haveTerminal`, not `interactiveStdin`**, and the difference is a
bug this change shipped for about an hour before GPT Sol found it. `interactiveStdin()` returns the
descriptor the attach should *use*, and its `"inherit"` means only that nothing has taken stdin
away — it never asks whether stdin is a terminal, because before this every caller was a command
that would go on to fail usefully if it wasn't. So `--wait 2h -p "…" </dev/null` from a cron job
read as "terminal", took the attach path, and exited non-zero out of `tmux attach` over a session
that had been created exactly as asked. `-p -` was fine throughout, because a consumed stdin is
what makes `interactiveStdin()` go and open `/dev/tty` in the first place.

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

`gjd-remote clone` with no argument clones **the repo you are standing in**, found by its git origin;
give it `owner/name` for one you are not. It clones to a staging name beside the destination and
renames it into place only once the origin and HEAD check out, so an interrupted clone leaves nothing
at the destination rather than a half-made checkout.

It deliberately runs nothing, so a fresh checkout is code and no database. Three commands from there,
and the middle one is the whole of it:

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

## The editor is `emacs -nw`

Every gjd-remote box gets `emacs-nox` — the terminal-only build — and it is the default editor, so
`git commit` with no message, `crontab -e` and anything else that opens an editor lands in emacs
rather than nano. Installed and wired up by
[`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh).

**Three things name the editor, and they come apart** — a box can have the package and still open
nano, so all three are asserted separately by provisioning's verify section:

- `$EDITOR` and `$VISUAL`, from `/etc/profile.d/editor.sh`, for anything that reads the
  environment. A **login** shell only, which is what tmux job scripts get (`exec bash -l`).
- the `editor` alternative (`update-alternatives --set editor /usr/bin/emacs`), for `sudoedit`,
  `visudo`, and anything else that runs `/usr/bin/editor` with no environment to consult.
- git's `core.editor`, set explicitly rather than left to fall through `$VISUAL`/`$EDITOR`, because
  `ssh <box> git commit` is a non-login shell that sees neither.

`emacs-nox` has no GUI to open, so `-nw` is redundant against it. It is written anyway: it is what a
person types, and it stays correct if a graphical emacs ever arrives.

**It lives in `provision.sh`, not in `cloud-init.yaml`'s `packages:` list**, even though it is a
plain apt package exactly like tmux. cloud-init runs once, on a box's first boot; `provision.sh` is
what gets re-run on the boxes that already exist, so it is the only file that reaches every box —
and a second copy in cloud-init would be the copy that goes stale.

## Tailscale

`provision.sh` installs it, enables `tailscaled`, and stops there — deliberately not logged in.
`tailscale up` prints a URL that has to be opened in a browser, exactly the same shape as Claude's
and Codex's own `/login` above, and a provisioning script that blocked waiting for that would hang
forever on a box with no browser to answer it. So the one command it leaves for whoever finishes
the build is:

```
sudo tailscale up --hostname=spideryarn-box --operator=greg
```

**Why the box has it at all**: it is how the [agent fleet dashboard](orchestrator-direction.md)
reaches Greg's phone. The dashboard binds the tailnet interface rather than a public one, so
reachability *is* the access control, and nothing extra has to be built to keep it away from
strangers.

### After `tailscale up`, give the fleet dashboard the address

**Logging in does not tell the dashboard.** Its bind list comes from
`/etc/fleet-dashboard.env`, which only `provision.sh` writes, and provisioning has already run and
found no address by the time you get here. So `tailscale up` is two commands, not one:

```
tailscale ip -4 | head -n 1                 # confirm a tailnet address exists BEFORE the next line
printf 'FLEET_BIND=127.0.0.1,%s\n' "$(tailscale ip -4 | head -n 1)" | sudo tee /etc/fleet-dashboard.env
sudo systemctl restart fleet-dashboard      # only if the unit is enabled — see the warning below
```

**That order, and it matters.** `EnvironmentFile=` is read when the service *starts*, so a restart
before the file exists binds loopback and looks fine until somebody picks up a phone. Written first,
the *first* start after login already has the address.

**The restart is conditional on the unit being enabled**, which as of 2026-09-08 it is not: the page
is up under a tmux job, and starting the unit alongside it makes two supervisors race for `:8787`.
If the unit is not running, there is nothing to restart — the file is simply waiting for its first
start, which is what you want.

Doing this by hand, rather than by an `ExecStartPre` that generates the file, is deliberate: an
`ExecStartPre` writes the file *after* systemd has already read `EnvironmentFile`, so it would take
effect one start late — a mechanism that looks correct and is off by one every time. It would also
have to write to `/etc` as `User=greg`. Re-running `gjd-remote provision` regenerates the file too,
and is the other way to get here.

**Before you have run it, the dashboard is reachable from the box and not from your phone, and that
is the deliberate trade.** The unit falls back to `127.0.0.1` alone, which is correct on every box
and cannot fail to bind. It used to fall back to this box's tailnet address as well, which on a
freshly provisioned machine is an address that machine does not have — and
[`tools/fleet/server.ts`](../../tools/fleet/server.ts) treats a bind it cannot take as fatal, on
purpose, so the whole dashboard died rather than half-binding. A page you can only reach from the
box is visible, correct and one command from fixed; a service that will not start is none of those.
Found by a cross-family review on 2026-09-08, two hours after the unit landed.

It was installed by hand on the live box first, on 2026-09-08 — a human ssh session, not
`provision.sh` — which is exactly the gap
[A change to the box is a change to a file](#a-change-to-the-box-is-a-change-to-a-file) exists to
close: a box rebuilt from the script alone, before this landed, would have booted with no
Tailscale and no way to reach it from a phone, and nothing here would have said why.

## The box's own services

Two long-running tools run under **systemd**, not tmux: the **Overseer**, which records what the
agent fleet did, and the **fleet dashboard** it reads — both
[orchestrator-direction.md](orchestrator-direction.md).

They are **system units with `User=greg`**, and that is the whole point of them. Both used to be
`scripts/tmux-job.ts` jobs whose entrypoint was inside a *worktree*, so `git worktree remove` took
them down, and a reboot took the tmux server and everything in it. A systemd **user** unit would
not have fixed the reboot either: it does not start at boot unless lingering is enabled for the
account, and nothing here enables it. The evidence that a unit really will come back is the
symlink, not the word `enabled`:

```
systemctl is-enabled overseer                                   # enabled
ls -l /etc/systemd/system/multi-user.target.wants/overseer.service
```

**Editing a unit in the repo does NOT change the box, and nothing tells you.** There are three
copies of each unit — the readable one under `infra/hetzner/systemd/`, the heredoc inside
`provision.sh`, and the one in `/etc/systemd/system/` that actually runs.
`tests/systemd-units.test.ts` compares the first two byte for byte; **nothing compares either to the
third.** Measured 2026-09-08: `overseer.service` matched, and `fleet-dashboard.service` on the box was
**53 lines different** from the repo — still carrying a hardcoded tailnet address that no other box
could bind, two revisions after that was fixed.

So the install step is part of every unit change, not an occasional chore:

```
# after ANY edit to infra/hetzner/systemd/*.service — before enabling, restarting, or believing it
sudo install -m 0644 -o root -g root \
  <(sed 's/@USER@/greg/g' infra/hetzner/systemd/overseer.service) \
  /etc/systemd/system/overseer.service
sudo systemctl daemon-reload
```

**This is not a check for a good reason.** A test asserting the installed file matches the repo would
go red the moment anyone edits a unit and stay red until somebody ran `sudo` — which agents on this
box cannot do. A red trunk with no agent-reachable fix is worse than the drift it detects, because a
shared red gate hides its own additional causes. So it is a step you take and a thing you verify by
hand, and `diff` is the whole of the verification:

```
diff <(sed 's/@USER@/greg/g' infra/hetzner/systemd/overseer.service) /etc/systemd/system/overseer.service
```

At 3am:

```
systemctl status overseer                # or fleet-dashboard
journalctl -u overseer -n 50 --no-pager  # -f to follow
sudo systemctl restart overseer
sudo systemctl stop overseer             # stays stopped; Restart=always respects a deliberate stop
```

`Restart=always`, not `on-failure`, because on this box the things that send a clean `SIGTERM` are
not the service's owner — a stray `pkill`, a tidy-up script, an agent killing what it thinks is its
own process — and `on-failure` reads every one of those mistakes as a decision. A `StartLimitBurst`
in `[Unit]` stops a genuinely broken build restarting for ever: it crash-loops visibly in the
journal for about a minute and then sits in `failed`.

**They run out of the primary checkout, `/home/greg/code/spideryarn2`, never a worktree** — a
worktree is deleted by normal tidying, and an `ExecStart` inside one is a service that disappears
when somebody cleans up. Two consequences follow, and both are real rather than theoretical:

- They run **whatever is in the primary checkout when they start**, including a red `dev`. That is
  deliberate: a dashboard that refuses to boot until somebody fixes `dev` is unavailable exactly
  when it is needed.
- Nothing keeps the primary checkout current, and it is often hours behind `origin/dev`. **Updating
  it is a deploy**: `git merge origin/dev` there, then `npm run build:fleet` if the dashboard's
  client changed — `tools/fleet/web/dist/` is gitignored, so no pull can supply it, and a stale one
  is served with no error anywhere.

The unit files are checked in at [`infra/hetzner/systemd/`](../../infra/hetzner/systemd/) and
installed by [`provision.sh`](../../infra/hetzner/provision.sh), which splices them in verbatim —
`gjd-remote provision` copies that one file to the box and nothing else travels with it, so the
units have to live inside it. `tests/systemd-units.test.ts` compares the two copies byte for byte,
because two copies of a unit file is how one of them goes stale.

**The fleet dashboard's unit is installed and deliberately not enabled** as of 2026-09-08: the page
is up under a tmux job and its owner asked to read the unit before it is switched on, since two
supervisors racing for `:8787` produce a loser whose failure looks like a crash. Its bind list is
`FLEET_BIND`, which the unit sets to `127.0.0.1` alone and `/etc/fleet-dashboard.env` extends with
this box's tailnet address — provisioning writes that file from `tailscale ip -4`, removes it when
there is no address, and [after a login you write it yourself](#after-tailscale-up-give-the-fleet-dashboard-the-address).
The unit names no tailnet address itself, because that is a per-machine fact and a checked-in copy
of it is one the next box cannot bind. It deliberately does not name `FLEET_ACT_ENABLED` in any
form.

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
