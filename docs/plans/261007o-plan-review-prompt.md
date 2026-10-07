You are reviewing a short implementation plan, read-only. Repo: this worktree (Spideryarn, TypeScript/React).

Plan: docs/plans/261007o-the-guide-acts-without-a-press-and-opens-every-new-article.md (untracked file in the worktree).
Background plan it extends: docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md.

Key code to read: src/web/command-proposal.ts (RISK, proposalRisk), src/web/chat-commands.ts (chipFor), src/web/CommandChip.tsx, src/web/Cited.tsx (cited(), how chips are drawn), src/web/ChatPanel.tsx (Conversation, Answer, Turn), src/web/useChat.ts (message status lifecycle), src/web/command-runners.ts (modeDoor, chatExecutor), src/guide.ts (modeWordsSection), src/converse.ts (GUIDE_SYSTEM), src/web/first-open-purpose.ts, src/web/last-view.ts (firstOpenSearch, useLastView), src/web/PurposePrompt.tsx, src/web/activation.ts (MODE_TARGET, modeGenerates, subModeGenerates), docs/project/security-map.md (chat-commands row).

Questions:
1. Security: is "act only on proposalRisk === navigate, in a guide thread, on an answer seen to finish on screen, first eligible chip only" a sound line given an article may contain a planted instruction? Any navigate-classified proposal that actually spends, writes, or leaves the article (e.g. a mode whose band spends on mount but modeGenerates says false; find opening Search; Chat mode; Learn sub-modes)? Check MODE_TARGET/subModeGenerates against what each band does on mount.
2. Is the "pending then done observed in this mount" trigger correct given useChat's provisional-id swap at the begin frame, recovery of pending rows, retry, edit, stop, and the dialog vs band surfaces? Is the effect-from-chip design (claim object via context) sound under StrictMode and React effect ordering?
3. Item 2: is shrinking first-open-purpose.ts as described correct? Any race or case (failed read, account change, link with state, metadata view) that the current coordinator handles and the shrunk one would get wrong?
4. Anything simpler that gets the same result, or anything the plan misses (docs, tests, the help page, privacy).

Output: a verdict (build / build with changes / rethink), then findings with ids F1.., each with severity P0-P3, evidence (file:line), and the change you recommend. Be concise.
