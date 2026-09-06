Verdict: **do-not-land**. F8–F10 are fixed, but Stage 2 has three established P1s.

### Findings

**F11 — P1, established — the desired configuration always fails the old environment check.**

Provisioning deletes `/etc/profile.d/gjd-remote-loopback.sh`, but the verify block still runs:

```bash
check "GJD_REMOTE_HOST is set on the box" \
  'su - '"$USER_NAME"' -c "echo \$GJD_REMOTE_HOST" | grep -qx "127.0.0.1"'
```

No remaining provisioning code sets that variable. On a correctly configured fresh box, `su -` therefore prints an empty line, sets `fail=1`, and provisioning exits non-zero. If a personal profile happens to preserve the variable, the check passes only by resurrecting the second answer this change is meant to remove.

Consequence: re-running `provision.sh` cannot report `PROVISION OK` for the intended state. The hand-applied live-box evidence bypassed this contradictory verification path.

Smallest fix: delete the obsolete check and its preceding comment.

**F12 — P1, established — the exact-content check accepts bytes the reader rejects.**

The content check uses:

```bash
test "$(cat /etc/gjd-remote-host)" = "127.0.0.1" &&
test "$(wc -l < /etc/gjd-remote-host)" -eq 1
```

Bash command substitution discards NUL bytes. I created `127.0.0.1\0\n`; this check returned success because `cat` became `127.0.0.1` and `wc -l` remained `1`. The TypeScript reader sees the NUL and rejects the file. The address-based SSH check also discards the NUL and connects successfully.

Consequence: after F11 is removed, all four new checks can pass while `gjd-remote` refuses the file, violating the exact-byte contract.

Smallest fix: compare bytes directly:

```bash
printf '127.0.0.1\n' | cmp -s - /etc/gjd-remote-host
```

**F13 — P1, established — malformed file contents are reparsed as shell syntax by `su -c`.**

The expansion does occur in the `eval` shell after `addr` is assigned. It is then inserted into the string passed to `su -c`, whose shell parses it again. For example, an address of:

```text
not-a-host; true #
```

produces the equivalent of:

```bash
ssh ... not-a-host; true # hostname
```

I reproduced that nested command returning success even when the transport command itself was forced to fail.

The preceding content check makes the overall provision fail for this ASCII example, so this is not privilege escalation—the file is root-controlled and execution is demoted to Greg. But the loopback row says `ok` when it tested no successful loopback, directly violating the verification contract.

Smallest fix: replace `test -n "$addr"` with an exact-value guard before interpolation, or pass the address as a separately quoted positional argument/direct argv rather than embedding it in `su -c`.

**F14 — P2, established — `test -e` treats a dangling legacy symlink as absent.**

```bash
! test -e /etc/profile.d/gjd-remote-loopback.sh
```

passes for a dangling symlink. I reproduced the check reporting success while the directory entry remained. If its target later appears, login shells regain the legacy answer without provisioning changing.

Smallest fix: also reject symlinks:

```bash
! test -e "$path" && ! test -L "$path"
```

**F15 — P2, established — failed or interrupted writes leak temporary files.**

After `mktemp`, failure in `printf`, `chown`, `chmod`, or `mv`, and interruption before the rename, leaves `/etc/.gjd-remote-host.*`. Against a directory destination, I confirmed `mv -f -T` failed correctly but left the 10-byte staged file. Subsequent runs normally avoid it because `mktemp` chooses another name, but repeated failures accumulate garbage and an ENOSPC run can worsen its own recovery conditions.

Smallest complete fix: install an `EXIT` trap immediately after `mktemp` and clear it after the successful rename.

**F16 — P3, established — two comments still describe the deleted export.**

- `infra/hetzner/provision.sh` says the editor login-shell path is “same as GJD_REMOTE_HOST below.”
- `tests/gjd-remote-host.test.ts` says the variable “is exported from /etc/profile.d/.”

Smallest fix: remove the first comparison and make the test history past tense.

### Re-checks and other conclusions

- **F8 fixed:** the parser accepts no colon, `@`, brackets, whitespace, or leading option syntax. I found no remaining accepted token that SSH and SCP parse as different hosts. The pre-existing explicit `GJD_REMOTE_HOST` override remains unvalidated, but that bypass is outside F8’s file-parser finding.
- **F9 fixed:** the bad-file test now proves Terraform was invoked zero times.
- **F10 fixed:** `{host, source}` is cached atomically with no fallback provenance.
- `npx vitest run tests/gjd-remote-host.test.ts`: **19/19 passed**.
- `bash -n` passes on the committed provisioning script.
- `mv -T` is appropriate here: the target image is Ubuntu 24.04/GNU coreutils, and it loudly refuses a destination directory.
- The two requested project-doc sections give the correct operating command and resolution order once the code findings above are fixed.

I reviewed the committed `9b7205f5..e2a32c82` range. Uncommitted changes appeared in `provision.sh` and the plan during the review and were not treated as part of the candidate.

**Verdict: do-not-land.**