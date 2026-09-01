I would not sign this off yet. Two chain defects remain, including one on the touch path the buttons were built for.

## Ranked findings

1. **High — `touchstart` cancels the chain before every rapid touch tap.**

   The first tap stores a target. On the second iPad tap, the window-level `touchstart` handler runs `dropChain` before the button’s `click`, so `stepFrom()` measures the page mid-glide and recreates the original race ([DiagramPanel.tsx:870](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:870), [DiagramPanel.tsx:876](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:876)). The comment correctly rejects blanket `pointerdown`, but the same reasoning applies to `touchstart`.

   This is especially serious because these buttons explicitly exist for iPad ([DiagramPanel.tsx:1629](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:1629)). The rapid-press test calls `button.click()` directly, so it emits no `touchstart` and passes despite the real touch path being broken ([diagram-step.test.tsx:246](/home/greg/code/spideryarn2/tests/diagram-step.test.tsx:246), [diagram-step.test.tsx:323](/home/greg/code/spideryarn2/tests/diagram-step.test.tsx:323)).

2. **High — the chain survives unrelated navigation and can override the reader’s new position.**

   It is cleared only by `wheel`, `touchstart`, and timeout ([DiagramPanel.tsx:876](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:876)). Within its 600ms life, all of these can replace the jump without clearing it:

   - the window keynav’s ↑/↓;
   - the picture’s own arrow navigation;
   - a mouse click on a dot;
   - the footer-card jump;
   - dragging the scrollbar;
   - Space/PageDown;
   - switching diagram kind.

   Dot and footer jumps receive raw `onJump` with no chain invalidation ([DiagramPanel.tsx:1593](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:1593), [DiagramPanel.tsx:1735](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:1735)). Scrollbar dragging and keyboard scrolling fire neither registered cancellation event. A subsequent button press therefore steps from the abandoned button target rather than the page.

   Trackpad scrolling is fine because it fires `wheel`. None of the integration tests covers an intervening jump or non-wheel manual scroll.

3. **Medium-high — the long-article scroll cost is substantially understated.**

   Every scroll frame calls `measureRow()` ([DiagramPanel.tsx:419](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:419)), which queries and reads the rect of every article row ([keynav.ts:215](/home/greg/code/spideryarn2/src/web/keynav.ts:215)). The comment’s “a rect read per frame” is false; it is one rect read per row per frame ([DiagramPanel.tsx:390](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:390)).

   On each paragraph crossing, `readerRow` also changes `followsReader`, producing a fresh scatter layout ([DiagramPanel.tsx:704](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:704)). Because `stops` depends on the whole `layout`, `paragraphStops` then reruns ([DiagramPanel.tsx:801](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:801)), doing `nodeAt`’s full node scan once per body row ([diagram.ts:850](/home/greg/code/spideryarn2/src/web/diagram.ts:850)). Thus the advertised ~2M comparisons are paid at every paragraph crossing, not merely when the picture meaningfully changes. `MAX_BLOCKS` caps dots, not the length of `blocks`, so 2M is not even a firm ceiling.

   The twelve-row/three-dot integration fixture cannot expose this.

4. **Medium — `layoutKey` narrows the reflow hole but does not close it.**

   The key contains fitted columns, prose visibility, width, mode width, and spine state ([App.tsx:1297](/home/greg/code/spideryarn2/src/web/App.tsx:1297)). It does not change when a late image loads or a webfont swaps in, both of which can change table height and move rows under a stationary reading line.

   This is already recognized elsewhere: `useColumnContext` observes the table specifically for late images and font swaps ([useColumnContext.ts:163](/home/greg/code/spideryarn2/src/web/useColumnContext.ts:163)). `useReaderRow` has no equivalent observer.

   The integration test changes `layoutKey` manually; it proves that changing the prop re-measures, not that real reflows necessarily change the prop ([diagram-step.test.tsx:279](/home/greg/code/spideryarn2/tests/diagram-step.test.tsx:279)). Consequently the “Every reflow” prop comments overclaim ([DiagramPanel.tsx:116](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:116), [App.tsx:3642](/home/greg/code/spideryarn2/src/web/App.tsx:3642)).

5. **Medium — `canStep` can be dead-looking while operational, or live-looking while inert.**

   `canStep` uses the last rendered `readerRow` ([DiagramPanel.tsx:820](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:820), [DiagramPanel.tsx:922](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:922)); activation uses `chain.current` first ([DiagramPanel.tsx:885](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:885)).

   Immediately after stepping off the first rung, Previous can still announce `aria-disabled="true"` yet work from the chained target. Immediately after targeting the final rung, Next can still look live yet do nothing. This lasts until scroll-derived state catches up, not necessarily “one frame.” It also makes the claim that `stepTo` and `canStep` report “the same condition” false ([DiagramPanel.tsx:1658](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:1658)).

6. **Low — a few comments still describe a cleaner model than the code has.**

   - `readerRow` is not the panel’s “one answer” for the row a press steps from; that is DOM measurement or the private chain ([DiagramPanel.tsx:635](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:635)).
   - `atRow` is not always section-granular. `jumpTo` deliberately writes an exact paragraph id, including from these buttons ([DiagramPanel.tsx:104](/home/greg/code/spideryarn2/src/web/DiagramPanel.tsx:104), [App.tsx:1032](/home/greg/code/spideryarn2/src/web/App.tsx:1032)).
   - The new tests do not pin Drift’s internal scroller following `line.diag-now`; they only assert that the line’s coordinate changes ([diagram-step.test.tsx:267](/home/greg/code/spideryarn2/tests/diagram-step.test.tsx:267)).

## What checked out

- `enabled` flipping and `enabled ? row : null` are sound: the stale row is hidden immediately, the old listener/frame is cleaned up, and enabling measures again.
- `paragraphStops` is correct for the documented “paragraph means body row” convention; its problem is cost, not mapping.
- `rung === 0` adds only the apparatus case. Empty ladders already displayed `—`, while the unmeasured case still falls back to the first rung.
- The new code performs no DOM read during render; DOM access is confined to effects and event handlers.
- The Drift follow target and `[here, layout]` dependency look correct.
- The updated `aria-disabled` CSS note is accurate.

I could not independently rerun Vitest in this read-only review sandbox because Vite attempted to create `node_modules/.vite-temp` and received `EROFS`. I made no changes.