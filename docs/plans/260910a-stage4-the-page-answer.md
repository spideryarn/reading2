Implemented Stage 4 without committing or restarting any service.

Key outcomes:

- Added the fixed-axis disk history series.
- Added source-timestamp-deduplicated work projection and aligned work-history rows.
- Added honest empty, unavailable, stale, partial-timing, and peak-attribution states.
- Threaded live `currentWork` through the real checkpoint → payload → parser → App → HealthPanel path.
- Used frozen `ranForMs`, reading age, and `LONG_RUN_MS`.
- Cross-family review found and fixed stale-scan cadence and malformed-work-record evidence bugs.

### Files changed

Product code:

- [state.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/state.ts)
- [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/wire.ts)
- [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/App.tsx)
- [HealthHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/HealthHistory.tsx)
- [HealthPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/HealthPanel.tsx)
- [WorkHistory.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/WorkHistory.tsx)
- [health-history-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/health-history-client.ts)
- [history-series.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/history-series.ts)
- [types.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/types.ts)
- [work-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/work-client.ts)
- [work-series.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tools/fleet/web/src/work-series.ts)

Tests:

- [fleet-work-series.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-work-series.test.ts) — 9 projection tests
- [fleet-work-history.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-work-history.test.tsx) — 13 rendering tests
- [fleet-web.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-web.test.tsx) — 2 end-to-end live/history wiring tests
- [fleet-history-series.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-history-series.test.ts)
- [fleet-attention.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-attention.test.ts)
- [fleet-collect.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-collect.test.ts)
- [fleet-compile-guards.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/fleet-compile-guards.test.ts)
- [overseer-observation.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/resource-history/tests/overseer-observation.test.ts)

The last four needed the new required `currentWork` argument; the existing history-series fixture needed a disk reading. `work-client.ts` and `health-history-client.ts` were necessary to parse both historical and live work without allowing malformed work metadata to erase valid health readings.

### Verification

```text
npx vitest run tests/fleet-work-series.test.ts tests/fleet-work-history.test.tsx tests/fleet-web.test.tsx

Test Files  3 passed (3)
Tests       451 passed (451)
Duration    30.30s
```

Cross-family review verification, including the history client:

```text
Test Files  4 passed (4)
Tests       473 passed (473)
```

Direct typecheck:

```text
✓ src/web/tsconfig.json
✓ tests/tsconfig.json
✓ tools/fleet/web/tsconfig.json
✓ tsconfig.json
✓ all 1914 source files are covered
```

`git diff --check` also passed.

### Red-first record

- The projection suite initially failed because `work-series.ts` did not exist.
- The component suite initially failed because `WorkHistory.tsx` did not exist.
- Test 2 later produced an assertion-level red: expected one consecutive stale copy, received zero. The fix detects unchanged scans across normal intervening `not-due` turns.
- The reviewer also saw a specific red where malformed work metadata returned `null` for the whole health sample; it now retains the health reading and reports one unreadable work record.
- Test 8 triggered an existing “every series” regression because its fixture omitted disk; the fixture was corrected.
- Tests 9 and 10 were green on their first run because their wiring had already been implemented before those tests were added. I did not obtain assertion-level red-first evidence for tests 1, 3–7, 9, or 10.

The pre-existing untracked `docs/plans/260910a-code-review-prompt.md` was not touched. No commit was made.