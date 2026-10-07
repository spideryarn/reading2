Code review of plan 261008a, built. You may edit files to fix what you find inside this stage; report anything wider for me to decide. Do not commit, do not run git commands that change the index or the working tree, and do not run `npm run deploy` or anything against a remote database.

Read first: docs/plans/261008a-guide-opens-glossary-and-summary-when-already-made.md (especially "After the plan review", which overrides the earlier sections), docs/plans/261008a-plan-review-sol.md (your own plan review), and docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md for the machinery this extends.

The diff is docs/plans/261008a-code-review.diff (against dev's HEAD). Key files: src/acts-alone.ts, src/guide.ts (madeLine), src/converse.ts (made in buildConverseMessages and converse), src/routes.ts (guideMade, MADE_READS, the done frame's opensFree), src/web/chat/{model,reduce,controller}.ts (TurnDone.opensFree, stripped from the message, Answered.opensFree), src/web/guide-acts.ts (GuideAct.made, actsAlone), src/web/CommandChip.tsx (the act opens unarmed), src/web/command-runners.ts and command-proposal.ts (modeDoor's unarmed pair, openModeUnarmed, chatExecutor passing it through), src/web/reader/Reader.tsx (the second activators with arms false). Tests: tests/guide-acts-*.test.*, tests/guide-kind.test.ts, tests/guide-route.test.ts, tests/command-runners.test.ts.

Check especially:
1. Can a guide act ever arm or start a paid run now — any path where the act still goes through runners.mode, or where the unarmed activators still arm (Dock.tsx useActivateMode / useActivateSubMode with arms=false; Learn's returnToSubMode; Diagram; Marginalia)? Any band among glossary / summary brief / fuller that spends on mount regardless?
2. Does the model's sentence agree with the act: the static prompt sentence in modeWordsSection, madeLine names matching the rows' printed names, the keys in opensFree matching the chip target keys (`submode:summary:brief` etc. as chipFor resolves them)?
3. Does opensFree stay off the stored message and the client's ChatMessage on every path (send, retry, edit; recovery never carries it)?
4. Is the route's extra store read per guide turn sound (errors, logging nothing sensitive, ordering vs the existing awaits)?
5. Stale comments or docs left untrue anywhere (chat-tools.md, security-map.md's chat-commands row, help page src/web/help/pages/modes/chat.md, the comments in guide-acts.ts / CommandChip.tsx / acts-alone.ts).

Run `npm run typecheck` and the touched test files (`npx vitest run tests/guide-*.test.* tests/command-runners.test.ts`) after any edit. Report findings with severity P0-P3, what you changed for each, and a verdict (land / land with your fixes / do not land).
