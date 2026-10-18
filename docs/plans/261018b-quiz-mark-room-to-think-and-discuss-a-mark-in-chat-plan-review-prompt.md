You are reviewing a plan in the Spideryarn repo (this worktree). Read-only review.

Plan: docs/plans/261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md

Read the plan, then the code it touches: src/quiz-mark.ts (MARK_MAX_TOKENS, the cut-off handling),
src/ai-call.ts (CHAT_REASONING, outgoing, warnIfThinkingAteTheCeiling), src/web/chat-handoff.ts
(fencedQuote, askAboutSummaryParagraph), src/web/QuizPanel.tsx (Mark, the .quiz-step row),
src/web/modes/conversation/ConversationModes.tsx (LearnBand, QuizSubBand), src/web/reader/Reader.tsx
(handToChat, askAboutSummary), src/routes.ts (MAX_QUESTION_CHARS, the chat route's caps), and
docs/project/chat-from-a-mode.md, docs/project/quiz.md.

Questions:
1. Is the root cause right (thinking tokens counted in max_tokens on Sonnet 5.5)? Is 4,000 sensible, or
   should effort be set instead? Any timeout/stall interaction we miss?
2. For the hand-off: will a "wait" handoff from Learn mode (?mode=learn&learn=quiz) to Chat work —
   showBand("chat"), the useEffect that clears the handoff when mode != chat, ?learn= lingering? Will a
   seed of up to ~3,500 chars plus the reader's text fit through every cap on the way (composer, route,
   stored message, title generation)? Any cap smaller than 4,000 we missed?
3. Security / privacy: anything about quoting model text and the reader's answer into a chat message.
4. Simpler or better shape we missed?

Write findings as a numbered list, each with severity (high/medium/low), file:line evidence, and the
fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
