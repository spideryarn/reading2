Not shippable yet.

- Dropping `threadId === null` is right for stale URLs.
- `loaded && threads.length > 0` prevents this composer’s wipe-on-arrival race. The existing `+` race remains separate.
- Blocking edge: `send(null)` uses unchecked `mintId()`. If it collides with an existing thread, both client and server append to that thread instead of creating one. That violates the repo’s explicit collision-check rule. [useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1217), [chat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:289)
- A collision corrected by the server can also consume the nonce on the optimistic composer, then lose focus when its corrected ID remounts it.
- The 16 focused tests pass, but they mock `onSendNew`; they test neither `send(null)`, collision handling, nor focus transfer. The current fixture also lacks the newly required `kind: "chat"`, so typecheck is not green.

The fix needs “create new” intent preserved through the server boundary, not merely reliance on a random unused ID.