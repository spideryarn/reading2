## Verdict: do not build yet

The operation model is right, but the plan is not yet four independently shippable stages. Stage 2 can strand recovery and preserve a refused 409 projection; stage 3 can drop early stop/cancel intent unless command delivery moves earlier.

### Blocking changes

1. **`base = what this tab believes` is sound; “operations are turns alone” is not.**

`begin` and `discard` can update `base` directly. They are synchronous and break none of the twelve bugs.

Rename and delete have asynchronous requests. They need operation identities even if their optimistic UI is never rolled back:

- A late rename/delete failure otherwise remains the same stale-failure class as bug 12.
- A 409 refresh can overwrite an in-flight rename, recreating bug 1’s snapshot-over-newer-projection class.
- The promised “success and failure use the same admission rule” cannot cover them.

The plan claims the gate will close the `remove` catch, but `remove` and `rename` actually share [`write`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1669>). With `operations: Map<OpId, TurnOperation>`, that promise is impossible.

Use mutation operations:

- `RenameOperation`: project the title while pending; on success or failure commit it to `base`, preserving today’s no-rollback behaviour.
- `DeleteOperation`: apply the tombstone immediately; use the operation only to admit its completion/error.

The same modelling gap exists for load: the proposed gate looks only in `state.operations`, while load’s `opId` lives separately ([plan](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-operation-model.md:30>)). Define registration/input events separately from gated asynchronous-result events.

2. **Stage 2 is not deployable as written.**

After a named stream stalls or closes without `done`, today `run` deliberately leaves the answer pending, releases ownership, and lets the watcher adopt it ([useChat.ts](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1405>), [watcher](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1184>)).

Stage 2 stores that row in an operation but defines no `turn.disconnected`/handoff transition. The old watcher can patch `base`, but the still-live operation will continue projecting its pending row over that patch.

The old 409 path has the same problem: refreshing `base` does not help while the refused edit operation is still projected.

Either:

- add an explicit stage-2 compatibility transition that materialises the pending projection into `base`, removes its writer/operation, and then lets the old watcher run; plus drop the refused operation before the old 409 refresh, or
- merge turn migration with recovery and 409 migration.

The current stage-2 event list is insufficient.

3. **Turn-before-intent is the right dependency, but not with the current React boundary.**

A stop before `begin` is currently preserved by writing `stopWanted` synchronously and consuming it when `begin` arrives ([stop](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:955>), [begin handling](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1313>)).

Reducer dispatch does not synchronously update a closure. If stage 3 removes those refs and its `begin` handler dispatches before checking current state, the exact stop-before-begin window can be lost.

Before removing the refs, introduce one of:

- a synchronous controller that applies the event and emits commands, or
- a reducer-owned, exactly-once command queue consumed by an effect.

Add tests proving that stop and cancel pressed before `begin` each produce exactly one request using the server thread ID, answer ID, and attempt. Existing tests do not cover this client path.

4. **`legacy.apply` is safe only in stage 1.**

It is acceptable while there are no turn operations: it merely relocates existing pure updaters while their current guards remain.

It is unsafe once turn projection begins. An opaque updater can modify the base beneath an active operation, and neither an allowlist label nor a slug check makes that safe. A slug also cannot distinguish two operations for the same article—the bug 10/12 case.

Make it stage-1-only, preferably with a development assertion that no turn operation exists. Remove it before stage 2; use named transitional events if any bridge remains.

### Other required plan details

- The reducer must never mutate a `Map`, `Set`, operation, message, tool array, or event. Deep-freeze inputs and run the same transition twice in tests. Mint IDs and timestamps outside it.
- Stage 4 says the reducer returns only state, but also says the pure part emits commands. Choose an explicit contract such as `{state, commands}`.
- Cache the projected snapshot for `useSyncExternalStore`; `getSnapshot` cannot construct fresh `threads`/`recovering` values on every call.
- Projection cost should remain comparable to today. Chat updates rerender `ConversationBand` or `ChatDialog`, not the parent article. Preserve structural sharing so every delta does not rebuild every thread and message.
- Define ordering or exclusion for two operations in the same thread. Testing only concurrent operations in different conversations avoids the difficult case.
- Preserve façade behaviour explicitly: synchronous IDs from `send`/`begin`, `onThreadId`, immediate optimistic rows, retry field clearing, edit rollback on 409, cancel rollback on any failure, rename/delete no rollback, and `loaded`/`loadFailed` semantics.

Three factual corrections are also needed:

- The plan says “two new modules” and lists three.
- The “three catches” are stop, cancel, and shared `write`; the latter serves both rename and delete.
- `chat-arrival-race.test.ts` containing a ninety-second runtime is unsupported by its source. I could not time it because the read-only sandbox prevented Vitest creating its temporary config file.

After revising these points, start with stage 1: the machine and load, with `legacy.apply` explicitly confined to that stage. No files were changed.