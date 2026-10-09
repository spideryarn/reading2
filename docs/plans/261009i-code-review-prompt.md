Code review of commit 86f0ef224 in this worktree (Spideryarn), plan docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md (read its "After the plan review" section: your own plan review is docs/plans/261009i-plan-review-sol.md, and the plan says how each finding was taken, including where it disagreed). The diff is docs/plans/261009i-code-review.diff (against 4da94b0e, the dev it branched from). Read CLAUDE.md first.

You may FIX what you find, inside this stage's scope: edit the files, add or adjust tests, and run the relevant suites (npx vitest run <files>) and npm run typecheck. Do not commit, push, deploy, touch .env.local, or write to any remote database. Do not edit a defence listed in docs/project/security-map.md § Where the defences physically live; if a fix would need that, report it instead. Anything wider than this stage: report it, do not build it.

Look hardest at:
1. Live in the guide: the kind threaded from ConversationModes (kindOf) through useLiveConversation/useGptLive (sessionKind fixed at start) to the ticket/session bodies and /live-tool; liveKind in src/routes.ts (stored kind wins, mismatch 409 before minting); runTool getting kind only for guide; SpokenKind now including guide (withSpokenTurn, targetOf, the reducer's spoken kind). Any path where a guide session still runs tools outside GUIDE_TOOLS, gets the companion prompt, or a spoken turn lands in a second guide? Reconnect/resume paths that call start again?
2. withoutCommandButtons in the live seed (src/command-token.ts, src/live.ts): correct, and does it change chat/learn seeds acceptably?
3. The greeting (src/web/guide-greeting.ts, GuideGreeting.tsx, ChatPanel Conversation wiring): greetsHere useRef semantics under StrictMode, remounts (keyed by thread id), live tail; GuideKeepReason's race handling (storedPurpose before save, busy lock, lost reply); usePurpose(null).
4. The Guide command row (CommandBar guideRow, executor.openGuide, Reader openTheGuide via ?guide=1 + showBand) and the regenerated catalogue.
5. GUIDE_SYSTEM's new greeting paragraph (src/converse.ts) and SPOKEN_GUIDE (src/live.ts): plain, accurate about what the greeting says, nothing that contradicts other rules in those prompts.
6. normaliseProfileText moved to src/types.ts with re-export from src/profile.ts.

Write your findings, with a verdict line first (land / land with fixes / do not land), then numbered findings (P1/P2/P3) with file:line, and for each whether you FIXED it (and how) or are REPORTING it. List the tests you ran and their result.
