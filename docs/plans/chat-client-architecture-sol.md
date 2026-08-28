## Verdict

Yes. Much of this complexity is reducible.

The missing concept is not quite “client or server owns this row.” The server always owns durable truth. The missing client concept is:

> Every asynchronous action is an operation with its own identity, phase, intent, and exclusive right to update a particular projection.

Today, row IDs stand in for operation IDs. That cannot work reliably because retry deliberately reuses an answer row, while the server correctly distinguishes attempts ([useChat.ts:191](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:191), [routes.ts:742](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:742)). The refs are an informal operation ledger assembled one concern at a time.

I would replace that ledger with a small plain-TypeScript controller and state machine. No dependency, no server rewrite, no big bang.

One detail: this checkout currently has 11 `useRef` calls in `useChat`, not twelve; `useComments` has one. The numerical difference does not affect the finding.

## Diagnosis

There are three different things in one `threads` array:

1. Server facts: stored threads, messages, attempts, conflicts.
2. This tab’s projection: provisional IDs, optimistic edits, hidden deletions, partial text.
3. Processes currently changing that projection: load, send, retry, edit, stop, cancel, repair, recovery.

The third has no first-class representation. It is spread across `running`, `owned`, `watched`, `attempts`, the stop sets, mutable variables inside `run`, and several effects. The consequences line up with the twelve bugs:

- Stale loads have no operation identity, hence `showing`, `load`, and `live` ([useChat.ts:622](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:622)).
- Streams have no operation record, hence `owned`, `released`, and `watched` ([useChat.ts:980](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:980)).
- Stop/cancel intent has nowhere to live before `begin`, hence two sets ([useChat.ts:825](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:825)).
- The client has provisional identities but no atomic “these are now the server identities” transition, hence the half-swapped-ID failure ([useChat.ts:1238](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1238)).
- Every asynchronous completion decides for itself whether it is still entitled to write. Bugs 10 and 12 are the inevitable result: the entitlement check had to be copied into both success and failure paths ([useChat.ts:714](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:714)).

The server is already shaped better. It has stored attempts, process-local live attempts, ordered destructive writes, narrow tail guards, and an atomic cancel route ([contracts.ts:512](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/contracts.ts:512), [routes.ts:1563](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1563)). I would preserve those.

## Target shape

`useChat` should become a React façade over a `ChatController`. The controller synchronously applies events through one pure transition function and runs the resulting commands. React subscribes to its snapshot, probably with `useSyncExternalStore`.

`useSyncExternalStore` is an implementation mechanism here, not the solution. The operation model and admission gate are the solution.

A representative model:

```ts
type OperationId = string & { readonly __chatOperation: unique symbol };
type Intent = "none" | "stop" | "discard";

type LoadPhase =
  | { phase: "idle" }
  | { phase: "loading"; opId: OperationId; startedAtRevision: number }
  | { phase: "ready"; opId: OperationId }
  | { phase: "failed"; opId: OperationId; error: string };

type TurnIds = {
  threadId: string;
  questionId: string;
  answerId: string;
};

type TurnOperation =
  | {
      phase: "opening";
      opId: OperationId;
      command: SendCommand | RetryCommand | EditCommand;
      ids: { kind: "local"; value: TurnIds };
      intent: Intent;
    }
  | {
      phase: "streaming";
      opId: OperationId;
      command: SendCommand | RetryCommand | EditCommand;
      ids: { kind: "server"; value: TurnIds };
      attempt?: string;
      text: string;
      tools: ToolRun[];
      intent: Intent;
    }
  | {
      phase: "recovering";
      opId: OperationId;
      ids: { kind: "server"; value: TurnIds };
      attempt?: string;
      startedAt: number;
      intent: Intent;
    };

interface ChatState {
  slug: string;
  revision: number;

  /** Last accepted server facts. */
  base: readonly ChatThread[];

  /** Optimistic turns and mutations projected over base. */
  operations: ReadonlyMap<OperationId, ChatOperation>;

  /** The one operation currently allowed to patch each answer row. */
  writerByAnswer: ReadonlyMap<string, OperationId>;

  tombstones: ReadonlyMap<string, number>;
  load: LoadPhase;
  error: { opId: OperationId; message: string } | null;
}
```

`threads` becomes a derived projection of `base + operations − tombstones`. That matters on a 409: drop only the refused optimistic operation, adopt the refreshed server thread, and reapply unrelated local operations. No whole-list or whole-thread snapshot needs to overwrite them.

