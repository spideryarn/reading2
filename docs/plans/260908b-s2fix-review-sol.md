The fixes are not fully closed: **five closed, three partly closed**. S2-01 still permits the original P0 without a cast; S2-03 can fabricate wait restarts; S2-07’s brand can be invalidated without a cast.

## Findings

1. **S2-01 — P0 — partly closed — [tools/overseer/diff.ts:400](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:400)**

   The guarded `next` behavior is correct, but the type does not enforce baseline ownership.

   Concrete sequence:

   1. `diff(a, b)` returns `held` because `b` has rows and a null generation.
   2. The caller writes `baseline = b` directly. This compiles: omitting `baseline` from the result does not revoke the caller’s existing `b`.
   3. `diff(b, c)` sees `null → 200` as `unverifiable`, compares reused handles across worlds, and can emit silence or a fabricated status transition.

   The “bad `previous` is unreachable” claim is also false: `admissible(null, b)` can mint a branded, non-empty/null-generation snapshot, which can then be passed as `previous` without a cast. The test at `tests/overseer-diff.test.ts:349` demonstrates a disciplined caller, not a compiler-enforced one.

   The distinction needs to be encoded in the baseline type or handled defensively when `previous` is unsuitable. Simply holding forever is not the only escape: a readable `next` can be adopted as a fresh world without comparing it to the unplaceable predecessor.

2. **S2-02 — P1 — closed — [tools/overseer/observation.ts:281](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:281)**

   The original bad sequence is stopped at parsing: fractional, negative, zero-PID, unsafe, or otherwise invalid numeric values no longer reach generation or deadline logic. The zero/non-zero distinctions match the stated contract.

3. **S2-03 — P1 — partly closed — [tools/overseer/diff.ts:322](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:322), [tools/overseer/diff.ts:547](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:547)**

   The original `60 → 3600` missed restart is fixed, and the failure modes are correctly understood in prose:

   - Too high hides genuine extensions.
   - Too low fabricates restart events from collection-duration variation.

   But 10 seconds is not a safe fixed bound. Concrete sequence: A’s countdown is sampled near the beginning of a 4-second collection; B’s during a valid 20-second collection, with the same real wait throughout. Because `collectedAt` is stamped at the end, B’s implied deadline moves roughly 16 seconds later and `waitRestart()` emits a false `session-wait-restarted`.

   The real fixture only exercises a 65 ms duration difference. The 14.9-second test pins the chosen policy against 120 seconds; it does not establish that 10 seconds is above the producer’s possible timing error. Since `tookMs` is available, the comparison should account for per-snapshot sampling uncertainty rather than assuming a constant derived from a short capture.

4. **S2-04 — P1 — closed — [tools/overseer/observation.ts:106](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:106), [tools/overseer/observation.ts:372](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:372)**

   A token on another cause is rejected, and downstream code cannot represent that combination through `ObservedStatus`.

   Requiring the token is the right strictness direction for the stated reliability bar. If a future producer emits `unrecognised-agent-status` without it, losing the whole snapshot is an intentional, visible availability failure rather than silently collapsing distinct unknown statuses.

5. **S2-05 — P1 — closed — [tools/overseer/admissible.ts:144](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/admissible.ts:144)**

   Equal-clock disagreements in generation, rows, or collection duration are rejected with a useful reason.

   Excluding `health` and `refreshMs` is correct. They can legitimately change independently of the collection carrying `collectedAt`; including them would turn an ordinary repeated collection into a rejection and stall history for a non-collection change.

6. **S2-06 — P1 — closed, with a P2 residual — [tools/overseer/observation.ts:422](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:422)**

   Relative/oversized directories and currently invalid repo values are rejected, so the original recovery hazard is closed.

   **S2-06A — P2:** repeating `isRepoValue` is the wrong trade. Concrete sequence: the producer changes its grammar; this copy does not; typecheck and the current example-based tests remain green; the Overseer then either rejects every newly valid snapshot or accepts a value the producer has begun refusing. The claim that tests “pin the two together” is not true—they do not compare the validators. Preserving a type-only-import aesthetic is worth less than having one authoritative recovery/security grammar.

7. **S2-07 — P2 — partly closed — [tools/overseer/admissible.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/admissible.ts:83)**

   The brand prevents constructing an `AdmissibleSnapshot` directly from an unbranded parse result, but it does not preserve the asserted invariants.

   Concrete sequence: obtain one accepted snapshot, then mutate its non-readonly `error`, `rows`, or clock—or spread it and override those fields. The brand remains assignable, no cast is required, and `diff()` accepts the now-unadmissible snapshot. A failed collection can therefore still be transformed into false disappearance events.

8. **S2-08 — P2 — closed — [tools/overseer/diff.ts:386](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:386), [README.md:53](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tests/fixtures/overseer-snapshots/README.md:53)**

   The between-collections blind spot is plainly documented both on `diff()` and beside the fixtures. The unavoidable sequence—session starts after A and exits before B—remains correctly described as absent evidence rather than a solvable differ bug.

The requested test command passed: **2 files, 69 tests**. No files were changed by me.