## Verdict: go with changes

The page-wide delegated card is the right direction, and extracting the shared delegated machinery is preferable to copying it. Before building, the plan needs changes around accessibility, disabled controls, overlapping card owners, Escape arbitration, SVG/static rendering, and the guard’s handling of JSX spreads.

1. **Keep the global `TipCard`, but extract only the genuinely shared state machine.**

   Mounting one `TipCard` beside `OfflineStrip` is sound: it survives all `App` early-return routes and remains page-wide, matching the existing root structure in [main.tsx](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/main.tsx:235).

   A shared hook is better than copying a smaller `TipCard`, because detach handling, warm swaps, focus, description restoration, dialog portals, Escape and mutation observation are exactly the details likely to drift. But the hook should not absorb BlockLink-specific policy:

   - virtual positioning for reading-time lines: [BlockLinkCard.tsx:215](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:215)
   - close-on-scroll for a pressed reading line: [BlockLinkCard.tsx:391](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:391)
   - refreshing from a changed article index/resolver: [BlockLinkCard.tsx:409](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:409)
   - the reading-line click gesture: [BlockLinkCard.tsx:493](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:493)

   Give the hook callbacks such as `contentFor`, `referenceFor`, `describe`, and `observeAttributes`; leave those policies in `BlockLinkCard`.

   The hook must use `Element`/`SVGElement`, not the current `HTMLElement` assumption at [BlockLinkCard.tsx:308](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:308), because the plan makes SVG paths and rects triggers.

   Preserve the gutter’s `.tip-soon` sizing, currently selected at [BlockLinkCard.tsx:579](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:579), and test that an existing `aria-describedby` is merged and restored, not merely that the new one appears.

2. **The accessibility migration is sufficient only for focusable elements.**

   `title` can be an accessible-name fallback or, when the element already has a name, an accessible description. `data-tip` has no semantics. `aria-label` where `title` was the sole name plus `aria-describedby` while the tooltip is displayed is correct for focusable controls and links, and matches the [WAI-ARIA tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).

   It is not sufficient for the many non-focusable triggers. The plan’s promise that keyboard focus opens every migrated card at [plan:19](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md:19) is false for `<span>`, `<div>`, `<li>`, `<time>`, `<th>`, `<path>` and `<rect>`.

   Handle the element types separately:

   - `<button>` and focusable `<input>`: planned handling is right, provided the tooltip text is a description rather than accidentally replacing an existing visible name.
   - `<a>`: fine when its text or `aria-label` remains the name. Prohibit overlap with `[data-block-link]`.
   - `<time>`: put the exact date in `sr-only` contents, following the existing precedent at [ChangelogPage.tsx:213](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/ChangelogPage.tsx:213). Do not rely on `aria-label`; WAI-ARIA guidance notes that naming `time` is not consistently supported.
   - `<th>` and ordinary spans/divs: do not add hundreds of arbitrary tab stops. If the text matters beyond mouse hover, provide persistent `aria-describedby` content or `sr-only` text; otherwise explicitly classify it as pointer-only supplementary information.
   - `<input pattern>` in future: its `title` can participate in native validation messaging, so a blind migration would not be equivalent.
   - SVG shapes: `data-tip` provides only pointer behavior unless a deliberate keyboard-navigation model is added. An SVG `<title>` can also carry accessibility semantics; it is not merely another JSX attribute.

   The W3C’s naming guidance explicitly describes `title` as the final accessible-description fallback, so removing it can lose information even when it was not the accessible name. [W3C accessible names and descriptions](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/).

3. **The SVG migration would break the standalone cost report.**

   `cost-charts.tsx` is intentionally shared with a server-rendered static report that has no React root or `TipCard`: [cost-charts.tsx:8](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/cost-charts.tsx:8) and [cost-analysis-chart.ts:65](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/scripts/cost-analysis-chart.ts:65). Its test expressly requires the SVG `<title>` hover text at [cost-charts.test.tsx:90](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/cost-charts.test.tsx:90).

   Therefore [plan:117](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md:117) is not viable as written. Give `StackedDayChart` an explicit rendering mode: rich `data-tip` in the app, native `<title>` in standalone markup. Pin both outputs in tests and make the guard’s exception exact to that file/mode.

