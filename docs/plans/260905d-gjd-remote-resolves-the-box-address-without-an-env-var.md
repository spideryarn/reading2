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

## The spikes

Three, all 2026-09-05, all on the box. The first is in "Why the env var cannot reach the shells that
need it" above. The other two are about Stage 2, and both changed the code.

**The write path, against a fake `/etc`.** The exact `mktemp` → `printf` → `chown` → `chmod` →
`mv -f -T` sequence, run over each destination it might meet:

| destination before | after |
|---|---|
| nothing | `regular file 644`, right content, no leftovers |
| the file it wrote last run | same — idempotent |
| a `0600` file of nonsense | replaced, mode corrected |
| **a symlink pointing at another file** | replaced by a real file, **and the symlink's target left untouched** |
| **a directory** | `mv` refuses, run aborts — the file is *not* put inside it |
| a leftover temp file from a killed run | fine, but the litter stays |

The last two rows are why `mv -f -T` rather than `cat >`, and they are also the finding: a refused
`mv` under `set -e` leaves one `/etc/.gjd-remote-host.XXXXXX` behind for ever, because nothing after
it knows it is there. Fixed in the same stage — the `mv` now cleans up its own staged file before it
exits non-zero.

**Can the four verify checks fail?** A check nobody has watched fail is not evidence
([silent-success.md](../reusable/silent-success.md)), and `check()` swallows all output, so a check
that passes for the wrong reason is invisible. The three file checks were pulled **verbatim out of
`provision.sh` by `grep`** — not retyped — and run against bind-mounted variants inside a private
mount namespace, so the real `/etc` was never written:

| the file is | type check | content check |
|---|---|---|
| `127.0.0.1\n`, root, 0644 | ok | ok |
| `1.2.3.4\n` — a valid but wrong address | ok | **FAIL** |
| right content, mode `0600` | **FAIL** | ok |
| two lines | ok | **FAIL** |
| no trailing newline | ok | **FAIL** |

Plus: the export check fails when the export is put back, and the `$addr` expansion in the ssh probe
resolves in the root shell before `su` sees it — `[127.0.0.1]` from a good file, `[1.2.3.4]` from a
wrong one, and a refusal on an empty one. So the probe really does follow the file.

Worth knowing: **provisioning is stricter than the reader.** The reader accepts `127.0.0.1` with no
trailing newline; the content check does not, because `wc -l` counts newlines. That is deliberate —
the managed file has one exact shape — but it means a hand-written file can work perfectly and still
be reported as wrong, which is the right way round.

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

## Review ledger — GPT Sol, round 2 (Stage 1 code)

[260905d-review-sol-stage1.md](260905d-review-sol-stage1.md), prompt in
[260905d-review-prompt-stage1.md](260905d-review-prompt-stage1.md). Verdict: **do-not-land**. All
three accepted and fixed; none overruled.

| | | |
|---|---|---|
| **F8** | P1 | `HOST_TOKEN` allowed `:`, and `ssh` and `scp` do not read a colon alike — established against a fake ssh: `scp` took `greg@2001:db8::1:/tmp/x` as host **`2001`** while `ssh -G` took the whole address, so one accepted line could send the upload to a different machine than the session. **The colon is out**, and four colon forms are tested as refused. |
| **F9** | P2 | The "never a fall-through to Terraform" test never counted the Terraform calls, so an implementation that ran it eagerly and then returned the file's error would have passed → it counts now. |
| **F10** | P2 | `cachedHost`/`cachedSource` as two `let`s could be half-assigned by a later branch and print a plausible-but-false provenance → one `cachedAddress` object, `host()` and `hostSource()` are projections of it, and the unreachable `?? "terraform"` is gone. |

Sol's own note that the IPv6 concession was incomplete anyway (`::1` was rejected by the
leading-alphanumeric rule) is why F8's fix is removal rather than repair: IPv6 here needs
`isIP(value) === 6` **and** a bracketed `[addr]:path` for scp, and that is worth writing the day
something needs it.

## Review ledger — GPT Sol, round 3 (Stage 2)

[260905d-review-sol-stage2.md](260905d-review-sol-stage2.md), prompt in
[260905d-review-prompt-stage2.md](260905d-review-prompt-stage2.md). Verdict: **do-not-land**, with
F8–F10 confirmed fixed. All six accepted; none overruled.

| | | |
|---|---|---|
| **F11** | P1 | A verify check I never saw — `check "GJD_REMOTE_HOST is set on the box"` — read the variable back out of a login shell. With the export deleted, **a correctly configured box would fail provisioning**. Deleted, and its comment ("a login shell, because that is what a tmux session gets") kept as a headstone, because that sentence *was* the bug. |
| **F12** | P1 | `test "$(cat …)" = "127.0.0.1"` **discards NUL bytes**: Sol wrote `127.0.0.1\0\n` and the check passed a file the reader refuses. Now `printf '127.0.0.1\n' \| cmp -s - /etc/gjd-remote-host`, byte for byte. |
| **F13** | P1 | The address is read in one shell and spliced into the string `su -c` hands to another, which **parses it again**: `not-a-host; true #` makes the probe report `ok` having tested no loopback at all. A `case` guard now holds the value to exactly the characters the TypeScript reader allows, before anything interpolates it. |
| **F14** | P2 | `test -e` follows a symlink, so a **dangling** legacy symlink read as absent — and would come back to life the day its target appeared. `! -e && ! -L`. |
| **F15** | P2 | Staged temp files still leaked on any failure before the rename, and on a kill. A sweep of `/etc/.gjd-remote-host.*` before `mktemp` — not an `EXIT` trap, because the script already owns one and a second would silently disarm the first, and the sweep covers the killed-outright case a trap cannot. |
| **F16** | P3 | Two comments still described the deleted export. Both corrected. |

