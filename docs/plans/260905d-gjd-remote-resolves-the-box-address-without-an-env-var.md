# `gjd-remote` resolves the box address without an env var

`gjd-remote` runs from the box — the loopback key, its `authorized_keys` line and the `Host 127.0.0.1`
block are all there, and provisioning puts them there
([hetzner-remote-server-box.md § Running `gjd-remote` from the box](../project/hetzner-remote-server-box.md#running-gjd-remote-from-the-box)).
But the *address* still comes from `GJD_REMOTE_HOST`, exported from `/etc/profile.d/`, and the
agents that most want to use the tool never see it. This is the fix for that last inch.

The work it unblocks is [feedback-reports.md § The run](../project/feedback-reports.md#the-run):
one `gjd-remote new-claude` session per feedback report, fanned out **by a loop already running on
the box**, so Greg can `resume-all` into a tab per report or steer them by remote control.

## The problem, and how it presents

Measured on the box, 2026-09-05, from an agent's Bash tool:

```
$ env -u GJD_REMOTE_HOST npx tsx scripts/gjd-remote.ts ls
✗ could not read the server address from Terraform state (spawnSync tofu ENOENT).
  Run this from the repo, or set GJD_REMOTE_HOST=<ip> to override.
```

Two things make this worse than a missing variable.

- **The message names the wrong thing.** It talks about Terraform state and `tofu`, neither of which
  the box has or should have. It reads as "this tool does not run here", and that is exactly the
  conclusion that got written into an agent's memory and, on 2026-09-05, into
  `docs/project/feedback-reports.md` as "this step runs from the laptop". Both were wrong.
- **The doc already claims it works.** `hetzner-remote-server-box.md` says "from any session on the
  box, `gjd-remote ls` and the rest just work". True in a login shell, false in every agent tool
  shell, and a doc that is right for the human and wrong for the agent is the worst of both.

## Why the env var cannot reach the shells that need it

`/etc/profile.d/` is read by **login** shells only. An agent's tool shell is not one. The obvious
repair is to move the export somewhere non-login shells inherit — `/etc/environment`, via `pam_env`.
Spiked it, and it does not work here. 2026-09-05, `GJD_SPIKE_PROBE=alive` appended to
`/etc/environment` and removed again afterwards:

| where | sees it? |
|---|---|
| `ssh 127.0.0.1 'printenv GJD_SPIKE_PROBE'` | **yes** — `alive` |
| a **new** tmux session on the box's already-running tmux server | **no** — `unknown variable` |

The second row is the one that matters, because every agent on this box lives in a tmux session.
`pam_env` populates the ssh session, but the tmux *server* was started days ago and new sessions
inherit **its** environment, not the client's — `update-environment` copies a fixed list that our
variable is not on. So `/etc/environment` would fix a shell nobody works in and miss every shell
somebody does, and it would do it *silently*: the failure looks identical to the one we have now.

That is the simpler option, and it is passed over for that reason. The two others:

- **Pin `GJD_REMOTE_HOST` into each session with `tmux new-session -e`**, beside the `GJD_REPO`
  metadata the launcher already pins. Works only for sessions `gjd-remote` itself started, after
  this change — not for a shell, a cron job, or the primary checkout. Half a fix.
- **Leave it, and document the prefix.** Every launch command then carries
  `GJD_REMOTE_HOST=127.0.0.1`, and the day one does not, the error blames `tofu`. We have already
  watched that trap fire twice in two days.

## What we are building

**The tool should know where it is**, rather than being told by an environment it cannot rely on.

1. **`/etc/gjd-remote-host`** — a one-line file holding the address `gjd-remote` should use *when
   run on this machine*, written by `provision.sh`, root-owned, `0644`, a regular file. On the box
   it holds exactly `127.0.0.1`. On a laptop it does not exist, and nothing changes.
2. **`scripts/gjd-remote-host.ts`** — the resolution, as pure functions, tested. The order is
   **`GJD_REMOTE_HOST` → `/etc/gjd-remote-host` → Terraform state**:
   - the env var stays first, so an explicit override still wins everywhere;
   - the file beats Terraform because on the box Terraform is not merely absent but *wrong*. Measured
     2026-09-05: `ssh 188.245.166.213 hostname` from the box — the address Terraform state holds —
     is `Permission denied (publickey)`, because the loopback key is offered only for
     `Host 127.0.0.1 localhost` under `IdentitiesOnly yes`. Terraform-first would protect against an
     unexpected laptop file at the cost of a latent box failure the day `tofu` appears there;
   - **only `ENOENT` means absent.** Every other outcome — `EACCES`, `EISDIR`, a symlink, a
     non-regular file, empty content, extra lines, stray whitespace, a value that is not a bare
     host token — **dies naming the path and the reason**. A broad `catch` that turned an unreadable
     file into "absent" would fall through to `tofu` and report a Terraform problem on a machine
     whose actual problem is one line in `/etc`.
3. **`/etc/profile.d/gjd-remote-loopback.sh` is removed**, not re-pointed at the file. Exporting the
   file's contents into the environment would hand the resolver a value through the branch that
   does *no* validation, so a malformed file would be honoured in a login shell and rejected in
   every other — and the provenance line would say "env" for an address that came from the file.
   `GJD_REMOTE_HOST` goes back to meaning one thing: an explicit override somebody typed.
4. **Provisioning verifies the file contract, and authenticates through it.** It writes the file as
   a temporary root-owned regular file and renames it over the destination, then checks owner, mode,
   type and exact content — and **reads the address out of it for the existing loopback ssh probe**,
   so the address the tool will use and the address provisioning proves can never be two different
   things.
5. **`doctor` prints the provenance**, in the heading it already prints: `gjd-remote → 127.0.0.1
   (from /etc/gjd-remote-host)`. `doctor --box-only` needs no repo identity, which is what makes it
   the right place — the shell you are in when this goes wrong may be `$HOME`, a cron job, or a
   broken checkout. `resolve` gets the same line, since it is one call.

`--help`, the `host()` docblock and the module inventory in
[hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) all currently say the
address comes from Terraform. They are part of the change, not documentation of it.

## Stages

**Stage 1 — the tool, and nothing that needs the box.** `scripts/gjd-remote-host.ts` +
`tests/gjd-remote-host.test.ts`, wired into `host()`, with `doctor` and `resolve` printing the
source, and `--help`/docblock/doc inventory corrected. Done when the resolver's own tests are green
and **the laptop path is provably unchanged**: no file, env unset, Terraform still answers.

Red first, and it has to be red for the right reason: the module ships first with today's behaviour
(env → Terraform) so the new assertions fail on the *answer*, not on a missing import. A test that
goes red because the file it imports does not exist has proved nothing about a fallback.

**Stage 2 — the box, and the next box.** `provision.sh` writes and verifies `/etc/gjd-remote-host`,
drops the `profile.d` export, and probes the loopback with the address read from the file. Applied
to the live box in the same stage, because a fix that only reaches the next box leaves this one
exactly as broken as it was. **This is where every real box command belongs**: provisioning runs
before any repo is cloned ([cloud-init](../../infra/hetzner/cloud-init.yaml) bootstraps, then
`provision.sh`, then `gjd-remote clone`), so `provision.sh` cannot run the CLI at all and must not
pretend to. The proof is a post-apply smoke test from the checkout: `ls`, `resolve`,
`new-claude --no-attach -p -`, `kill`, all with `GJD_REMOTE_HOST` unset.

Docs in the same stage: `hetzner-remote-server-box.md` (the caveat added this morning becomes a
description of how it works — and its comment that "a login shell is enough" gets corrected, see
below), `feedback-reports.md` (drop the `GJD_REMOTE_HOST=` prefix from the fan-out recipe).

**One thing Stage 2 must say out loud.** Removing the `profile.d` export means a checkout still on
an older commit loses the variable and gets the old Terraform error. That is a loud failure, not a
silent one, and `git pull` fixes it — but it is a real window while other agents' worktrees catch up.

## The comment that was wrong, and the class it belongs to

`provision.sh` justifies the `profile.d` export with "A login shell is enough — tmux sessions get
one (`exec bash -l` at the end of every job script)". They do not. That `exec bash -l` is the line
*after* `claude` exits ([`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts), the `job` array), so
Claude and every tool shell under it run from a stock-PATH **non-login** bash.

The same file already documents this exact class two blocks earlier, about `claude` itself: *"`claude
runs` used to be a LOGIN shell, and it passed throughout the npm-prefix bug. What runs the work is
non-interactive."* The check was rewritten to take the non-interactive path; the export written
below it then assumed the login one. **The class: verifying the convenient path instead of the path
the work actually takes.** Stage 2's verification is written to take the same non-login path the
agents do.

## Review ledger — GPT Sol, round 1 (plan)

[260905d-review-sol-plan.md](260905d-review-sol-plan.md), prompt in
[260905d-review-prompt-plan.md](260905d-review-prompt-plan.md). Verdict: revise before
implementation. All seven accepted; none overruled.

| | | |
|---|---|---|
| **F1** | P1 | `profile.d` re-export bypasses the validation and lies about provenance → the export is **deleted**, not re-pointed. |
| **F2** | P1 | `provision.sh` runs before any clone exists, so it cannot run the CLI → the CLI smoke test moves to Stage 2, provisioning checks the file contract only. |
| **F3** | P1 | "exists and parses" would pass a valid *public* IP while the ssh probe still tested a hardcoded `127.0.0.1` → provisioning pins the content and **probes with the value it read**. |
| **F4** | P2 | The I/O and trust contract was underspecified → the `ENOENT`-only matrix above, plus write-temp-and-rename. |
| **F5** | P2 | Stage 1's "done" depended on Stage 2's file, and an import-error red proves nothing → stages resplit, module scaffolded with old behaviour first. |
| **F6** | P2 | `resolve` needs a repo identity; host trouble happens outside one → provenance goes in `doctor`'s heading, which `--box-only` reaches. |
| **F7** | P3 | `--help` and the `host()` docblock both assert Terraform is the default → both in Stage 1's manifest. |

Kept against no objection: the env → file → Terraform ordering, and the judgment that reading a
root-owned `/etc` file widens no authority a caller who can set the variable did not already have.

## What done looks like

- On the box, in a shell with no `GJD_REMOTE_HOST`: `ls`, `resolve`, `new-claude --no-attach -p -`
  and `kill` all work, proved by running them, not by reading them.
- On a machine with no `/etc/gjd-remote-host`, resolution is exactly what it was: env, then
  Terraform. A laptop cannot tell this change happened.
- `npm test`, `npm run typecheck`, `npm run check` green.
- The feedback-reports fan-out recipe is one command with nothing to remember.
