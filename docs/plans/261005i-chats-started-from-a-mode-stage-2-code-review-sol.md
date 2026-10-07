- **CR-7 — P1, established, fixed:** A remembered Chat draft overwrote the clearing of a non-chat URL. Reproduce with stored Chat and Remember threads, an unsent Chat draft, and `?mode=chat&thread=<Remember id>`. The new test failed by reopening Chat. Non-chat arrival now shows the list; drafts remain accessible on their rows, including pending origins and submitted IDs.

- **CR-8 — P2, established, fixed:** `threadParam.parse("spya-rem001")` and `"spya-chat01"` return `null`, so pasted-URL tests exercised an absent parameter. Replaced invalid fixtures and added a parser check, seen red first. `0` is valid; `1` is not.

- **CR-9 — P2, established, fixed:** Changing Remember’s icon to Globe passed all three original icon-map tests. Giving every source row Chat’s icon passed all 16 original panel tests. Added exact glyph checks; both mutations now fail.

- **CR-10 — P2, established, fixed:** The original “never sends” test called `onSendNew` directly, which always creates a conversation. It could pass with open-thread protection removed. It now renders the real panel, types and sends; widening openable threads and disabling URL clearing makes it fail on a POST to Remember.

Removing listing and filter narrowing separately caused existing tests to fail. The band tests would still pass with panel narrowing removed; panel tests using supplied fixtures would still pass with the band’s listing removed.

The navigation guard survived a Remember-row press before URL clearing flushed. A filter does not hide an explicitly opened chat, and last-view restoration never restores `thread`. Source buttons are siblings of row buttons.

**Validation:** 199 tests passed across 11 files, each run separately. Typecheck passed through `node --import tsx scripts/typecheck.ts`. Lint reports only an arrival-effect complexity advisory. No browser run. All mutations restored; no commit made.

Changed files:

- [ConversationModes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/modes/conversation/ConversationModes.tsx)
- [chat-tools.md](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/docs/project/chat-tools.md)
- [chat-lists-every-conversation.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-lists-every-conversation.test.tsx)
- [chat-list-sources.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-list-sources.test.tsx)
- [mode-icons.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/mode-icons.test.ts)
- [remember-own-thread.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/learn-own-thread.test.tsx)
- [chat-draft-survives-a-mode-change.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/tests/chat-draft-survives-a-mode-change.test.tsx)

land