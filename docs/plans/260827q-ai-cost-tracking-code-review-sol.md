Verdict: not ready to land. The routing implementation itself looks sound, including concurrent label collection and job-step aggregation, but two blockers prevent the tests from proving it.

## BLOCKER

1. The metering lifecycle can be removed while every scoped test remains green.

[tests/messages-stream.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/messages-stream.test.ts:17) never imports or calls `streamMessage`. It tests `meterStream`, configuration constants, and client construction separately.

These mutations would leave the focused 51 tests green:

- Delete both `record(...)` calls at [messages-stream.ts:241](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:241) and [messages-stream.ts:251](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:251).
- Change all stages to `call.stream.finalMessage()`.
- Remove the provider injection at [messages-stream.ts:233](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:233).

The claimed backstop does not help: `unscopedCalls()` increments only when `recordSpend()` is invoked without a collector at [ai-spend.ts:113](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-spend.ts:113). Bypassing the wrapper invokes no recorder at all, so it increments nothing. The statement at [messages-stream.ts:213](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:213) is therefore false for exactly the bypass it discusses.

Add gateway-level tests using stubbed SSE that assert:

- The actual outgoing body contains `provider`.
- One successful call produces exactly one `SpendRecord` with the wire cost.
- Error and abort each produce exactly one record.
- Calling `finalMessage()` twice cannot double-record.
- The gateway is still the only value-level Anthropic client/stream entry point.

The null-vs-zero mutation test is useful, but it proves only the helper’s representation. It does not prove that completed calls reach that helper and recorder.

2. This change fails the typecheck gate.

[tests/ai-spend.test.ts:106](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/ai-spend.test.ts:106) and line 107 fail with `Property ... does not exist on type 'never'`. TypeScript does not treat the callback assignment to `seen` as definite.

Vitest transpiles without typechecking, so all 17 collector tests pass while the repository gate fails—the exact silent-success shape this project guards against.

## SHOULD FIX

3. Add the defensive refusal check before shipping the gateway migration.

The ambiguity is real, the consequence includes extra paid calls, and testing it requires no harmful request. Put one wire-specific helper in [messages-stream.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts), roughly:

```ts
message.stop_reason === "refusal" ||
message.stop_details?.type === "refusal"
```

Then use it at all seven stage branches, such as [summarise.ts:943](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:943).

Feed a synthetic response with `stop_reason: "end_turn"` and `stop_details.type: "refusal"`. Keep the poisoned extra field and prove it reaches neither logs nor repair prompts.

The present safety test actively forbids any `stop_details` read at [stop-details.test.ts:429](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/stop-details.test.ts:429), so that rule must become “only the central discriminator may read `.type`.” Also, its behavioural stage list omits `ideas` at [stop-details.test.ts:101](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/stop-details.test.ts:101); deleting `ideas`’ refusal branch would currently pass.

4. Abort classification and recording need to be idempotent.

[Messages-stream.ts:250](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages-stream.ts:250) checks the external signal rather than how the SDK stream ended.

That misclassifies:

- `call.stream.abort()` with no external signal as `"error"`.
- A provider failure racing with a later signal abort as `"aborted"`.

The installed SDK exposes `stream.aborted`; use that, or the SDK’s abort error type.

Also memoize the wrapper’s final promise or otherwise guard recording. The SDK’s `finalMessage()` can be awaited repeatedly, and the wrapper currently appends another spend record every time.

One correction to the supplied claim: error/abort does not necessarily record null cost. It passes the existing meter at line 251. If a terminal `message_delta` arrived and the stream then failed before `message_stop`, the error row retains that cost. That is arguably the better behaviour, but it needs a test and a “known/lower-bound” interpretation.

5. Preserve `is_byok`.

The live fixture contains `is_byok: false` at [messages-stream.test.ts:60](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/messages-stream.test.ts:60), but no code records or tests it. Under BYOK, OpenRouter cost may legitimately be zero while the upstream bills elsewhere. The current result would be `costNanos: 0`, `aiUnpriced: 0`: indistinguishable from a genuinely free call.

