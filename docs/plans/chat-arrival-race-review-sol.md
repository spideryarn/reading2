## Findings

- **LOW — superseded loads can still publish a stale error.** [useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:701)  
  Sequence: `StrictMode` starts GET 1 and GET 2; GET 2 succeeds and displays the list; GET 1 then rejects. The success path rejects the old generation, but the `catch` only checks the slug, so `error` is set and [ChatPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:415) displays a failure over the valid list. `load-failed-flags.test.ts` misses this because it asserts only `loadFailed`. Add the generation check to the catch and assert `chat.error === null`.

- **LOW — remote deletions can still arrive as ghosts.** [useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:685)  
  Sequence: tab A’s GET reads thread T; its response is delayed; tab B deletes T; A’s response arrives. A has no local tombstone, so `mergedArrival` adds T. Worse, if A sends into it, the server can recreate T as a new thread while A temporarily displays the old transcript plus the new turn. This predates the change, but “deletions win” means only deletions made through this hook. The current `deleted` set cannot cover other tabs.

## Answers

- “A row already on screen wins” is safe for the practical arrival paths. The reset precedes the fetch, and same-visit server rows cannot normally appear before the current arrival. Widening beyond `running` was right: the delayed stale response can land after the send finishes. It also protects a rename or completed error state made after the snapshot.

- Per-thread refreshes do not need suppression during the ordinary same visit: a server-backed thread is unavailable until the current arrival has finished. Also, leaving and returning to an article does **not** preserve this hook—the `Reader` is keyed by slug at [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:413). The claimed production duplicate-load path is therefore inaccurate; real `StrictMode` remains sufficient justification for the guard.

- The updater is pure. A delete after the tombstone snapshot queues its filtering update after the merge, so the delete still wins.

- Ordering is safe: `ThreadList` clones and sorts by `updatedAt`; opening uses `find(id)`.

- The arrival tests exercise the real hook and real `StrictMode`. `expect(call).toBe(2)` honestly guards the premise.

- The seam-test split is sound for the original thread-id regression. One mutation both tests miss is `ConversationBand` altering/dropping the question before calling `send`; assert the POST body’s `question` too.

- Replace the fixed 100ms sleep with `vi.waitFor` on `location.search`. The current wait exceeds nuqs’s 50ms jsdom throttle, but encodes dependency timing.

- Exporting `ConversationBand` is a reasonable, cheaper seam than source-text inspection.

- The composer guard is now presentational, not safety-critical. However, comments at [App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1952), [ChatPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:514), and [chat-list-composer.test.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-list-composer.test.tsx:20) still describe the old wipe. The test also retains `ChatBand` at line 13. No runtime sequence exists, so these are documentation nits.

- Historical plan documents should retain the name they used at the time.

Checks: all 44 scoped tests passed. The web TypeScript project passed; only the named unrelated route and scratch-file failures remained.

**do not ship — generation-check the stale-load catch and add the one missing `error === null` assertion.**