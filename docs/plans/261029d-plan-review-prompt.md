You are reviewing a plan before it is built, read-only. Repo: Spideryarn (an AI-assisted reading app). Read AGENTS.md (CLAUDE.md) briefly for house rules.

The plan: docs/plans/261029d-a-reminder-bar-at-the-top-and-add-a-selection-to-the-glossary.md

Read it, then read the code it names, at least:
- src/web/reader/Reader.tsx (showBar, bandCovers, selectProse, the TouchSelectionChip mount, the CommentDialog `fresh` construction, the `executor` built from readingExecutor, glossaryReady)
- src/web/TouchSelectionChip.tsx, src/web/CommentDialog.tsx (FreshBox, the Copy button)
- src/web/command-proposal.ts (resolveArgument, runProposal), src/web/command-runners.ts (glossaryRunners), src/web/glossary-ask-handoff.ts, src/web/GlossaryPanel.tsx (the hand-off take)
- src/web/scroll.ts (watchBarVisibility, stepBar, stickyDestination), src/web/styles/shell.css § the bar that leaves while you read, src/web/styles/narrow-window.css § a small device
- src/web/Masthead.tsx (facts line), src/web/ReadSoFarMark.tsx

Look for: anything that would make either feature silently do nothing or the wrong thing; paid model calls that could fire twice or without a press; interactions with the existing bars, safe-area insets, the band, Marginalia's fixed head, the keyboard; a11y; anything in the plan that is wrong about the code; a materially simpler design. Rank findings P0-P3, each with file:line evidence and a concrete fix. Do not edit any file. Write your answer as your final message.
