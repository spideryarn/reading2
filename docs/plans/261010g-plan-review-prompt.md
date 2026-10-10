Review the plan docs/plans/261010g-guide-chat-at-the-top-of-the-command-bar-with-one-icon.md before it is built. Read-only.

Context: src/web/CommandBar.tsx (§ guideRow ~line 515, besideTheModes, the `shown` memo ~line 1950 and the row JSX ~line 2620), src/web/ChatPanel.tsx (GuideRow ~1250, the header h2 ~680), src/web/GuideGreeting.tsx, docs/project/icons.md, tests/command-bar-guide.test.tsx, tests/command-bar-guide-row.test.ts.

Questions:
1. Is pinning the guide row first only on an empty box right? Anything in the selection-keeping effect (previousReasonRows), the `firstOrdinary` rule, the suggestion heading/rule logic, or the pick/ask flow that this breaks?
2. Is making the free guide row the default (row zero, bare Enter) a problem compared with Suggest being row zero?
3. The name "Guide chat" and its description: clear to a new reader? Any collision with Help's guides, the "Ask the guide" row, or the argument parser (tests/command-match-arguments.test.ts collision matrix)?
4. Any place the guide is named on screen that the plan misses for the Compass?
5. Anything simpler.
Answer with numbered findings, each with severity and a concrete fix.
