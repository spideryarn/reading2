## Findings

**F17 — P2, established — `check-cloud-init.ts` does not parse F12’s command.**

The parser collects only physical lines beginning with `check `. For the two-line F12 check, it extracts the argument as a lone `\`, prints that, and syntax-checks it successfully; it never sees the `printf … | cmp` command on the next line. Thus “44 verification checks are runnable shell” is not evidence for this check. See [check-cloud-init.ts](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/check-cloud-init.ts:279) and [provision.sh](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/infra/hetzner/provision.sh:1164).

Consequence: future quoting damage to F12 can pass this preflight.

Smallest fix: put this `check` invocation on one physical line, or teach the parser to join continuations.

**F18 — P2, established — F13’s shell pattern is locale-sensitive and does not exactly match `HOST_TOKEN`.**

Under the configured `en_GB.UTF-8` locale, the guard accepts `İhost` and `ıhost`; the JavaScript regex rejects both. Bash range expressions use locale collation, while [`HOST_TOKEN`](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote-host.ts:64) is ASCII-only.

This does not reopen the shell-injection hole: the permitted extra characters are not shell syntax, and the exact-content check still fails the overall verification. But the claimed character-set equivalence is false.

Smallest fix: set `LC_ALL=C` before the `case`, or spell out the ASCII characters without ranges.

**F19 — P2, established — F15’s reason for avoiding an `EXIT` trap is incorrect, leaving catchable current-run failures uncleaned.**

The existing trap is inside the `CLAUDE_SETTINGS_SH` heredoc and runs in a child `bash`; it is not a trap owned by the parent `provision.sh` process. See [provision.sh](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/infra/hetzner/provision.sh:884).

The sweep prevents accumulation across reruns, and the explicit handler covers `mv`, but a failure or catchable termination after `mktemp` and before `mv` still leaves the current staged file. A harness forcing failure there left `.gjd-remote-host.XXXXXX`.

Smallest fix: retain the initial sweep for SIGKILL leftovers, add a parent `EXIT` trap immediately after `mktemp`, and clear it after the successful rename.

**F20 — P2, reasoned — F15’s cleanup glob is broader than the files this script creates and can itself abort provisioning.**

`mktemp` creates a regular file with exactly six generated suffix characters, but `rm -f /etc/.gjd-remote-host.*` targets every entry with that prefix. It can delete unrelated names such as `.gjd-remote-host.backup`; if a matching entry is a directory, GNU `rm -f` fails and `set -e` aborts the run. When nothing matches, it is safe: the unmatched literal is ignored because of `-f`.

Smallest fix: clean only regular files matching the exact six-character temporary-name shape.

## Re-check outcome

- F11: fixed; no functional dependency on `GJD_REMOTE_HOST` or the deleted profile script remains.
- F12: the runtime double-quote/backslash layering is correct and produces exactly `printf '127.0.0.1\n'` for `eval`; F17 concerns only the preflight parser.
- F13: the injection is closed; F18 is the locale mismatch.
- F14: fixed for dangling symlinks.
- F15: accumulation is improved, but F19–F20 remain.
- F16: both comments are corrected.
- `vitest`: 19/19 passed.
- `bash -n`: passed.
- Cloud-init preflight: passed with 44 checks via `node --import tsx`; the requested `npx tsx` launcher was blocked by the sandbox’s Unix-socket restriction.

**Verdict: land-with-changes.**