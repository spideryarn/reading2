# Review: plan 261001m — Remember is its own single thread

You are reviewing a PLAN, read-only. Do not change any file.

Repo: this worktree. The plan is `docs/plans/261001m-remember-is-its-own-single-thread.md` (untracked
file in the working tree; read it there). Background, read as needed:

- `docs/project/remember-mode.md` (esp. § A Remember conversation IS a chat thread, § On screen)
- `src/chat.ts` — `withTurn`, `withSpokenTurn`, `taken`
- `src/store/pg-chat.ts` — `threadsFor`, `upsertThread`, `begin`, and the import/speak paths
- `src/db/schema.ts` — `chatThreads`, `chatMessages`, `comments.threadId`, `realtimeSessions.threadId`
- `drizzle/0048_rename_review_thread_kind.sql` — the hand-completed data-move precedent
- `src/routes.ts` § `streamChat` (from line ~2626)
- `src/web/modes/conversation/ConversationModes.tsx` § `ConversationBand`, `src/web/ChatPanel.tsx`,
  `src/web/useChat.ts` (`send`, `begin`, how a server-overruled thread id is followed)

Check, in particular:

1. Does the migration fold lose or corrupt any reader data in any case (ordinals, the unique
   `(article, thread, ordinal)` constraint during the move, message PK, pending rows with attempt
   ids, realtime_sessions, comments)? Is "keep the earliest" right?
2. Is every writer that can create a `chat_threads` row with kind `remember` covered by the
   server rule — typed turn, spoken turn, retry/edit, any import/restore/export path, the
   live-conversation route? Would any of them now hit the unique index as a 500?
3. Does the client really follow a server-chosen thread id for a brand-new thread (the `begin`
   frame), so fold-and-append works end to end? Any race where the optimistic new thread lingers
   in the Remember band beside the real one?
4. Remember-band behaviour: auto-select, `?thread=` override, delete → fresh thread, StrictMode
   double effects, the existing `started` latch and handoff logic, live session hang-up on thread
   change.
5. Anything simpler that gets the same result.

Severity: P0 (data loss / prod break), P1 (wrong behaviour a reader hits), P2 (worth fixing), P3
(nit). Give every finding an ID (F1, F2…), the file/line evidence, and a concrete fix. Last, my own
suspicions: the spoken-turn conflict choice, and whether a 2-row composer under `max-height: 500px`
is the right trigger.
