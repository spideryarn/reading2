Review this plan doc before it is built (read-only). Repo: spideryarn2 (the reading app). Plan:
docs/plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md

Read the relevant code: src/web/Dock.tsx (MODES_UI, visibleModes, fitSignature, DockModes, DockModeLinks, DockExperimentalSwitch, SWITCH_STATE, PRESS), src/mode-catalog.ts, src/web/styles/dock-fit.css, src/web/styles/dock.css, src/web/BlockGutter.tsx, src/web/styles/gutter.css (§ reading time and the slot/container-query rules), src/web/reading-time.ts gutterCss, tests/dock-experimental-modes.test.tsx, tests/public-network-trace.test.tsx, docs/project/new-mode.md § Moving a mode in or out of the switch.

Questions I most want answered:
1. Is my reading of Greg's reorder instructions sound? Especially "Move FAQ and Search a little bit further left". Propose a better order if you see one.
2. Does "remove hairlines inside a group, keep them between groups" break anything (dock-fit measurement, selected-state look, the `+` selector with Tooltip wrappers, loose links arm)?
3. The reading-time hover strip: will a span with width calc(min(1, var(--read,0)) * 8px) placed at the gutter's right edge overlap icons or prose, get clipped, or steal clicks? Is `min()` with a unitless custom property valid in calc here? Better simple alternative?
4. The mini switch inside the experimental button: any a11y or fit-ladder problem?
5. Anything missed when moving Diagram behind the switch (activation, visitor POLICY, command bar, tests, docs).

Be concrete: file:line, and what would go wrong. Rank findings by severity.
