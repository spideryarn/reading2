## Verdict: request changes

Do not build the lease registry as proposed. Ship a box-specific static cap of **1 worker**, in both the live box and provisioning, then use the memory measurements to design a small Linux-only emergency admission check.

The proposed registry is too complicated to remain advisory and too approximate to be a safety boundary. It fails precisely during the thundering-herd event it is meant to handle.

### 1. Is the registry worth it?

No, not for v1.

Changing 3 → 2 only reduces 54 worker forks to 36 during the observed 18-run incident. Changing it to 1 reduces them to 18. A one-worker box policy is honest about this machine: it is a host for many simultaneous suites, not a host where any single suite deserves parallelism.

The existing measurements already show poor returns above a few workers, and explicitly acknowledge that the current cap is not a bound ([prior plan](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md:116)). On this box, global throughput and continued Postgres availability matter more than individual-suite latency.

I would:

1. Change the box policy from 3 to 1, including provisioning and its self-check ([provisioning write](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/infra/hetzner/provision.sh:983), [self-check](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/infra/hetzner/provision.sh:1218)).
2. Leave laptops unchanged.
3. After seeing the memory table, add a machine-opted-in Linux emergency fuse if justified.
4. Revisit adaptive extra workers only if cap 1’s solo latency becomes a demonstrated problem.

At cap 1, a memory “clamp” cannot reduce further. Its only meaningful decision is therefore **admit or refuse**.

### 2. Thundering herd

The registry does not fix it.

Eighteen starters can all:

1. Read zero leases.
2. Choose three workers.
3. Create eighteen distinct `<pid>` files.

`O_EXCL` on each unique PID filename changes nothing. “Create, re-read, then back off” also lacks a unique allocation rule: every participant may make the same decision, and late arrivals can invalidate earlier decisions.

This is not “slightly too many workers once”; the overshoot can be the whole herd—18× the intended allocation.

If adaptive extra workers are built later, the claim must be atomic. The smallest defensible shape is a short, bounded admission critical section that assigns capacity, not a suite-lifetime semaphore:

- Hold the admission mutex only while reading and updating reservations.
- Bound acquisition to hundreds of milliseconds.
- On admission-lock failure, take one worker or fail fast according to current memory pressure.
- Release the admission mutex immediately; the lease persists separately.
- Recover crashed leases using more than PID alone.

That does answer the old lock objection: nobody waits behind a suite for minutes. But it is still a home-grown scheduler, which is why I would not build it yet.

### 3. Is the config universal?

Only for conventional invocations.

A direct `npx vitest run <files>` does discover and load this `vitest.config.ts`; `--standalone` also loads it. Vitest evaluates the config in the Vitest process, rather than in every fork ([installed Vite loader](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/node_modules/vite/dist/node/chunks/node.js:36958)).

But there are important holes:

