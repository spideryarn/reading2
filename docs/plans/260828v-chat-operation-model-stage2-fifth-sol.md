# DO NOT SHIP as stages 2 and 3 together

Stage 2 is done. Stage 3 is not.

## Findings

1. **P2 — the naming invariant still overclaims its scan.** `mentions()` omits both `state.unnamed` and `TurnOperation.opening`. After `turn.began`, `opening.id` still contains the provisional thread ID. Removing `knownAs()` would not redden this invariant, although another stage-2 test catches the practical hold-forever failure. [chat-invariants.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-invariants.test.ts:422), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:680)

2. **P2 — purity is not “proved” as claimed.** The harness freezes the operation shell but not operation-owned nested values, tombstone values, or nested event data. `sealedEvent` is only a shallow copy and freeze. An idempotent nested mutation can therefore escape both the freeze and the twice-run comparison. [chat-reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/chat-reduce.ts:43), [chat-reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/chat-reduce.ts:88)

3. **P2 — “every kind” still excludes turns in the explicit success/failure symmetry table.** `turn.done` versus `turn.failed` is not among the pairs, including for a superseded turn. [chat-invariants.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-invariants.test.ts:574)

## Direct answers

- **The original window is closed.** My probe confirmed: no early DELETE, fabricated early success is refused, and `turn.began` releases exactly one DELETE even when `from === to`.
- **The lost-frame residue is slightly worse inside that narrow failure case.** Previously the premature request could win the race after the server write; now it certainly remains held. But the ordinary delivered-frame path is genuinely fixed, not merely moved.
- **`namesThread` should become reducer-owned using `unnamed` plus reader title ownership.** That removes the hook’s stale guess rather than adding vocabulary. The server-named-empty case is not currently reachable through the application contract, so it is not a stage-2 blocker.
- **No separate delete fence is owed:** deleting an already-absent thread is truthful idempotent success. Rename must reject a missing row, but the planned `expectedTitle` fence can cover both stale-title and missing-row cases; no second fence is needed.
- **Stage 2:** ship.
- **Stage 3:** do not ship yet.
- **Combined verdict:** do not ship.

Focused Vitest could not start because the read-only sandbox blocked Vite’s temp file. The direct typecheck found the peer glossary error plus two ignored `output/lift*` files outside every TypeScript project. Scoped lint had one complexity advisory. No files changed.