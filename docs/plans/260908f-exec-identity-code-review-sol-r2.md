## Verdict

I would not sign off unchanged. No P0, but both P1 fixes are only partly closed:

- **P1-1:** the durable-register comparison fixes `verified(A) → unknown → verified(B)` and the upgrade’s failure to learn a token. The first-sighting fold still permits historical-age inheritance.
- **P1-2:** the elapsed-time check detects ordinary old-process/new-process mismatches, but it can still certify a reading assembled from two processes.

No fix introduced anything worse than those remaining holes.

## Ranked findings

### P1 — `previousToken: null` does not prove continuity, but the fold treats it as though it does

[diff.ts:1178](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/diff.ts:1178) deliberately uses null for both:

1. a legacy register entry predating execution identity; and
2. any session whose earlier readings were all unknown.

Only the first is the one-time migration case. In the second:

1. a session is registered while execution is unknown;
2. its status clock accumulates;
3. its harness is replaced during the blind interval;
4. the first verified reading is run B;
5. [store.ts:2369](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/store.ts:2369) sees null and preserves the old `statusSince`.

Run B therefore inherits an age that may belong to run A—the original failure class. The current test at [fleet-execution-identity.test.ts:934](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tests/fleet-execution-identity.test.ts:934) asserts preservation but does not establish that no replacement occurred.

Smallest sound fix: reset to a lower bound for every null first sighting. If retaining migration-era ages is important, legacy-unseeded and runtime-never-verified need distinct stored states; one null cannot safely support both decisions. I would prefer the one-time truthful age reset.

### P1 — five-second agreement still admits a mixed-process `verified` reading

[startAgrees](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/execution-identity.ts:244) accepts any start instants within five seconds. I reproduced:

- `ps`: PID 101 is Claude A, age 3 seconds, conversation `claimed`;
- later `/proc/101/stat`: replacement B started 2 seconds ago;
- difference: 1 second;
- result: `kind: "verified"`;
- `identityWriteGate`: `allowed: true`.

So a replacement can land inside the tolerance and pass. This is the same P1-2 hole, narrowed to young processes. Rapid PID reuse is operationally unlikely on this box, but `verified` still does not prove the assembled fields belong to one process.

The formula itself simplifies to:

```text
fromTable = uptime_at_check - ps_etimes
```

That is the correct reconstruction target. However, procps calculates `etimes` from its own uptime and `/proc/<pid>/stat` start time, so this is effectively a lossy earlier reading of the same kernel value, not an independent identity source. [procps source](https://gitlab.com/procps-ng/procps/-/blob/6164fbb82916178a0fa60f4eb1f7b651247407df/ps/output.c)

The tolerance is also awkward in the other direction: rounding costs under a second, plus the interval between the `ps` uptime sample and the later uptime read. Five seconds covers normal ~40 ms probes, but not the probe’s permitted ten-second runtime, so a slow valid collection can become unknown.

For the timing questions:

- Wall-clock steps do not matter because `table.atMs` algebraically cancels.
- Suspend before both readings is fine: `/proc/uptime` includes suspend and field 22 uses boot-time accounting. [proc_uptime(5)](https://man7.org/linux/man-pages/man5/proc_uptime.5.html), [kernel implementation](https://github.com/torvalds/linux/blob/master/fs/proc/array.c)
- Suspend or container pause *between* samples causes a false unknown, not a false verified.
- An ordinary container’s `/proc/uptime` and process start ticks retain a compatible host/time-namespace basis; the collector-PID-namespace scope is adequate.
- Hardcoded 100 is correct on this x86_64 box (`getconf CLK_TCK` reports 100), but not a universal Linux ABI guarantee. The documented interface says to divide by `sysconf(_SC_CLK_TCK)`. [proc_pid_stat(5)](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html)

A second, bracketed process classification remains the clean proof.

### P2 — the token validator accepts noncanonical and unproducible values

[execution-token.ts:54](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/execution-token.ts:54) accepts, among others:

```text
boot:1:01
boot:1:9007199254740992
not-a-uuid:1:1
```

The first is a second textual encoding of the canonical `boot:1:1`; the second cannot be represented as the safe integer required by both wire parsers. Because stored tokens are compared textually, a noncanonical accepted checkpoint token can manufacture a replacement and reset `statusSince`.

Parse the numeric components as safe integers and require reserialization to equal the input. The boot portion may stay deliberately loose, although validating the kernel UUID at the machine boundary would make the contract clearer.

### P2 — leaving `claimed-only` wide is no longer defensible

[wire.ts:1641](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/wire.ts:1641) documents an invariant the type contradicts. Given that this already caused an independent reader to infer a dead branch, this is exactly the wrong-state-the-compiler-should-refuse case.

It is not an immediate safety hole because the write gate refuses every `claimed-only` value. Still, I would narrow it now and have the tolerant parsers downgrade impossible incoming combinations.

The P2-4 downgrade for incoherent `verified` conversations is otherwise the right decision: preserve the useful process token, make the conversation unverifiable, and fail the write gate. Failing the whole row would discard safe continuity information unnecessarily.

One small follow-on: addressability is currently encoded three times—in the gate, Overseer parser, and browser parser—despite the browser comment saying it is not duplicated. Exporting one predicate from the new leaf would prevent the next harness addition drifting.

## Verification

- Typecheck: passed independently.
- Identity-centred suites: 517/517 passed.
- Wider focused run: 616/617 passed. The unrelated failure was the existing EPERM test assuming signalling PID 1 returns EPERM; in this environment it succeeds.
- `docs/plans/260908f-exec-identity-suite-r2.txt` is absent, so there is no final full-suite Vitest summary to rely on.