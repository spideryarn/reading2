Review this small plan before it is built (read-only). Repo: spideryarn2. Plan:
docs/plans/260929f-mode-bar-regroup-glossary-ideas-timeline-with-trajectory-search-with-chat.md
It follows docs/plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md.

Read src/web/Dock.tsx (ModeGroup, MODES_UI and its row comments, groupStarts, visibleModes), src/mode-catalog.ts (which modes are experimental), tests/dock-mode-order.test.ts, and grep tests/ and docs/ for anything else that depends on the bar's order or on the group names `passages`, `dimensions`, `talk`.

Questions:
1. Is the reading of Greg's sentence right — especially where Glossary/Ideas/Timeline sit inside Trajectory's run, and where Search sits inside Chat's? Say if another placement is clearly better supported by his words.
2. Is renaming the groups (passages+dimensions -> contents, talk -> ask) worth it, and are the names right?
3. Anything else that asserts the old order or the old group names and would go red or go stale?
4. Is the switch-off bar in the plan correct given the experimental flags?

Be concrete: file:line. Rank by severity.
