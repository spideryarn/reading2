**CR-6 remains P1, established. CR-1 through CR-5 are closed. No CR-7 finding.**

| Fix | Assessment |
|---|---|
| CR-1 | Correct: checks the locked transaction snapshot before writing. Both conflict tests fail without the guard. |
| CR-2 | Correct: displayed origins come from server metadata. Removing the fix reproduces both the missing origin and the falsely labelled plain thread. |
| CR-3 | Correct: completion survives detach, defers to recovery/repair, and fires once. Removing notification makes the detached completion assertion fail. |
| CR-4 | Correct: an empty draft with a pending origin restores. Removing the condition loses the origin. |
| CR-5 | Correct for its reported case: failed first Send resumes the original ID. Removing the branch restores another ID. |
| CR-6 | Its original regression passes and fails without durable confirmation, but acknowledgement **after remount** remains broken. |

No other regression found in the ordinary chat, floating block chat, Remember, draft restoration, blank arrival, retry, edit or Live paths.

**CR-6 — P1, established: a reopened composer misses the corrected ID.**

The durable callback in [ConversationModes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/chats-started-from-a-mode/src/web/modes/conversation/ConversationModes.tsx:1001) updates drafts, while the reopened band owns a different controller.

(a) Reproduction:

1. Send an origin draft; hold the response before `begin`.
2. Leave Chat, then return while the server list remains empty. CR-5 resumes the guessed ID.
3. Release `begin` acknowledging a different ID.
4. Send a follow-up from the reopened composer.

The runtime reproduction sent:

```ts
{ threadId: guessedId, question: "held followup", at: null }
// No origin; expected threadId was the acknowledged replacement ID.
```

The draft had moved to the confirmed ID, but the mounted controller and composer still addressed the guess. The original CR-6 test releases acknowledgement **before** returning, so it misses this order.

(b) Smallest safe closure: publish the acknowledged thread snapshot to mounted bands, and adopt it only when the band still displays the guessed ID. Extend `onConfirmed` to supply that snapshot; keep detached navigation callbacks detached.

```ts
onConfirmed: (id, acknowledgedThread) => {
  if (id !== current) {
    drafts.moveThread(current, id);
    if (drafts.destination() === current) drafts.setDestination(id);
  }
  drafts.clearOrigin(id);
  drafts.publishConfirmation({ from: current, thread: acknowledgedThread });
};

useEffect(() => drafts.subscribeConfirmed(({ from, thread }) => {
  if (kind !== "chat" || selectedThread.current !== from) return;
  adoptConfirmed(from, thread);
  void setThread(thread.id, { history: "replace" });
}), [drafts, kind, adoptConfirmed, setThread]);
```

These proposed APIs need an article-scoped subscription and a controller transition replacing the placeholder and clearing its unnamed status. Carry the pending assistant row too, so recovery follows the confirmed conversation.

Validation: **67 tests across seven offline files passed**. CR-1’s exact suite was tested red; CR-2–CR-6 mutation checks used standalone real-band/controller probes in `/tmp` after Vitest’s memory admission refused further runs. The remaining CR-6 failure was reproduced there. No repository file changed.

do not land