## Blocking findings

1. [styles.css:10220](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10220>) — the one-slot hover swap still wins at every larger capacity.

`tr:hover .blk-gutter:not([data-open]):has(.blk-cmt) > .blk-more` has specificity `(0,5,1)`. None of the count-based hides at [10229](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10229>), [10242](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10242>), or [10248](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10248>) exceeds `(0,3,0)`. Later-wins therefore never enters into it.

A 4×4 matrix is insufficient because the result also depends on whether the count includes `.blk-cmt`. All no-note combinations are correct. At rest, noted combinations are also correct except for the deliberate one-slot mark-for-dot substitution. On hover, these six noted cells are wrong:

| Capacity | Controls | Actual extra element |
|---:|---:|---|
| 2 | 2 | `…` |
| 3 | 2 | `…` |
| 3 | 3 | `…` |
| 4 | 2 | `…` |
| 4 | 3 | `…` |
| 4 | 4 | `…` |

The diagonal cases `(2,2)`, `(3,3)`, and `(4,4)` draw `capacity + 1` grid rows and create a closed overhang. The last is a real application state: a noted four-line owner row has four controls, and hovering adds the fifth item.

The one-slot swap needs to be scoped to the one-slot bracket, or every larger bracket needs a selector capable of defeating it. The current structural test at [gutter-target-size.test.ts:289](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/tests/gutter-target-size.test.ts:289>) only checks that strings exist, so all tests pass over this defect.

2. [BlockGutter.tsx:636](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:636>) — the disclosure is not keyboard-coherent.

The `…` is last in DOM order, after every control it reveals. Activating it from the keyboard leaves focus on the last element, so forward Tab skips all newly revealed controls; reaching them requires reverse-tabbing.

There is a harder failure for a one-slot noted row. [styles.css:10219](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10219>) makes `…` `display:none`, and only `tr:hover` restores it. A keyboard-only reader tabs from the mark straight out of the gutter. On `hover:none`, the opacity rule cannot revive a `display:none` element either. This affects every noted one-slot row, not only an orphaned note; orphan status appears nowhere in the selectors.

It also makes the Escape claim at [BlockGutter.tsx:396](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:396>) conditional. If a one-slot noted panel is open after the pointer has left the row, Escape focuses `…` while open, then the state update makes that focused element `display:none`, so focus is lost. The jsdom test at [block-gutter.test.tsx:542](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/tests/block-gutter.test.tsx:542>) cannot observe that CSS transition.

The listeners themselves clean up correctly and do not leak. Capture-phase `pointerdown` does not fight the control handlers because presses inside `box` do not dismiss; the four `setOpen(false)` calls and the `…` toggle are on distinct targets.

## Other findings

3. [plan:256](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:256>) — the measurements do not support the general “zero overhangs” conclusion.

The explicitly unmeasured case at [plan:302](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:302>)—four controls in a four-slot gutter—is exactly one of the failing hover cases above. The four noted rows measured only capacities 1–3, where `N=4` legitimately needs the dot.

Also, a 390px viewport in desktop Chrome does not itself exercise `@media (hover: none)`. The write-up does not say touch input was emulated. The threshold-edge case is fine; a gutter a fraction above a threshold has at least the corresponding exact number of slots.

The 96px+ statement at [plan:263](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:263>) is also wrong: at rest, four controls fit and there should be no dot.

4. Several comments still state the superseded layout as current fact.

Most importantly:

- [styles.css:279](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:279>) still says two grid columns and a three-slot floor.
- [styles.css:1137](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:1137>) says the second column remained, the row is still 87.1px, and the gutter is two slots.
- The main gutter header at [styles.css:9802](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:9802>) through [9854](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:9854>) still describes the two-column, explicitly positioned, floored arrangement.
- [styles.css:10012](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10012>) says no row has a floor and the invariant remains “no interactive control”; both contradict the surviving one-slot floors and deliberate open-panel exception.
- [styles.css:10076](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10076>) says there is no floored heading immediately after declaring its floor.
- [styles.css:10107](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10107>) still says three slots are reserved and the width is “one of two.”
- [BlockGutter.tsx:456](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/BlockGutter.tsx:456>) says the mark has its own column level with the permalink.
- [TableView.tsx:1086](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/TableView.tsx:1086>) says “the floor” is gone and restates the un-narrowed invariant.
- The claim that every dot show/hide rule uses `data-controls` is false in [plan:133](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md:133>), [styles.css:10169](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10169>), and [gutter-target-size.test.ts:289](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/tests/gutter-target-size.test.ts:289>). The surviving hover swap both shows and hides it through `:has()`.

5. [styles.css:300](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:300>) — the token arithmetic is wrong above a 16px root.

At a 20px root, one slot is 30px, so `--text-pad-l` is `30 + 2×7 = 44px`, not 46px. Removing the second column returns 30px there, not “24px at every root.” The 12px and 16px figures are correct.

The `90vw` explanation and its 626-versus-742 arithmetic are correct for ordinary prose, and it accurately keeps row-specific measures out of the claim.

6. [styles.css:10423](</home/greg/code/spideryarn2/.claude/worktrees/gutter-fit-to-row/src/web/styles.css:10423>) — `margin:-1px` does not make the box two pixels larger in each direction.

With global `box-sizing:border-box` and an explicit one-slot width, the border remains inside that width; the fixed-width grid track instead overflows the 22px content box horizontally. The measured result may look acceptable, but the stated box-model explanation is false.

## Earlier five findings

- Threshold conjunction: correct. `A ≥ 48px AND A ≥ 3rem` is exactly `A ≥ max(48px, 3rem)` at every root, including equality and fractional sizes. The only possible difference is parser support; the conjunction is the more conservative spelling.
- One-slot floors: correctly retained.
- Heading box: correctly implemented.
- Real control count: the React/counting half is correct; the CSS half is incomplete because the hover `:has()` rule overrides count decisions.
- Two insets and open release: correctly implemented.

The three requested test files pass: 93 tests. `npm run typecheck` could not start because this sandbox refused `tsx`’s `/tmp` IPC socket with `EPERM`; that is an environment failure, not a TypeScript result.