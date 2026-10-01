## P0

None.

## P1

Fixed:

- [src/simple-summary.ts:729](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:729): Fuller refusal or truncation without `message_start` released Brief and Simple into an already-lost press. Those outcomes now hold the gate until sibling abort; a valid response without `message_start` still releases it.
- [src/simple-summary.ts:781](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:781): an already-aborted job could open Fuller. Calls now check the combined signal first, and stagger waiters race the abort.

## P2

Fixed:

- [src/messages-stream.ts:581](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/messages-stream.ts:581): SDK `streamEvent` listeners run inline, so a throwing `onStart` listener turned a successful stream into failure. It is now isolated, content-free logged, and fires once on the typed raw `message_start`.
- [src/simple-summary.ts:643](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:643): `cacheArticle` could override the model’s physical cache floor. Marking and staggering now use the selected model’s floor: 512–1,023 tokens stagger on Opus but remain parallel and unmarked on Sonnet.
- [evals/simple/fanout-spike.ts:145](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/evals/simple/fanout-spike.ts:145): the spike could hang when the first call ended without its trigger, or open siblings after first-call failure. Its gate now records started/ended/failed.
- [evals/simple/fanout-spike.ts:251](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/evals/simple/fanout-spike.ts:251): guard calls were paid outside a spend collector despite the script claiming all calls were recorded. Future checks use a separate eval collector while remaining outside writer cost/latency.
- [tests/simple-summary.test.ts:863](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/tests/simple-summary.test.ts:863): expanded coverage for no-start success, refusal, truncation, cancellation, both retry types, cache markers, and model-specific floors.
- [tests/messages-stream.test.ts:201](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/tests/messages-stream.test.ts:201): pins ordering, exactly-once behavior, and exception isolation.

Still open, intentionally wider:

- [docs/plans/261001j-simple-press-cost-and-latency.md:82](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/docs/plans/261001j-simple-press-cost-and-latency.md:82): an already-warm multi-step job still staggers. `cacheArticle` says another compatible step exists, not that a live cache entry definitely exists; skipping safely needs a new trustworthy warmth signal.

All plan-review P1/P2 items are either implemented or explicitly recorded as the wider warm-cache trade-off.

## Verification

- Required six-file Vitest gate: **passed, 179/179**.
- Mutations: disabling staggering failed 5 tests; disabling marking failed 2.
- `git diff --check`: passed.
- Scoped lint: passed, with four pre-existing complexity advisories.
- Required `npm run typecheck`: **exit 1** because this sandbox rejects `tsx`’s `/tmp` IPC socket before TypeScript starts.
- Equivalent `node --import tsx scripts/typecheck.ts`: **passed** all four projects and coverage of all 2,539 source files.
- Extra `npm test`: could not start because the sandbox cannot reach the local Postgres/Docker lane.
- No paid calls and no commit.

Verdict: **accept with fixes**. The scoped code is sound; the only non-green required gate is the sandbox-blocked `npm run typecheck` wrapper, while the underlying typecheck passes.