**How I missed F11**, since it is the one that would have broken provisioning: I grepped for
`GJD_REMOTE_HOST` across the tree and piped it through `head -20`. The hit was the twenty-first line.

### The fixes, watched failing

The check-can-fail spike, re-run against the *fixed* text — extracted from `provision.sh` by `grep`,
bind-mounted variants, private mount namespace:

| the file is | content check | address guard |
|---|---|---|
| `127.0.0.1\n` | ok | ok |
| `127.0.0.1\0\n` — **F12's repro** | **FAIL** (it passed before) | ok |
| no trailing newline | **FAIL** | ok |
| `1.2.3.4\n` | **FAIL** | ok — shape is fine, and the ssh probe is what catches the address |
| `not-a-host; true #` — **F13's repro** | **FAIL** | **FAIL**, so `su -c` is never handed the string |

And the export check now fails on a dangling symlink (**F14**), while still passing when nothing is
there.

## Review ledger — GPT Sol, round 4 (narrow re-check of the F11–F16 fixes)

[260905d-review-sol-stage2-recheck.md](260905d-review-sol-stage2-recheck.md), prompt in
[260905d-review-prompt-stage2-recheck.md](260905d-review-prompt-stage2-recheck.md). Verdict:
**land-with-changes**, F11–F16 confirmed fixed, four new P2s. All four accepted.

| | | |
|---|---|---|
| **F17** | P2 | **`check-cloud-init.ts` never read my checks at all.** It filters physical lines starting with `check `, so a `check "…" \` gave it the argument `\`, and `printf "%s" \` parses perfectly — four checks reported as "runnable shell" with nothing having looked at them. Fixed in the *parser*, not by reformatting the checks: a preflight that silently skips what it cannot parse is the very thing it exists to prevent. Watched go red on a deliberately broken continued check, then green again. |
| **F18** | P2 | Bash range expressions collate **by locale**, so `[A-Za-z]` under `en_GB.UTF-8` admits the dotted and dotless Turkish i, which the reader's ASCII regex refuses — the claimed equivalence was false. `LC_ALL=C` inside the check's own subshell. Measured: `İhost` accepted under `en_GB`, refused under `C`. |
| **F19** | P2 | My reason for avoiding an `EXIT` trap was **wrong**: the trap I pointed at lives inside a heredoc and belongs to a child bash, not to `provision.sh`. So there is a trap now, set after `mktemp` and cleared after the rename, and the sweep stays for the killed-outright case a trap cannot reach. |
| **F20** | P2 | The sweep glob was broader than the files we create. Proved by the spike in the way I least expected: `.gjd-remote-host.backup` is **exactly six characters**, so my "matches mktemp's own shape" glob deleted a file somebody had put there on purpose. The staging name now carries `.tmp.`, and `test -f` steps over a directory rather than aborting the run under `set -e`. |

**The spike also caught itself.** Its first F19 run reported `exit 0` with the file left behind,
which looked like the trap failing. It was the harness: `write_it && echo …` puts the subshell in a
condition context, and `set -e` does not fire there. Corrected to `write_it; rc=$?`, the real
behaviour appears — `mv` refuses, exit 1, nothing left staged. Twice now this spike has measured
itself rather than the code, in both directions.

## What done looks like

- On the box, in a shell with no `GJD_REMOTE_HOST`: `ls`, `resolve`, `new-claude --no-attach -p -`
  and `kill` all work, proved by running them, not by reading them.
- On a machine with no `/etc/gjd-remote-host`, resolution is exactly what it was: env, then
  Terraform. A laptop cannot tell this change happened.
- `npm test`, `npm run typecheck`, `npm run check` green.
- The feedback-reports fan-out recipe is one command with nothing to remember.

## What landed

**Stage 1** — `9b7205f5`. `scripts/gjd-remote-host.ts` + 18 tests, `host()` rewired,
`terraformHost()` split out so it is only run when it is asked, `hostSource()` behind `doctor`'s
heading and `resolve`'s new `host:` line, `--help` ENVIRONMENT rewritten, one module-inventory entry
in the box doc. Red first and red on the answer: the fallback test failed
`expected { host: '1.2.3.4' } to deeply equal { host: '127.0.0.1' }` against the scaffold, not on a
missing import.

**Stage 2** — `provision.sh` writes `/etc/gjd-remote-host` (mktemp → `chown`/`chmod` → `mv -f -T`,
because `cat >` follows a symlink and keeps the destination's ownership), deletes
`/etc/profile.d/gjd-remote-loopback.sh`, and adds four verify checks: the file's type/owner/mode,
its exact content, the absence of the old export, and the loopback ssh **at the address read from
the file**. Docs: the box doc's section rewritten, `feedback-reports.md`'s recipe de-prefixed.

**Applied to the live box** by hand, in the same shape the script now uses — the box is not rebuilt
from `provision.sh` on every change, and a fix that only reached the next box would have left this
one exactly as broken as it was. All four checks run by hand on the box afterwards: pass.

Proved on the box with `GJD_REMOTE_HOST` unset in the shell, 2026-09-05:

```
$ npx tsx scripts/gjd-remote.ts resolve
host: 127.0.0.1  (from /etc/gjd-remote-host)
$ npx tsx scripts/gjd-remote.ts new-claude fanout-noenv-op5 --no-attach -p - < prompt.txt
✓ started 'fanout-noenv-op5' with a prompt
$ npx tsx scripts/gjd-remote.ts ssh 'tmux capture-pane -p -t fanout-noenv-op5 …'
❯ Reply with the single word OK and then stop. …
● OK
$ npx tsx scripts/gjd-remote.ts kill fanout-noenv-op5
✓ killed 'fanout-noenv-op5'
```
