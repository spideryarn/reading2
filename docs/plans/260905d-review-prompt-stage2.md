# Review: Stage 2 — provisioning writes the address, plus the fixes for F8–F10

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback`, branch
`worktree-gjd-remote-host-fallback`. TypeScript + ESM, `tsx`, vitest; `infra/hetzner/provision.sh`
is bash, run as root on the box.

You have reviewed this work twice: the plan (F1–F7, all accepted) and the Stage 1 code (F8–F10,
verdict do-not-land). **Continue the ID sequence from F11.** Reuse an ID only for the same finding.

## The candidate

Committed, in order:

```
fcb81404   Stage 2: provisioning writes the address down, and proves it by using it
e2a32c82   The colon comes out: ssh and scp do not read one alike   (the F8–F10 fixes)
git diff 9b7205f5..e2a32c82
```

`9b7205f5` is the Stage 1 commit you already reviewed; the range above is exactly what is new.
Changed paths, complete:

- `infra/hetzner/provision.sh` — writes `/etc/gjd-remote-host`, deletes the `profile.d` export, four
  verify checks
- `scripts/gjd-remote-host.ts` — `HOST_TOKEN` loses `:` (F8)
- `scripts/gjd-remote.ts` — one `cachedAddress` object instead of two `let`s (F10)
- `tests/gjd-remote-host.test.ts` — colon forms refused (F8), Terraform calls counted (F9)
- `docs/project/hetzner-remote-server-box.md`, `docs/project/feedback-reports.md`,
  `docs/plans/260905d-*.md`

Start with `provision.sh` (the block around "gjd-remote loopback key", and the verify block near the
end) and the two `gjd-remote-host` files.

## Two things to check, and the first is a re-check

**1. Narrowly: are F8, F9 and F10 actually fixed?** F8 was your established P1, so this is the check
that matters most. The fix is removal, not repair: `HOST_TOKEN` is now
`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, and IPv6 is simply refused, on the reasoning that doing it
properly needs `isIP(value) === 6` *and* a bracketed `[addr]:path` for scp. Say if removal leaves a
hole you can still get through — anything the parser now accepts that `ssh` and `scp` would still
read differently.

**2. Broadly: Stage 2 itself.** The contract:

- `provision.sh` is **re-run on live boxes** and must be idempotent. `/home` is a persistent volume
  that survives server rebuilds; `/etc` is not.
- The file must end up a **root-owned `0644` regular file** holding exactly `127.0.0.1\n` — the
  reader refuses a symlink, a non-regular file, stray whitespace or a second line.
- The old `/etc/profile.d/gjd-remote-loopback.sh` export must be gone, so the question has one
  answer rather than two that disagree by shell.
- The verify checks must **fail** when the thing they check is wrong. `check()` is
  `if ( set +o pipefail; eval "$2" ) >/dev/null 2>&1` — so anything that exits 0 for the wrong
  reason passes silently, which is this repo's most common bug shape.

Attack those. Particularly worth pressing:

- The write: `mktemp /etc/.gjd-remote-host.XXXXXX`, `printf`, `chown`, `chmod`, `mv -f -T`. Under
  `set -euo pipefail`, on a re-run, and with a hostile or half-broken destination (an existing
  symlink at `/etc/gjd-remote-host`, a directory there, a leftover temp file from a killed run, a
  full disk). What does it leave behind that a later run trips over?
- The four checks, read as *shell*: quoting, word splitting, and the `$addr` in
  `check "…" 'addr=$(cat /etc/gjd-remote-host) && … su - '"$USER_NAME"' -c "ssh … $addr hostname"'`
  — which shell expands what, and when. Is there an input to that file which makes the check pass
  while the tool would go somewhere else, or makes it fail while everything is fine?
- Ordering: the file is written in the "loopback key" block; the checks run in the verify block near
  the end. Is anything between them able to invalidate it?
- The docs: `docs/project/hetzner-remote-server-box.md` § "Running `gjd-remote` from the box" and
  `docs/project/feedback-reports.md` § "The run" now tell an agent how to do this. Is either now
  saying something that is not true of the code in this diff?

## What you can and cannot run

Tree read-only; `/tmp` and node_modules caches writable. Please run
`npx vitest run tests/gjd-remote-host.test.ts` (19 tests, no network). You have **no network, not
even loopback**, and you are not on the box, so `provision.sh` cannot be executed — read it, and
build a throwaway harness under `/tmp` if you want to run a fragment of it against a fake `/etc`.

Run by me on the box, 2026-09-05, after applying the same change by hand:

```
$ stat -c "%F %U %a" /etc/gjd-remote-host   →  regular file root 644
$ cat /etc/gjd-remote-host                  →  127.0.0.1        (wc -l = 1)
$ test -e /etc/profile.d/gjd-remote-loopback.sh  →  absent
$ npx tsx scripts/gjd-remote.ts resolve      (GJD_REMOTE_HOST unset in the shell)
host: 127.0.0.1  (from /etc/gjd-remote-host)
$ npx tsx scripts/gjd-remote.ts new-claude fanout-noenv-op5 --no-attach -p - < prompt.txt
✓ started 'fanout-noenv-op5' with a prompt
  … pane showed Claude answering "OK" …
$ npx tsx scripts/gjd-remote.ts kill fanout-noenv-op5   →  ✓ killed
```

`npm run typecheck` clean. `npx tsx scripts/check-cloud-init.ts` passes (it reports "45 verification
checks are runnable shell", which now includes the four new ones). Full `npm test` is running as I
send this; I will report it and can re-run anything.

## Findings format

ID (`F11`, …), severity, **established** or **reasoned**, what shows it fails its own claim, the
consequence, the smallest fix.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1.** End with: land, land-with-changes, or do-not-land.

## My own suspicions — last, and worth less than what you find yourself

1. `mv -f -T` is what I reached for after a previous bug in this repo where a plain `mv` put a file
   *inside* a directory at the destination and exited 0. I have not proved `-T` is available and
   behaves on this box's coreutils, only that the script parses.
2. The `$addr` check is the one I am least sure of, because it is a value read from a file being
   spliced into a `su -c "…"` string inside an `eval`. I convinced myself the expansion happens in
   the eval's shell with `addr` already set. That is exactly the kind of reasoning that is wrong.
3. I applied this to the live box **by hand**, in the same shape, rather than by re-running
   `provision.sh` — which reinstalls a great deal and would have been the heavier, riskier move on a
   box with eleven live sessions on it. So the script's own path is *read*, not *run*. If you think
   that gap is the finding, say so.
