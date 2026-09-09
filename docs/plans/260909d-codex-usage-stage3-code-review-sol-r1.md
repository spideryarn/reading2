Verdict: **land with changes**. No P0s; one P1 should be fixed first.

## Findings

### 1. P1 — The persisted validator accepts a percentage whose stated seven-day window resets in year 5138

[`codexWindowValidationError`](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/usage-history-record.ts:323) checks only that the reset follows `readAt`. It does not check that it falls within `windowMinutes`, despite having both values.

**(a) Construct:** I encoded and decoded:

```ts
{
  readAt: "2026-09-09T00:00:00.000Z",
  windowMinutes: 10_080,
  usedPercent: 24,
  resetsAt: "5138-11-16T09:46:40.000Z",
  resetsAtMs: 100_000_000_000_000,
}
```

Both operations retain it as `kind: "value"`. A future reader can therefore receive an apparently valid 24% observation lasting millennia.

Stage 2 currently rejects this exact normal-duration input, but stage 3 explicitly introduced independent persisted validation so one producer regression or differently written schema-1 line cannot resurrect it. This is the persistence analogue of stage 2’s timestamp P1.

**(b) Smallest change:**

```ts
const windowMinutes = window.windowMinutes as number;
const resetsAtMs = window.resetsAtMs as number;
const latestPossible = readAtMs + windowMinutes * 60_000;

if (
  !Number.isSafeInteger(windowMinutes) ||
  windowMinutes <= 0 ||
  !Number.isSafeInteger(resetsAtMs) ||
  !Number.isSafeInteger(latestPossible) ||
  Math.abs(resetsAtMs) > MAX_EPOCH_MS ||
  Date.parse(window.resetsAt) !== resetsAtMs ||
  resetsAtMs <= readAtMs ||
  resetsAtMs > latestPossible
) {
  return `${location} had an invalid resetsAtMs`;
}
```

This rechecks the original observation using its stored instant; it does not re-adjudicate against the viewer’s clock.

### 2. P2 — This build’s encoder can write a line indistinguishable from a legacy line

[`codexForEncoding`](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/usage-history-record.ts:464) adds an explicit unknown only to omission markers. A current, ordinary line lacking `codex` is serialized without the key.

**(a) Construct:** I passed a valid `collector-failed` line without `codex` to `encodeUsageHistoryLine`. The resulting JSON had no `codex` property. Afterward, no reader can distinguish “writer predates Codex” from “current writer silently failed to supply Codex.”

The production mapper supplies it today, so this is not an active daemon failure. It does contradict the claimed persisted invariant, and the “six absences” test currently blesses the problem by using the current encoder to manufacture its legacy case.

**(b) Smallest change:**

```ts
function codexForEncoding(line: UsageHistoryLine): CodexObservation {
  if (line.codex !== undefined) return line.codex;
  return {
    kind: "unknown",
    why:
      line.pass.kind === "omitted"
        ? "the Codex observation was not retained because this usage-history record was omitted"
        : "the current writer supplied no Codex observation for this usage pass",
    retryable: false,
  };
}
```

Then test legacy input as old bytes, without passing it through today’s writer:

```ts
const legacy = pass();
delete legacy.codex;
const decoded = decodeUsageHistoryLine(JSON.stringify(legacy));
```

### 3. P2 — A synchronous collector throw bypasses `Promise.allSettled` and the single-flight wait

[`usageHistoryDaemonOptions`](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/scripts/overseer.ts:111) invokes both collectors while constructing the array passed to `Promise.allSettled`.

**(a) Construct:** let Claude return an unresolved promise and let Codex throw synchronously:

```ts
claude: () => unresolvedClaude,
codex: () => {
  throw new Error("synchronous failure");
},
```

I confirmed that `usage.run()` rejects immediately, with Claude still running untracked. The daemon may begin another pass and shutdown will not await the orphaned Claude collection.

Both production collectors are currently `async`, so their throws become rejected promises; this affects injected or future wrappers rather than today’s default path.

