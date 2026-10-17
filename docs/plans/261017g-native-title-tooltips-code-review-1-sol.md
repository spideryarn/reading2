Verdict: changes required. Stage 1 has three behavioral defects and two guard gaps.

1. **High — Escape can close two surfaces, and does not yield to native dialogs.**  
   [useDelegatedCard.tsx:272](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/useDelegatedCard.tsx:272), [tip-card.test.tsx:193](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/tip-card.test.tsx:193)

   A visible tip only stops propagation when its trigger is inside `.tooltip-anchor`. Elsewhere the same Escape continues to `useEscapeToClose`, input handlers, etc., closing or clearing both surfaces. The test at line 193 currently asserts this incorrect behavior.

   There are two further ordering problems:

   - An open native `<dialog>` should own Escape, but the hook never checks `dialog[open]`.
   - A nested `useHoverCard` also listens on `document` capture. `stopPropagation()` does not stop another listener on the same node, so both the nested tip and its outer card can close; the test uses a passive fake `.tooltip-anchor`, not a real outer card.

   **Fix:** when only an open timer is pending, cancel it without consuming Escape. When a card is visible, consume Escape for every trigger—not only nested ones—with `stopImmediatePropagation()`. First yield when `dialog[open]` exists. Give `TipCard` a window-capture Escape option so it runs before document-capture hover cards; keep it registered after Dock so Dock’s existing window-capture priority remains. Add pair tests against a real `useHoverCard`, a `useEscapeToClose` probe, Dock, and `<dialog open>`. Reverse the assertion at line 205.

2. **Medium — a disabled `Tooltip` still blocks `TipCard`.**  
   [Tooltip.tsx:431](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/Tooltip.tsx:431), [TipCard.tsx:68](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/TipCard.tsx:68)

   `data-tooltip-trigger` is added even when `enabled={false}`. If that trigger has a fallback `data-tip`, `Tooltip` opens nothing and `TipCard` deliberately ignores it, so the reader gets no card. The ignore rule also misses a `data-tip` descendant inside a Tooltip trigger, allowing two cards.

   **Fix:** emit `data-tooltip-trigger` only when `enabled` is true, and have `TipCard` reject `target.closest("[data-tooltip-trigger]")`, not merely the exact `data-tip` element. Test both a disabled Tooltip whose trigger has `data-tip` and a nested `data-tip` descendant of an enabled Tooltip trigger.

3. **Medium — tapping an already-open reading-time line no longer closes it.**  
   [BlockLinkCard.tsx:331](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:331)

   The old handler returned immediately when the line was already current. Therefore a second finger tap’s `pointerover`/`pointerout` close timer survived and closed the card. The new unconditional `openNow()` cancels that timer and reopens the same card, contradicting “the next tap anywhere closes it.”

   **Fix:**

   ```ts
   if (el === controls.current()) return;
   controls.openNow(el, e.clientY, true);
   ```

   Add a reading-time test that performs `finger(line)` twice and expects the card to close after the delay.

4. **Low — the spread guard misses statically visible titles.**  
   [no-native-title-tooltips.test.ts:82](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/no-native-title-tooltips.test.ts:82)

   `spreadsTitle()` misses nested literal spreads such as `{...{...{title: "x"}}}` and computed literal keys such as `{...{["title"]: "x"}}`.

   **Fix:** recurse into `SpreadElement.argument` within `ObjectExpression`, and treat a computed `StringLiteral` whose value is `"title"` as a hit. Add both forms to the scanner fixture.

5. **Low — the SVG exception exempts an entire file, not the intended native branch.**  
   [no-native-title-tooltips.test.ts:66](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/no-native-title-tooltips.test.ts:66), [no-native-title-tooltips.test.ts:133](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/no-native-title-tooltips.test.ts:133)

   Any future SVG `<title>` anywhere in `cost-charts.tsx` passes. That weakens the promise that a new SVG title fails the guard.

   **Fix:** make the exception site-specific by tracking ancestors and allowing only titles under the `tips === "native"` conditional in `StackedDayChart`, or separately assert every allowed title has that conditional ancestor.

Everything else I checked is sound: the reading-line virtual positioning, re-entry repositioning, press/scroll state, index refresh, description restoration, portal root, and fade-out content survived the extraction. `controls` has stable identity, `specRef` supplies current callbacks, and the hover/open timers cleanly cancel one another. The paragraph markup and page-wide mount are valid, and both cost-chart modes preserve their intended output.

Tests run:

- The five scoped card/chart files passed: **70/70 tests**.
- `tests/cost-analysis-html.test.ts` passed, including the standalone report.
- The guard’s self-test passed. Its repository scan failed on ten still-unswept files while stage 2 was in progress, as expected.

No files were changed.