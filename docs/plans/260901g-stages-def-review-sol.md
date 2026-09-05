# Stages D–F, reviewed before they were built

GPT Sol (gpt-5.6-sol, high effort), 2026-09-04, on
[260901g](260901g-one-stream-end-classification-shared-by-five-callers.md) § Stages D, E and F —
the four callers Stage C left on their own copies.

**Three of the four findings changed the plan before a line was written**, which is the argument for
reviewing a plan rather than a diff: the `stopped` derivation and the `truncated` fold were both
wrong in the draft, and both would have looked correct in a green test run.

- **Finding 1 (accepted).** `stopped` cannot be derived only from the round's outcome: a reader can
  stop *after* a round classified `wants-tools`, while its tools are running. The two assignments
  inside the tool batch stay.
- **Finding 2 (accepted, and it changed the design).** The sticky `truncated` fold is reachable —
  `wanted` needs only an id and a name, and `parseToolArgs` turns truncated arguments into `{}`
  rather than failing — but "any round that ended `length`" over-fires on a round that wrote no
  prose, and the panel's sentence is a **failure** with a retry offered. The fold became strictly
  additive and prose-guarded.
- **Finding 3 (accepted).** An in-band `chunk.error` is data, never reaches `StreamEnd`, and so
  `classifyEnd` alone would not have given `evals/referee-claims.ts` the invariant Stage D claimed
  for it. The eval throws on `chunk.error` in its loop as well.
- **Finding 4 (noted, and done anyway).** Touching the eval is an addition rather than an unforking.
  True. Six lines, and the hole is the class this plan exists for.

**What it checked and found sound:** the guard-order equivalence (`readerAborted` returns false once
either clock has fired, so converse's reader-then-clocks order and the classifier's
clocks-then-reader order agree on every input); throwing on `provider-failed` in all four, including
that `stoppedByReader` tests the error's identity so a provider error coinciding with a reader abort
is not swallowed; that `src/routes.ts` stores converse's partial text with `status: "error"`; and
that all five red-first tests really do go red today.

It could not run a test file — vitest could not create `node_modules/.vite-temp` in its sandbox — so
every finding above is reasoned rather than reproduced. The orchestrator ran them instead.

---

## Findings

1. **High — `stopped` cannot be derived only from the round’s `StreamOutcome`.** A reader can stop after a round has classified as `wants-tools`, while its tool batch is running. The current checks at [src/converse.ts:1969](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/converse.ts:1969) and [src/converse.ts:2047](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/converse.ts:2047) then set `stopped`; the already-computed round outcome cannot. The exact input is: a clean `tool_calls` round, then the reader aborts after the first tool completes. [tests/converse-stop.test.ts:302](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/tests/converse-stop.test.ts:302) already pins it. Derivation can replace the catch and post-stream assignments, but the two tool-phase assignments must remain. If that is Stage E’s intent, its current “becomes one reading of the round’s outcome” wording overclaims it.

2. **High — the sticky `truncated` fold is reachable, but “any truncated round” is not the right public policy as written.** Reachability is real: `wanted` requires only an id and name ([src/converse.ts:1849](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/converse.ts:1849)); malformed/truncated arguments become `{}` rather than failing ([src/chat-tools.ts:444](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/chat-tools.ts:444)); the tool therefore runs and another round follows. But consider:

   - Round 1 emits no prose, emits a named tool call with truncated arguments, and ends `length`.
   - Round 2 emits a complete prose answer and ends `stop`.

   A sticky fold yields `truncated: true`, while the stored answer itself did not stop mid-sentence. That contradicts the field contract at [src/types.ts:2427](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/types.ts:2427) and the rendered message at [src/web/ChatPanel.tsx:1355](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/web/ChatPanel.tsx:1355). There is a second required dominance rule: if a later reader stop occurs, current behavior guarantees `truncated: false` through `!stopped` ([src/converse.ts:2079](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/converse.ts:2079)); an unconditional sticky fold could produce both the failure warning and “You stopped this answer.”

3. **Medium — `StreamOutcome` still cannot express an in-band `chunk.error`.** Each production caller turns that frame into a throw inside its loop, before `classifyEnd` ([src/converse.ts:1656](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/converse.ts:1656), [src/referee-mirror.ts:1541](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/referee-mirror.ts:1541), [src/referee-claims-run.ts:445](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/referee-claims-run.ts:445), [src/referee-criteria-run.ts:582](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/referee-criteria-run.ts:582)). `openRouterStream` records only `finish_reason` in `StreamEnd` ([src/ai-call.ts:1152](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/ai-call.ts:1152)). Thus the union is exhaustive only for streams that return normally, not for all provider-reported endings.

   This breaks Stage D’s new eval claim specifically. `ablated()` currently ignores `chunk.error` ([evals/referee-claims.ts:912](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/evals/referee-claims.ts:912)). A parseable claims payload, followed by a truthy `chunk.error`, followed by `[DONE]`, would classify `finished` and still pass the proposed “anything but a clean end” check.

4. **Low — changing `evals/referee-claims.ts` is scope expansion, not mechanical unforking.** Its own contract explicitly says it has “no clocks, no invariants” ([evals/referee-claims.ts:895](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/evals/referee-claims.ts:895)), and it contains none of the judgement being removed. Making truncation and every non-`finished` outcome fatal may be worthwhile for eval integrity, but it is a separate behavior change—and, because of finding 3, the proposed change does not actually establish the stronger invariant.

## Checks that hold

- **Guard precedence is equivalent.** `readerAborted` returns false when either clock has fired ([src/openrouter-stream.ts:62](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/openrouter-stream.ts:62)); both old and new paths also give deadline precedence over stall ([src/openrouter-stream.ts:100](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/openrouter-stream.ts:100), [src/ai-call.ts:208](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/ai-call.ts:208)).

- **Throwing on `provider-failed` is right** for converse and the referees. `stoppedByReader` checks the thrown error’s identity/type, so an ordinary provider error coinciding with an aborted reader is not swallowed ([src/openrouter-stream.ts:70](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/openrouter-stream.ts:70)). A `finish_reason: "error"` can still intentionally lose to a simultaneous reader abort because that is classifier precedence, not accidental catching.

- **The route preserves converse’s partial answer.** Deltas accumulate at [src/routes.ts:2578](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/routes.ts:2578); a throw stores that text with `status: "error"` at [src/routes.ts:2629](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/routes.ts:2629) and sends an error frame at [src/routes.ts:2654](/home/greg/code/spideryarn2/.claude/worktrees/stream-end-classification/src/routes.ts:2654).

- **All four provider-error red-first tests should go red today.** `[DONE]` makes `end.terminated` true, while `"error"` makes `finishReason` non-null, so every old conjunction accepts it. The two-round truncation test also goes red today, but only if round one includes a surviving tool call; otherwise no second round is reachable.

I attempted `tests/converse-stop.test.ts`, but Vitest could not start because `node_modules/.vite-temp` is absent and the filesystem refused to create it. No test assertions ran.