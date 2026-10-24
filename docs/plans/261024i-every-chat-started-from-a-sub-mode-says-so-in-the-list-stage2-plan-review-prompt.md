Review the plan section "## Stage 2, rewritten after Greg chose B" in
docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md, before it is built.
Your own earlier review of the first draft is
docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list-plan-review-sol.md (F1, F2, F5
are what this rewrite answers). Greg's choice and the options he chose between are in
docs/user-feedback/questions/q-nvxfwx.md. The house recipe is docs/project/chat-from-a-mode.md
§ Adding it to another mode.

Read the code it touches: src/types.ts (ThreadOrigin, sameOrigin, ORIGIN_MODES, Quiz, QuizKeptAnswer),
src/thread-origin.ts, src/db/schema.ts (chat_threads CHECKs and FKs; quiz_attempts),
src/store/pg-quiz-attempts.ts, src/store/pg-chat.ts, src/routes.ts (parseOrigin, the quiz mark route's
done frame), src/admin-articles.ts READER_STATE and src/store/pg-article-transfer.ts,
src/web/useQuiz.ts, src/web/QuizPanel.tsx (QuizArrival, the Discuss button), src/web/reader/Reader.tsx
(handToChat, reopenItemChat, openOrigin, openQuizAt), src/web/thread-source.ts, src/web/ChatPanel.tsx
(how source.learn routes a row), src/web/OriginChat.tsx, src/web/useChatAnchors.ts.

Questions I most want answered:
1. Is the composite FK (article_id, origin_attempt_id, origin_batch_id, origin_item_id) ->
   quiz_attempts(article_id, id, batch_id, question_id) sound in Postgres with NO ACTION, given
   article-delete cascades and the transfer's delete order? Any path that deletes quiz_attempts
   without its threads (tests, scripts, a db reset, the seeder)? Is it worth it vs. a simple FK or none?
2. Is "one chat per mark (attempt)" consistent with how reopenItemChat/handedItemChats and the waiting
   (not-sent) handoff behave? Any way a second press makes a second chat or reopens the wrong one?
3. Does anything break when a chat-kind thread's threadSource says from "learn" (filters, the Learn chip,
   row opening, listedInChat, the Learn conversation pinned rows)?
4. Anything in the 12-step recipe the plan misses.

Output: numbered findings, each with severity (blocker / should-fix / nit), evidence (file:line), and a
concrete change. Then a verdict. Do not edit any files.
