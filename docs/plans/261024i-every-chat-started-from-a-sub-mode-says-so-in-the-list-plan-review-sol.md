F1 — blocker — A Quiz origin cannot be identified by `questionId` alone.

Evidence: the plan proposes `{ mode: "quiz"; itemId: QuizQuestionId; quote }` ([plan:86](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:86)), but Quiz explicitly mints question IDs per batch ([types.ts:6149](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/types.ts:6149)), and the existing code warns that a replacement batch can reuse an ID for a different question ([useQuiz.ts:582](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/useQuiz.ts:582)). The existing `QuizArrival` already carries both `batchId` and `questionId` for exactly this reason ([QuizPanel.tsx:142](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/QuizPanel.tsx:142)).

Concrete change: define Quiz identity as at least `{ mode: "quiz"; batchId; questionId; quote }`. Persist both IDs—preferably with an `origin_batch_id` column—and test that identical question IDs in two batches are different origins. Do not simply add Quiz to the existing item-origin `describe.each` tables.

The way back can then be better than the plan claims: set `quizArrival = { batchId, questionId }` and navigate atomically to Learn › Quiz. If the batch is still current, it lands on the exact question without putting it in the URL; if not, `QuizArrival` already safely ignores it and Quiz opens normally. Revise [plan:102](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:102) accordingly.

F2 — should-fix — “Fresh chat per mark” conflicts with a question-level mark in Quiz.

Evidence: the plan correctly says repeated answers produce different marks and therefore deserve fresh chats ([plan:91](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:91)), but proposes one `OriginChatMark` selected by question identity ([plan:96](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:96)). Quiz attempts are append-only ([pg-quiz-attempts.ts:6](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/store/pg-quiz-attempts.ts:6)), while `threadForOrigin` returns only the newest matching conversation ([useChatAnchors.ts:323](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/useChatAnchors.ts:323)). After answering again, the visible mark could therefore reopen a discussion about an older answer and older model mark.

Concrete change: choose and document one meaning:

- Exact-mark provenance: expose the quiz attempt’s UUID and include it in `QuizOrigin`; show the chat mark only on that attempt.
- Question-level provenance: explicitly call it “the newest chat about this question,” accepting that it may concern an earlier answer.
- Simplest first version: store the Quiz origin for Chat’s list and way back, but defer the inline Quiz mark until attempt identity is available.

F3 — should-fix — The plan still does not cover “every chat started from a sub-mode.”

Evidence: its own table identifies Summary › Brief/Fuller as another sub-mode that starts an unannotated chat ([plan:41](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:41)), but Stage 2 then calls Quiz “the one sub-mode” with this problem ([plan:81](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:81)). Summary’s sender is indeed another waiting, originless handoff ([Reader.tsx:1187](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/reader/Reader.tsx:1187)).

Concrete change: either include Summary after its pending product decision, or narrow the plan’s title and claim. My recommendation is to split the work: ship Stage 1 as the direct response to this feedback, then handle Quiz and Summary provenance separately. That is the simpler change that fully covers what Greg actually encountered.

F4 — should-fix — `originPlace` is the right concept, but its proposed shape should reuse the existing sub-mode model.

Evidence: the current implementation’s `OriginPlace` only permits Sources views ([thread-source.ts:137](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/thread-source.ts:137)), and `OriginBackWords.view` is likewise `SourcesView` only ([thread-source.ts:255](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/thread-source.ts:255)). Quiz immediately requires Learn › Quiz. The codebase already has the correct discriminated `SubMode` type and common `subModeWords` lookup ([sub-modes.ts:35](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/sub-modes.ts:35), [sub-modes.ts:334](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/sub-modes.ts:334)).

Concrete change: represent the optional child as `SubMode` and obtain its label through `subModeWords`; do not widen an uncorrelated `{ mode, view? }` pair. `threadSource`, its tooltip, the meta label, and `originBack` should share this. `titleFromOrigin` should remain separate because it names the conversation’s subject, not its destination.

F5 — should-fix — The proposed Quiz mark placement will not fit the existing controls row.

Evidence: the plan puts `OriginChatMark` next to the Discuss button ([plan:96](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/docs/plans/261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list.md:96)). That component is a full-width line with a gist ([origin-chat.css:15](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/styles/origin-chat.css:15)), while `.quiz-step` is a non-wrapping flex row ([quiz.css:245](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/styles/quiz.css:245)). Four icons only just passed the previous 390px browser check.

Concrete change: place the mark on its own full-width line below the icon row, or explicitly make it a wrapping full-basis child. Add the 390px layout to the rendered/browser checks.

The Investigate diagnosis itself is right. Its lens origin is stored, `Your questions` lists every such chat ([InvestigatePanel.tsx:413](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/InvestigatePanel.tsx:413)), and arriving reopens the newest one ([InvestigatePanel.tsx:284](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/InvestigatePanel.tsx:284)). For that report, visible words in Chat’s list are the missing piece; I found no second unimplemented meaning of “annotated” or “see it again.”

A waiting draft does preserve its origin when eventually sent: the handoff stores the origin before the draft ([ConversationModes.tsx:1014](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/modes/conversation/ConversationModes.tsx:1014)), `pendingOrigin` retains it until the server knows the thread ([ConversationModes.tsx:711](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/modes/conversation/ConversationModes.tsx:711)), and `sendTo` includes it in the request ([ConversationModes.tsx:1290](/var/tmp/spideryarn-worktrees/fbtwsm7t-investigate-chat-origin/src/web/modes/conversation/ConversationModes.tsx:1290)).

Verdict: **revise before build**. Stage 1 is sound; Stage 2 needs batch-aware identity, a clearer mark-versus-question decision, and corrected placement/navigation. No files were edited.