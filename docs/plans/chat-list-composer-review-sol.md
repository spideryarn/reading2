## Findings

- **High — the list composer can append to an existing conversation.** [ChatPanel.tsx:383](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:383) uses the ordinary `onSend`, while [App.tsx:1772](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1772) passes the raw `?thread=` value to `send`. During initial loading, `useChat` starts with `threads = []` ([useChat.ts:437](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:437)), so [ChatPanel.tsx:219](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:219) decides there is no open conversation and shows the list composer—even when `?thread=` names a real stored conversation.

  Reachable sequence:

  1. Open chat through a bookmark or “open full” with `?thread=t1`.
  2. Before the chat GET finishes, the panel shows “Ask something new…”.
  3. Enter a question.
  4. `send(t1, …)` uses `t1` rather than minting ([useChat.ts:1217](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1217)); the server finds the stored thread and appends to it.

  This also bypasses the normal conversation’s `busy` guard because the list composer hardcodes `busy={false}`. If `t1` is still answering—plausible immediately after opening a floating chat full-screen—the second question can be appended while that answer is pending. The outstanding initial refresh can additionally replace the optimistic rows wholesale at [useChat.ts:543](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:543), making the new turn disappear locally while its request continues.

  The discarded-empty-thread case is harmless in isolation, but it is not the only state where the list and URL disagree. A list action must explicitly mean “new”: the backed-out `onSendNew`, or an equivalent callback that always calls `send(null, …)`, is required.

- **Medium — the test does not test the integration it says it pins.** [chat-list-composer.test.tsx:52](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-list-composer.test.tsx:52) hardcodes `threadId: null`, and lines 54–56 replace the real callback with an array push. It never renders `ChatBand`, never calls `useChat.send`, and cannot establish that the callback mints instead of joining a URL-named thread. It would remain green with the bug above.

  It also does not prove the draft or focus behavior across remounts: `render()` always renders the list, and its fake `onSend` never opens a conversation. A useful transition test would type a draft, rerender with an open thread, rerender the list, and assert the draft returns; similarly, it should start a conversation with a raised nonce and assert only the conversation composer consumes it. The current test is otherwise a reasonable component test for rendering, Enter, trimming, clearing, and initial non-focus, though the exact placeholder and CSS-class query are somewhat refactor-sensitive.

## Answers to the remaining questions

- **Focus refs:** sound. With separate refs and `focusNonce={0}`, the list composer cannot consume the conversation composer’s nonce.
- **Draft ref:** sound for the intended list → conversation → list remount. It is cleared synchronously after sending and preserved when merely opening a row. It is lost when chat mode unmounts, matching the existing draft lifetime documented in the file; article changes remount `Reader` by slug.
- **CSS:** no defect found. Both the populated list and empty state now absorb remaining vertical space, while the composer stays at the bottom. The empty state’s lack of its own scrolling could matter only at an unusually short height, and this change does not introduce a concrete overflow at the current content size.

I could not execute the test in this read-only environment: Vitest attempted to create `node_modules/.vite-temp/...` and failed with `EPERM`.