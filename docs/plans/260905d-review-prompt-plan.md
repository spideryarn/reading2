# Review: a plan to let `gjd-remote` find the box's own address without an env var

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback` (a git worktree of
the spideryarn/reading2 repo), branch `worktree-gjd-remote-host-fallback`. TypeScript + ESM, run
with `tsx`, no framework. `scripts/gjd-remote.ts` is a CLI that manages Claude Code sessions in tmux
on a Hetzner box; it is ~5700 lines and calls `main()` at import time, which is why every testable
decision in it has been split into a `scripts/gjd-remote-*.ts` module with a matching test.

**This is a plan review — no code has been written yet.** Attack the design, not an implementation.

## The candidate

Live pre-commit; base `HEAD` of this worktree.
Untracked files, the whole candidate:

- `docs/plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md` — the plan
- `docs/plans/260905d-review-prompt-plan.md` — this prompt

Read for context (all committed, unchanged by me):

- `scripts/gjd-remote.ts` — `host()` and `HOST()` around lines 255-290 are what the plan changes;
  `attachHandover` (~line 678) and the `new-claude` path (~line 2360-2500) are its callers.
- `scripts/gjd-remote-tmux.ts` + `tests/gjd-remote-tmux.test.ts` — the house style for "split a
  decision out of the CLI and test it", which the new module is meant to follow.
- `infra/hetzner/provision.sh` — the loopback key, its `authorized_keys` line, the `~/.ssh/config`
  block and the `/etc/profile.d/gjd-remote-loopback.sh` export are written around lines 960-1025;
  the verify checks that assert them are around lines 1119-1130.
- `docs/project/hetzner-remote-server-box.md` § "Running `gjd-remote` from the box".
- `docs/project/feedback-reports.md` § "The run" — the work this unblocks.

This is where to start, not the limit of scope.

## What it is meant to do

`gjd-remote` is written to run from Greg's laptop, where the box's address comes out of Terraform
state (`tofu -chdir=infra/hetzner output -json`). It now also needs to run **on the box itself**, so
that an unattended loop there can fan work out into real, resumable tmux sessions instead of into
in-process subagents nobody can open a tab on.

Everything for that exists already except the address: the box has a keypair that reaches only
itself, and `GJD_REMOTE_HOST=127.0.0.1` is exported from `/etc/profile.d/`. The gap is that
`/etc/profile.d/` is read by **login shells only**, and the agents that want the tool run in
non-login tool shells where the variable is unset — so the tool falls through to `tofu`, which the
box does not have, and dies with an error about Terraform state.

The plan adds a third source between the two that exist: a `/etc/gjd-remote-host` file written by
provisioning, read by a new tested module, ordered `GJD_REMOTE_HOST` → file → Terraform.

**Invariant that must not break:** a machine with no `/etc/gjd-remote-host` — every laptop, every CI
checkout — must resolve the address exactly as it does today, and must never silently ssh somewhere
other than where it did before this change. A wrong address here is not a broken command; it is a
command that runs against the wrong machine.

Deliberately out of scope: making `gjd-remote` a real binary on the box's PATH, any change to what
the loopback key can reach, and the feedback-reports loop itself.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/gjd-remote-tmux.test.ts`) and read anything in the repo. You have **no
network, not even loopback**, so nothing that ssh's, provisions, or talks to the box can be run by
you. Those I ran myself; the raw results are quoted in the plan under "Why the env var cannot reach
the shells that need it" and "The problem, and how it presents", and I can re-run anything you want
a fact from.

## Attack it

Independently, and before you read my own doubts at the bottom.

The invariant to try to break: **a laptop resolves the same address after this change as before**,
and **the box resolves an address that its ssh configuration can actually authenticate to**.

Worth pressing on specifically:

- The **ordering** env → file → Terraform. Is file-beats-Terraform right, or is
  Terraform-beats-file safer for the laptop? What does each get wrong, and on which machine?
- The **failure semantics**: file absent = fall through silently; file present but unparseable =
  die naming the file. Is there a third case (unreadable-but-present, empty, a directory, a
  symlink) that the plan has not decided?
- **Trust.** The file is root-owned `0644` on a box whose `/etc` an agent with sudo can write. Does
  reading an address out of `/etc` widen anything that matters, given the reader already runs as a
  user who could ssh anywhere?
- **The provisioning half.** `provision.sh` is re-run over an existing box, `/home` is a persistent
  volume that survives server rebuilds, and the `~/.ssh/config` block is appended behind a marker
  for exactly that reason. Does writing `/etc/gjd-remote-host` need the same care, or is `/etc`
  disposable enough that `cat >` is right?
- **The verification.** The plan says provisioning should check that the address resolves with
  `GJD_REMOTE_HOST` unset. Is that check reachable from inside `provision.sh` in a way that would
  actually have caught today's bug, or does it need something the script cannot do?
- Anything in the plan that is **effort without a benefit** — the `resolve` source line, the
  `profile.d` export being sourced from the file rather than repeating the address.

For each finding give:

- an ID (`F1`, `F2`, …), a severity, and whether it is **established** or **reasoned**
- what shows it fails its own claim, the concrete consequence, and the smallest fix

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by which file it is in: a defect in a *plan* that will cause a P1 to ship
is not a P3 because it is made of prose. **Refuse only on an established P0 or P1** — direct
evidence, no unresolved material inference.

End with a one-line verdict: proceed, proceed-with-changes, or do-not-proceed.

## My own suspicions — read these last, and spend most of the run elsewhere

1. I may be building a module where a five-line function would do. The house style says split it out
   to test it; the honest alternative is `try { readFileSync } catch {}` inline in `host()` and no
   new file. Which is right for a codebase whose problem has repeatedly been *un-testable* code in
   this one script?
2. `/etc/gjd-remote-host` as a filename. `/etc/gjd-remote/host`, `/etc/gjd-remote.conf`, or a
   key=value file that `profile.d` can source directly are all plausible; I picked the flat file
   because one fact does not need a directory, and because a bare address is trivially parseable in
   both shell and TypeScript.
3. I have not decided whether `doctor` should also check this, or whether the provisioning verify
   block is enough. `doctor` is the thing a human runs when something is wrong; provisioning is the
   thing that runs when the box is built. Today's bug survived because neither asked the question in
   the form an agent hits it.
