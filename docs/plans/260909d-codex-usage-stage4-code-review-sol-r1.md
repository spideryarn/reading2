Verdict: **land with changes**. No P0s; four P1 paths can produce a misleading decision screen.

## Findings

### 1. P1 — An expired reading still says “Rate limit reached” now

[UsagePanel.tsx:1215](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsagePanel.tsx:1215) renders `rateLimitReachedType` in the present tense independently of the reset check at [UsagePanel.tsx:1120](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsagePanel.tsx:1120).

**(a) Construct:** a reading taken an hour ago with `rateLimitReachedType: "weekly"` and a reset one minute ago renders:

```text
Rate limit reached — weekly
7 days Unknown this window already reset 1m ago
```

I reproduced that exact contradictory screen. This needs no malformed data; ordinary stale history reaches it.

**(b) Smallest fix:** time-qualify snapshot-only backend states. Apply the same treatment to spend-control state.

```tsx
{reached !== null ? (
  <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
    When this reading was taken, the backend reported a reached limit —{" "}
    {reached.length === 0 ? "type not named" : reached}
  </p>
) : null}

{bucket.spendControlReached === true ? (
  <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">
    When this reading was taken, the backend reported that spend control was reached.
  </p>
) : null}
```

### 2. P1 — A structurally unreadable newest sample can still supply a trusted percentage

[codexAttempt](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/usage-history-client.ts:258) parses Codex directly from the raw record instead of using [parseSample](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/usage-history-client.ts:367).

**(a) Construct:** give the newest sample a valid Codex `0%` observation but `pass: null`. `parseSample` rejects it—the parsed history contains zero samples—yet `latestCodex` is the valid `0%` value. I reproduced:

```json
{
  "parsedSamples": 0,
  "selected": {
    "kind": "value",
    "usedPercent": 0
  }
}
```

Thus “a newer unreadable sample supersedes the older value” is honoured only when the whole sample is obviously malformed; a partially malformed sample bypasses it.

This also answers the test question: deleting Codex from `parseSample`’s whitelist does **not** fail the named route→parser→DOM test, because `codexAttempt` independently rereads the raw record. A separate parser assertion fails, but the praised end-to-end test itself does not catch that mutation.

**(b) Smallest fix:** select from the validated sample.

```ts
function codexAttempt(raw: unknown): CodexObservationView {
  const sample = parseSample(raw);

  if (sample === null) {
    return {
      kind: "unknown",
      why: "the newest history sample was unreadable",
      retryable: false,
    };
  }
  if (sample.kind === "unsupported") {
    return {
      kind: "unknown",
      why: "the newest history sample was written by an unsupported build",
      retryable: false,
    };
  }
  if (sample.kind === "omitted") {
    return {
      kind: "unknown",
      why: `the newest history sample was omitted: ${sample.why}`,
      retryable: false,
    };
  }
  return sample.line.codex ?? {
    kind: "absent",
    why: "this history record predates Codex usage collection",
  };
}
```

This removes the duplicate parsing path and makes the DOM test genuinely depend on the whitelist.

### 3. P1 — Persisted spend-limit states can produce calm “General headroom”

The persisted schema deliberately accepts `spendControlReached: null` and non-null `individualLimit`. The browser parser preserves them, but [CodexBucketSection](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsagePanel.tsx:1204) ignores `individualLimit` entirely and treats null spend-control exactly like `false`.

**(a) Construct:** a schema-valid line with:

```ts
{
  spendControlReached: false,
  individualLimit: {
    limit: "10",
    used: "10",
    remainingPercent: 0,
    resetsAt: 1789473600,
  },
  windows: [{ usedPercent: 0, /* valid weekly window */ }],
}
```

is accepted by `encodeUsageHistoryLine`, decoded, parsed and displayed as:

```text
General headroom
7 days
0% used
```

The exhausted individual limit is absent from the screen. `spendControlReached: null` has the same calm rendering.

The current stage-2 producer fails closed on these general-bucket states, but stage 3 intentionally made the persisted validator an independent boundary. A schema-valid older/newer line or producer regression therefore resurrects the exact discarded-state bug from the first review.

**(b) Smallest fix:** apply stage 2’s fail-closed rule at the persisted rendering boundary.

```tsx
const controlWhy =
  general && bucket.spendControlReached !== false
    ? "General headroom is unavailable because spend-control state was reached or unavailable."
    : general && bucket.individualLimit !== null
      ? "General headroom is unavailable because an individual spend limit was reported."
      : null;

{controlWhy === null ? (
  <div className="tw:mt-1 tw:grid tw:grid-cols-2 tw:gap-2">
    {bucketWindowCards(bucket, asOf, skew)}
  </div>
) : (
  <StatCard
    label="General headroom"
    value={{ kind: "absent", state: "unavailable", why: controlWhy }}
    tone="unknown"
  />
)}
```

