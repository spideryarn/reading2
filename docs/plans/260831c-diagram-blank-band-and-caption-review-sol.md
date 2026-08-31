## Findings

1. **Medium — the Info “button” has no activation path.**  
   [DiagramPanel.tsx:1902](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1902), [Tooltip.tsx:168](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Tooltip.tsx:168), [styles.css:8425](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8425)

   `Tooltip` opens through hover or focus; `.diag-about` has no click handler, and the CSS explicitly says pressing it does nothing. Touch access therefore depends on browser-generated hover/focus behavior and is unreliable. It also exposes button semantics without a button action.

   Keep the `<button>`—an inert focusable span would be worse—but make click/tap toggle the card. `cursor: help` is appropriate once the control actually works.

   On keyboard focus, the counts exist both in the button name and in the tooltip description, so assistive technology may repeat them. The tooltip relationship is intentionally `aria-describedby`; its `what` paragraph duplicates the `aria-label`.

2. **Medium — “costs no height” is false under wrapping.**  
   [styles.css:8408](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8408), [DiagramPanel.tsx:1138](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1138), [diagram-panel-hover.test.tsx:889](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/diagram-panel-hover.test.tsx:889)

   `.diag-opts` has `flex-wrap: wrap`. `margin-left: auto` right-aligns the icon on whichever flex line it lands; it does not guarantee room on an existing line. At widths where Drift’s two `Choice` groups fit without the icon but not with it, the icon creates another line.

   The test only proves that `.diag-note` disappeared. It passes with the icon alone on a new row, so it does not prove its stated “costs no line” property.

3. **Medium — the live-region announcement is present in the DOM but not reliably triggered.**  
   [DiagramPanel.tsx:1163](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1163), [DiagramPanel.tsx:1916](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1916), [diagram-panel-hover.test.tsx:901](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/diagram-panel-hover.test.tsx:901)

   `ScatterNote` conditionally mounts a `role="status"` already containing its message. Live regions are reliable when the empty region exists first and its contents change later; injecting a populated `status` is not guaranteed to announce. The comment’s “spoken once” claim is therefore stronger than the code supports. [MDN’s live-region guidance](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions) states this explicitly.

   This was also a weakness of the old conditional `<p role="status">`, so it is not newly introduced by moving the caption. The test verifies markup, not an announcement or its timing, and cannot establish “only once” across Drift/Trail/Sketch transitions.

4. **Low — several comments and project docs are now false.**

   - [DiagramPanel.tsx:1150](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1150) says the words do not change. The one-paragraph case gained the new “There is a dot…” sentence at [DiagramPanel.tsx:1843](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1843).
   - [DiagramPanel.tsx:1822](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1822) still calls this “what the strip says.”
   - [DiagramPanel.tsx:536](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:536) claims cleanup may run after a replacement attachment. React documents cleanup of the previous ref before invoking the next ref callback. The identity guard is harmless, but its stated reason is unsupported. [React’s callback-ref contract](https://react.dev/reference/react-dom/components/common#ref-callback).
   - [diagram.md:994](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:994) and [diagram.md:1020](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:1020) still say the caveat and omitted count are in a visible strip.
   - The CSS and component comments claiming “no height at all” are false for the wrapping case above.

## Callback ref: fine

The actual working tree is safer than the pasted diff:

- Each attachment owns its own `ResizeObserver` and local `raf`; no handle is shared across attachments.
- The returned cleanup is the React 19 contract and is safe under StrictMode’s setup/cleanup/setup cycle.
- `disconnect()` and `cancelAnimationFrame()` are attachment-specific and cannot tear down the replacement.
- `scroller.current` is established before passive effects and conditionally cleared.
- `box` is synchronously remeasured when the scroller returns.
- Sketch makes `here` null; returning to a picture makes it non-null, so the follow-scroll effect reruns after attachment.
- The new `[kind]` effect clears `hover`, `roving`, and `hasFocus`. `collapsed` is constant.

I found no second `[]`-dependency effect reading a conditional ref in `DiagramPanel.tsx`. `SketchView.tsx` already uses callback refs, although its callbacks still use React’s older null-on-detach compatibility path.

## Tests

The targeted file passes: **26/26**.

The Sketch→Force test is real for the production regression and failed on the old implementation. It does not cover observer disconnect, resize delivery, animation-frame cancellation, or StrictMode, but those paths are sound by inspection.

All three caption tests can still pass with materially broken behavior:

- “costs no line” cannot detect wrapping or a broken tooltip.
- The live-region test cannot prove that assistive technology announces it, or that it announces only once over time.
- The accessible-name test passes if the tooltip never opens, has the wrong content, or the element is a no-op button.

There is no test that opens `.diag-about` and checks both card paragraphs, or activates it by click/tap.

## Postmortem

The cause and introducing commit `3897bc9` are correct. The prevention section needs tightening:

- [the postmortem:58](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/260831a-the-scroller-that-mounted-after-the-measure.md:58) says jsdom cannot see the bug, but the new jsdom test does reproduce it. The missing piece was the transition scenario, not jsdom itself.
- [the postmortem:69](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/260831a-the-scroller-that-mounted-after-the-measure.md:69) says the ref is called with `null`; the revised implementation returns a cleanup and therefore is not.
- [the postmortem:79](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/260831a-the-scroller-that-mounted-after-the-measure.md:79) overstates callback refs as the only answer. An effect keyed to the condition can be correct too; the real rule is that setup must follow the target node’s lifetime.
- A stronger class guard would exercise Sketch→picture→Sketch→picture and assert `observe`/`disconnect`, plus run that lifecycle under StrictMode.

