## Verdict: request changes

Cap 2 is a reasonable CPU choice, and omitting a swap-percentage trigger is defensible. But the admission mechanism still does not bound concurrent runs. I would refuse to merge it as the memory-exhaustion fix.

### Findings

1. **P1 — A simultaneous-start herd can still oversubscribe by the whole herd.**

   Every process independently reads `MemAvailable` and immediately decides; nothing records the memory it has promised but not yet allocated ([vitest.config.ts:197](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:197), [vitest-admission.ts:156](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest-admission.ts:156)).

   For example, with 9 GiB available, a 4 GiB reserve, and nominal 2, every starter calculates capacity 5 and admits 2 workers. Eighteen simultaneous starters can therefore all admit roughly 4.236 GiB of predicted peak each: about 76.25 GiB in aggregate.

   Memory ramping over seconds helps staggered arrivals; it makes the burst race worse, not bounded. Also, the regression intercept is not evidence that 3.84 GiB has been allocated before the next config reads: the measurement script records aggregate peak, not the allocation timeline ([spike-vitest-workers.py:43](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/scripts/spike-vitest-workers.py:43)).

2. **P1 — `--maxWorkers` can exceed the admitted capacity.**

   Suppose exactly one worker fits. `decideAdmission()` returns one, but the root config deliberately allows `--maxWorkers=8` to replace that afterward ([vitest.config.ts:190](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:190), [vitest.config.ts:301](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:301)). The existing test proves this precedence ([vitest-worker-caps.test.ts:139](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/tests/vitest-worker-caps.test.ts:139)).

   This is not merely a potentially confusing log. The actual parallel lanes can consume more memory than the admission calculation allowed. The machine’s veto must be applied to the final resolved count, or the run must be refused when a CLI override exceeds capacity.

3. **P2 — The Linux safety threshold has not been shown to be conservative.**

   The constants come from Mac RSS for the unit lane ([vitest-admission.ts:48](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest-admission.ts:48)), but gate Linux runs containing all three lanes. Summed RSS double-counting shared pages suggests one source of overestimation; it does not bound differences in V8/kernel behavior, full-suite work, or memory charged to the external PostgreSQL process.

   Before shipping a safety threshold, measure Linux system-wide `MemAvailable` loss for representative full runs at 1/2 workers and overlapping runs. Use `smaps_rollup` PSS for attribution, but calibrate against `MemAvailable`, because that is what the policy actually reads.

4. **P2 — An opted-in machine can silently fail open.**

   An existing but empty reserve file becomes “not applicable” ([vitest-admission.ts:87](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest-admission.ts:87)); the test explicitly blesses that ([vitest-memory-admission.test.ts:145](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/tests/vitest-memory-admission.test.ts:145)). Provisioning writes with truncating redirection, so an interrupted write can leave precisely that state ([provision.sh:1025](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/infra/hetzner/provision.sh:1025)).

   Similarly, failure to read or parse `/proc/meminfo` becomes `unsupported`, then `not-applicable` ([vitest-admission.ts:112](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest-admission.ts:112), [vitest-admission.ts:150](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest-admission.ts:150)). On Linux with the reserve present, these states should throw. Write the provisioning file through a temporary file plus atomic rename.

5. **P2 — The config-time side effect can rerun inside an already-started suite.**

   `tests/vitest-worker-caps.test.ts` imports `vitest.config.ts` directly ([vitest-worker-caps.test.ts:37](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/tests/vitest-worker-caps.test.ts:37)), whose top level calls `workersForThisRun()` ([vitest.config.ts:222](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/adaptive-test-resources/vitest.config.ts:222)). That test also creates nested Vitest instances which resolve the real config.

   Near the threshold, the outer run can be admitted, allocate memory, and then the import or nested resolution can refuse from inside a test worker. The result is exactly the misleading partial red test the refusal message says cannot happen. Move the independently tested worker-cap logic out of the side-effectful config entrypoint.

### Answers to your questions

1. **Residual TOCTOU:** it is the herd problem wearing a different hat. The maximum overshoot remains the whole simultaneous cohort. A multi-process barrier test is still required if the claimed property is “bounds concurrent runs.”

   Release N children together, make them observe the same starting capacity, keep admitted children alive, and assert:

   ```text
   sum(FIXED_RUN_PEAK + admittedWorkers × PER_WORKER_PEAK)
     <= initialMemAvailable - reserve
   ```

   Also assert that a later entrant is refused. The current implementation will correctly make that test red.

2. **Constants:** measure on Linux before shipping. PSS being lower than summed RSS does not prove a Mac-derived threshold is conservative. Measure the same observable the policy consumes, including the full suite and external-service effects.

3. **Log seam:** a reporter’s `onInit(ctx)` can see resolved `ctx.config.maxWorkers` and the resolved project configs. Compute the effective scheduler count as `project.config.maxWorkers ?? ctx.config.maxWorkers`. A setup file is too late and runs per worker. This is a better seam for the truthful log, though enforcement must not disappear when users replace reporters.

4. **Refusal output:** the current location is comprehensible enough. Vite prints `failed to load config from …`; Vitest then labels it `Startup Error`, preserves the complete refusal message, and exits 1. I would not move it solely for presentation. The direct-import problem above does need fixing.

5. **Swap:** I would not add “swap used > X%” as an independent trigger. Cumulative swap occupancy is stale and causes false refusals. If operational evidence demands another emergency signal, use sustained Linux memory PSI or recent swap-in/swap-out activity. This omission is not a merge blocker.

### Earlier refuse-to-merge checklist

| Item | Result |
|---|---|
| 1–2 leases/PID identity | Pass: absent |
| 3 count disagrees with resolved workers | **Fail via `--maxWorkers`** |
| 4 fixed cost and reserve | Pass |
| 5 floor-to-one | Pass |
| 6 peak versus mean | Pass, but Linux calibration missing |
| 7 swap-percentage-only | Pass |
| 8 Linux-only/opt-in | Partial: platform behavior passes; empty/error states fail open |
| 9 honest config-time log | Pass in wording; reporter is the better seam |
| 10 concurrency barrier | **Fail; still required for the claimed bound** |
| 11 provisioning semantics | Pass as claimed, apart from the empty-file/atomic-write defect |

The cap-2 reasoning is sound: cap 1 buys little peak-memory reduction for a large wall-time penalty. It just does not rescue the admission mechanism’s missing concurrency bound.

Targeted verification passed: 34 admission/worker-cap tests and the tests TypeScript project. I made no edits.