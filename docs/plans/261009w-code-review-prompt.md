You are reviewing built code in the Spideryarn repo, in this worktree. You MAY fix what you find inside this change (the files in the diff), then report; anything wider than this change, report only and do not edit. Do not commit, do not touch git state, do not run the paid eval (evals/guide/referee-offer.ts costs money).

Read first:
1. docs/plans/261009w-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md — the plan, your own earlier plan review in docs/plans/261009w-plan-review-sol.md, and how each finding was handled.
2. docs/plans/261009w-code-review.diff — the scoped diff against origin/dev (src, tests, the eval). The merge brought in another plan's work (the guide's "next steps", docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md, src/next-steps.ts, src/web/GuideNextSteps.tsx); this change had to integrate with it via guideModeKeys and ChatCommandsFor.
3. Results: evals/guide/results/referee-offer-v2-merged.json and docs/investigations/261009d-the-guide-offers-referee-to-referees-measured.md.

Check especially:
- Is Referee truly unreachable through ordinary Chat chips, the command bar, the Dock, and visitors with the switch off, while working in a guide thread (chips AND next-step buttons)? Trace CommandChip/GuideNextSteps → useChatCommands → ChatCommandsFor → CommandExecutor.guide → withModeDoor → modeDoor → activators. Is there any other surface that renders guide answers (e.g. a chat dialog, GuideGreeting, a live/spoken guide transcript, the Metadata page) outside the Conversation wrapper and so silently gets chat's door?
- Does `modeActsAlone` now returning false for Referee keys break anything else that reads it (OPENS_FREE_ONCE_MADE, keysOpenFree, madeLine, routes' guideMade)?
- useMemo dependencies in Reader.tsx (chipModes now an object; chatCommands depends on it) — any identity churn that re-renders every chip or re-fires a guide act?
- guideDoorRows dedupe and sub-mode coverage; subModeRows(…, true, …) for Learn/Diagram current-state arguments.
- offeredBehindTheSwitch key parsing and the prototype guard.
- Prompt wording in src/guide.ts and src/mode-catalog.ts (OFFERED_BEHIND_THE_SWITCH.audience/guidance): injection resistance, and whether the long parenthetical on Referee's line reads well to the model.
- Tests: do they fail for the right reasons; anything important not pinned?

Run `npm run typecheck` and `npx vitest run tests/guide-offers-behind-the-switch.test.ts tests/guide-offers-behind-the-switch-door.test.tsx tests/chat-command-chips-prompt.test.ts tests/guide-kind.test.ts` after any fix (the box is loaded: do not run the full suite).

Write findings as a numbered list, each with severity (P0–P3), evidence (file:line), and either "fixed: <what>" or "not fixed: <why / what Greg or the author must decide>". End with a one-line verdict.
