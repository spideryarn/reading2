# The address the box could not tell itself

For four days `gjd-remote` could not be run by the agents it exists for, and the error it gave sent
two separate readers to the wrong conclusion — one of them into an agent's memory, one of them into
`docs/project/feedback-reports.md`, where it became an instruction to do the work somewhere else.

Nothing was broken in the sense of a crash. Every part worked; one of them was verified along a path
nobody uses.

## What happened

`0e579d27` (2026-09-01, *"The tool that manages the sessions was the one tool a session could not
run"*) gave the box a loopback keypair and put the address in
`/etc/profile.d/gjd-remote-loopback.sh`:

```sh
export GJD_REMOTE_HOST=127.0.0.1
```

`/etc/profile.d/` is read by **login shells only**. Every agent on this box runs its commands in a
non-login tool shell, so the variable was unset, `gjd-remote` fell through to its Terraform source,
and the box — which has no `tofu` and should not have one — printed:

```
✗ could not read the server address from Terraform state (spawnSync tofu ENOENT).
```

Which is true, and about the wrong thing. The reader is told about Terraform on a machine where
Terraform is not the answer, so the natural conclusion is *this tool does not run here*. On
2026-09-04 that went into an agent's memory as "gjd-remote is a laptop tool". On 2026-09-05 it went
into `feedback-reports.md` as "this step runs from the laptop", by me, in a doc telling future
agents how to fan out feedback work.

## The real cause

Not the missing variable. The commit **checked the wrong shell**, and its own comment says so:

```sh
# A login shell is enough -- tmux sessions get one
# (`exec bash -l` at the end of every job script).
```

They do get one, and it is the wrong end. `exec bash -l` is the line **after** `claude` exits in the
job script (`scripts/gjd-remote.ts`, the `job` array) — it exists so the pane outlives the work.
Claude, and every tool shell under it, is started from the stock-PATH non-login bash above it.

The same file already knew this. Forty lines further down, about `claude` on `PATH`:

> `claude runs` used to be a LOGIN shell, and it passed throughout the npm-prefix bug. What runs the
> work is non-interactive.

That check had already been rewritten to take the real path
([260902c](260902c-a-claude-that-could-never-update-itself.md)). The export written below it assumed
the convenient one, and its verify check —
`check "GJD_REMOTE_HOST is set on the box" 'su - … -c "echo \$GJD_REMOTE_HOST" …'` — asked a **login
shell**, so it passed every time while the thing it stood for was false for every agent.

## The class

**Verifying the convenient path instead of the path the work takes.**

The shape: a fact is established for a shell, a user, a PATH or an environment that is *easy to ask*,
and the work happens somewhere else. The check passes, the feature is broken, and the check will go
on passing for as long as it exists — it is not a flaky test, it is a test of a different claim. This
is the second time in four days ([260902c](260902c-a-claude-that-could-never-update-itself.md) was
the first, same file, same shape), which is what makes it worth naming rather than fixing twice.

A sibling turned up while fixing it, and it belongs to the family: **a checker that silently skips
what it cannot parse.** `scripts/check-cloud-init.ts` filtered *physical* lines beginning with
`check `, so a check continued onto a second line handed it the argument `\` — and `printf "%s" \`
parses perfectly. Four checks were counted in "44 verification checks are runnable shell" with
nothing having read them.

## The fix

Full detail in
[260905d](../plans/260905d-gjd-remote-resolves-the-box-address-without-an-env-var.md); the shape of
it is that **the machine now says where it is, in a file, and nothing has to be told**:

- `/etc/gjd-remote-host` — one line, root-owned, written by `provision.sh` — read by
  [`scripts/gjd-remote-host.ts`](../../scripts/gjd-remote-host.ts) between `GJD_REMOTE_HOST` and
  Terraform. A file has no shell to be wrong about.
- The `profile.d` export is **deleted**, not repointed. Two answers that disagree by shell is the
  bug, not the mechanism.
- Provisioning checks the file's bytes and **probes the loopback with the address it read out of
  it**, so the address the tool will use and the address provisioning proves cannot diverge.
- The preflight parser joins continued lines, and was watched going red on a broken one.

## What would have caught it, ranked

1. **Verify along the path the work actually takes — cheapest and highest value.** The check that
   would have caught this on 2026-09-01 is one line, and it is the same lesson the file had already
   written down about `claude`: ask the *non-interactive* shell. Better still, as here: check the
   artefact (a file's bytes) rather than an environment, because an artefact has no path to be right
   or wrong along.
2. **Make the failure name its own machine.** The error said "Terraform state" on a box that will
   never have Terraform. One sentence — *"on a machine that hosts sessions of its own,
   `/etc/gjd-remote-host` answers this instead"* — turns a four-day wrong conclusion into a
   five-minute fix, and it costs nothing.
3. **When a doc and an agent's memory agree, suspect them both.** Two independent readers wrote down
   "laptop only" from the same misleading error. Neither had run the command with the variable
   unset; both had read the same output. The memory was corrected on 2026-09-05, and the rule that
   catches this generally is already in `CLAUDE.md`: harness memory is not where knowledge lives.
4. **Distrust a checker's own count.** "44 checks are runnable shell" was four short of the truth
   and looked identical to the truth. A count is evidence about a parser, not about what it parsed —
   see [silent-success.md](../reusable/silent-success.md).
