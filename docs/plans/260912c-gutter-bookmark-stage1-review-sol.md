No P0 or P1 findings. The Stage 1 change is sound.

Findings:

- P2 — fixed: the test only proved ordering after one named container query. It now checks the complete imported reader stylesheet set and requires the hide rule to remain the final `display` decision affecting `.blk-more`. [gutter-target-size.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/gutter-target-size.test.ts:366)
- P2 — fixed: the component comment suggested assistive technology might reach a `display:none` button. I replaced that with the accurate reason for retaining the symmetric toggle: harmless programmatic activation without coupling behavior to CSS. [BlockGutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/BlockGutter.tsx:726)
- P2 — wider, unchanged: when a keyboard reader activates a normally-hidden control such as the permalink from the expanded column, closing can hide that focused control and leave focus on `body`. This predates Stage 1 and is separate from hiding the ellipsis; dialog-opening controls subsequently manage focus, but the permalink path does not.

The requested interaction trace checks out:

- Keyboard: Enter sets the destination to the column head; Tab skips the hidden ellipsis; Escape is handled on `document`, closes the column, redraws the ellipsis, then restores focus to it.
- Pointer: hiding the focused ellipsis may move focus to `body`, as the plan records, but outside `pointerdown` and document Escape remain available.
- Touch/iPad: `row-active` controls opacity and hit-testing only. The open rule reveals the controls, while the later hide rule removes the ellipsis. Gutter buttons are excluded from block-selection taps.
- Heading rows: the later heading-open rule changes only positioning and alignment, so it cannot restore the ellipsis.
- Cascade: all `display` rules naming `.blk-more` are in `gutter.css`; the competing count selectors and the new selector are all specificity `(0,3,0)`, and the new rule is last. Other `.blk-more` rules only affect opacity or pointer events.

Checks:

- Requested Vitest command: **65 passed**
- Typecheck: passed via `node scripts/typecheck.ts`; the npm wrapper itself was blocked by the sandbox denying `tsx`’s `/tmp` IPC socket.
- `git diff --check`: passed.
- No commit made.