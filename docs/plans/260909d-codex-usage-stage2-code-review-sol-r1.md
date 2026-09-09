Verdict: **land with changes**. No P0s, but findings 1 and 2 are P1 paths where a misleadingly usable reading can reach rationing.

## Findings

### 1. P1 — Backend limit states are silently discarded

[parseCodexUsageBucket](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:215) preserves `rateLimitReachedType` but discards both `spendControlReached` and `individualLimit`. It also turns a missing `rateLimitReachedType` into explicit `null`.

The generated 0.153.4 schema identifies `spendControlReached` as backend-reported spend-control state and defines `individualLimit.remainingPercent`.

**(a) Construct:** start from the real fixture and set the duplicate `codex` snapshots to:

```ts
bucket.spendControlReached = true;
bucket.individualLimit = {
  limit: "10",
  used: "10",
  remainingPercent: 0,
  resetsAt: 1789435399,
};
```

The parser returns a value containing only the apparently healthy `24%` weekly window. Deleting `rateLimitReachedType` from both snapshots likewise returns `rateLimitReachedType: null`.

**(b) Smallest safe v1 fix:** fail the decision bucket closed until those states are modelled:

```ts
if (expectedLimitId === "codex") {
  if (!Object.hasOwn(bucket, "rateLimitReachedType")) {
    return { kind: "unknown", why: "codex bucket omitted rateLimitReachedType" };
  }
  if (bucket.spendControlReached !== false) {
    return { kind: "unknown", why: "codex spend-control state was reached or unavailable" };
  }
  if (bucket.individualLimit !== null) {
    return { kind: "unknown", why: "codex reported an individual spend limit not handled by this reader" };
  }
}
```

Also parse the bare fallback with expected id `"codex"`. The better follow-up is to add both facts to `CodexUsageBucket`.

### 2. P1 — The timestamp heuristic accepts implausible resets for millennia

[resetInstantMs](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:80) distinguishes seconds from milliseconds only at `1e12`, then validates only that the result is in the future.

**(a) Construct:** put `resetsAt: 100_000_000_000` in both general snapshots. This is a schema-valid int64. The parser publishes:

```text
24%, resetsAt 5138-11-16T09:46:40.000Z
```

That percentage can consequently look current indefinitely.

**(b) Smallest change:** use the stated window duration to identify and bound the unit:

```ts
function resetInstantMs(
  value: unknown,
  sourceAtMs: number,
  windowMinutes: number,
): number | null {
  const n = finiteNumber(value);
  if (n === null || !Number.isSafeInteger(n) || n <= 0) return null;

  const latestPossible = sourceAtMs + windowMinutes * 60_000;
  const valid = [...new Set([n, n * 1000])].filter(
    (ms) => Number.isSafeInteger(ms) && ms > sourceAtMs && ms <= latestPossible,
  );
  return valid.length === 1 ? valid[0]! : null;
}
```

This accepts either present-day seconds or milliseconds without accepting an arbitrary far-future instant.

### 3. P2 — Freshness is stamped when spawning, not when the reply arrives

[collectCodexUsage](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:459) captures `Date.now()` before a measured roughly two-second call.

**(a) Condition:** collection starts at `09:00:00`, the window resets at `09:00:01`, and the reply arrives at `09:00:02`. The old window passes validation and is returned with `readAt: 09:00:00`, although it was already expired when published.

This is narrow and usually conservative, hence P2 rather than P1.

**(b) Smallest change:**

```ts
const pinnedNowMs = options.nowMs;

// On response id 2:
const replyAtMs = pinnedNowMs ?? Date.now();
finish(
  enforceExpectedAccount(
    parseCodexAppServerReply(response, replyAtMs),
    options.expectedAccountId,
  ),
);
```

### 4. P2 — Raw deep equality turns semantic agreement into disagreement

[readBuckets](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:379) compares the complete raw objects.

**(a) Construct:** delete `limitName` from the bare snapshot while retaining `limitName: null` in the canonical snapshot. The parsed meanings are identical, but the whole reading becomes unknown.

**(b) Smallest change:** compare the validated representations:

