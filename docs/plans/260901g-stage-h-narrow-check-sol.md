## Verdict: REFUSE

F5 is fixed, `b043abe4` is behaviour-neutral, and F7’s original stale-success reproduction is fixed. However, F6’s established P1 remains reader-visible and unchanged.

### F6 remains open — P1 — established: the panel still states something the server does not know

The revised contract correctly says the answer “may be incomplete” ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/types.ts:2504)), but the panel still states definitively that it “stopped mid-sentence” ([ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/web/ChatPanel.tsx:1355)).

(a) I reran the original reproduction at current `HEAD`:

```bash
node --import tsx /tmp/review-truncation-fold.ts
```

Both stored sentences are complete, while the resulting event still has `truncated: true`; the panel therefore renders the false mid-sentence claim.

(b) The server-only boundary is defensible as ownership, but it does not resolve F6. Put the copy change to the product owner. The previous truthful replacement remains suitable:

> A model step hit its output limit after writing part of this answer. The answer may be incomplete; try again.

No change to the fold is needed.

### F8 — P2 — established: the reset still happens too late for pre-body failures

The reset at [ai-call.ts](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/ai-call.ts:1207) is after `await send(...)` and response validation. A reused `StreamEnd` remains stale when a retry aborts, rejects, returns non-OK, or has no body before reaching that block.

(a) I executed an aborted second call with:

```json
{
  "end": {"terminated":true,"finishReason":"stop","answered":true},
  "outcome":{"kind":"finished"}
}
```

No production caller currently reuses the object, so this remains P2 and is not independently a refusal.

(b) Move all three reset assignments immediately before `await send(...)`, so every attempted stream begins with a clean out-parameter.

## Checks passed

- F5: `terminated = true` has one production writer, the literal `[DONE]` branch in [openrouter-stream.ts](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/openrouter-stream.ts:251). Production constructors use `false`; no production caller aliases or reuses the object. Gating the signals is correct.
- `quiz-mark`, `explain`, and `search`: the changed precedence accepts only an already-complete stream; the stream’s finish reason still determines truncation/filter/provider failure.
- `b043abe4`: no disagreeing completed-turn input found. `record.prose` captures the same `roundText.trim()` predicate in `finally`, `record.ended` captures the same classified outcome before its switch, and the final record’s `finishReason` is the old final `end.finishReason`. Throwing rounds never reach the turn summary.

Executed:

```text
3 focused files: 61 passed
quiz-mark/explain/search files: 60 passed
```

No files changed.