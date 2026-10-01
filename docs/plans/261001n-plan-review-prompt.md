Review the plan docs/plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md before it is built. Read-only.

Read the code it names: src/web/TrajectoryPanel.tsx (row rendering ~line 670-700), src/web/BlockRef.tsx, src/web/BlockLinkCard.tsx, src/web/useReadingTime.ts (rowsOnScreen, freshRows), src/web/reading-time.ts (firstOnScreen, gutterCss, SAFE_ID), src/web/ReadingTimeStyle.tsx, src/web/useColumnContext.ts, src/web/scroll.ts (stickyOffset), src/web/reader/Reader.tsx (bandOverProse, ~line 505-560, and where ReadingTimeStyle is mounted ~2487), src/web/ModeSurface.tsx, src/web/styles/prose.css (.block-ref).

Questions:
1. Is the 8K design right — one style element keyed on data-block-link, scoped to .mode-band, sampled on window scroll? Will it be wrong anywhere: bands that are not .mode-band (Chat dialog, Annotations marginalia, Structure), block links whose element is not an <a> with that attribute, modes whose band scrolls the prose differently, the prose not scrolling on window, band-away state, Tweets/Summary specifically?
2. Is the enabled gate (bandOpen && !bandOverProse) right?
3. Performance on a 2000-block article: anything that forces layout per frame?
4. Any simpler design that is as good?
5. Is 8J's reorder correct, and does anything else (styles, voices.css, tests) depend on the order?

Give findings as P0/P1/P2 with file:line evidence, and a verdict.
