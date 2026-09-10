Implemented Stage 3 without touching `refresh.ts`, `tools/overseer/`, or committing.

Changed files:

- [health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-history.ts) — stores/parses `workTurn`, protects readings from oversized summaries, and exports `WORK_EVERY_MS`.
- [health-wiring.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/health-wiring.ts) — reads work independently, owns cadence, and retries after refused appends.
- [routes-health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/routes-health-history.ts) — exposes `workEveryMs`; the browser could not previously determine it.
- [seed-health-history.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/seed-health-history.ts) — supplies explicit `not-due` to the new append contract.
- [fleet-health-history.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-health-history.test.ts)
- [fleet-health-wiring.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-health-wiring.test.ts)
- [fleet-health-history-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-health-history-route.test.ts)

Tests added cover:

- Due/not-due cadence and exact five-minute boundary.
- First turn after restart.
- Legacy lines without `workTurn`.
- Empty successful scans.
- All unavailable arms and their distinct clocks.
- Work on collector failure.
- Oversize-summary retry and durable loss reason.
- A 288-work-record pessimistic rotation budget.
- Genuinely oversized health readings.
- Refused append cadence.
- Expired work samples.
- Production composition wiring.
- Route-provided work cadence.

The oversize retry test was watched failing first: the on-disk record remained a reading but lacked the required replacement work fact. Additional mutation checks confirmed the legacy, unavailable-arm, expiry, rotation-budget, and route-cadence tests fail at their intended assertions.

Stage 2 already correctly enforced `MAX_STORED_WORK_BYTES` on encoded bytes, dropping groups and visibly bounding strings, so no Stage 2 changes were needed.

Final command:

```sh
npx vitest run tests/fleet-health-history.test.ts tests/fleet-health-wiring.test.ts tests/fleet-health-history-route.test.ts tests/fleet-work-groups.test.ts
```

Final summary:

```text
Test Files  4 passed (4)
Tests       80 passed (80)
Duration    4.84s
```

`git diff --check` also passed. Broad checks were not run, per the task constraints.