- `--config <other-file>` selects another config explicitly. This is documented Vitest behavior, not an edge case. [Vitest configuration documentation](https://github.com/vitest-dev/vitest/blob/main/docs/config/index.md?plain=1)
- A different `--root` can discover a different config.
- Programmatic `createVitest(..., { config: false })` bypasses it; supplying another config replaces it ([installed Vitest source](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:14275)).
- The VS Code extension normally searches for and loads Vitest/Vite configs, but supports an explicit `vitest.rootConfig`, alternative search patterns, and multiple configurations. [Official Vitest VS Code extension](https://github.com/vitest-dev/vscode)
- `--standalone`, watch mode, and the extension may keep an idle Vitest process alive. A config-lifetime lease would reserve capacity while no tests are executing.
- One Node process can create multiple Vitest instances. The existing tests deliberately do so, and the current config comments already explain why PID/global state cannot distinguish a watch restart from another instance ([config](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:134)).

There is a worse accounting hole: the root placement intentionally allows CLI `--maxWorkers` to override the config ([config](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:239)), and the existing test proves that resolved behavior ([test](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/tests/vitest-worker-caps.test.ts:139)). A config-time lease could record 1 while the resolved run actually uses 8.

So I would refuse the claim that config-time leases account for every actual worker.

### 4. Memory signal and determinism

Use `/proc/meminfo`’s `MemAvailable` on this Linux box. Do not implement a macOS approximation yet. Make adaptive behavior an explicit machine policy, returning a typed result such as Linux snapshot versus unsupported platform; laptops retain the static rule.

The proposed formula is incomplete. It must resemble:

```text
worker_capacity =
  floor(
    (MemAvailable - protected_headroom - fixed_run_peak)
    / incremental_worker_peak
  )
```

A result below one means **refuse**, not “floor to one”. Otherwise the mechanism always adds another process group when it has calculated that none fits.

The measurements must cover:

- Peak, not mean.
- Whole process-group memory, including test-spawned children.
- Fixed main-process/global-setup cost separately from incremental worker cost.
- Database creation/migration and teardown phases.
- A clean, non-thrashing baseline: RSS under active swapping understates the working set, while summing RSS can double-count shared pages.

Different worker counts are acceptable: that is already true across machines and explicit overrides. But an adaptive run must emit one concise startup line containing:

- Final resolved workers, not merely the config’s requested value.
- Nominal source and value.
- Memory headroom, reserve, fixed cost, and per-worker assumption.
- Pressure/refusal reason.
- PID and policy version.
- Reservation totals, if reservations ever exist.

Logging only inside `resolveParallelWorkers()` would be misleading when CLI resolution later changes `maxWorkers`.

### 5. Swap

Do not gate on swap-used percentage alone. Swapped pages can remain after pressure has passed; high swap usage with 15 GiB available and no paging is not the same state as tonight.

Use a combined emergency condition: very low `MemAvailable` plus exhausted swap or sustained Linux memory pressure. Under that condition, **fail fast** with a distinctive resource-pressure message.

That is not the old blocking failure. It terminates promptly and explains that no test verdict was produced. Starting “just one” more worker while Postgres is already contending for its next allocation is the wrong degradation.

Threshold values require the missing table and an explicit reserve for Postgres, agents, kernel, and cache.

### 6. Serial lane

`private-postgres` is already at its minimum per invocation: `fileParallelism: false, maxWorkers: 1` ([config](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:271)).

Eighteen databases themselves are likely not the first concern. The prior design measured databases as cheap. But eighteen runs still cause:

- Eighteen database clone/dump/restore/migration setup paths.
- Eighteen lifetime lease connections ([private setup](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/tests/setup/private-db-global.ts:1)).
- Active test pools, potentially up to the default pool limit.
- Concurrent disk and Postgres work not controlled by root `maxWorkers`.

Measure that setup phase and actual peak Postgres connections. Do not add another database-specific mechanism unless it proves material. Also remember the known shared Storage collision: serialisation within one run does not isolate eighteen runs from one another ([testing doc](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/docs/project/testing.md:146)).

### Refuse to merge

I would block a change containing any of these:

- Write-after-read leases presented as thundering-herd protection.
- PID-only lease identity without handling multiple Vitest instances, watch lifetime, PID reuse, and crash residue.
- A lease count that can disagree with resolved `--maxWorkers`.
- `floor(MemAvailable / bytesPerWorker)` without protected headroom and fixed per-run cost.
- A floor of one that starts work after the calculation says no worker fits.
- Mean RSS used as the sizing number.
- Swap-percentage-only refusal.
- Silent macOS fallback or adaptive behavior enabled everywhere by default.
- A config-time log presented as the final resolved worker count.
- Only sequential unit tests for a concurrency claim. The red-first test must launch several processes behind a barrier and demonstrate the proposed algorithm’s current oversubscription.
- Provisioning that merely creates a policy file without checking its parsed semantic values.

The memory table can change the static choice between 1 and 2, the reserve and refusal thresholds, and whether database setup needs attention. It cannot rescue the registry’s TOCTOU, lifecycle, CLI-resolution, or entry-point problems.

I attempted the repo-required GPT Sol design review, but the reviewer could not initialize its in-process client under this sandbox (`EPERM`), so this verdict has not received the cross-family pass.