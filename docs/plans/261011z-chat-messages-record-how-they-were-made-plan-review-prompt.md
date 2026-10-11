# Plan review: chat messages record how they were made

You are reviewing a plan before it is built, read-only. Repo root is your cwd (a worktree of
Spideryarn, TypeScript + Postgres via drizzle). The plan is untracked:
`docs/plans/261011z-chat-messages-record-how-they-were-made.md`. Read it first, then check its
claims against the code: `src/db/schema.ts` (chatMessages), `src/store/pg-chat.ts` (toMessage,
messageRow, begin, appendSpoken, retry, edit), `src/chat.ts` (withTurn, withSpokenTurn),
`src/routes.ts` (streamChat body ~3204-3330, spokenChat ~4267), `src/types.ts` (ChatMessage),
`src/web/ChatPanel.tsx` (Composer ~3073-3340, SendHow ~153-162), `src/web/useDictationField.ts`,
`src/web/useChat.ts` (send ~716-830, speak ~530), `src/web/modes/conversation/ConversationModes.tsx`
(~1280-1340), `src/store/export.ts` (~683-727), `docs/project/sql.md`.

Questions I most want answered:

1. Is one `via` column with role-dependent values the right shape, versus alternatives? Names?
2. Is the composer's provenance detection (two refs: dictation's onChange vs. the textarea's
   onChange) correct? Are there paths where the dictation hook writes the box that would be
   mis-classified, or keyboard edits that bypass the textarea onChange? Any send path from the
   composer that does not pass through `submit` (e.g. the double-press-on-Stop `onDone`)?
3. Is there any other writer of chat_messages rows (assistant or user) that would need `via` and
   that the plan misses? Any read/copy path (exports, article transfer, fork/copy of threads) that
   drops a field silently?
4. Retry/edit leaving `via` alone: right?
5. Anything that should be simpler.

Severity scale: P0 (data loss / prod break), P1 (wrong behaviour the feature exists for), P2
(should fix), P3 (nit). Give each finding an ID (F1, F2…), file:line evidence, and a suggested fix.
End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
