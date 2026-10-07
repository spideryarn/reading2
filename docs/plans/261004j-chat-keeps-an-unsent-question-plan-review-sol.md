The plan needs changes before implementation. I found five established P1 gaps in the proposed behavior. No repository files changed.

The two central explanations under “Why it is lost today” are accurate: `ChatPanel`’s refs disappear on unmount, and a new `useChat` mount creates a new controller without the previous empty conversations. However, “`?thread=` keeps its id” needs qualification, and “for a stored conversation, fixing 1 is the whole fix” is incorrect.

1. **F1 — P1, established: `loaded` does not prove that a conversation is absent.**

   Type a follow-up draft in stored chat A, switch mode, then return while its list GET fails. `loaded` becomes true, but the new controller has no conversations. The proposed orphan rule therefore moves A’s draft into fresh chat B. Sending it creates another conversation without A’s history.

   Evidence: [`useChat.ts:966`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/useChat.ts:966) explicitly includes failed loads; [`reduce.ts:1223`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/chat/reduce.ts:1223) sets that failure state.

   **Smallest fix:** require `loaded && !loadFailed` before absence-based recovery. Leave the retained draft untouched on failure.

2. **F2 — P1, established: an unrelated orphan overrides the conversation—or list—the reader left.**

   Start empty chat B, type a draft, close it, then open stored chat A and type another draft. Switch mode and return. B is the only orphan, so the proposed rule starts a new conversation with B’s words, replacing the valid selection of A.

   Similarly, type in the list box while B exists, switch away, and return: recovery opens B instead of showing the retained list draft. Neither scenario requires multiple orphans, so the deliberate exclusion does not cover it.

   Evidence: [`ChatPanel.tsx:483`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatPanel.tsx:483) preserves empty conversations containing text; [`ConversationModes.tsx:488`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:488) otherwise selects Chat through `?thread=`. The proposed rule explicitly falls back to any most recently written orphan.

   **Smallest fix:** retain the last Chat destination, including an explicit “list” destination. Recover the selected missing conversation; do not let an unrelated orphan override a valid selection or the list.

3. **F3 — P1, established: retaining a stored draft does not restore it after visiting Remember.**

   Type in stored chat A, enter Recall, then return to Chat using the bar or command bar. Recall replaces `?thread=A` with its own conversation id. Chat filters that conversation out and shows its list. A is loaded, so it is not an orphan; nothing in the plan reopens its composer. Quiz similarly clears `thread`.

   Evidence: [`ConversationModes.tsx:492`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:492) replaces the address with Remember’s id; [`ConversationModes.tsx:139`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:139) clears it for Quiz; [`Reader.tsx:455`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/reader/Reader.tsx:455) changes only the mode on ordinary return.

   **Smallest fix:** preserve Chat’s selected destination independently of Remember’s use of `?thread=`. Add actual Chat → Recall/Quiz → Chat tests, rather than only unmount/remount tests with the original URL retained.

4. **F4 — P1, established: Remember cannot recover an orphan by blindly minting another conversation.**

   Type in never-sent Recall A, leave, and have another tab create the stored Recall conversation B. On return, A is an orphan. Starting C and moving A’s words to it cannot recover the draft: `oneRemember` chooses B because it has messages, and the cleanup effect discards empty C. The same applies to Tutorial and Explore.

   Evidence: [`ConversationModes.tsx:332`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:332) prefers conversations with messages; [`ConversationModes.tsx:500`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:500) discards losing empty conversations. Remember’s selection ignores the id written by `startNew()`.

   **Smallest fix:** retain one draft per Remember kind and supply it to that kind’s selected conversation, creating a conversation only when none exists. Resolve the initial draft before mounting the composer: [`ChatPanel.tsx:2213`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatPanel.tsx:2213) reads its seed only once.

5. **F5 — P1, established: `ChatDialog` is part of these transitions and deletion paths.**

   The exclusion’s lifecycle claim is false. Entering Chat or Remember makes `overlay` null and unmounts `ChatDialog`. Leaving Chat with a known stored conversation can mount that dialog for the same id, but it owns a separate draft.

   More seriously: type a draft in stored chat A, switch to another mode, and delete A through the floating dialog. That deletion bypasses the proposed `ChatPanel`/band draft cleanup. Returning to Chat would classify A’s retained words as an orphan and reopen them in a fresh conversation.

   Evidence: [`Reader.tsx:1006`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/reader/Reader.tsx:1006), [`Reader.tsx:3637`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/reader/Reader.tsx:3637), [`ChatDialog.tsx:205`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatDialog.tsx:205), and its direct deletion at [`ChatDialog.tsx:884`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatDialog.tsx:884).

   **Smallest fix:** include the dialog’s thread drafts and deletion paths in the shared store. Its passage drafts can remain separately scoped.

6. **F6 — P2, reasoned: absence is too broad a substitute for “never sent.”**

   Even a successful GET can precede an outstanding first POST. A reader can send the first question, type a follow-up while awaiting the answer, then leave and return before persistence. The old operation survives unmount; the new GET may omit its conversation. Orphan recovery would move the follow-up into another conversation.

   Evidence: [`useChat.ts:457`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/useChat.ts:457) describes operations surviving unmount; [`useChat.ts:672`](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/useChat.ts:672) inserts messages before the request leaves; the textarea remains editable while awaiting an answer.

   **Smallest fix:** record whether the draft’s conversation was genuinely never sent. Automatically recreate only that category; do not infer it solely from a missing server row.

A simpler design would keep the module-level store, but retain **Chat’s last destination plus per-thread drafts**, and **one draft per Remember kind**. Recover only the selected, explicitly never-sent Chat conversation. This removes arbitrary orphan selection and Remember’s draft-moving machinery while leaving controller lifetimes unchanged.

Deliberate sign-out already uses `location.replace("/")`, so that path clears module memory. Recall, Tutorial and Explore have distinct keys and do remount. The StrictMode handoff guard is a useful precedent, but recovery must also respect handoff precedence and Remember’s creation rule.

Validation: `tests/remember-own-thread.test.tsx` passed all 26 tests using `--configLoader runner`. These validate existing behavior; no proposed implementation exists to test.

**REFUSE**