**(b) Smallest change:**

```ts
const settle = <T>(run: () => Promise<T>): Promise<T> =>
  Promise.resolve().then(run);

const [claude, codex] = await Promise.allSettled([
  settle(collectors.claude),
  settle(collectors.codex),
]);
```

Add a test where the second collector throws synchronously and assert the first remains awaited.

### 4. P2 — The “target bucket absent” test describes a state production cannot persist

[`readBuckets`](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:434) converts an otherwise valid model-bucket reading with no general `codex` bucket into top-level `unknown`. The record test manually constructs a value containing only `codex_spark`, but the real producer cannot emit it.

**(a) Construct:** supply a valid canonical map containing only `codex_bengalfox`. The resulting disk record is an `unknown` carrying prose, not the tested value with preserved model buckets.

Your acceptance is safe for rationing: it cannot create false headroom. But it loses irrecoverable diagnostic data and means the test’s “six distinct absences” claim is stronger than production.

**(b) Smallest fix, if preserving all six as specified:**

```ts
// Remove the early return when rawMap.codex is absent.
const buckets = /* parse every canonical bucket as today */;
const canonical = buckets.find((bucket) => bucket.limitId === "codex");

if (
  canonical !== undefined &&
  result.rateLimits !== null &&
  result.rateLimits !== undefined
) {
  // Existing duplicate comparison.
}

return { kind: "value", value: buckets };
```

Stage 4 must then derive general headroom only from `buckets.find(b => b.limitId === "codex")`. This can be deferred without making the current decision unsafe, but the current test/report should stop claiming production preserves that state.

### 5. P2 — The composition-root assertion can pass from a comment

[`fleet-usage-history-wiring.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/fleet-usage-history-wiring.test.ts:209) checks a raw substring.

**(a) Construct:** revert the actual `runOverseer` usage wiring and add this comment anywhere:

```ts
// usage: usageHistoryDaemonOptions(usageRetention)
```

The assertion passes. The behavioral half still exercises `usageHistoryDaemonOptions` directly, not the production `runParsed` connection.

**(b) Smallest stronger form:** parse `scripts/overseer.ts` with the already-installed TypeScript compiler and assert that a real `usageHistoryDaemonOptions(...)` call is a descendant of the `runOverseer({...})` argument:

```ts
const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

let wired = false;
function visit(node: ts.Node): void {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "runOverseer"
  ) {
    const inspect = (child: ts.Node): void => {
      if (
        ts.isCallExpression(child) &&
        child.expression.getText(source) === "usageHistoryDaemonOptions"
      ) wired = true;
      ts.forEachChild(child, inspect);
    };
    node.arguments.forEach(inspect);
  }
  ts.forEachChild(node, visit);
}
visit(source);
expect(wired).toBe(true);
```

## What checked out

- The stash is cleared before opening/appending. `keep-stored`, Claude rejection, the first pass, and a throwing `onPass` cannot reuse an earlier observation.
- Shutdown awaits the complete usage chain before `usageRetention.close()`.
- Normal timer passes cannot overlap.
- `spendControlReached` and `individualLimit` survive the field-by-field mapping and JSON round trip.
- The other nullable/absent states survive JSON mechanically. However, absence 3 is not producer-reachable as represented, and absence 6’s cause is not distinguishable without a future source discriminator.
- Not bumping either schema is correct. An old decoder accepts a new line because it casts the remaining object; a new decoder accepts an old line as legacy. An old browser drops `codex` at its existing whitelist, but Claude remains readable.
- The expanded record and mapping tests use exact equality in the important field-preservation paths; those assertions are real.
- I ran `npx vitest run tests/fleet-usage-history-wiring.test.ts`: **7/7 passed**.
- I did not use the network or a live account. I could not test a hard process kill; that loses in-memory state entirely, so it cannot carry a stale stash into the restarted process.

I would not simplify away the separate persisted type or field-by-field mapper: that explicit seam is what prevents another silent field drop. Most of the added size is validation and tests, not runtime orchestration.