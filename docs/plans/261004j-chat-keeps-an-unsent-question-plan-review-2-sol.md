The revised design is much simpler, but **two established P1 gaps remain**. No files changed.

Round-1 status:

| Finding | Status |
|---|---|
| F1 | **Partly closed.** Recovery checks `!loadFailed`, but the existing arrival effect can still start a conversation after failure; see F7. |
| F2 | **Closed.** Remembering the selected destination removes arbitrary orphan selection. |
| F3 | **Behaviour closed.** Reopening the remembered stored conversation handles Recall/Quiz rewriting `thread`. The explanation remains inaccurate; see F11. |
| F4 | **Closed.** A draft per Remember kind avoids creating a competing conversation. |
| F5 | **Closed at plan level.** Shared dialog drafts and cleanup cover the issue. Implementation must include its `cancelAndDiscard` path as well as `remove`. |
| F6 | **Partly closed.** Explicit `fresh` is better than inferred absence, but its proposed definition can become stale; see F9. |

1. **F7 — P1, established: the existing arrival effect overrides the retained list draft.**

   Reachable sequence: arrive with no stored chats → close the automatically created empty conversation → type in the list’s box → switch mode → return.

   The remembered destination is the list, so the proposed rule does nothing. But the existing arrival effect sees zero conversations and calls `startNew()`. The reader ends up in an empty conversation composer; their retained list text is hidden.

   That effect also checks only `loaded`, so a failed GET still starts a conversation despite the plan’s recovery guard and its “no new conversation” test.

   Evidence: the plan’s [list exemption](docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md:69), the existing [arrival effect](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:715), and [closing an unused conversation](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatPanel.tsx:477).

   **Fix:** make recovery and default arrival one ordered decision. A retained list draft must suppress automatic creation, and failed loads must suppress it too. Add the zero-stored-conversations list test.

2. **F8 — P1, reasoned: clearing Remember’s draft on Start over can lose it when deletion fails.**

   Type a follow-up in a stored Recall, Tutorial or Explore conversation → press Start over → DELETE fails. Existing behaviour restores the old conversation. Clearing that kind’s draft when Start over begins would restore its transcript with an empty box.

   The plan says “Start over clears” without specifying whether that happens before or after successful deletion, so timing remains a material inference.

   Evidence: [planned clearing](docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md:62), [Start over with restoration enabled](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:848), and the existing [failed-delete test](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/tests/learn-own-thread.test.tsx:432).

   **Fix:** specify that successful Start over clears the draft; refusal preserves it. Test both outcomes for all three kinds.

3. **F9 — P1, established: `fresh` records a historical snapshot, not whether the conversation remained unsent.**

   Start empty Chat A → type a draft, recording `fresh=true` → use Live to complete a spoken exchange without editing the typed draft → leave Chat → delete A in another tab → return.

   A is now missing, and its draft still satisfies the plan’s definition of `fresh`: A had no messages **when the text was written**. Recovery therefore creates another conversation and moves the words into it, despite the explicit exclusion of drafts belonging to sent conversations deleted elsewhere.

   A first spoken exchange changes the conversation independently of `onDraft`. The composer explicitly supports holding a typed draft while talking.

   Evidence: [the proposed definition](docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md:51), [typed drafts during Live](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatPanel.tsx:2304), [spoken submission](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/useChat.ts:482), and [spoken persistence updating the conversation](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/chat/reduce.ts:1274).

   **Fix:** make eligibility an irreversible “never submitted” property. The first typed or spoken write must revoke it even if the draft text never changes. Also test typing another draft during the asynchronous Live-to-typed handoff.

4. **F10 — P1, reasoned: an untouched handed-over question may never enter the store.**

   Accept a question handed into Chat → switch mode without editing the composer → return.

   Currently `draftFor()` returns the seed without storing it, and `Composer` does not call `onDraft` when adopting its initial value. Merely replacing the refs with the proposed store leaves no stored text for recovery to find. The plan gives handoffs precedence but does not explicitly persist their seed.

   Evidence: [seed lookup](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatPanel.tsx:425), [one-time composer initialization](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/ChatPanel.tsx:2213), and [handoff acceptance](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:704).

   **Fix:** explicitly store the accepted handoff once, outside render. Add an untouched-seed round-trip test, including clearing the seed so it cannot return.

5. **F11 — P3, established: “Why it is lost today” still contains round-1 inaccuracies.**

   The refs and controller-lifetime explanations are accurate. However, `thread` does **not** retain the Chat id across every mode change: Recall replaces it and Quiz clears it. Consequently, retaining the words alone is not the whole fix for stored conversations. The plan’s later explanation correctly acknowledges both facts.

   Evidence: [the stale statements](docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md:26), [Recall’s replacement](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:492), and [Quiz’s clearing](/home/greg/code/spideryarn2/.claude/worktrees/qi-ja6rdqm8-chat-draft-on-mode-change/src/web/modes/conversation/ConversationModes.tsx:139).

   **Fix:** qualify URL retention and explain that restoring the destination is also necessary.

The module store plus Chat’s last destination and drafts per Remember kind remains the simplest reasonable design. Fold restoration into the existing arrival decision; it does not need another competing arrival mechanism.

Recall, Tutorial and Explore have distinct keys and do remount. Ordinary local sign-out reloads, but auth events received from another tab only update React. I did **not** establish a cross-reader draft leak: globally unique article slugs and owner-only Chat limit that path. The plan’s blanket reload argument is nevertheless too broad.

Validation: four existing lifecycle suites passed, **86 tests**. They confirm current behaviour, not the proposed implementation.

**REFUSE**