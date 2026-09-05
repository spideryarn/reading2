# `gjd-remote` — Claude Code sessions on a box that never sleeps

A CLI that drives a Hetzner server holding one tmux session per Claude Code session, so work
survives the laptop sleeping, the ssh dropping, and the tab being closed. **It drives whichever
repo you are standing in**, so you will meet it from repos that have never heard of it — which is
what this page is for.

**`--help` is the reference and stays current.** Read it before this or anything else:

```
npx tsx scripts/gjd-remote.ts --help
```

That form works everywhere. The box has no `gjd-remote` on its PATH, so the bare name in the help's
own examples is a laptop convenience — `npx tsx scripts/gjd-remote.ts` is the invocation to reach
for either way. From the box it needs no address and no key of yours — provisioning gave it both
([Running `gjd-remote` from the box](../project/hetzner-remote-server-box.md#running-gjd-remote-from-the-box)).
An agent that reports "gjd-remote cannot run here" has almost certainly hit that path and misread
it; check the report before believing it.

## The commands you will actually type

| | |
|---|---|
| `ls` (or no args) | every session, its repo, its age, and Claude's own title for the work — [what the columns mean](../project/hetzner-remote-server-box.md#what-gjd-remote-ls-is-telling-you) |
| `new-claude [name] -p "…"` | start a session, optionally with its first prompt — [starting a session with a prompt](../project/hetzner-remote-server-box.md#starting-a-session-with-a-prompt) |
| `resume [name]` | reattach; with no name, the most recent |
| `kill <name>` | end one |
| `resolve` | which repo is this, where is it on the box — one round trip, nothing created. **Run this first when a command refuses.** |
| `doctor` | check everything and say what is wrong; non-zero if any check failed |
| `upload <file>` | copy a file into `uploads/` under this repo's checkout on the box — [getting a file onto the box](../project/hetzner-remote-server-box.md#getting-a-file-onto-the-box) |
| `log` | every session launched from here, and whether it ever ran — `--lost` is the reboot case ([the log](../project/hetzner-remote-server-box.md#the-log)) |

## What to know before you use it from another repo

- **Identity is the git origin**, lower-cased to `owner/name` — never a folder name. A worktree is
  the same repo as its parent; two repos may share a basename. Outside git it refuses and names
  `--repo` and `--dir`.
- **`push-env` is not a copy.** Spideryarn's keys come off a reviewed allowlist; every other repo
  gets a checklist of key *names* sorted by a model, which is remembered per repo. Values are never
  sent to a model. Two guards cannot be ticked past: the tokens that can delete infrastructure, and
  any non-loopback database URL, caught by value.
- **That model call is billed to Spideryarn wherever you ran it from**, because the key and the
  ledger resolve from the tool's own location rather than your cwd.
- All three, and the clone-and-setup question a new repo gets, are in
  [Which repo, and where on the box](../project/hetzner-remote-server-box.md#which-repo-and-where-on-the-box).

## Then read

- **[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md)** — the owner of this
  subject: the shape of the machine, building one, every script and its test,
  [the traps](../project/hetzner-remote-server-box.md#traps) and
  [the known holes](../project/hetzner-remote-server-box.md#known-holes). Everything above is a
  pointer into it.
- [infra/hetzner/README.md](../../infra/hetzner/README.md) — Terraform, cloud-init, MCP servers.
  Followed literally while building a machine.
- [A change to the box is a change to a file](../project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file)
  — anything you install or configure by hand is also an edit to the file that builds the next box.
- [browser-control.md](../project/browser-control.md) — before any browser work, because the answer
  is decided by the machine: the Chrome extension cannot follow you to the box.
- [iterm.md](iterm.md) — driving the tabs that `resume-all` opens. Mostly traps.
