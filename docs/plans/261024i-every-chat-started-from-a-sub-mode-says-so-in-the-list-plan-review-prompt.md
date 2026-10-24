Review this plan before it is built: docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md (read-only review; do not edit files).

Context to read: docs/project/chat-from-a-mode.md (the 12-step checklist for a new origin), src/web/thread-source.ts, src/web/ChatPanel.tsx (§ the thread list near `threadSource(t)`, `OriginBack`, `ThreadSourceMark`), src/types.ts § ThreadOrigin, src/thread-origin.ts, src/web/QuizPanel.tsx (§ onDiscuss), src/web/reader/Reader.tsx (§ handToChat, lensInChat, reopenItemChat, openOrigin, discussQuizMarkInChat), src/web/OriginChat.tsx, src/web/useChatAnchors.ts, docs/project/quiz.md, docs/plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md.

Questions:
1. Is the diagnosis right — that the only missing piece for Investigate is words in Chat's list? Anything else Greg could have meant by "annotated" / "see it again within investigate" that the current code does not do?
2. Stage 1: is `originPlace` the right generalisation; any place where a sub-mode's chats are already named that should share it?
3. Stage 2: is a Quiz origin worth it, and is the design (fresh chat each press, mark beside the button, pending origin on a waiting draft, way back opens Quiz only) sound? Does a waiting draft with an origin actually persist the origin when sent (check ConversationBand / pendingOrigin)? Any trap in the checklist steps for an id-shaped origin whose ids are minted per batch?
4. Anything simpler that covers Greg's words.

Give numbered findings (F1…), each with severity (blocker / should-fix / nit), evidence (file:line), and a concrete change. End with a verdict: build as is / revise before build.
