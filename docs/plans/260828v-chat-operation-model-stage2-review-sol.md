# DO NOT SHIP

The recovery handoff is sound, but Stage 2 has three ship blockers.

## Findings

1. **P1 — cancel-before-`begin` is lost in the real UI.**  
   `cancelAndDiscard` queues the wish and sends nothing, then `ChatDialog` immediately closes and unmounts. Cleanup clears `controller.onNamed`; when `begin` later arrives, nobody sends `/cancel`. The server finishes and stores the conversation, which returns on reload. Tests keep the hook mounted, so they miss this production lifecycle. See [useChat.ts:441](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:441), [ChatDialog.tsx:245](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatDialog.tsx:245), and [controller.ts:313](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/controller.ts:313).

   Retry has a second failure: its row already has a server id, but the new operation has `began: false`. If the retry gets a 409 or transport failure before `begin`, the queued cancel is never consumed. Waiting is necessary for an attempt-specific stop, but not for destructive cancel.

2. **P1 — the 409 repair can overwrite newer work.**  
   `repair.succeeded` replaces the entire thread and guards only against a currently live turn. A delayed snapshot can therefore:

   - overwrite a later rename after its PATCH succeeds;
   - remove a later send that completed before the repair arrived;
   - race another repair, since repairs do not supersede each other.

   If it arrives while a turn is live, it is discarded permanently, leaving the external turns that caused the 409 absent locally. This is the exact snapshot-over-rename race the plan names. See [reduce.ts:628](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:628) and [260828v-chat-operation-model.md:126](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:126).

3. **P1 — `turn.began` does not migrate a tombstone when the server changes the thread id.**  
   It renames `base` and the operation, but leaves the tombstone under the provisional id. Projection therefore exposes the server-named thread, and a later refusal tries to remove a tombstone under the wrong id. Server id replacement is supported behavior. See [reduce.ts:405](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:405), [project.ts:121](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/project.ts:121), and [chat.ts:326](/Users/greg/Dropbox/dev/experim/spideryarn2/src/chat.ts:326).

4. **P2 — stop and cancel results still bypass the gate.**  
   Their requests remain in `useChat`, and async failures dispatch ungated `error.set` and `tombstone.removed` inputs. In the existing cancel → delete → late 409 sequence, provenance keeps the thread deleted, but the obsolete cancel still writes “Couldn’t discard…” over the successful delete. A late stop failure can likewise report against a retired or retried answer.

## Direct answers

- **Recovery:** the disconnect handoff itself is atomic and has one writer under reader-reachable ordering.
- **409:** dropping the edit immediately restores its discarded rows correctly. The repair that follows is not safely ordered.
- **Cancel predicate:** `began` is not sound for retry.
- **Gate:** stop/cancel async results bypass it.
- **Stage 3:** the single intent union is right, but part of it is required before Stage 2 can ship. A turn-only field is insufficient: cancellation can outlive the turn or belong to a recovery-owned row. Cancel needs an addressed operation or explicit handoff, with refusal atomically lifting its tombstone and setting its error.

No files were changed.