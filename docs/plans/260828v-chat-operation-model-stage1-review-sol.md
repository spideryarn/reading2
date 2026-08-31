## Verdict: do not ship `6f35022` as-is

The load gate is sound, but stage 1’s compatibility boundary has one reachable ordering regression and supersession does not protect persistence.

### Blocking findings

1. **An older rename can overwrite a later edit.**

Rename A remains projected while a later edit of the first question writes title B through `legacy.apply` ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1550)). When rename A answers, success *or failure* commits A into `base` ([reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:248)).

This is reachable: rename from the list, open the conversation while the PATCH is slow, then edit its first question. Before this commit, the later edit remained B; now the older rename eventually restores A.

The development assertion does not catch this: it checks for a represented `TurnOperation`, while the live edit is precisely an unrepresented legacy turn ([reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:187)). Therefore the assertion is insufficient.

2. **Rename supersession protects only the local projection, not the stored title.**

Both PATCHes start immediately. Marking A superseded neither cancels nor serializes its request ([controller.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/controller.ts:116)). The PATCH route is not placed in `inTurnOrder` ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3842)).

Therefore B can write and return first, then A can write last. The reducer continues showing B while the database contains A; reload restores the replaced title. The pure reducer tests cannot expose this.

### Other findings

- Ordinary cancel rollback is equivalent: the tombstone prevents turn writes, and removing it reveals the preserved base. But tombstones have no owner. `cancel → delete → cancel failure` removes the delete’s tombstone too; delete completion only retires its operation, so the conversation can reappear ([reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:139), [reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:177)). This largely inherits the old weakness, but the new model should resolve it.
- A superseded rename failure still overwrites `error`, even after the newer rename succeeds ([reduce.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/chat/reduce.ts:268)). It cannot restore the title, but its generic message misleadingly makes the current rename look failed.
- Every `ChatState` write does pass through `reduce`. `released` and `recovering` remain separate React state. The turn, watcher, repair, stop, and cancel answers still bypass the result gate through ungated compatibility events, as documented.

### Controller lifecycle

StrictMode is safe: the second load removes the first operation, so either late outcome is refused. `useSyncExternalStore` also covers the subscription-change gap; the render reads the new controller immediately and React rechecks snapshots while changing subscriptions.

One caveat: replacing `held.current` during render ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:586)) can lose the old controller if an in-place concurrent slug render is abandoned. Production remounts by slug, so this is not currently reader-reachable.

### Stage 2

Stage 2 remains the right architectural move, but not exactly as written:

- Mixed title ownership must be designed: a first-question edit needs to supersede an earlier rename’s *title*, without superseding the whole turn.
- Rename requests need ordered persistence or a server-side fence.
- Cancel rollback needs tombstone provenance.
- The plan says existing tests remain unchanged while also requiring exactly one early stop/cancel request ([260828v-chat-operation-model.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828v-chat-operation-model.md:230)). The characterization tests currently require two stop requests and one doomed cancel request ([chat-intent-paths.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-intent-paths.test.ts:118)). Stage 2 must deliberately change those tests and behaviour.

No files changed.