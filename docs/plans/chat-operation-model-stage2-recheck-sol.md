# DO NOT SHIP

## Findings

1. **P1 — the tombstone still is not migrated at `turn.began`.**  
   The base thread and intent adopt `begun.threadId`, but `tombstones` remains keyed by the provisional ID. Projection therefore exposes the server-named conversation, and a refusal cannot find its tombstone. This is the previous blocker unchanged. The unmount test uses the same thread ID on both sides, so it misses this case. [reduce.ts:567](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:567), [reduce.ts:588](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:588), [project.ts:127](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/project.ts:127), [chat-unmounted-turn.test.ts:185](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-unmounted-turn.test.ts:185).

2. **P1 — the repair still overwrites newer same-ID work.**  
   `merged()` preserves only rows absent from the snapshot. A retry updates an existing answer ID; an edit preserves its question ID; recovery also replaces an existing ID. If any finishes and retires while the repair is out, the older snapshot’s same-ID row wins. The new test proves later sends because those mint new IDs; it does not prove retries, edits, or recovery. [reduce.ts:765](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:765), [reduce.ts:843](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:843), [chat-reduce.test.ts:822](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-reduce.test.ts:822).

3. **P2 — an old controller can still invoke a live UI callback.**  
   The stream does retain the old controller after unmount or slug change, so internal intent delivery is sound. Its state is isolated from the new controller. But `#onThreadId` also survives and may call `setThread` after the reader closed the dialog or moved to another slug, reopening or repointing the current view when the server corrects an ID. Unsubscription removes only the listener. [controller.ts:165](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/controller.ts:165), [controller.ts:175](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/controller.ts:175), [controller.ts:334](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/controller.ts:334), [useChat.ts:268](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:268).

4. **P2 — superseded repair failures still report.**  
   A newer repair supersedes an older one, and the older success is suppressed. Its failure is not: it retires and writes `error`, potentially reporting failure after the newer repair succeeded. [reduce.ts:716](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:716), [reduce.ts:843](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:843), [reduce.ts:854](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:854).

The retry cancel/stop distinction and atomic `intent.failed` transition are right.

Every reducer-visible asynchronous result does mechanically pass through the gate. The remaining problems are that admitted results still have unsound merge/supersession behavior, plus the external `onThreadId` callback.

The seven permutations plus rename fence are the right eventual Stage 3. Stage 2 is not done until these races are fixed and pinned—especially provisional-ID tombstone migration and repair versus a completed same-ID retry/edit/recovery.

I could not rerun Vitest because this read-only sandbox prevents its temporary-file creation. No files were changed.