Every asynchronous result must contain an `opId`:

```ts
type ChatEvent =
  | { type: "load.succeeded"; opId: OperationId; threads: ChatThread[] }
  | { type: "load.failed"; opId: OperationId; error: string }
  | { type: "turn.began"; opId: OperationId; ids: TurnIds; attempt?: string }
  | { type: "turn.delta"; opId: OperationId; text: string }
  | { type: "turn.done"; opId: OperationId; message: ChatMessage }
  | { type: "turn.failed"; opId: OperationId; error: string }
  | { type: "turn.disconnected"; opId: OperationId }
  | { type: "recovery.settled"; opId: OperationId; message: ChatMessage }
  | { type: "turn.intent"; opId: OperationId; intent: "stop" | "discard" };
```

The admission rule is once, above all branches:

```ts
const op = state.operations.get(event.opId);
if (!op || !accepts(op, event)) return unchanged(state);
```

That is what structurally prevents bug 12. A catch cannot forget its stale-load check because a failure without an operation ID is not a valid event, and the shared gate rejects a dead operation.

Key transitions:

| From | Event | Result |
|---|---|---|
| loading | current success/failure | settle load |
| loading | event for older `opId` | no-op |
| opening | begin | replace the complete `TurnIds` object atomically; enter streaming |
| opening | stop/discard | store one exclusive intent; send it after begin |
| streaming | delta/tool | apply only if `writerByAnswer[id] === opId` |
| streaming | disconnect | enter recovering without releasing ownership |
| streaming/recovering | done/error | commit result, remove operation and writer |
| any terminal/dead operation | any later frame | no-op |
| any phase | delete | tombstone once; every projection path obeys it |

The controller may retain one private `Map<OperationId, Runtime>` for `AbortController`s, readers, and timers. Those genuinely are mutable runtime handles and do not belong in React state. One such registry is honest; eleven unrelated registries are the smell.

## What happens to the refs

| Current ref | Target |
|---|---|
| `onScreen` | Remove; edit creates an operation from the controller’s synchronous current snapshot. |
| `gone` | Becomes `state.tombstones`, updated atomically with removal/rollback. |
| `latest` | Remove; cancel’s operation stores the rollback value before hiding it. |
| `showing` | Remove; state carries `slug`, and every completion carries `opId`. |
| `running` | Remove; derive active operations per thread. |
| `load` | Remove; replaced by `LoadPhase.opId`. |
| `stopWanted` | Merge into `TurnOperation.intent`. |
| `cancelWanted` | Same union; the type cannot hold both intents. |
| `attempts` | Becomes a field on the streaming operation. |
| `owned` | Replace with `writerByAnswer`; an operation, not a row, is the writer. |
| `watched` | Remove; recovery is a phase of the same operation or a newly created recovery operation for a loaded pending row. |

`released` also disappears. Moving from `streaming` to `recovering` is itself a state transition, so React no longer needs an otherwise meaningless counter to notice that a ref changed.

## Staged path

1. **Make arrival loading an explicit operation now.** About 0.5–1.5 days.

   Add `LoadPhase` and a small reducer while leaving the rest of `useChat` untouched. Both success and failure dispatch an action carrying the load’s `opId`; the reducer alone rejects stale actions. Keep `mergedArrival` initially.

   This independently eliminates the machinery behind bugs 9–12. It also lets the stale comment in `ChatPanel` saying the load “replaces the whole list” be corrected ([ChatPanel.tsx:91](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:91)).

2. **Introduce the operation reducer and migrate one path at a time.** About 3–5 days.

   Suggested order:

   - send → begin → delta → done;
   - retry/edit and 409 repair;
   - stop/cancel intent;
   - lost-stream recovery;
   - rename/delete operations.

   Keep the existing `ChatApi` throughout. Each migration is independently shippable; unmigrated methods can continue dispatching legacy projection actions temporarily.

3. **Extract the controller and driver.** About 1–2 days, overlapping with step 2.

   The pure transition function decides state and emits commands; the driver performs fetch/SSE/timers and sends events back. `useChat` subscribes and exposes the current API.

   This creates a deterministic harness where tests can deliver `begin`, delete, load success, load failure, disconnect, recovery, and done in arbitrary orders without involving React scheduling.