4. **Current browsers do deliver `pointerover`/`pointerout` on plain disabled buttons, but that does not solve the product problem.**

   Chromium and WebKit shipped the interoperable policy in 2023, and Firefox enabled it by default in Firefox 124. Current Chrome, Firefox and Safari therefore send hover pointer events to disabled form controls; activation events remain suppressed. [Firefox bug 1653882](https://bugzilla.mozilla.org/show_bug.cgi?id=1653882), [WebKit bug 251246](https://bugs.webkit.org/show_bug.cgi?id=251246).

   Two problems remain:

   - A native disabled button cannot receive keyboard focus.
   - The house `Button` explicitly applies `disabled:pointer-events-none`, so the proposed delegated listener will not see it at all: [button.tsx:46](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/components/ui/button.tsx:46).

   For disabled controls whose explanation matters, use the repo’s existing `aria-disabled` pattern, with an activation guard, as documented in [IconButton.tsx:54](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/IconButton.tsx:54). For submit buttons or other cases where emulating disabled safely is awkward, keep native `disabled` and put the tooltip on an explicit focusable wrapper with suitable accessible text. Listening on an arbitrary nearest ancestor solves neither focus nor the `pointer-events:none` case cleanly.

5. **Define one owner and one Escape consumer before generalising `data-tip`.**

   The plan needs explicit invariants:

   - An element may not simultaneously be a `Tooltip` trigger and a `[data-tip]` trigger. The existing `IconButton titled={false}` sites are the precedent.
   - A `[data-tip]` trigger may not be the same element as, or sit inside, `[data-block-link]`/xref triggers. Otherwise both delegated cards open.
   - A `[data-tip]` inside an interactive card is allowed: the parent card stays open, the child tip opens, and the first Escape closes only the child.
   - Mark cloned `Tooltip` triggers with an ownership attribute and make `TipCard` reject collisions, rather than relying only on call-site discipline.

   Do not lift the current BlockLink Escape handler unchanged. It closes from a document listener without stopping propagation at [BlockLinkCard.tsx:525](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:525). The established nested-tooltip rule is “one Escape, one surface” at [Tooltip.tsx:331](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/Tooltip.tsx:331).

   The shared hook should:

   - stop propagation only when it actually consumes Escape;
   - cancel pending opens as well as open cards;
   - ignore IME-composition Escape;
   - follow the repo’s existing rule that an open native dialog outranks JS surfaces, documented at [useEscapeToClose.ts:40](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/useEscapeToClose.ts:40);
   - retain the dialog-local portal root;
   - test a tip inside an interactive tooltip and inside a modal dialog.

   Ignoring finger `pointerover` remains the right touch behavior: a tap should activate the control. Decide and document pen separately; current BlockLink behavior ignores only `pointerType === "touch"` at [BlockLinkCard.tsx:477](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BlockLinkCard.tsx:477).

6. **The proposed guard currently misses native titles that already exist.**

   The claim at [plan:97](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md:97) is materially incomplete. There are at least six native titles created by JSX spreads, including:

   - [BibliographyPanel.tsx:1297](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/BibliographyPanel.tsx:1297)
   - [GlossaryPanel.tsx:1372](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/GlossaryPanel.tsx:1372)
   - [FaqPanel.tsx:422](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/FaqPanel.tsx:422)
   - [QuotesPanel.tsx:1356](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/QuotesPanel.tsx:1356)
   - [DictationStrip.tsx:332](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/DictationStrip.tsx:332)
   - [DictationStrip.tsx:756](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/DictationStrip.tsx:756)

   The AST walker should inspect `JSXSpreadAttribute` expressions and detect statically visible `title` properties through object, conditional and logical expressions. Add spread forms to the self-test.

   Also include `SourceLink` in both the type change and the component-forwarder guard. It declares and forwards `title` at [SourceLink.tsx:131](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/SourceLink.tsx:131) and [SourceLink.tsx:236](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/SourceLink.tsx:236), but Stage 2 names only `Button` and `Link` at [plan:115](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md:115).

   The `iframe` exception is correct and supported by W3C technique H64. [W3C iframe title guidance](https://www.w3.org/WAI/WCAG21/Techniques/html/H64.html). Make other exceptions site-specific rather than allowing an entire tag globally. Restrict the `<title>` check to SVG ancestry so a future React document `<title>` is not falsely rejected.

7. **Add tests for the migration’s invariants, not only the card’s happy path.**

   In addition to the plan’s tests, require:

   - existing `aria-describedby` is preserved and restored;
   - `data-tip-describes="off"` works;
   - an SVG element can anchor the card;
   - a statically spread `title` fails the guard;
   - `SourceLink title` is a compile error;
   - `[data-tip]` plus `Tooltip` ownership is rejected;
   - `[data-tip]` plus `[data-block-link]` is rejected;
   - nested interactive-card Escape closes one surface;
   - composing Escape closes none;
   - native-dialog Escape follows the existing priority;
   - the shadcn disabled `Button` case is checked in a real browser, since jsdom cannot expose CSS hit-testing;
   - the standalone cost report retains its hover label.

8. **Minor factual corrections to the plan.**

   - The direct JSX inventory is 168 lowercase-element `title` attributes plus two SVG `<title>` elements, not 170 host attributes plus two SVG titles. The spread-created titles sit outside that count.
   - “Every one … keyboard focus opens it” is false for non-focusable and disabled elements.
   - “The other `dangerouslySetInnerHTML` sites draw an article’s sanitised blocks” is too broad; for example, Design renders trusted specimen markup at [DesignPage.tsx:1394](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/DesignPage.tsx:1394). The security conclusion can remain, but the supporting sentence should say that every untrusted HTML sink is sanitised, not that every sink is article markup.
   - Paragraph splitting needs an explicit valid DOM shape: `TipNote` currently renders a `<span>` at [Tooltip.tsx:678](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/Tooltip.tsx:678), so it cannot simply contain `<p>` elements. Use block spans or introduce a separate block container.