Add both inputs to the card suite. The CLI is safe today because the live producer rejects them first, but mirroring the guard in `codexBucketLines` would keep its renderer independently safe too.

### 4. P1 — Overlapping polls can let an older value overwrite a newer failure

[useUsageHistoryView](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsageHistory.tsx:55) starts interval requests without sequencing or single-flight protection.

**(a) Construct:** hold poll 1 open; start poll 2; resolve poll 2 with `latestCodex: unknown`; then resolve poll 1 with an older value. My controlled hook probe produced:

```json
{"afterNew":"unknown","afterOld":"value"}
```

A slow earlier fetch can therefore replace the newer failure with a reassuring value. Both mounts agree—but agree on the wrong response.

**(b) Smallest fix:** discard results from superseded requests.

```ts
let live = true;
let newestRequest = 0;

const load = (): void => {
  const request = ++newestRequest;
  void api.window(WINDOW_HOURS).then((next) => {
    if (!live || request !== newestRequest) return;
    setView(next);
    if (next.kind === "history" && next.refreshMs > 0) {
      setRefreshMs(next.refreshMs);
    }
  });
};
```

Add a deferred-promise hook test resolving request 2 before request 1.

### 5. P2 — An impossible future reading still supplies numeric headroom

[CodexUsageCard](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/UsagePanel.tsx:1261) correctly classifies a future `readAt` as unreadable, but continues rendering all its numbers.

**(a) Construct:** `readAt` one hour in the future with a valid reset six days later renders:

```text
Reading taken at a time this page cannot read
General headroom
0% used
```

The warning prevents this being wholly calm, hence P2, but an impossible observation should not provide decision numbers.

**(b) Smallest fix:** withhold the observation’s numerical facts when its own time cannot be read.

```tsx
const reading = ago(codex.readAt, asOf, skew);

if (reading.ms === null) {
  return (
    <Card className="tw:mb-3 tw:p-4">
      <h2 className="tw:text-lead tw:font-semibold">Codex subscription</h2>
      <StatCard
        label="General headroom"
        value={{
          kind: "absent",
          state: "unavailable",
          why: "the reading instant is in the future or cannot be compared with this page’s clock",
        }}
        tone="unknown"
      />
    </Card>
  );
}
```

### 6. P2 — The CLI tests do not prove the real command dispatches through the tested implementation

[overseer-cli-codex-usage.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tests/overseer-cli-codex-usage.test.ts:59) tests exported helpers directly. It never exercises the production `case "usage"` at [overseer.ts:971](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/scripts/overseer.ts:971).

**(a) Mutation:** replace the case body with the old Claude-only implementation. All three new CLI tests remain green. The current wiring is correct, and your live command run establishes that once, but the regression guard does not.

**(b) Smallest fix:** add an AST composition assertion using the Babel machinery already used by `fleet-usage-history-wiring.test.ts`.

```ts
test("the production usage case dispatches through runUsageCommand", () => {
  const source = babelParse(
    readFileSync(new URL("../scripts/overseer.ts", import.meta.url), "utf8"),
    { sourceType: "module", plugins: ["typescript"] },
  );
  const usageCase = findSwitchCase(source, "usage");
  expect(containsNamedCall(usageCase, "runUsageCommand")).toBe(true);
});
```

## Test assessment

I ran `tests/fleet-codex-usage-card.test.tsx`: **16/16 passed**.

The tests are strong around duration-based labels, model/general separation, null reset credits, over-100 preservation, expiry, duplicate buckets/slots, and valid Codex surviving a failed Claude pass. The missing combinations are exactly where findings 1, 3 and 4 live.

The route→parser→DOM test catches removal of Codex from the route payload or latest selector. It does not itself catch the old `parseSample` whitelist regression because the raw-record selector bypasses that parser.

## Your five suspicions

1. **Absence as a number:** checked. Legacy absence, malformed Codex, missing general bucket, empty windows, unknown windows and null reset credits do not become zero. Finding 3 is the related unsafe path: decision-significant nullable fields are ignored while a real `0%` remains visible.
2. **Newest selection:** file-order selection works for the explicit unknown, absent, omitted, unsupported and trailing-hole cases. Findings 2 and 4 break it through a partially unreadable sample and cross-request response inversion.
3. **Two mounts:** both consume one App-owned view. Before the first fetch there is no Codex card; errors and retained in-flight values are shared, so I found no disagreement between mounts. The polling race can make both consistently stale.
4. **Absent versus malformed:** preserved through the card as distinct state words, tones and reasons.
5. **CLI:** text and JSON both include Codex; a rejected Codex collector preserves Claude and its scan control. I could not rerun the live network-backed command in this sandbox. The untested production dispatch seam is finding 6.

No files were changed.