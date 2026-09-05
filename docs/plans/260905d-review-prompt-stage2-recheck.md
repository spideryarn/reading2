# Re-check: the fixes for F11–F16, and nothing else

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback`, branch
`worktree-gjd-remote-host-fallback`.

**This is a narrowly scoped re-check, not a new round.** You raised F11–F16 on Stage 2 and refused
it; three were established P1s, and their fixes were not in the snapshot you reviewed. House rule:
those fixes get a check *of the fixes*, and general discovery is closed. Please **do not** open new
lines of enquiry outside the six — if something outside them is a genuine P0/P1 you cannot leave
alone, say so in one line at the end under "outside scope".

Continue the ID sequence from **F17** for anything new.

## The candidate

```
git diff e2a32c82..db3cb94d
```

`e2a32c82` is what you reviewed; `db3cb94d` is the fixes. Changed paths, complete:
`infra/hetzner/provision.sh`, `tests/gjd-remote-host.test.ts` (one comment, F16),
`docs/plans/260905d-*.md`.

## What each fix claims, and what to check

- **F11** — the obsolete `check "GJD_REMOTE_HOST is set on the box"` is deleted; a comment stands
  where it was. Check: is anything else in the verify block, or anywhere in `provision.sh`, still
  depending on that variable or on `/etc/profile.d/gjd-remote-loopback.sh`?
- **F12** — the content check is now
  `check "…" "printf '127.0.0.1\n' | cmp -s - /etc/gjd-remote-host"`. Note the argument is
  **double-quoted** where the others are single-quoted, so `\\n` in the source is collapsed by bash
  before `check()` evals it. Check that layering, and check `scripts/check-cloud-init.ts` still
  parses it (it reports 44 runnable checks and passes; it reported 45 before, one having been
  deleted).
- **F13** — the ssh probe now guards the value before interpolating:
  `case "$addr" in ""|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) false ;; *) true ;; esac`. Claim: this is the
  same character set `HOST_TOKEN` in `scripts/gjd-remote-host.ts` allows, in the same order. Check
  both halves — that it matches the reader, and that nothing gets through it into the `su -c`
  string. Shell pattern subtleties (the `-` at the end of the bracket, `!` vs `^`, locale ranges)
  are exactly what I want a second pair of eyes on.
- **F14** — `! test -e … && ! test -L …`.
- **F15** — `rm -f /etc/.gjd-remote-host.*` immediately before `mktemp`, instead of an `EXIT` trap.
  The reason for not using a trap: `provision.sh` already sets `trap 'rm -f "$tmp"' EXIT` for the
  settings.json temp, and a second `EXIT` trap replaces it silently. Check that reasoning, and check
  the glob: is there any state of `/etc` where that `rm` removes something it should not, or fails
  under `set -euo pipefail` when nothing matches?
- **F16** — the two comments.

## Evidence I have already

The three file checks were extracted from `provision.sh` **by grep, verbatim** and run against
bind-mounted variants inside a private mount namespace (real `/etc` untouched):

| file | content check | address guard |
|---|---|---|
| `127.0.0.1\n` | ok | ok |
| `127.0.0.1\0\n` (your F12 repro) | **FAIL** — it passed before | ok |
| no trailing newline | **FAIL** | ok |
| `1.2.3.4\n` | **FAIL** | ok (shape is fine; the ssh probe is what catches it) |
| `not-a-host; true #` (your F13 repro) | **FAIL** | **FAIL** — so `su -c` never sees it |

Export check: **FAIL** on a dangling symlink, ok when nothing is there.

The live box's `/etc/gjd-remote-host` passes `printf '127.0.0.1\n' | cmp -s -` and
`stat -c "%F %U %a"` → `regular file root 644`.

A first pass of this spike reported the content check failing on a *good* file. That was the spike's
own extraction dropping a quoting layer, not the check — it is in the prompt because you should
assume the same mistake could be in the other direction somewhere.

## What you can run

Tree read-only, `/tmp` writable, no network. `npx vitest run tests/gjd-remote-host.test.ts` is
19/19. `bash -n` passes. You cannot run `provision.sh`; a `/tmp` harness against a fake `/etc` is
the way to test a fragment, as above.

Same severity scale and format as before. End with: land, land-with-changes, or do-not-land.
