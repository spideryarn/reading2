# Review: Stage 1 — `gjd-remote` resolves its address from the machine, not the environment

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback`, branch
`worktree-gjd-remote-host-fallback`. TypeScript + ESM, run with `tsx`, vitest.

You reviewed the **plan** for this in `docs/plans/260905d-review-sol-plan.md` and raised F1–F7. All
seven were accepted; the plan records the dispositions. **Continue the ID sequence from F8** — reuse
an ID only for the same finding.

## The candidate

Committed: `9b7205f5608e0e9c7d100921d16bd0f1a169acce` (the only candidate commit).

```
git show 9b7205f5 --stat
git diff 9b7205f5^..9b7205f5
```

Changed paths, complete:

- `scripts/gjd-remote-host.ts` (new) — the resolver
- `tests/gjd-remote-host.test.ts` (new) — its tests
- `scripts/gjd-remote.ts` — `host()` rewired, `terraformHost()` split out, `hostSource()` added,
  `doctor`'s heading and `resolve` print the source, `--help` ENVIRONMENT text
- `docs/project/hetzner-remote-server-box.md` — one module-inventory entry
- `docs/plans/260905d-*.md` — the plan, the previous review prompt, your previous review

Start with the first three. This is where to begin, not the limit of scope.

## What it is meant to do

`gjd-remote` manages Claude Code sessions in tmux on a Hetzner box. It is normally run from a
laptop, where the box's address comes out of Terraform state. It must **also** work when run *on*
the box, where there is no `tofu` and where ssh to the box's own public address is refused — the
loopback key is offered only for `Host 127.0.0.1` under `IdentitiesOnly yes` (measured: `ssh
188.245.166.213 hostname` → `Permission denied (publickey)`).

Contract:

- Address sources, in order: `GJD_REMOTE_HOST` → `/etc/gjd-remote-host` → Terraform state.
- **Only `ENOENT` means the file is absent.** Everything else — `EACCES`, a directory, a symlink, an
  empty file, two lines, stray whitespace, a value that is not a bare host token — must fail loudly
  naming the path, and must **never** fall through to Terraform.
- A machine with no `/etc/gjd-remote-host` (every laptop, every CI checkout) must behave exactly as
  before this commit.
- The resolved string is interpolated into `user@host` and handed to `ssh`, `scp` and `mosh`.

Out of scope for this stage, and deliberately absent: **nothing writes `/etc/gjd-remote-host` yet.**
`provision.sh` gets that in Stage 2, along with deleting `/etc/profile.d/gjd-remote-loopback.sh`
(your F1) and probing the loopback with the address read from the file (your F3). Do not report
their absence as a finding; do report anything in *this* commit that would make them wrong.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. Please actually run
`npx vitest run tests/gjd-remote-host.test.ts` (18 tests, no network, ~1s) rather than only reading
it. You have **no network, not even loopback**, so nothing that ssh's or reaches the box is runnable
by you; those results are quoted below and I can re-run any of them on request.

Run on the box, 2026-09-05, at this commit:

```
$ env -u GJD_REMOTE_HOST npx tsx scripts/gjd-remote.ts ls
✗ could not read the server address from Terraform state (spawnSync tofu ENOENT).
  Run this from the repo, or set GJD_REMOTE_HOST=<ip> to override.
  On a machine that hosts sessions of its own, /etc/gjd-remote-host answers this instead —
  provisioning writes it, and this one has not got it.

$ env GJD_REMOTE_HOST=127.0.0.1 npx tsx scripts/gjd-remote.ts resolve
cwd:  /home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback
host: 127.0.0.1  (from the GJD_REMOTE_HOST environment variable)
repo: spideryarn/reading2  (…)
box:  /home/greg/code/spideryarn2  (found by origin, https)
```

`npm run typecheck` clean; `tests/gjd-remote-{host,repo,tmux,run,flow,log}.test.ts` + `doc-links`:
7 files, 369 passed, 2 skipped.

## Attack it

Independently, before my questions at the bottom.

Invariants to try to break:

1. **A laptop is unaffected.** Find any path where this commit changes the address, the error text
   in a way that misleads, or the number of `tofu` subprocesses on a machine with no
   `/etc/gjd-remote-host`.
2. **No silent fall-through.** Find an input to `readBoxHostFile` that ends up at Terraform without
   anyone being told, or one that is rejected when it should be honoured.
3. **Nothing dangerous reaches ssh.** The value becomes `greg@<host>` in an argv. Try to get
   something through `HOST_TOKEN` that ssh would read as an option, a second argument, or a
   different destination than a reader of the file would expect.
4. **The memoisation.** `cachedHost`/`cachedSource` are module-level `let`s set together. Find an
   order of calls where they disagree, or where `hostSource()` reports a source the address did not
   come from.
5. **The tests hold what they claim.** Any assertion that would still pass with the behaviour
   inverted, or any case in the contract above with no test.

For each finding: an ID (`F8`, `F9`, …), a severity, whether it is **established** or **reasoned**,
what shows it fails its own claim, the concrete consequence, and the smallest fix.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1.** End with a one-line verdict: land, land-with-changes, or
do-not-land.

## My own suspicions — read these last, and spend most of the run elsewhere

1. `HOST_TOKEN` allows `:` so an IPv6 literal is not rejected out of hand, but nothing brackets it,
   so `::1` would reach ssh unbracketed. Is allowing the colon at all the wrong call here?
2. `hostSource()` calls `host()` for its side effect and then reads a module-level `let`, with a
   `?? "terraform"` that should be unreachable. That is a smell; the alternative is returning
   `{host, source}` everywhere and touching every call site.
3. Refusing stray whitespace rather than trimming it may be too strict for a file a human might edit
   with `echo " 127.0.0.1" > …`. I chose strict because the failure it prevents is silent
   misdirection, but I would like the second opinion.
