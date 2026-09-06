## Verdict: REFUSE

F5 and F6 are established P1s with end-to-end reproductions.

### F5 — P1 — established: a deadline after `[DONE]` discards a complete answer

[classifyEnd](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/ai-call.ts:188) checks current signal state before `end.terminated`. After `sseChunks` consumes `[DONE]`, its asynchronous `reader.cancel()` cleanup can cross the deadline. The already-complete answer is then classified `timed-out` and thrown away.

(a) Executed:

```bash
node --import tsx /tmp/review-stream-end-ordering.ts
```

The harness sends complete prose, `finish_reason: "stop"`, and `[DONE]`, then delays the body’s cancellation cleanup beyond the deadline. Result:

```json
{
  "result": "threw",
  "message": "... [ai-slow]",
  "events": [{"type":"delta","text":"A whole answer."}]
}
```

This also exposes an incorrect existing test: “blames our deadline before anything the provider said” supplies `terminated: true`. A terminator is not merely something the provider said; it proves the complete SSE response arrived.

(b) Let an observed terminator dominate signals that may have fired later:

```ts
if (!end.terminated) {
  if (deadline.aborted) return { kind: "timed-out" };
  if (stalled.aborted) return { kind: "went-quiet" };
  if (readerAborted(signal, deadline, stalled)) return { kind: "abandoned" };
}
```

Then retain the existing finish-reason switch. Change the current precedence test to use `terminated: false`, and add a test asserting that `terminated: true` plus a subsequently fired clock remains `finished`.

### F6 — P1 — established: the additive fold reports a whole answer as “stopped mid-sentence”

The guard at [src/converse.ts](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/converse.ts:2060) proves only that an earlier truncated round wrote some prose. It does not prove that prose ended mid-sentence.

(a) Executed:

```bash
node --import tsx /tmp/review-truncation-fold.ts
```

Frames:

1. Round one writes `I’ll check that.\n\n`, emits a complete usable tool call, then ends `length`.
2. The tool runs.
3. Round two writes `The answer is complete.` and ends `stop`.

The resulting stored event is:

```json
{
  "text": "I’ll check that.\n\nThe answer is complete.",
  "truncated": true,
  "stopped": false
}
```

The panel consequently says: “This answer ran out of room and stopped mid-sentence.” Neither sentence is incomplete.

(b) The available wire signals cannot reliably determine grammatical or semantic incompleteness. The smallest sound correction is to make the public contract describe the observable fact rather than infer sentence completeness.

Exact UI replacement:

```text
A model step hit its output limit after writing part of this answer. The answer may be incomplete; try again.
```

Exact type-contract replacement:

```ts
/** At least one provider round hit its output limit after writing prose. Assistant turns only. */
```

If `truncated` must continue to mean “the stored answer definitely ends mid-sentence,” the earlier-round condition needs a separate uncertainty state; no reliable boolean-only test can preserve the new catch while rejecting this input.

### F7 — P2 — established: `openRouterStream` does not actually reset a reused `StreamEnd`

The reset at [src/ai-call.ts](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/ai-call.ts:1173) clears `finishReason` and `answered`, but not `terminated`, despite promising that a reused object cannot retain a stale verdict.

(a) Executed:

```bash
node --import tsx /tmp/review-reused-stream-end.ts
```

The first stream receives `[DONE]`; the second reuses the object and ends at EOF without a terminator. Result:

```json
{
  "end":{"terminated":true,"finishReason":null,"answered":true},
  "outcome":{"kind":"finished"}
}
```

No production caller currently reuses the object, so this is P2 rather than current user-visible failure.

(b) Complete the reset:

```ts
options.end.terminated = false;
options.end.finishReason = null;
options.end.answered = false;
```

### Other checks

- The merged `searchesFrom` bookkeeping is coherent: it updates only when usage arrives, survives rounds without usage, and classification occurs after the round’s usage is banked. I found no functional auto-merge defect.
- `turnSoFar()` reports the same usage before and after banking: pending usage is included before, accumulated totals after.
- `noteRound()` reads a fresh per-round `end`; an early throw records `null`, not a stale previous reason.
- The three referee switches preserve their individual JSON policies and reject `provider-failed` before parsing.
- `unknown-finish-reason`, including without `[DONE]`, reaches success deliberately through explicit caller cases. That is a permissive policy, but it satisfies the stated invariant and is not a finding.
- `npx vitest run tests/converse-stream-end.test.ts`: 3/3 passed.
- `git diff --check 2f94ed1b..6d813cd6`: clean.
- No repository files were changed.