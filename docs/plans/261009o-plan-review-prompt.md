Review the plan at docs/plans/261009o-delete-a-chat-question-and-what-follows.md before it is built. Read-only.

Context: Spideryarn, a reading app. Chat conversations are stored in Postgres (`chat_threads`, `chat_messages`, src/db/schema.ts). An existing "edit a question" feature already hard-deletes every turn under an edited question (`edit` in src/store/pg-chat.ts, `withEdit` and `requireTail` in src/chat.ts, the route in src/routes.ts around `chatStore.edit`). The client chat state is an operation/projection machine in src/web/chat/ (model.ts, reduce.ts, effects.ts, controller.ts, project.ts) driven from src/web/useChat.ts; the panel is src/web/ChatPanel.tsx (`Turn`, `ArmedDelete`).

Please check, against the code:
1. Is anything referencing a chat message id (DB, cost ledger, exports, client caches like `?thread=`/`at=` URL state, guide acts in src/web/guide-acts.ts, recovery operations, streaming map keys) that a hard delete of trailing messages would break or leave dangling?
2. Concurrency: is refusing when any message is `pending` plus `requireTail` under `lockArticleRow` and `inTurnOrder` enough? Any race with the sweep, `finish`, recovery, or a held (unnamed) thread on the client?
3. Is the client "prune" operation shaped right for this state machine (draw while in flight, server thread into base on success, drop on failure)? What interactions with other operations (turn, recovery, rename, delete tombstones, load) could go wrong?
4. Product decisions 1–7: anything that would surprise the reader or that is clearly worse than a simpler alternative?
5. Anything missing from tests.

Reply with numbered findings, each with severity (high/medium/low), file:line evidence, and a concrete fix. Say plainly if a section is fine.