Add `isByok: boolean | null` to `CallMeter` and `SpendRecord` before these records become a database contract.

6. The model test claims more than it checks.

The test titled “keeps the unprefixed spelling out of every request” at [models.test.ts:94](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/models.test.ts:94) only calls `modelFor(task)`. Pipeline requests use `CAPABLE_MODEL_OPENROUTER` directly—for example [toc.ts:653](/Users/greg/Dropbox/dev/experim/spideryarn2/src/toc.ts:653). Switching one stage back to `CAPABLE_MODEL` would leave that test green.

Prefer having `streamMessage(task, ...)` derive `modelFor(task)` itself. Otherwise test the captured outgoing bodies of all seven stages.

## Direct answers

- `message_delta` is correct against the captured live response, and the installed SDK emits the raw event before merging it. Reading `event.type` is safe for SDK-emitted events. What is not guaranteed is long-term OpenRouter extension placement; the fixture test cannot detect upstream drift because it keeps injecting yesterday’s shape.
- `message_start` cannot currently create a partial cost: the code reads only its id and provider. If OpenRouter moved cost there, the current meter would report null.
- Labels concurrency is sound. Every stream owns a separate closure-backed meter, while concurrent calls intentionally append into the same step-local ALS array. Independent `collectSpend` runs get independent arrays.
- `runStep` is sound for awaited work. `spend` is local to each invocation, and `onDone` runs synchronously in `collectSpend`’s `finally` before control reaches success or catch. It cannot report the previous step. An unawaited/detached model call could finish after the log line and be omitted; no current stage appears to do that.
- `TASK_WIRE: Record<Task, Wire>` retains its compile-time exhaustiveness guarantee. The rename did not weaken it. It does not guarantee that a call site actually uses the assigned wire.
- A one-member `Provider` union is acceptable as an explicit domain invariant. Deriving it from `GATEWAY` would remove duplication, but this is not a substantive problem.
- `CAPABLE_MODEL` is still a trap. Its immediate comment is good, but nearby comments are stale and contradictory: [models.ts:177](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:177), [models.ts:207](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:207), [models.ts:355](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:355), and [models.ts:457](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:457). Rename it to something like `CAPABLE_ARTIFACT_GENERATOR`; comments alone are insufficient beside two nearly identical exported constants.

## Null or missing-record inventory

| Path | Result | Existing tests catch it? |
|---|---|---|
| Delta has no cost | Recorded as unpriced/null | Yes, helper only |
| Cost is null/string/non-finite/negative | Recorded as unpriced/null | Yes, helper only |
| Abort/error before priced delta | Null cost | No wrapper test |
| OpenRouter moves/removes the field | Null cost in production | No; static fixture remains green |
| Caller uses `call.stream.finalMessage()` | No record, no dropped count | No |
| Caller never finalizes the stream | No record | No |
| Direct SDK/fetch call bypasses gateway | No record | No enforcement test |
| Wrapper finishes outside a collector | Dropped counter increments | Unit-tested, but nothing reports it in production |
| Detached call finishes after `collectSpend` returns | Missing from the emitted log total | No |
| Process dies mid-call | No record | Known limitation |
| Wrapper `finalMessage()` called twice | Duplicate records | No |
| BYOK returns zero OpenRouter cost | Looks free, not unpriced | No |

Stopping here is coherent as an OpenRouter-routing and short-lived log-observability increment. It is not yet a cost-tracking increment in the plan’s original sense: Vercel logs expire, request-path calls are not collected here, and no owner/article history exists. That is acceptable provided the lifecycle tests, refusal handling, and BYOK field are fixed before the in-memory shape hardens into the database schema.

Verification: the four focused suites passed, 51/51. The full suite reached 3,619 passing tests with eight failures from shared-tree work outside the supplied diff. The full run also reports `docs/project/ai-gateway.md` as orphaned; because that file was not in the supplied scoped diff, I did not rank it, but if it belongs to this change it is another gate failure.