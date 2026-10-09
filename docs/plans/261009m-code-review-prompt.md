Code review of plan docs/plans/261009m-delete-a-chat-question-and-what-follows.md, as built, in this worktree. Read the plan first (its decisions and its Reviews section; the plan review is docs/plans/261009m-plan-review-sol.md).

The change: `git diff HEAD` in this worktree (uncommitted), plus new untracked files tests/chat-delete-from-route.test.ts, tests/chat-prune-reduce.test.ts, tests/chat-delete-from-panel.test.tsx. Core files: src/chat.ts (`withDeleteFrom`, `requireTail`), src/store/pg-chat.ts (`deleteFrom`), src/store/contracts.ts, src/routes.ts (`deleteChatFrom` and its route row), src/web/chat/{model,reduce,project,effects,controller}.ts (`PruneOperation`), src/web/useChat.ts (`deleteFrom`), src/web/ChatPanel.tsx (`Turn`'s bin, `ArmedDelete` size, the `speaking` gate), src/web/ChatDialog.tsx and src/web/modes/conversation/ConversationModes.tsx (gating on `settled`), src/web/help/pages/modes/chat.md. The many one-line test edits only add the new required effect/prop to fakes.

You may fix what you find inside this stage (workspace-write). Do NOT run any git command that changes state — no commit, checkout, restore, reset, or shelving of changes. Check especially:

1. Server: transaction, lock and tail correctness; the ordinal arithmetic (`gte(ordinal, index)` given ordinal equals array index); that the `updated_at` written equals what the client computes (`prunedAt`); interactions with `finish`, the pending sweep, gist generation (`setGist`'s compare-and-set), and `retry`/`edit` on the same thread.
2. Client reducer: the gate (`accepts`), superseding by a thread delete, the projection, success and failure, and interaction with turn/recovery/repair/load/spoken operations; whether gating on `settled()` during render is correct and re-renders when it changes; the `speaking` gate in `Conversation`.
3. UI: the reuse of `ArmedDelete` (disarm timer, focus), the held row, the count wording, accessibility.
4. Anything a test claims but does not actually check.

Gates you can run: `npm run typecheck`; `npx vitest run tests/chat-prune-reduce.test.ts tests/chat-delete-from-panel.test.tsx tests/chat-delete-from-route.test.ts tests/authenticated-api-route-contract.test.ts` (the route test needs the local Postgres; if it cannot reach it, say so rather than skipping). Do not run the full suite — the box is shared.

Reply with numbered findings (severity, file:line, what is wrong, and whether you fixed it and how), then a list of files you changed. Say plainly if an area is fine.
