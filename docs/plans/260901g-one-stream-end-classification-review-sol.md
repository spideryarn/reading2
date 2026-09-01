The boundary is right, with one missing classification:

- Add `{ kind: "unknown-finish-reason"; reason: string; terminated: boolean }`. Quiz deliberately uses a deny-list and accepts future spellings ([quiz-mark.ts](/home/greg/code/spideryarn2/src/quiz-mark.ts:516)); folding an unknown into either `finished` or `unterminated` hides that policy or changes behaviour.
- Keep `wants-tools`: it reports the provider’s request; validating or acting on assembled tool calls remains caller policy.
- Keep `provider-failed`, but define it narrowly as `finish_reason: "error"`. It does not subsume `chunk.error`, HTTP refusal, or a thrown transport failure.
- `ai-call.ts` is the right home. `openRouterStream` sees every parsed chunk before yielding; `sseChunks` should retain only framing facts such as `[DONE]`. The ledger rationale is slightly overstated: its current verdict is coarser and sees only the composite signal ([ai-call.ts](/home/greg/code/spideryarn2/src/ai-call.ts:815)).
- Optional fields are the right temporary trade, provided `openRouterStream` initializes them to `null`/`false` before reading. Make them required after Stage C; policy exhaustiveness still comes from `StreamOutcome`.
- Rounds do not belong in the union. The unit is one provider request/stream; aggregating several outcomes into a turn is converse policy. Fix the plan’s contradictory phrase “per stream, not per request” to “per provider request/stream, not per feature request/turn.”

**Verdict: change the union first—add an explicit raw `unknown-finish-reason` outcome, because otherwise Stage B either changes quiz’s deliberate deny-list behaviour or conceals it inside `finished`; then build it.**