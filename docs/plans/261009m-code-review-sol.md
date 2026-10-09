No high-severity findings. I found and fixed seven issues:

1. **Medium — stale finishes could overwrite the pruned timestamp.**  
   [src/store/pg-chat.ts:512](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/src/store/pg-chat.ts:512) updated the thread clock even when the attempt-fenced message update matched no row. A late finish after pruning, sweeping, or retrying could therefore reorder the conversation and replace `prunedAt`. Fixed by updating `updated_at` only when the fenced finish lands; added store and route regressions.

2. **Medium — the reducer trusted a potentially stale rendered delete button.**  
   [src/web/chat/reduce.ts:324](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/src/web/chat/reduce.ts:324) previously accepted a prune even if the thread had become busy since render. It could overlap a send, rename, recovery, spoken append, earlier prune, or an unnamed thread. Fixed with an event-time `isSettled` check and reducer coverage for these cases.

3. **Medium — deletion lost keyboard focus and exposed little accessible confirmation state.**  
   [src/web/ChatPanel.tsx:927](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/src/web/ChatPanel.tsx:927) removed the focused row on the second press, leaving focus on the document body. Fixed by moving focus to the preceding retained question’s Rewrite button before pruning. The button now also exposes its changing label through `aria-label`, its armed state through `aria-pressed`, and hides the decorative icon from assistive technology.

4. **Low — the confirmation count included the answer as a later message.**  
   [src/web/ChatPanel.tsx:966](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/src/web/ChatPanel.tsx:966) treated every discarded row alike, producing misleading wording. Fixed with separate wording for the question’s answer and only counting subsequent rows as “messages after it.”

5. **Low — the held action row did not reserve the bin’s width.**  
   [src/web/ChatPanel.tsx:2083](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/src/web/ChatPanel.tsx:2083) withdraws the real callback while an answer is arriving, so the old placeholder logic could not know that the bin belonged there. Fixed with a separate `holdDeleteFrom` prop and a test using the real callback-withdrawn shape.

6. **Low — the authenticated-route guard canary was stale.**  
   [tests/authenticated-api-route-contract.test.ts:1024](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/tests/authenticated-api-route-contract.test.ts:1024) still expected 128 guards after this route added the 129th. Fixed the count and provenance comment.

7. **Low — one reducer test claimed an ordering case it did not exercise.**  
   [tests/chat-prune-reduce.test.ts:154](/var/tmp/spideryarn-worktrees/fbmx423m-delete-chat-message/tests/chat-prune-reduce.test.ts:154) said whole-thread deletion won “whichever answers first” but never dispatched `delete.succeeded`. Fixed by including that event in every ordering.

The remaining reviewed areas are sound: the transaction and article lock, mandatory tail check, `gte(ordinal, index)` arithmetic, server/client `prunedAt` agreement, retry/edit serialization, pending refusal, gist compare-and-set, reducer projection and rollback, whole-thread-delete supersession, and load/repair/recovery/spoken interactions. `settled()` changes do trigger React rerenders, and the Live `speaking` gate correctly covers active phases.

Verification:

- Focused unit project: **490 tests passed**.
- Typecheck equivalent: **all 3,593 source files covered and passed**.
- Lint: exit 0; only existing informational complexity notices.
- The requested combined Vitest command could not start the database project: sandbox access to `127.0.0.1:54362` failed with `EPERM`. The route regression was therefore unavailable, not skipped.
- `npm run typecheck` itself could not create its `tsx` IPC socket in this sandbox; running the same script through `node --import tsx` passed.

Files I changed:

- `src/store/pg-chat.ts`
- `src/store/contracts.ts`
- `src/web/chat/reduce.ts`
- `src/web/ChatPanel.tsx`
- `tests/store-chat-pg.test.ts`
- `tests/chat-delete-from-route.test.ts`
- `tests/chat-prune-reduce.test.ts`
- `tests/chat-delete-from-panel.test.tsx`
- `tests/authenticated-api-route-contract.test.ts`
- `docs/postmortems/261009j-an-attempt-fence-guarded-the-row-but-not-its-aggregate-clock.md`
- `docs/postmortems/261009k-a-render-gate-did-not-guard-the-event-it-displayed.md`