Review the plan at docs/plans/261004h-metadata-page-bottom-bar-draws-the-same-frames-as-the-reading-view.md before it is built. Read-only.

Relevant code: src/web/Dock.tsx (DockModes, MarginToggle, DockModeLinks, DockLink, groupStarts, fitSignature, hasQuickSearch, the Dock's own return around "mode !== undefined && onMode"), src/web/Metadata.tsx (the Dock mount near the end of the page component), src/web/styles/dock-fit.css (the mode switch, .dock-frame, lines between runs, the fit ladder rungs 2-4 and the .always exception), src/web/styles/narrow-window.css (coarse pointer: .dock-modes and .dock > .dock-btn flex), src/web/styles/dock.css, src/web/dock-fit.ts, tests/dock-fit.test.ts, tests/dock-mode-tooltips.test.tsx, tests/a-second-press-closes-the-mode.test.tsx. Any other mount site of Dock that takes the links arm (a visitor, a fixture) counts too: find them.

Questions:
1. Is the diagnosis right and complete? Is there any other visible difference between the two bars for a signed-in owner that the plan's table misses?
2. Is wrapping links in .dock-modes / .dock-frame sound: does any existing CSS rule under .dock-modes assume a button or a radio (the .on fill, focus ring, coarse-pointer flex, dock-group-start, border-radius, the .always label exception and its specificity tie), and does anything select `.dock-modes` in JS or a test in a way that would now also match the Metadata page wrongly?
3. Is dropping the `dock-mode` class and its three selectors safe, or does something else key on it (dock-fit.ts measurement, mode-catalog.ts, a test)?
4. ARIA: links in plain div frames, no radiogroup. Right, or should the row carry a role/label?
5. Is the quick-search box rightly deferred, and are options A/B/C described truthfully against DockQuickSearch.tsx and search-draft.ts?
6. Anything simpler?

Give findings as P0/P1/P2 with file:line evidence, then a one-line verdict (BUILD / BUILD WITH CHANGES / DO NOT BUILD).
