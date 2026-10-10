Six established P1 findings, all fixed with regressions observed failing first. No commit made. The verdict applies with these worktree fixes.

1. **CR-1 — P1, established: conflicting origin accepted inside the transaction.**  
   **Reproduce:** Create a thread through `withTurn`, then call it again with that ID and a different origin—or an origin when the existing thread has none. The second call previously appended messages.  
   **Fix:** Check origin equality against the database-locked thread snapshot before writing. Reproduced in `chat-origin-transaction.test.ts`; the actual cross-process database race was not run.

2. **CR-2 — P1, established: a refused draft invents a server thread’s origin.**  
   **Reproduce:** Submit a claim draft whose ID collides with a plain thread; receive 409, leave Chat, and return with that plain thread loaded. It previously displayed Debate’s origin.  
   **Fix:** Carry stored origin in `begin`; render only server metadata and clear confirmed pending origins.

3. **CR-3 — P1, established: a late answer leaves the claim mark absent.**  
   **Reproduce:** Hold the first POST, return to Debate while its departure refresh finds no thread, then release the answer. No mark appeared.  
   **Fix:** Refresh from controller completion, including after composer unmount and recovery. Ignore callbacks for departed articles.

4. **CR-4 — P1, established: emptying the seeded text loses the pending origin on return.**  
   **Reproduce:** Clear the claim’s draft, leave Chat, and return. Restoration previously required nonblank text.  
   **Fix:** Restore drafts carrying either words or a pending origin.

5. **CR-5 — P1, established: failed first Send resumes an unrelated plain draft.**  
   **Reproduce:** Return 500 for the first Send, leave Chat, then return with an empty server thread list. Chat previously created another ID without the origin.  
   **Fix:** Resume the original unconfirmed ID, preserving its origin and possible stored history.

6. **CR-6 — P1, established: corrected thread ID is lost after unmount.**  
   **Reproduce:** Leave Chat before `begin`, then acknowledge the turn with a different thread ID. The guessed ID retained its pending origin.  
   **Fix:** Separate durable draft acknowledgement from detachable navigation; move draft bookkeeping to the confirmed ID and clear its pending origin.

Validation: **248 tests passed across 13 offline suites**. The typecheck script passed via `node --import tsx scripts/typecheck.ts`; migration-chain and diff checks passed. Lint exited successfully with warnings and complexity notices. Database integration and browser keyboard behaviour remain unverified here.

Changed files:

- [src/chat.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/chat.ts)
- [src/routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/routes.ts)
- [src/web/ChatDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/ChatDialog.tsx)
- [src/web/chat-draft.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/chat-draft.ts)
- [src/web/chat/controller.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/chat/controller.ts)
- [src/web/chat/model.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/chat/model.ts)
- [src/web/modes/conversation/ConversationModes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/modes/conversation/ConversationModes.tsx)
- [src/web/reader/Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/reader/Reader.tsx)
- [src/web/useChat.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/useChat.ts)
- [src/web/useChatAnchors.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/useChatAnchors.ts)
- [tests/chat-anchors-refresh.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-anchors-refresh.test.tsx)
- [tests/chat-controller-notifies-once-per-task.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-controller-notifies-once-per-task.test.ts)
- [tests/chat-origin-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-origin-route.test.ts)
- [tests/chat-origin-transaction.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-origin-transaction.test.ts)
- [tests/conversation-band-origin.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/conversation-band-origin.test.tsx)
- [tests/debate-check-claim-in-chat.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/sources-claim-check-in-chat.test.tsx)
- [docs/project/debate.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/project/reception.md)
- [docs/postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md)
- [docs/postmortems/261005i-a-pending-origin-is-mistaken-for-an-acknowledged-thread-origin.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/postmortems/261005i-a-pending-origin-is-mistaken-for-an-acknowledged-thread-origin.md)
- [docs/postmortems/261005j-a-stream-outlives-the-component-that-would-refresh-its-result.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/postmortems/261005j-a-stream-outlives-the-component-that-would-refresh-its-result.md)
- [docs/postmortems/261005k-restoring-words-discards-a-draft-whose-origin-survives-empty-text.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/postmortems/261005k-restoring-words-discards-a-draft-whose-origin-survives-empty-text.md)
- [docs/postmortems/261005l-a-failed-submission-hides-a-pending-origin-behind-a-missing-local-thread.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/postmortems/261005l-a-failed-submission-hides-a-pending-origin-behind-a-missing-local-thread.md)
- [docs/postmortems/261005m-detaching-navigation-also-detaches-draft-confirmation.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/postmortems/261005m-detaching-navigation-also-detaches-draft-confirmation.md)

land