Verdict: committed `2c9a6d9a` had four established P1s and should have been refused. The working tree now fixes all four. I found no remaining replay or broadcast-binding escape, and did not commit.

Findings:

- F1 — P1, established: a kill preview could display process A while storing replacement B’s start token. The new test reproduces scan(A) → PID reuse → token(B) → confirm(B). Fix: bracket the authoritative preview scan with start-token reads and use the second scan’s details. [Test](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts:2538>) · [fix](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/routes-actions.ts:2396>)

- F2 — P1, established: after one confirmation plus 32 dry runs, replay returned `preview-unknown`, contradicting the tombstone-until-expiry contract. Fix: evict only fresh previews; if all 32 entries are live tombstones, refuse new previews until one expires. [Test](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts:2833>) · [fix](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/routes-actions.ts:1552>)

- F3 — P1, established: raw JSON containing `-0` was returned as `0`, after which `isDeepStrictEqual` rejected the server’s own preview. Fix: compare according to JSON value semantics. [Test](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts:2669>)

- F4 — P1, established: approximately 2,000 nested arrays fit comfortably under 64 KiB and survived the preview response, but confirmation threw `RangeError` and returned 500. The iterative JSON comparator fixes this without weakening object-key or array-order checks. [Test](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts:2689>) · [comparator](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/routes-actions.ts:616>)

- F5 — P2, established: action, malformed-material, wrong-kind, and changed-material failures shared an unhelpful sentence. They now retain `preview-mismatch` but name the failed check.

- F6 — P3, established: several statements overclaimed provenance or timing. I corrected the rule-scan comment, per-candidate identity-to-signal window, “server’s own status,” “never submitted,” and “immediately before signalling.”

- F7 — P3, established: changing only a receipt’s `serverInstanceId` made the refusal claim another server had minted it and was gone. It now accurately says the receipt *claims* another instance. [Test](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts:2641>)

On the accuracy question: the original comment was directionally right but underclaimed the residual window. An early candidate waits through later identity reads and earlier signal steps, so “a few milliseconds” or “immediately before signalling” is not established. The fresh scan also establishes rule membership only at scan time; mutable command/cwd data can change afterwards without changing PID/start ticks. The revised comments now say exactly that.

Your four suspicions:

1. Splitting mismatch explanations was worthwhile and cheap; done.
2. `isDeepStrictEqual` was wrong for this JSON contract; replaced.
3. Evicting tombstones was not an acceptable bounded-memory trade; fixed while retaining the hard 32-entry limit.
4. Refusing an over-64 preview remains correct. Arbitrarily marking some excess processes unconfirmable would contradict the action’s “every matching process” meaning without any policy for choosing which 64.

Verification:

- Scoped suite: 257 passed; only the three intentional Stage 3 tests failed.
- Typecheck: source, web, and root projects clean; only the seven intentional Stage 3 test errors remain.
- `git diff --check`: clean.
- Targeted lint reported only existing findings, including the pre-existing ANSI-regex error.

Files changed:

- [routes-actions.ts](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/routes-actions.ts>)
- [wire.ts](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/wire.ts>)
- [fleet-actions-route.test.ts](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tests/fleet-actions-route.test.ts>)
- [stage2 report](</home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260909h-box-contracts-stage2-report.md>)