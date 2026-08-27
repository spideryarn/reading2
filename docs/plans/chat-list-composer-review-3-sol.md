Do not ship this exact version.

1. `threadId === null` does guarantee `onSend` mints. But `threads.length > 0` does not guarantee the fetch landed.

   Reachable counterexample: press `+` before loading finishes → type an unsent draft → close the conversation. [`leave()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:291) preserves that local thread because it has a draft, then clears `threadId`. The guard now passes while the initial refresh is still outstanding. Sending from the list composer can therefore still be wiped by [`refresh()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:530).

2. The safe minimal guard is `threadId === null && loaded && threads.length > 0`. `loaded` already records completion of the initial request in [`useChat`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:565), but it is not passed into `ChatPanel`.

3. The real IDs and draft-survival tests are good. The test named “once the fetch has landed” merely supplies a non-empty array, so it assumes the disputed premise. It needs a `loaded: false, threads: [localThread], threadId: null` case—or, better, a deferred-fetch seam test around `ChatBand`.

Lint passes. Vitest and typecheck could not start in this read-only environment because their tooling writes temporary files/IPC sockets.