Two fixes are closed; two are partly closed.

| Fix | Verdict |
|---|---|
| S2-01 | **partly closed** |
| S2-07 | **partly closed** |
| S2-03 | **closed** |
| S2-06A | **closed** |

## Findings

1. **R3-01 — P0 — S2-01/S2-07 — [tools/overseer/diff.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:91)**

   The private field protects the box, but the accessor exposes the live, unfrozen object inside it. TypeScript’s `readonly` does not stop mutation through standard mutating APIs:

   ```ts
   const baseline = baselineOf(admitted);
   if (baseline === null) throw new Error("unexpected");

   Object.assign(baseline.snapshot, { tmuxServerPid: null });
   diff(baseline, next);
   ```

   This compiles without a cast. If `baseline` has rows, it is now precisely a value `unplaceable()` would refuse. But `diff()` checks only `next`, trusts `previous`, takes the `unverifiable` generation branch, and can compare reused handles across a reboot—producing silence or a fabricated transition.

   `BaselineBox` and `AdmissibleBox` also share the same `FreshSnapshot` reference when `baselineOf()` promotes one, so mutation through either accessor changes both views.

   The boxes need an owned, runtime-immutable value—or must avoid exposing their live backing object—for the stated “cannot mutate after blessing” guarantee.

2. **R3-02 — P2 — S2-07 — [tools/overseer/observation.ts:112](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:112)**

   The readonly conversion is shallow. `ObservedStatus` inherits mutable arms from `SessionState`, so ordinary property assignment still compiles:

   ```ts
   const row = admitted.snapshot.rows[0];
   if (row?.status.kind === "waiting") {
     row.status.secondsLeft = 3600;
   }
   ```

   Passing that admitted snapshot to `diff()` can manufacture `session-wait-restarted`; setting an invalid number can violate parser invariants entirely. `meta`, `question`, and `health` are likewise transitively mutable.

   The existing type test at `tests/overseer-diff.test.ts:104` proves only that a top-level property cannot be directly reassigned.

3. **R3-03 — P2 — S2-01 residual — [tools/overseer/diff.ts:144](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:144)**

   Documentation is not enough for the nullable promotion result.

   Concrete sequence:

   1. `x` is admissible but has rows and an unreadable generation.
   2. `baselineOf(x)` correctly returns `null`.
   3. `diff(baselineOf(x), next)` compiles.
   4. `diff()` interprets the refusal as a cold start and emits a fleet-wide set of `session-seen` events.

   I would use `{ ok: true; baseline: Baseline } | { ok: false; reason: string }`. It prevents the unsafe composition and forces the daemon to acknowledge the refusal.

   This is lower severity than the original P0 because `Baseline | null` does represent failure and normal assignment to `Baseline` forces a check. The hole appears because `diff()` gives that same null a second, legitimate meaning. The design principle does not differ from the P0: a refusal must not silently become permission.

## S2-03

The new bound is sound for preventing fabricated events. If sampling error is `e₁` and `e₂`, then for an unchanged wait the observed movement is `e₂ − e₁`. The earlier collection’s duration contributes negatively, so only the later collection can establish the maximum positive drift.

When the earlier collection is long, it can hide a genuine extension. A small extension is therefore not guaranteed to be detected; even an extension exceeding `nextTookMs + 2s` can be hidden by a sufficiently late earlier implied deadline. That is soundness rather than completeness, and matches the declared policy of preferring a missed small restart to a fabricated event. Adding the earlier duration to the tolerance would only hide more.

The comment saying an extension below the later collection’s bound “is invisible” is too categorical; “may be invisible” is exact. I do not count that as leaving S2-03 open.

## S2-06A

The production code now uses the authoritative validator directly, and its module performs no import-time I/O. The differential test is the right regression test. Its 16 values cover the current grammar’s meaningful boundaries: special `unknown`, segment count, allowed punctuation, case/space rejection, dot traversal, trailing separators, and the 100/101 length boundary.

No finite corpus can prove equivalence against arbitrary future syntax, but source de-duplication is the primary guarantee; the test is an appropriate drift alarm.

The permitted Vitest command passed: **2 files, 75 tests**. The scoped files matched revision `6ebb6672`; I changed no files.

Your final suspicion is substantially right: the nominal wrappers make outside construction a type error, while the semantic truth of the two mint sites necessarily rests on those modules. That is the normal smart-constructor trade. What is not yet sound is post-mint immutability—the live referent escapes, so the guarantee currently also rests on callers choosing not to mutate it.