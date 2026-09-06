Verdict: request changes. The core run-mode mechanism works, but two real lifecycle/override regressions remain.

## Findings

1. **Medium — `VITEST_MAX_WORKERS` is lost after a watch-mode config restart. High confidence.**

   Initial startup is safe: the config is evaluated before `resolveConfig`, once for the root server; the three inline projects are materialized from that object with `configFile: false`, so they do not re-evaluate it independently.

   It is not evaluated exactly once per process. On Vite restart, the config runs again after the variable has been deleted. I reproduced:

   ```text
   before restart: unit=8, private=1, shared=8
   after restart:  unit=4, private=1, shared=4
   ```

   This cannot produce different caps between the two parallel lanes; both still come from one evaluation. It does silently discard the run override used with `npm run test:watch`.

   Preserve the captured value across restarts using a private process-global or renamed environment variable. Do not memoise `resolveParallelWorkers()` itself: that would make its environment-varying tests order-dependent.

2. **Medium — the standard `--maxWorkers` CLI option is now ignored by the parallel projects. High confidence.**

   With `createVitest(..., { maxWorkers: 2 })`, I observed:

   ```json
   {
     "globalMaxWorkers": 2,
     "projects": {
       "unit": 4,
       "private-postgres": 1,
       "shared-services": 4
     }
   }
   ```

   Vitest prefers `project.config.maxWorkers` over the global/CLI value at [cli-api.CnMVyzaz.js:3832](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:3832). This change therefore breaks the ordinary `vitest --maxWorkers=…` escape hatch.

   The simpler arrangement appears to be putting the parallel cap at root `test.maxWorkers`, leaving only `private-postgres` with project-level `maxWorkers: 1`. Then parallel projects fall back to the global value, including CLI overrides.

3. **Low — tests inspect the raw config object, not the lifecycle they claim to protect. High confidence.**

   `loadConfig()` at [vitest-worker-caps.test.ts:74](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/tests/vitest-worker-caps.test.ts:74) proves object construction and deletion separately, but not actual project resolution or pool scheduling. Consequently both findings above pass.

   Add a subprocess/programmatic `createVitest` test covering:

   - resolved project caps;
   - CLI override precedence;
   - optionally a watch restart.

   Also, “the machine file is looked for where provisioning writes it” only asserts a regex against the TypeScript constant; it never checks `provision.sh`.

4. **Low — documentation has already drifted. High confidence.**

   The plan still says the box uses `~/.claude/settings.json` and that the variable was observed in a fresh session at [plan:56](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md:56) and [plan:143](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md:143).

   The provision check also says an unreadable file restores “Vitest’s default” at [provision.sh:1167](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/infra/hetzner/provision.sh:1167); it actually restores the repository’s quarter-core default.

   The incident evidence is duplicated across the plan, config, testing doc, and provisioning script, contrary to the repository’s one-home policy. The 110-line config explanation should become a short rationale plus links.

## Direct answers

- **Does the cap reach forks?** Yes. Resolved runtime values were `3/1/3`. Vitest groups files at [cli-api.CnMVyzaz.js:3881](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:3881), calls `pool.setMaxWorkers` at [line 3762](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:3762), limits active tasks at [line 3493](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:3493), then forks at [line 3150](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/test-worker-caps/node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:3150). The private lane enters Vitest’s special sequential group.
- **Default:** I favour half for the generic default and `3`—possibly `2` after measurement—for Hetzner. The measured quarter default more than doubles solo runtime; half costs only 37%. The machine file already expresses the genuinely crowded-machine policy. Eight steady-state runs at three workers still means 24 forks on 16 cores.
- **Machine file:** Reasonable. I would only ignore `ENOENT`; permissions, `EISDIR`, and I/O errors should not silently weaken an intentional machine policy. Honouring `XDG_CONFIG_HOME` is conventional but not a blocker if this is deliberately a fixed provisioning rendezvous.

Focused tests passed 17/17. Runtime project resolution passed. Typechecking reached the existing two unrelated `dock-corner-controls` fixture errors.