4. **Only then consider sharing the controller across mounts.**

   Initially keep one controller per mounted `useChat`. If preserving a live conversation across `ChatDialog` → `ConversationBand`, chat → review, or another mode becomes important, lift a lazily started article controller above those surfaces. The existing plan records that remounting can currently hide a just-started conversation ([chat-mode.md:1095](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/chat-mode.md:1095)).

## Tests

Keep every existing integration test. The public hook contract need not change.

The pure `withServerIds` tests eventually become `turn.began` transition tests; their invariant remains important, but the helper itself may cease to exist. The arrival and recovery suites remain valuable façade tests ([chat-arrival-race.test.ts:321](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-arrival-race.test.ts:321), [use-chat-recovery.test.ts:319](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/use-chat-recovery.test.ts:319)).

Add dependency-free invariant tests that permute small event sequences:

- A stale or terminal operation can never change state.
- Every pending answer has exactly one writer or recovery operation.
- A tombstoned thread cannot be projected by any event.
- `stop` and `discard` cannot coexist.
- `begin` changes all three IDs in one transition.
- Removing one of two active operations cannot announce that the other is gone.
- Success and failure have identical admission rules.

The present tests are good incident regressions, but their structure explains the recurrence: `loadFailed` and `error` needed separate tests for the same stale completion ([load-failed-flags.test.ts:3](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/load-failed-flags.test.ts:3), [chat-arrival-race.test.ts:378](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-arrival-race.test.ts:378)).

## What I would not do

- **No Redux, Zustand, XState, TanStack Query, or similar.** The needed machinery is a discriminated union, a pure transition function, and a small driver. A dependency would be a third framework exception without buying the project-specific invariants ([vision.md:58](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/vision.md:58)).
- **No naïve “put all state in `useReducer`.”** Without operation IDs and one admission gate, that merely relocates the races.
- **Do not split ownership into `useThreadList` and `useTurn`.** The list/turn collision is the problem. Split selectors or files only after both share one controller.
- **No stream sequence numbers now.** One fetch body is already read in order ([sse.ts:86](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/sse.ts:86)). Sequence numbers would not fix stale GETs, deletion, provisional IDs, wrong attempts, or remounts. Add them only if streams later support replay or reconnection.
- **No general list version as a write precondition.** The Postgres store deliberately rejected this because it would turn safe concurrent appends into conflicts ([pg-chat.ts:45](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-chat.ts:45)). `expectedTailId` is the correct narrow destructive guard.
- **Do not move reconciliation “entirely server-side.”** The server cannot know which optimistic projection this tab has shown or whether a response was delayed after leaving it.
- **Do not refactor `ChatPanel` concurrently.** Its size is mostly view behaviour. Its per-conversation `busy` derived from the final message is exactly right and should remain ([ChatPanel.tsx:906](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatPanel.tsx:906)).

## Related areas

Leave `useComments` and `useSearch` alone during the chat migration. They show the same family—tombstones, provisional IDs, per-row ordering—but have materially simpler lifecycles ([useComments.ts:166](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useComments.ts:166), [useSearch.ts:137](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSearch.ts:137)). After chat proves the operation model, copy the concept into the next sibling that needs it; do not invent a generic streaming-hook framework in advance.

Keep `useChatAnchors` as a low-frequency projection. Lifting token-by-token transcript state above `TableView` would re-render and re-annotate the article on every delta ([useChatAnchors.ts:6](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChatAnchors.ts:6)). A shared controller could later emit summary changes only on create, rename, terminal answer, and delete.

The other-tab resurrection is a separate consistency boundary. No local state machine can reject a deletion it has never heard about. The boring 80/20 fix is:

- broadcast a successful deletion through `BroadcastChannel`;
- revalidate chat on focus/visibility return.

A server revision helps only when paired with some way for the other tab to learn the newer revision. A bare revision or `deletedAt` does not stop an already captured older response from arriving first.

## Cost and timing

The core work is roughly 5–8 developer days, split into safe pieces. The first day is worthwhile even if nothing else happens.

My recommendation:

- Do the explicit load operation now.
- Make the turn-operation/controller work a prerequisite for the next feature that adds another chat transition.
- If chat development is continuing immediately, pay the remaining cost now; twelve concurrency findings in three days is enough evidence that another feature will otherwise buy another local guard.
- Do not change the server contract or introduce a state library as part of it.

This does not make distributed concurrency disappear. It does make “an obsolete async result changed the current screen” and “two processes both believed they could write this row” centrally expressible and mechanically rejectable. That is the class the current shape is repeatedly rediscovering.

Read-only consultation; I made no changes and ran no test suite.

