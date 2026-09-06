Verdict: **request changes**.

### Findings

1. **Medium — the `globalThis` carrier leaks across independent Vitest instances.**

   [vitest.config.ts:152](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/vitest.config.ts:152) cannot distinguish a watch restart from a second `createVitest` run. I reproduced:

   ```text
   first instance, env=7:  unit=7, shared=7
   second instance, no env: unit=7, shared=7
   ```

   The tests hide this by deleting the symbol before every case at [vitest-worker-caps.test.ts:58](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/tests/vitest-worker-caps.test.ts:58). Add a regression test with two sequential `createVitest` instances: the second must use the machine/default value, not the first instance’s override.

2. **Low — the provisioning test does not check the promised value `3`.**

   [vitest-worker-caps.test.ts:216](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/tests/vitest-worker-caps.test.ts:216) accepts any digits and then proves that those same digits parse. Changing provisioning to `99` leaves it green; it also does not check that the verify block expects the same value. Finding 3 is therefore mostly, but not completely, addressed.

3. **Low — finding 4 remains partly unaddressed.**

   The historical inaccuracies were corrected, but:

   - The runtime error still says “quarter” instead of “half” at [vitest.config.ts:129](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/vitest.config.ts:129).
   - The incident remains substantially repeated across the config, testing doc, and provisioning script rather than merely cited.
   - “Full suite green” immediately followed by two failures at [the plan:197](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md:197) is misleading.

### Direct answers

1. **Root placement:** yes for `npm test`, direct files, `--project unit`, and watch mode. File/project filtering does not introduce a project `maxWorkers`; only `private-postgres` deliberately shadows the root with `1`. An alternate `--config` or running outside config discovery naturally bypasses it.

2. **Carrier:** it survives `vi.resetModules()`, as intended, and the test hooks prevent ordinary order dependence. It is not sound for multiple independent Vitest instances in one process.

3. **Precedence:**

   - Valid environment + invalid machine file → environment wins; the file is never read.
   - Invalid environment + valid machine file → throws; it does not fall back.
   - Empty environment → treated as unset, then the machine file is evaluated.
   - A leaked carrier from an earlier instance incorrectly acts like the environment layer.

4. **Nested `createVitest`:** no material suite-scale handle or port risk found. Every instance closes in `finally`, and the focused suite exited normally: **20/20 passed in 654 ms**. It does leak one temporary directory per run because `scratch` is never removed.

5. **Wrong-reason/machine issues:** the effective-cap helper manually repeats Vitest’s scheduler fallback, but matches Vitest 4.1.11. The provisioning-number assertion is the clear false-positive hole. The header saying nothing reads the real machine file is also false: importing the config and `createVitest` both do; valid `3` versus absent remains portable across the two named machines.

6. **Over-built:** the code comments and docs still carry far more incident narrative than the implementation needs. The plan is the right home for that evidence.