Implemented Stage 2 without committing.

### Files changed

- [scripts/overseer.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/scripts/overseer.ts)
  - Added Commander-backed `tick` and `last <session> [--turns N]`.
  - Added corresponding `Parsed` and exhaustive `runParsed` arms.
  - Moved status rendering out while preserving compatibility exports.

- [cli-messages.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/overseer/cli-messages.ts)
  - Resolves session names through `/api/state`.
  - Encodes `$` as `%24` in one place.
  - Parses all four message-response outcomes.
  - Renders timestamped, speaker-labelled, single-line turns, truncated to 220 characters.

- [cli-tick.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/overseer/cli-tick.ts)
  - Prints claim ownership prominently.
  - Prints direct usage with cache age, 55/70/85 meanings, and current band.
  - Uses `collectHealth({ includeSwapActivity: false })`; tick needs load/memory/swap fullness, avoiding the deliberate `vmstat` wait.
  - Lists every dashboard session, fetching messages only for `mine`.
  - Names missing `mine` sessions and non-`mine` sessions explicitly.
  - Isolates failures per section and remains exit code 0.

- [status-cli.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tools/overseer/status-cli.ts)
  - Contains the single status rendering implementation used by both `status` and `tick`.
  - Avoids the Commander/daemon/tick import cycle.

- [overseer-cli-tick.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tests/overseer-cli-tick.test.ts)
  - Ten fixture/injected-dashboard tests covering encoding, usage honesty, claim visibility, missing sessions, degradation, parsing, truncation and plain-text rendering.

- [overseer-cli.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-cli/tests/overseer-cli.test.ts)
  - Repointed status imports to the extracted leaf.

The pre-existing modification to `docs/plans/260909d-stage2-codex-task.md` was left untouched.

### Verification

Green Stage 2 suite:

```text
npx vitest run tests/overseer-cli-tick.test.ts

Test Files  1 passed (1)
Tests       10 passed (10)
```

Green CLI/status/parser subset:

```text
npx vitest run tests/overseer-cli-tick.test.ts tests/overseer-cli-parse.test.ts tests/overseer-cli.test.ts

Test Files  3 passed (3)
Tests       53 passed (53)
```

Green compiler run using Node’s tsx loader:

```text
node --import tsx scripts/typecheck.ts

✓ src/web/tsconfig.json  (344 files)
✓ tests/tsconfig.json  (1783 files)
✓ tools/fleet/web/tsconfig.json  (71 files)
✓ tsconfig.json  (560 files)
✓ all 1865 source files are covered by some project
```

Scoped lint exited 0 with 40 informational findings and no warnings or errors:

```text
npx biome lint --max-diagnostics=none scripts/overseer.ts tools/overseer/cli-messages.ts tools/overseer/cli-tick.ts tools/overseer/status-cli.ts tests/overseer-cli-tick.test.ts tests/overseer-cli.test.ts
```

The two exact requested commands cannot complete inside this sandbox because the `tsx` executable is denied permission to create its Unix IPC socket:

```text
npm run typecheck
Error: listen EPERM: operation not permitted /tmp/tsx-1000/14.pipe
exit 1
```

```text
npx vitest run tests/overseer-cli-tick.test.ts tests/overseer-cli-parse.test.ts tests/overseer-cli-state.test.ts tests/overseer-cli.test.ts

Test Files  1 failed | 3 passed (4)
Tests       1 failed | 85 passed (86)
```

The sole failure is the pre-existing state concurrency test spawning two `npx tsx` children; both fail with the same `/tmp/tsx-1000/*.pipe` `EPERM`. The equivalent compiler invocation and every test not requiring child `tsx` processes pass.

### Mutation checks

Each intended assertion went red:

- Raw `$` instead of `encodeURIComponent`: encoding test failed, receiving `id=$20` instead of `id=%2420`.
- Absent usage rendered as `0%`: unknown/not-zero test failed.
- Removed cache age: stale-cache test failed on the missing `cache 48m old`.
- Replaced missing-session report with `continue`: `dead-agent` assertion failed.
- Rethrew the health-section error: degradation test failed before later sections printed.

The requested absent-cache mutation names `tools/overseer/usage.ts`, which is outside the authorized file set. I therefore applied the equivalent mutation at the tick renderer—printing `five_hour: 0% used` for the absent arm—and confirmed the same required assertion reddened.

### Plan correction deviation

I first tried importing the browser’s existing message parser. That pulls `tools/fleet/web/src/messages-client.ts` into the root NodeNext project, where its Vite-valid extensionless `./types` import fails with TS2835. Fixing that browser file or adding a shared core would require editing outside the allowed file set. As permitted by the brief’s fallback, `cli-messages.ts` locally preserves the same four-arm parsing contract instead.