Do not land yet: one established P1 makes accepted colon-bearing hosts unsafe for `scp`.

### Findings

**F8 — P1, established: colon-bearing “hosts” are accepted but parsed differently by `ssh` and `scp`.**

[`HOST_TOKEN`](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote-host.ts:55) accepts both valid IPv6 and invalid host/port-like values:

```text
2001:db8::1  → found
host:2222     → found
a:b           → found
::1           → bad
```

The two `scp` call sites concatenate that value into `greg@<host>:<path>` ([`scpTo`](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:527), [`push-env`](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:2924)). Using a local fake SSH executable established how OpenSSH parses it:

```text
greg@2001:db8::1:/tmp/x
→ scp invokes ssh with host "2001", user "greg"
```

By contrast, `ssh -G greg@2001:db8::1` reports the complete IPv6 address as its hostname. Thus one accepted file can make SSH and SCP address different destinations; uploads and provisioning copies fail or go somewhere other than the resolver claims.

The IPv6 concession is also incomplete because the most relevant loopback form, `::1`, is rejected by the required initial alphanumeric character.

Smallest fix for this IPv4-backed v1: remove `:` from `HOST_TOKEN` and test that IPv6 and `host:port` forms fail loudly. If IPv6 is genuinely required, validate colon-bearing values with `isIP(value) === 6` and generate transport-specific destinations: `greg@2001:db8::1` for SSH/mosh, but `greg@[2001:db8::1]:path` for SCP.

**F9 — P2, established: the bad-file test does not prove Terraform was never invoked.**

The test named “a bad file is a failure, never a fall-through to Terraform” supplies an unobserved Terraform function and only checks the returned error ([test](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/tests/gjd-remote-host.test.ts:102)). An implementation that eagerly ran Terraform and then returned the file error would still pass.

Smallest fix: increment `terraformRun` in that test and assert it remains zero, as the preceding box-file test already does.

**F10 — P2, reasoned: the cache represents an impossible partial state and silently mislabels it as Terraform.**

No current call order makes `cachedHost` and `cachedSource` disagree: resolution and both assignments are synchronous. However, the paired module-level variables and `?? "terraform"` fallback ([`hostSource()`](/home/greg/code/spideryarn2/.claude/worktrees/gjd-remote-host-fallback/scripts/gjd-remote.ts:309)) mean a future branch that sets only the host will quietly print false provenance.

This does not require changing every caller. Cache one `{host, source}` object behind a private resolver; keep `host()` and `hostSource()` as projections of it. Then the type system makes partial cache state impossible and the fallback disappears.

### Other conclusions

- The laptop path retains env → Terraform, adds only the expected absent-file `lstat`, and still memoises Terraform to one subprocess.
- I found no option or second-argv injection through the file parser; the concrete hazard is SCP’s colon grammar.
- Strict whitespace rejection is the right choice for a root-managed routing file. A hand-edited leading space should produce a visible configuration error.
- `npx vitest run tests/gjd-remote-host.test.ts`: 18/18 passed.
- The typecheck script passed when run directly with Node; the `tsx` wrapper itself was blocked by this sandbox’s IPC restriction.

**Verdict: do-not-land.**