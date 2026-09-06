Verdict: **accept Stage C**. I found no established P0/P1 in its implementation, so I do not refuse it. The known F10/F22/F23 defects remain outside this stage and verdict, as requested.

## Findings

**F27 — P2 — established: the new test suite leaks jump stamps between tests.**

[`beforeEach`](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/tests/spine-jump-origin.test.ts:132>) resets with a same-path `history.replaceState(null, …)`. The installed wrapper deliberately preserves the current stamp on same-path replaces ([router.ts](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/router.ts:1385>)), so later tests can mount with the previous test’s mark already present.

Established by running:

```text
npx vitest run tests/spine-jump-origin.test.ts \
  --sequence.shuffle.tests --sequence.seed=2
```

“draws nothing on an entry no jump stamped” failed: expected zero marks, received one.

Smallest fix: call the already-imported `dismissJumpOrigin()` in `beforeEach`, before mounting.

**F28 — P3 — established: the committed plan’s review ledger is stale and its completion claim is false at this commit.**

The header says four refusals and twenty-one findings ([plan](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:3>)), but `1df91b3b` itself adds the fifth review, ending at F26. That review establishes three unresolved P1s in the committed Stage B2 code, so “every stage and the docs are built” is also premature for this exact commit.

Smallest fix: record five reviews / twenty-six findings, add the fifth-round disposition, and describe the Stage B2 corrections as pending until their commit lands.

**F29 — P3 — established: the subscription comment understates what re-renders the rail.**

[Spine.tsx](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/Spine.tsx:687>) says only a jump, Back, or dismissal re-renders it. Forward and any unarmed push that changes the stamp also do. The implementation is correct; only the exhaustive wording is wrong.

Smallest fix: say “a change in the effective stamp—typically a jump, Back/Forward, a stamp-stripping push, or dismissal.”

**F30 — P3 — established: the same comment contradicts itself about stale stamps.**

[Spine.tsx](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/Spine.tsx:693>) introduces “two cases where the chip stands without a mark,” then names a stale block “where the chip is gone as well.” Only `{kind:"top"}` is a chip-without-mark case.

Smallest fix: call these “two cases where no mark is drawn,” then distinguish top—chip remains—from stale—both disappear.

**F31 — P3 — established: the plan overstates the pre-existing final-search-mark bug.**

The plan says an unclamped final `.spine-match` is “clipped away” ([plan](</home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:551>)). More precisely, overflow clips the 3px minimum back to the row’s natural proportional height. A zero-height final row disappears; a positive-height row retains that natural sliver, though it may be subpixel and effectively invisible.

Smallest fix: describe it as “the 3px visibility floor is lost, so a zero/subpixel final-row mark can disappear.”

## Requested checks

The lifecycle invariant holds durably:

- Both views subscribe to the cached `useJumpOrigin()` snapshot.
- Arming hides both; the completing push reveals both from the new stamp.
- Dismissal strips the stamp and emits the event both subscribers read.
- A stale block is absent from both `rowOf` and measured rows, so both disappear.
- Article changes synchronously withhold the old payload, remount the reader keyed by slug, and pathname-changing writes clear the stamp.
- `{kind:"top"}` deliberately has a chip and no mark.
- A hidden spine or its initial pre-measure frame can likewise have a chip without a visible mark, but there is no durable mark-without-chip sequence.

The lane claim holds structurally. `laneOrder()` consumes only search matches; `OriginMark` has no lane or colour; `.spine-from` is an absolutely positioned sibling outside `.spine-matches`; and `--lanes` remains `lanes.size`. Several active searches cannot be shifted by the origin mark. The test uses one search, but the construction proves the general case.

The arithmetic is correct:

- Origin and search marks read the exact same `metrics.rows`.
- A tall row receives its actual measured top and height.
- A zero-height row becomes the intentional 3px minimum; at the bottom it is moved inward.
- For a last row whose rendered proportional height is at least 3px, its top is already at or above `100% - 3px`, so the clamp does not move it.
- If it is shorter than 3px, the clamp places the 3px floor wholly inside the rail.

The subscription cache claim also holds. Same-stamp scroll-spy replaces call the snapshot but return the identical cached object, so React does not commit another Spine render. The rail does now render on genuine stamp changes—necessarily—and a chained jump can cause one render to hide the old mark and another to show the new one.

On the suspicions:

1. The search-mark problem is real as a lost minimum-height guarantee, but “every final mark is clipped away” is too strong. Leaving the unrelated fix out of Stage C was right; it deserves a small follow-up.
2. From source alone, the origin is materially distinct from an L2 hairline: at least 3px versus 1px, full 12px width versus a 2px inset, and `--ink-faint` at 0.55 versus the much darker `--rule` at 0.8. That supports “place rather than structure,” but only the pending browser check can establish perception.
3. One mark remains the right v1. A fading trail still requires a second history store plus retention/decay semantics because browser history is unreadable. Stage C’s machinery does not remove that complexity. The stronger justification is simpler-first and rail density; the “marks only when asked for” argument is weaker because every trail entry would also originate in a requested jump.

Focused default-order suites: **242 tests passed**. The additional shuffled run established F27.