Review the plan docs/plans/261011m-guide-suggests-a-mode-with-a-button-a-bigger-chat-box-suggestions-centred.md in this repo (Spideryarn). Read it, then the code it names: src/web/guide-acts.ts, src/acts-alone.ts, src/web/CommandChip.tsx, src/web/GuideNextSteps.tsx, src/web/ChatPanel.tsx (useGuideAct uses, Composer, boxSize), src/web/chat/controller.ts (Answered/onAnswered), src/web/chat/model.ts and reduce.ts (opensFree), src/routes.ts (guideMade, MADE_READS, opensFree on done), src/guide.ts (modeWordsSection, madeLine, button()), src/mode-catalog.ts offeredBehindTheSwitch, src/web/styles/mode-band.css and chat-actions.css (.chat-composer, .chat-input, .chat-suggest), docs/project/security-map.md row on chat-commands.ts.

Questions:
1. Is deleting the act machinery complete as listed? Anything else that depends on it (Answered event, openModeUnarmed, acts-alone used elsewhere, live guide, MCP, tests) that the plan misses or that must NOT be deleted?
2. Is the security reasoning right (removing the exception narrows the defence; nothing in chipFor changes)?
3. Prompt change: anything else in src/guide.ts or the spoken guide that tells the model it opens things?
4. Stage 2 UI: risks in 2-row composer on phones / short bands, ChatDialog block chat in a card, centring the .chat-suggest column (GuideSaveOffer and guide-offer also use chat-suggest-btn; search step box in next steps).
Read-only. Write findings numbered F1.. with severity, file:line evidence, and a one-line verdict at the end ("VERDICT: build as planned" / "build with changes" / "rethink").
