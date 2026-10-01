## Findings

1. **Medium — fixed:** [OrderGroup.tsx:65](/home/greg/code/spideryarn2/.claude/worktrees/order-row-sideways-touch/src/web/OrderGroup.tsx:65) missed newly inserted options when neither the constrained group nor existing buttons resized. Added a child-list observer that reconnects `ResizeObserver` and reveals the selected button.

2. **Low — fixed:** [touch-controls.test.ts:461](/home/greg/code/spideryarn2/.claude/worktrees/order-row-sideways-touch/tests/touch-controls.test.ts:461) excluded matching `any-pointer: coarse` rules from its simulated cascade. The test now includes all coarse-pointer rules while requiring the winner to use `pointer: coarse`.

3. **Low — fixed:** [order-group.test.tsx:107](/home/greg/code/spideryarn2/.claude/worktrees/order-row-sideways-touch/tests/order-group.test.tsx:107) did not cover option insertion, ResizeObserver, or font-change reflows. Added coverage for all three.

CSS review found the five rows correct:

- Glossary, Citations, Debate and FAQ use the shared late `.gloss-sort` rule.
- Quotes’ later stylesheet supplies its own `nowrap`, after its base `wrap`.
- No later mode stylesheet overrides the relevant properties.
- The trailing item cannot shrink; the group does, keeping the trail pinned.
- `3px` padding plus `-3px` margin leaves the flex item’s outer dimensions—and therefore row height—unchanged while providing focus-outline room.
- Desktop retains the original wrapping rules.

`scrollLeft` cannot trigger either observer, so there is no reveal loop. A later resize/font/option change can override a deliberate swipe away from the selected button; that is consistent with the stated “keep the active order visible after reflow” behavior. SSR/jsdom guards are adequate, and the five accessible group names and button behavior were preserved.

Changed the component, both focused tests, and the plan’s code-review record. No wider findings need a decision.

Checks:

- Targeted Vitest: **21/21 passed**
- Typecheck: all projects passed via `node --import tsx scripts/typecheck.ts`
- Exact `npm run typecheck`: blocked by the sandbox denying `tsx`’s Unix socket
- Full `npm test`: blocked by unavailable local Postgres/Docker
- Scoped lint: no new errors; only existing advisory complexity notices
- `git diff --check`: passed

**Verdict: approve after fixes; the scoped implementation now satisfies the touch-row contract.**