```ts
const parsedBare = parseCodexUsageBucket(bare, nowMs, "codex");
const canonical = buckets.find((bucket) => bucket.limitId === "codex");

if (
  parsedBare.kind === "unknown" ||
  canonical === undefined ||
  !isDeepStrictEqual(parsedBare.value, canonical)
) {
  return { kind: "unknown", why: "the general codex snapshots disagreed" };
}
```

### 5. P2 — Schema-valid percentages above 100 lose the useful number

The current CLI schema declares `usedPercent` as an int32 without a maximum. [buildWindow](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:136) imposes an undocumented maximum.

**(a) Construct:** set both general snapshots to `usedPercent: 101` and `rateLimitReachedType: "rate_limit_reached"`. The reached signal survives, but the target window becomes unknown and loses the percentage.

This does not create a reassuring number, so it is not P1.

**(b) Smallest change:**

```ts
if (usedPercent === null || usedPercent < 0) {
  return unknownWindow(/* existing arguments */);
}
```

Accept the source number; clamp only the eventual progress-bar width, not the data.

### 6. P2 — Splitting a UTF-8 character across stdout chunks corrupts the protocol stream

[The stdout handler](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:557) calls `chunk.toString()` independently.

**(a) Construct:** put `limitName: "é"` in both snapshots, serialize the reply, and split the two bytes of `é` across chunks. The bytes become replacement characters. In my probe, only one duplicate snapshot was affected, so a semantically equal response became “disagreed”.

**(b) Smallest change:**

```ts
import { StringDecoder } from "node:string_decoder";

const decoder = new StringDecoder("utf8");

child.onStdout((chunk) => {
  buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
  const decoded = jsonMessages(buffer);
  buffer = decoded.rest;
  for (const response of decoded.messages) handleResponse(response);
});
```

### 7. P2 — An id-2 reply is accepted before the rate-limit request is sent

[handleResponse](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/codex-usage.ts:540) matches id 2 but does not check the protocol phase.

**(a) Construct:** have the fake emit a valid fixture reply with id 2 immediately after receiving request id 1, before returning the initialization response. The collector accepts it as a live reading and kills the child.

An honest JSON-RPC server should never do this, so P2.

**(b) Smallest change:**

```ts
let rateLimitsRequested = false;

// After sending `initialized`:
rateLimitsRequested = true;
if (!send({
  jsonrpc: "2.0",
  id: 2,
  method: "account/rateLimits/read",
  params: {},
})) return;

// When receiving:
if (response.id === 2 && rateLimitsRequested) {
  finish(/* existing parse */);
}
```

## Checks and test quality

The focused suite still passes 17/17. The positional mapping, exact child environment, message order, unrelated notification/id, timeout, and negative process-group PID tests can fail for their named reasons.

Important missing cases correspond to the findings above: spend controls, missing reached state, implausible timestamps, semantic duplicate drift, over-100 values, split UTF-8, and an id-2 reply before the request.

Other protocol outcomes fail safely:

- Partial lines are retained until the next chunk.
- A final unterminated line followed by exit becomes unknown.
- Early exit becomes retryable unknown.
- A reply that never arrives times out.
- Of two id-2 replies, the first settles the collector; the second is ignored.

## The four suspicions

1. **Over 100:** checked. It loses the percentage but preserves a separate reached signal; P2, not a falsely healthy result.
2. **Deep equality:** checked and reproduced; P2.
3. **Timestamp heuristic:** checked and reproduced with a year-5138 reset; P1.
4. **Process-group kill:** the production path is correct on this Linux host: successful `spawn({detached:true})` makes the child the new process-group leader, and `kill(-pid)` targets that group. The fake test proves the negative PID is requested, not OS behaviour. I could not observe an actual Codex helper descendant without running a live collection, but found no path that can target an existing parent group.

Finally, the credential boundary is implemented correctly: `sanitisedEnv(parentEnv)` removes `CODEX_API_KEY`; the resulting environment is passed directly to `spawn` with no shell; nothing in this spawn path re-adds the key. The test genuinely exercises the same environment-building path used by production.