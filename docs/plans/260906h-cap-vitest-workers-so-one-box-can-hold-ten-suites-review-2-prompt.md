# Re-review: the fixes to the vitest worker cap

You reviewed this change earlier and returned "request changes" with four findings. This is the
second pass over the same change, after acting on all of them. Be adversarial about the fixes
themselves — especially whether they introduce anything new — and say plainly if any finding was not
actually addressed.

Read the current state of these files in the repo:

- `vitest.config.ts`
- `tests/vitest-worker-caps.test.ts`
- `infra/hetzner/provision.sh` (the "test worker cap" section and the `check` in the verify block)
- `docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md`
- `docs/project/testing.md` (§ A run is not the only thing on the machine)

## What changed since your review

1. **Finding 2 (CLI `--maxWorkers` swallowed).** The cap moved from the shared project block to the
   config **root** (`test.maxWorkers`). Verified by resolving the real config with `createVitest`:
   `unit` and `shared-services` now carry no project-level `maxWorkers` at all, so they fall back to
   the global; `private-postgres` keeps its own 1. With `{maxWorkers: 2}` the parallel lanes resolve
   to 2.
2. **Finding 1 (watch restart loses the override).** The consumed `VITEST_MAX_WORKERS` is now kept on
   `globalThis` under `Symbol.for("spideryarn.vitest.workerOverride")`, read back on a later
   evaluation. A process-global rather than a second environment variable, so child processes do not
   inherit it. The symbol is exported so the test can clear it and ask what a fresh process does.
3. **Finding 3 (tests inspected the object, not the lifecycle).** The tests now resolve the real
   config through `createVitest` and assert per-lane caps: the serial lane staying serial with
   `VITEST_MAX_WORKERS=6` set (end to end), `--maxWorkers=2` reaching the parallel lanes, and the two
   parallel lanes agreeing. Both new tests were mutation-checked — putting the cap back on the
   projects reddens the CLI test; dropping the carrier reddens the restart test. The
   "where provisioning writes it" test now reads `provision.sh` and checks the path and the number.
4. **Finding on the machine file.** Only `ENOENT` is silent now; any other read error throws.
5. **Default.** Taken your recommendation: half the cores, floor 2. The box keeps 3 in the machine
   file.
6. **Docs.** The stale settings.json passages are gone; the incident lives in the plan and the other
   places cite it; the config comment is cut down.

## Questions

1. Does the root placement actually hold for **every** invocation shape — `npm test`, `vitest run
   <file>`, `--project unit`, watch mode? Any path where a project-level fallback would reintroduce
   the shadowing?
2. Is the `globalThis` carrier sound? Consider: two vitest instances in one process (the tests
   themselves call `createVitest`), the symbol surviving `vi.resetModules()`, and whether the tests
   are now order-dependent in any way I have not noticed.
3. Is `resolveParallelWorkers` still correct if `VITEST_MAX_WORKERS` is set to a valid value *and*
   the machine file is invalid, or vice versa? Walk the precedence.
4. Does the new `createVitest` usage in a test risk anything at suite scale — leaked servers, ports,
   handles — given it runs inside the `unit` lane alongside 600 other files?
5. Anything in the tests that would pass for the wrong reason, or is machine-dependent (this suite
   runs on an 18-core Mac and a 16-core Linux box, only one of which has the machine file).
6. Anything still over-built or misleading.

State a verdict: ship, or request changes with specific reasons.
