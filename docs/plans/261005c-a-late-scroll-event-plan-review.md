The diagnosis is correct, and removing the clock is sound **with one required change**.

**F1 — P1: the permanent half-pixel tolerance suppresses real reader movement.** The proposed guards in [stage 1](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/docs/plans/261005c-a-late-scroll-event-of-our-own-ends-a-centred-arrival-and-rewrites-at.md:68) and [stage 2](/home/greg/code/spideryarn2/.claude/worktrees/qi-d7pxe8z7-structure-click-at-rewrite/docs/plans/261005c-a-late-scroll-event-of-our-own-ends-a-centred-arrival-and-rewrites-at.md:88) treat a different fractional position as unchanged forever. Browsers expose subpixel `scrollY`. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/scrollY)

I reproduced this in memory, using jsdom and the base versus proposed predicates:

1. Hide the controls bar through reader scrolling.
2. Complete a centred jump to `scrollY = 3560`, then process its trailing event.
3. After the old deadline, move upward to `3559.75` and dispatch scroll.

| Rule | Arrival anchor | Controls bar |
|---|---|---|
| Base | Cleared | Revealed |
| Proposed | Retained | Hidden |

This violates both “holds until you move” and the bar’s existing rule that any upward movement reveals it (`src/web/scroll.ts:400`). After settlement, the glide’s wheel/touch cancellation listeners have been removed, so they cannot rescue this case.

**Change:** compare exact equality against the recorded browser readback in both guards. `moveWindow` already records the actual clamped/rounded `scrollY`; `holdAnchor` does likewise. Add handler-level tests for a late unchanged fractional position and a genuine `0.25px` movement.

I found no additional regression from the bar/glide frame ordering: before the tick, both values describe the previous movement; after it, both describe the latest movement. Instant moves, reduced motion and clamping follow the same readback rule. The larger viewport-position option addresses a separate layout issue and is unnecessary for this fix.

The requested Vitest run produced **37 passes and two failures**, precisely the delayed-anchor and delayed-bar failures described by the plan. The tree changed during review; I edited no files.

VERDICT: approve with changes