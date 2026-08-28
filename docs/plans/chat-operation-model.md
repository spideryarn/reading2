# The chat operation model — the build plan

**Status:** stage 1 built as `6f35022`, reviewed by GPT Sol, and one reader-reachable regression
fixed on top, 2026-08-28. **Stage 2 built 2026-08-28 as `852eda2`, refused by GPT Sol with three ship
blockers, and rebuilt on top the same day.** Stage 3 is what is left of stage 3 after that, which is
less than this plan says below. What each stage turned out to need that this plan did not say is at
the bottom: [§ What stage 1 actually did](#what-stage-1-actually-did),
[§ What stage 2 actually did](#what-stage-2-actually-did) and
[§ What the review of stage 2 sent back](#what-the-review-of-stage-2-sent-back).

**The boundary between stages 2 and 3 moved**, and that is the headline. Intent — the thing stage 3
was for — is in stage 2, because the review found that the wish was lost in the one lifecycle
production actually has and nothing short of moving it into the state fixed that.

The strategy and the evidence for it are in
[chat-client-architecture.md](chat-client-architecture.md), which ends with steps 2–4 written down
and not built. This is the build plan for them. Greg asked for it on 2026-08-28, straight after step
1 landed, saying to run it as staged work with reviews
([engineering-manager.md](../reusable/engineering-manager.md)).

Read that document first. In one line: `src/web/useChat.ts` collected twelve concurrency bugs in
three days, and GPT Sol's diagnosis was that

> Every asynchronous action is an operation with its own identity, phase, intent, and exclusive
> right to update a particular projection.
>
> — GPT Sol, 2026-08-28

and that this file has no such thing, so ten different `await`s each decide for themselves whether
they are still entitled to write, from four different vocabularies.

**This plan was refused twice before it was fit to build**, and the shape of the work is different
because of it.

The first refusal — [chat-operation-model-sol.md](chat-operation-model-sol.md), "do not build yet" —
had four blockers: turns are not the only operations, because rename and delete are asynchronous too;
the stage that migrated turns without recovery was not deployable, because a live operation would go
on projecting a pending row over the watcher's patch; the stop-before-`begin` window needs something
that answers synchronously before the refs holding it can go; and the escape hatch is safe in exactly
one stage. Four stages became three, and a controller replaced a `useReducer`.

The second — [chat-operation-model-recheck-sol.md](chat-operation-model-recheck-sol.md) — endorsed
the controller and the three stages and found four more things missing: registration and admission
are different kinds of event and one gate cannot do both; `loaded` has to outlive the operation that
answered it; a base updater cannot stand in for the tombstones; and an operation needs a defined way
of *retiring*, not only of projecting, or two renames finishing out of order put the old title back.
All four are written in below.

## What we are building

Three new modules under a new `src/web/chat/` directory. `useChat.ts` becomes a façade over them.

- **`src/web/chat/model.ts`** — the state, the events, and the operation union. Types and small pure
  helpers.
- **`src/web/chat/reduce.ts`** — one pure function,
  `reduce(state, event) => { state, commands }`, and **two kinds of event**, which is a distinction
  the first two drafts of this plan did not make and could not work without.

  An **input** is the reader doing something, or this code starting something: send, rename, delete,
  load. It *registers* an operation, so it cannot be gated — the gate rejects anything whose
  operation it cannot find, and a registration's operation does not exist yet by definition.

  A **result** is the world answering: a frame, a response, a failure, a timeout. Every one of them
  carries the `opId` of the operation it belongs to, and every one goes through one gate:

  ```ts
  const op = state.operations.get(event.opId);
  if (!op || !accepts(op, event)) return { state, commands: [] };
  ```

  That gate is the point of the whole exercise. It is the one place an obsolete result is refused,
  so it cannot be missing from a path — because there are no other paths. The types enforce the
  split: a result event without an `opId` does not compile.

- **`src/web/chat/controller.ts`** — holds the state, applies an event **synchronously**, runs the
  commands the reducer asked for, and tells its subscribers.

  **By the end of stage 2 it is the only thing that fetches, streams or sets a timer.** It is not
  that in stage 1, and saying so matters: stage 1 leaves `run`, the watcher and the 409 repair
  running in the hook, talking to the controller through the bridge described there. Sol caught the
  first draft promising the end state as though it were the starting one.

`ChatApi` — what the panel sees — does not change at any point. Neither does the server.

### The state

```ts
interface ChatState {
  slug: string;
  /** What this tab believes, before anything in flight is laid over it. */
  base: readonly ChatThread[];
  /** Everything asynchronous that is happening, each under an id of its own. */
  operations: ReadonlyMap<OpId, Operation>;
  /** Conversations the reader deleted. Deletions win over every projection. */
  tombstones: ReadonlySet<string>;
  /**
   * Where the one fetch that fills the list got to — and it outlives that
   * fetch's operation, which is why it is a field rather than a lookup.
   */
  loadPhase: "loading" | "ready" | "failed";
  error: string | null;
}

type Operation =
  | LoadOperation      // the one fetch that fills the list
  | RepairOperation    // one conversation, re-fetched because a 409 said the screen is wrong
  | TurnOperation      // a send, a retry or an edit, and the stream it is reading
  | RecoveryOperation  // a pending answer nobody is streaming, being looked for
  | RenameOperation
  | DeleteOperation;
```

**`loadPhase` is durable, and the operation is not.** An operation retires when it finishes; `loaded`
and `loadFailed` have to stay answerable long after that, because the panel reads them on every
render — "we have asked" is a fact about the past. Sol asked where that fact lives once the load
operation is gone, and this is the answer.

**The 409 repair is an operation of its own**, not a second use of the load's. Refusing the turn and
registering the repair is **one transition**: they are the same decision — this conversation on
screen is wrong, drop what made it wrong and go and ask. Split across two, there is a moment where
neither is true, and the repair's answer then arrives with nothing to admit it.

`threads` — the array the panel renders — is **derived**: take `base`, drop the tombstoned, and lay
each operation over the conversation it belongs to. It is never assigned.

**One map, holding every kind, and that is a correction.** The first version of this plan had
`operations` hold turns alone, with the load's id kept beside it in a `load` field. Sol refused it,
and the reason is that the gate above is then a lie: a load's result carries an `opId` the gate
cannot find, so the load needs a second entitlement check somewhere else, which is precisely the
shape that produced bugs 10 and 12. If a thing has an id and can come back late, it is in the map.

**Rename and delete are operations too**, for the same reason and one more. They are asynchronous —
they share [`write`](../../src/web/useChat.ts), whose `catch` writes `error` with no guard at all —
so a rename that fails after the reader has moved on is bug 12 again, wearing a different hat. And a
409 repair that refreshes a conversation can land over a rename still in flight, which is the
snapshot-over-newer-projection class from the top of the list. Their *optimistic behaviour* does not
change: today a failed rename or delete deliberately stays on screen, and it still will. The
operation is there to admit the completion, not to roll it back.

**`begin` and `discard` write `base` directly.** They are synchronous and local — starting an empty
conversation touches no server, and discarding one is a filter. There is nothing to arrive late, so
there is nothing to admit.

### Why a projection, and not just a tidier list

The concrete payoff is the 409 path, and it is worth stating because it is what tells the difference
between this and a cosmetic refactor.

An edit destroys: it rewrites a question and discards every turn under it. Today that is performed
on screen, and if the server refuses, the only way back is to re-fetch the conversation and hope
nothing else was happening in it — which is exactly the "a snapshot landed over an unrelated send"
bug this file already carries three paragraphs about.

As a projection, the discard is something the *operation* does when it is laid over `base`. Refusing
it is dropping one entry from a map. The discarded turns come back because they never left, and any
other conversation with a send running in it re-projects untouched. No fetch, no merge rule, no
timing argument.

### Why a controller rather than `useReducer`

Because of one window. A stop pressed in the moment before the `begin` frame is remembered and sent
as soon as there is an id to send it with — see `stopWanted`. Consuming that wish means reading the
current state at the instant `begin` arrives, and **`dispatch` does not update a closure
synchronously**: a reducer would tell us the answer on the next render, which is after the frame has
been handled. Sol's third blocker. A controller applies the event and hands back the new state on the
same line, which is what that window needs, and it is also what removes `onScreen` and `latest` —
two refs that exist only to read current state from outside a render.

React sees it through `useSyncExternalStore`. The controller keeps **one cached projection** and
rebuilds it only when the state changes, because `getSnapshot` is called on every render and must
return the same reference when nothing has moved.

## The stages

Three, each ending green and committable. If the work stopped after any one of them, what landed
would still make sense.

### Stage 1 — the machine, the load, and the two mutations

`model.ts`, `reduce.ts` and `controller.ts` exist. `useChat` subscribes to the controller and
projects. Migrated to real operations: the **load** (`load.succeeded` / `load.failed`, both carrying
its `opId`), **rename** and **delete**. `begin` and `discard` write `base`. Tombstones move into
state.

Everything else — the whole of `run`, the watcher, the 409 repair — keeps working by dispatching a
temporary `legacy.apply` event carrying a pure updater for `base`, and by reading current state
straight off the controller, which is synchronous.

**A base updater is not enough on its own, and that is the second thing Sol caught.** The tombstones
are not in `base`: cancel adds one before its request leaves, a refused cancel takes it away again,
and every late patch in the file consults the set. So the tombstones move into state in this stage
with two explicit events of their own, and the code still living in the hook reads
`controller.state.tombstones` where it reads `gone.current` today. That read is synchronous, which is
the whole reason the controller is here.

**`legacy.apply` exists in this stage and no other.** Sol was explicit about why: while there are no
turn operations it merely relocates updaters that still carry their own guards, and the moment turn
projection starts it becomes an opaque write to the base underneath a live operation. Neither an
allowlist nor a slug check makes that safe, because a slug cannot tell two loads of one article apart
— which is bug 10. So it carries a development-only assertion that no turn operation exists, and
stage 2 deletes it.

Gone by the end: `gone`, `latest`, `onScreen`.

**Done looks like:** every existing chat test green; `reduce` has dependency-free tests, including
one that watches a stale load's success *and* its failure be refused by the same gate; a test that a
late rename failure cannot write `error` after the reader has moved on — which nothing pins today;
and the reverse-order rename above.

### Stage 2 — the turn, in one piece

**Built 2026-08-28.** Read [§ What stage 2 actually did](#what-stage-2-actually-did) alongside this:
most of it held, and the two places it did not are worth more than the places it did.

`send`, `retry` and `edit` each create a `TurnOperation`; every frame becomes an event carrying its
id: `turn.began`, `turn.delta`, `turn.tool`, `turn.done`, `turn.failed`, `turn.disconnected`. The
text and the tool runs accumulate **in the operation**, not in the row, which is where `drainTurn`
already keeps them and for the same reason.

**Recovery and the 409 come with it, and that is Sol's second blocker.** They cannot be a later
stage: today a stalled stream leaves the answer `pending`, releases it, and lets the watcher adopt
it — and if the turn is an operation while the watcher still patches `base`, the live operation goes
on projecting its pending row over the patch, so the answer arrives and is invisible. The refused 409
is the same shape: refreshing `base` does nothing while the refused edit is still projected over it.
So `turn.disconnected` hands the answer to a `RecoveryOperation`, and the 409 drops the refused
operation *and then* refreshes the conversation, in one transition.

`turn.began` is one transition that swaps all three ids at once — thread, question and answer —
rather than the two-of-three swap that shipped once and surfaced weeks later as "That message is not
in this conversation."

The writer of an answer row is an **operation**, not a row id, which is the thing a retry breaks by
reusing the row.

Stop and cancel keep their two sets in this stage, consumed where they are consumed now — but the
controller's state is readable synchronously at that point, so the window stays closed.

Gone by the end: `legacy.apply`, `owned`, `released`, `attempts`, `watched`, `running`, `showing`,
`recovering` as stored state, and the four mutable variables inside `run`.

**Done looks like:** a browser pass confirming an answer still streams in, a stop still stops and a
cancelled conversation still disappears, and four tests that must exist before this stage ships. Sol
moved the first two here from stage 3, and the reason is exact: this stage rewrites `turn.began` and
moves command delivery, which *is* the machinery that holds those two wishes. Testing them
afterwards tests the replacement, not the change.

- a stop pressed before `begin`, and a cancel pressed before `begin`, each producing exactly one
  request carrying the server's thread id, answer id and attempt;
- a disconnected turn leaving exactly one recovery writer;
- a 409 dropping the turn and gating the repair;
- two operations in one conversation completing in reverse order.

**The first of those changes an existing test, deliberately, and this plan used to claim otherwise.**
It said "every existing chat suite green **unchanged**" and asked for exactly one early request in
the same breath, which cannot both be true:
[`tests/chat-intent-paths.test.ts`](../../tests/chat-intent-paths.test.ts) pins what the code does
today — **two** `/stop` requests, the first carrying an id the server has never heard of, and a
`/cancel` that is likewise doomed. Those are characterisation tests, written to catch an accidental
change; this stage changes that behaviour on purpose, so those assertions move with it and the change
is the finding. The rule that no test is rewritten *to make a stage pass* still stands, and it is a
different rule. It also said "nothing in the repo covers either today", which was true when it was
written and stopped being true on 2026-08-28.

**Three things stage 1 turned up that belong here.**

- **Rename needs ordered persistence or a server fence.** Supersession fixes the *screen* — the
  reader sees the title they asked for last — and does nothing about the database: two PATCHes are
  two requests, and the server writes whichever arrives last. `6f35022`'s commit message said
  supersession made the reverse-order case right, and that overclaims by exactly the width of the
  wire. The narrow fix is the one `expectedTailId` already uses on the destructive path: send
  something the server can refuse.
- **Tombstones need provenance.** They are a bare `Set<string>`, so nothing records *which*
  operation put one down. `cancel` → `delete` → the cancel's failure removes the delete's tombstone
  too, and a conversation the reader deleted comes back. Deletions are supposed to win over every
  projection; here one loses to an unrelated request failing.
- **The cancel-before-`begin` window is worse than "the wish is never re-sent", and this stage is
  where it gets fixed.** The dead branch is written up in
  [cancel-before-begin.md](../postmortems/cancel-before-begin.md); what that did not say until it was
  measured is that the one request which *does* go out reaches a real route, and
  [`cancelChat`](../../src/routes.ts) has two answers for it, both wrong for the reader
  ([`tests/chat-cancel-before-begin.test.ts`](../../tests/chat-cancel-before-begin.test.ts)):

  - **Not written yet → `200 { cancelled: true }`**, from the deliberate `if (!thread)` branch. The
    client is told it worked, nothing is aborted, `beginTurn` writes the conversation a moment later
    and the answer runs to completion. The reader is told they discarded something that is still
    there. **The common case** — the frame is emitted right after the write, so "no frame yet" mostly
    means "not written yet" — and the worse one, because nothing on screen is wrong at the time.
  - **Written, frame in flight → `409` on the tail id.** `askToCancel` reads any refusal as "the
    premise was wrong", so the tombstone comes off, the conversation returns with an error under it,
    and the frames start landing in it again. The reader watches the answer they cancelled carry on
    typing.

  **Two rules the fix must obey.** Send **once**, when there is an id the server can match. And never
  read "the server could not match that id" as a refusal *or* as a success — case 1 comes back `200`,
  so a client that trusts the status is wrong in the quiet direction.

  **Three fixes that do not work**, so that they are not each rediscovered. Every one of them fails
  for the same underlying reason — it needs to know **whether this row has a server name yet**, which
  is a fact about the turn, and the turn is not represented until this stage:

  1. *Move the cancel check to the correct side of the reassignment* — the one-liner. It fires the
     wish, and the re-send then races `askToCancel`'s restore: the 409's `catch` can land after the
     re-send has succeeded, leaving the reader looking at a conversation the server has deleted.
     Today screen and server agree; this makes them disagree.
  2. *Re-add the tombstone in `nameRow` before re-sending* — narrows that race and does not close it.
     The `catch` can still land last and take the tombstone off again.
  3. *Suppress the restore while `cancelWanted` still holds the id* — `cancelAndDiscard` adds to that
     set on **every** cancel and nothing consumes it after `begin`, so it cannot tell the doomed
     cancel from a genuine post-`begin` one; it would suppress the legitimate restore and break
     `tests/chat-intent-paths.test.ts`. A fourth, *ask `attempts` whether the row is named*, looks
     right and is the most dangerous: it is keyed on `begun.attempt`, which is **optional** and
     documented as "missing means the server did not say", so a server that omits it would turn every
     cancel into a wish nobody ever consumes — no request at all, ever.
- **Mixed title ownership needs designing.** An edit of the first question renames its conversation,
  so it must supersede an earlier rename's **title** without superseding the whole turn — which the
  current single `superseded` flag cannot express, since it is per-operation rather than per-thing-
  it-owns. Stage 1 sidesteps it by having rename write `base` and draw nothing (see below); once a
  turn projects, the edit's title is projected and the question comes back.

### Stage 3 — intent, and the invariants

**Intent moved into stage 2 and is built.** This section is kept as it was written, because the
paragraph below it — the invariant tests — is still stage 3's, and because the reason it moved is
worth more than the plan it replaced:
[§ What the review of stage 2 sent back](#what-the-review-of-stage-2-sent-back).

~~Stop and cancel stop being two sets of message ids and become one `intent` field on the turn
operation that the type will not let hold both at once — which is today an invariant maintained by a
comment.~~ They are one field on an operation of their own — an `IntentOperation`, not a field on the
turn, because a wish can outlive the turn it was waiting on and can be aimed at a row a recovery
owns. `stopWanted` and `cancelWanted` are gone, and with them the last ref.

**Done looks like:** the invariant tests Sol asked for, each permuting a small event sequence —

- a stale or terminal operation can never change state;
- every pending answer has exactly one writer or one recovery operation;
- a tombstoned conversation cannot be projected back by any event;
- stop and discard cannot coexist;
- `turn.began` changes all three ids in one transition;
- removing one of two live operations cannot announce that the other is gone;
- success and failure are admitted by the same rule.

The two early-intent tests are **not** here: they ship with stage 2, which is the stage that moves
the machinery holding those wishes. ~~This stage folds the two sets into one field and must leave
them green.~~ Stage 2 did that too. What is left for this stage is the list above and nothing else,
so it is now a stage of tests: seven invariants, each permuting a sequence, over a machine that is
already built. Two of them — "stop and discard cannot coexist" and "every pending answer has exactly
one writer" — have one test each already
([`tests/chat-reduce.test.ts`](../../tests/chat-reduce.test.ts)); the permutation is what is missing.
The one thing that is still a *change* rather than a test is the **rename fence**, below.

## Rules the code must follow

- **The reducer is pure, and proved so.** It never mutates a `Map`, a `Set`, an operation, a message,
  a tool array or the event it was handed. Ids and timestamps are minted outside it and arrive on the
  event. Tests deep-freeze the input and run each transition twice, because React invokes an updater
  twice under StrictMode and this file has been bitten by an impure updater before.
- **Structural sharing.** A delta rebuilds one message in one thread. Projection cost must stay
  comparable to today's, because a chat delta re-renders `ConversationBand`, and the article is
  underneath it.
- **Two operations in one conversation have a defined order** — creation order — and it is tested.
  Testing only concurrent operations in *different* conversations would skip the hard case.
- **And a defined way of retiring, which is not the same question.** Creation order says what to do
  while both are live; it says nothing about what happens when the second one finishes first. Sol's
  example, and it bites in stage 1: rename A, then rename B, and B comes back first. Commit B, retire
  it, and A — still live, still older — projects again, so the reader watches the title they replaced
  come back.

  So an operation says what it **supersedes**, and a superseded operation stops projecting the moment
  the newer one is registered. A rename supersedes the previous rename of that conversation; a delete
  supersedes everything for it. A turn supersedes nothing, because two sends in one conversation are
  two appends and both belong on screen. A superseded operation is still admitted when it answers —
  its failure still has something to say — it simply has nothing left to draw. **Tested by completing
  two renames in the reverse order.**

### What the façade must still do, exactly as it does now

The acceptance list, from Sol. Each of these is behaviour `ChatApi` has today and must keep:

- `send` and `begin` return an id **synchronously**;
- `onThreadId` fires when the server overrules the thread id;
- the reader's question and the empty answer row appear before the request leaves;
- a retry blanks the fields of the answer it replaces, carrying only `stance`;
- a refused edit puts the discarded turns back;
- a refused cancel puts the conversation back;
- a failed rename or delete does **not** roll back, and says so in `error`;
- `loaded` means "we have asked", not "it worked"; `loadFailed` is the difference.

## How each stage is checked

- **Watch the gate fail.** Every stage that claims the admission gate covers a path shows it: delete
  the gate in a probe copy, watch the tests go red, put it back. A check never seen fail is not
  evidence — [silent-success.md](../reusable/silent-success.md).
- **No existing test is rewritten to make a stage pass.** The chat suites are the contract. If one
  has to change, that is a finding, and it goes in this document with the reason.
- `npm test` and `npm run typecheck` clean at the end of each stage.
- **A browser pass on stage 2**, in a Sonnet subagent — a green suite is not evidence a reader can
  watch an answer arrive ([browser-testing.md](../project/browser-testing.md)).
- **GPT Sol reviews every stage after it is built**, not skippable because a stage felt small.

## What this does not touch

Carried over from [chat-client-architecture.md](chat-client-architecture.md), where the reasoning
is: no state library; no stream sequence numbers; no version column on the chat list; no moving
reconciliation to the server; no refactor of `ChatPanel.tsx`; and `useComments` and `useSearch` stay
as they are until one of them needs this.

Two more, specific to this plan:

- **No shared controller above the mounted surfaces** — Sol's original step 4. One controller per
  mount. Lifting it is what would let a conversation survive `ChatDialog` → `ConversationBand`, and
  it is a separate decision with its own reasons, not a tidy-up that falls out of this.
- **The other-tab resurrection stays open.** A slow response can still bring back a conversation
  deleted in another tab. No client state machine can refuse a deletion it has never heard of, and
  the fix is `BroadcastChannel` plus revalidate-on-visibility. Separate work.

## What stage 1 actually did

Built 2026-08-28. Everything above held; these are the places where the code had to decide something
this plan did not say, and one place where the plan was wrong.

- **There are four modules, not three.** `project.ts` holds the projection. It is one function with
  one live branch in this stage, and it is separate because `reduce` and the controller both have a
  reason not to own it: the reducer must not know what a thread looks like on screen, and the
  controller caches what this returns.
- **`mergedArrival` and `withoutEmpty` moved into `chat/model.ts`**, docstrings and all, and
  `useChat.ts` re-exports both. The reducer needs them, and a module importing the module that
  imports it is a cycle — `npm run cycles` would have caught it. Everything that referred to
  "useChat.ts § `mergedArrival`" still lands on a real line.
- **`write` became a module-level `writeThread`** that maps every ending onto an outcome and does not
  throw, exactly as `askForThreads` does. The reader-facing wording — "Couldn't rename that
  conversation: …" — is composed in the reducer, because that is what knows which operation answered.
- **`cancelAndDiscard` no longer keeps a rollback copy, and that is what let `latest` go.** A
  tombstoned conversation is projected away rather than removed from `base`, and no frame may write
  to it, so it sits there exactly as the reader last saw it. Putting it back after a refused cancel
  is removing the tombstone. `askToCancel` lost its `restore` parameter with it.

  **Pinned on both sides**, which is better than it looked while it was being written:
  `tests/chat-intent-paths.test.ts` — "puts the conversation back, and says so in error" — was
  committed that morning against the old code and watched red by deleting the restore from
  `askToCancel`'s catch. It passes against the new shape unchanged, which is the whole use of a
  characterisation test: it was written to describe a rollback copy and it still holds when the
  rollback copy is gone, because what it asserts is what the reader sees.
- **This answers the open question at the bottom of
  [the inventory](chat-operation-model-inventory.md)** — is `remove` structural like `begin` and
  `discard`, or its own thing? Its own thing. `begin` and `discard` write `base` and register
  nothing; `remove` is a `DeleteOperation` with a tombstone, registered in one transition, and never
  rolled back. `rename` is an operation too. The plan's paragraph naming three local edits was
  counting `rename` among them and should not have.
- **A rename writes its title into `base` at registration and draws nothing.** The first version of
  stage 1 had the operation draw the title and commit it when the PATCH answered, and that was a
  reader-reachable regression: **an edit of the first question renames the conversation too** —
  `editTurn` on the server says so and `edit` mirrors it — so an edit landing while the PATCH was out
  wrote a title into `base` that the operation drew over and then overwrote. Rename from the list,
  open the conversation on a slow connection, rewrite the first question, and the name you replaced
  comes back. Found by GPT Sol reviewing the built stage, 2026-08-28; reproduced red first in
  [`tests/chat-title-ownership.test.ts`](../../tests/chat-title-ownership.test.ts).

  **The rule it is an instance of, and the one to apply in stage 2: an operation projects what can
  still be withdrawn.** A refused edit's discarded turns come back because the operation never really
  took them away — that is the whole payoff of the projection. A rename's optimistic title is
  deliberately *never* withdrawn, even when the PATCH fails, so there is nothing for it to draw, and
  the last writer to `base` wins, which is the reader's own order.

  **The development assertion cannot police this**, which is the sharper half of the finding: it
  looks for a represented `TurnOperation`, and the live edit is precisely a legacy turn that has not
  been migrated. An assertion that can only see what has already been moved cannot see what has not.
- **A superseded rename's failure says nothing.** It is still admitted — it is still in the map — but
  the reader is looking at the newer title, and reporting the older one's failure tells them a rename
  that succeeded, or is still in flight, has failed. Supersession is still load-bearing for rename,
  then, but for the **error** rather than for the title.
- **`load.started` does not clear the list.** A controller is made per article, so arriving at one
  starts from an empty base already, and wiping it on a second load of the *same* article — which is
  every `StrictMode` mount — would throw away exactly what `mergedArrival` exists to protect.
- **The controller is latched in a `useRef`, not a `useMemo`.** React is explicitly allowed to throw
  a `useMemo` cache away and rebuild it, and rebuilding this one would silently empty the reader's
  conversation list. Constructing a controller has no side effects, so the latch is safe during a
  render. This is not one of the three refs the stage removes: it holds the controller, not state
  read from outside a render.

`gone`, `latest` and `onScreen` are gone, `ChatApi` is unchanged, and `tests/chat-reduce.test.ts`
covers the gate, supersession and purity with no React in it. The gate was watched failing: deleting
it in a probe copy turns exactly the four tests that name it red, including a stale load's success
and its failure separately. The two purity tripwires were watched failing too — a `Map` mutated in
place and a thread renamed in place — because `Object.freeze` on a `Map` does nothing at all to
`map.set`, and a freeze that cannot fail is not a check.

## Reference

[chat-operation-model-inventory.md](chat-operation-model-inventory.md) — every write to `threads`,
every ref with its read and write sites (marking the reads that happen after an `await`, which are
the staleness checks), and what each chat test would catch. Built before stage 1 so that "all of
them" can be checked rather than asserted.

## What stage 2 actually did

Built 2026-08-28. Everything above held except where this section says otherwise. Five modules now:
`effects.ts` joined `model.ts`, `reduce.ts`, `project.ts` and `controller.ts`, because the controller
runs the turn and the controller is imported *by* the hook — the request functions could not stay in
`useChat.ts` without a cycle.

`legacy.apply` and its assertion are gone, and so are `owned`, `released`, `attempts`, `watched`,
`running`, `showing`, `recovering` as stored state, `run` and its four mutable variables. What is
left in the hook is `stopWanted` and `cancelWanted`, which stage 3 takes.

### The rule that decided every branch, and what it dissolved

**An operation projects what can still be withdrawn** — stage 1's finding, applied to the turn. The
three shapes come out *different*, and that is the answer rather than an inconsistency:

- a **send** writes its two rows into `base` at registration, exactly as it always did, and the
  operation draws only the answer row's contents. Nothing withdraws the reader's own words; a
  refused send is repaired by fetching the conversation. Two other things turn on this and the plan
  named neither: `mergedArrival` protects a conversation it can see in `base`, and **two sends in one
  conversation stay in the reader's order however they finish**. Drawing them instead would have
  landed them in completion order, which is the plan's own "two operations in one conversation
  completing in reverse order" failing in the ordinary case rather than the exotic one;
- a **retry** draws a blanked row over the answer it replaces, so a refusal puts the old answer back;
- an **edit** draws the rewritten question, the discard, and the new answer. The payoff, unchanged
  from the plan.

**This dissolves "mixed title ownership" rather than solving it.** The plan said an edit's title must
supersede a rename's *title* without superseding the whole turn, and that a single per-operation
`superseded` flag cannot express it. It does not have to: **a title is never withdrawn, so no
operation draws one.** An edit writes its title into `base` at registration, the way a rename does,
and the last writer wins — which is the reader's own order.
[`tests/chat-title-ownership.test.ts`](../../tests/chat-title-ownership.test.ts) passes unchanged,
including the case that says a rename which fails *after* an edit still reports its failure. Per-
thing supersession would have silenced that, and the committed test says it should not.

### `withServerIds` takes `namesThread` as an argument now

It worked out "does this turn name the conversation?" from `t.messages.length <= 2`, which is right
for the case it was written for. Under a projection the optimistic rows are not always in the list
being checked, and the same expression then reads *true* for the **second** send into a one-turn
conversation — so the `begin` frame's title, which is the server's stored one, lands over a rename
the reader made a moment earlier. The turn knows whether it created the conversation; nothing else
does. `tests/chat-client.test.ts` gained the argument and one case for it.

### The cancel-before-`begin` fix, and both rules

`stop` and `cancelAndDiscard` ask the operation whether the row has a server name yet. If it has, the
request goes out at once, as it always did. If it has not, the wish waits and the `named` command —
emitted by `turn.began`, run synchronously by the controller — fires it **once**, with the id, the
attempt and the tail the server itself minted.

Both rules the postmortem asked for fall out of that. Sent once, when there is an id the server can
match. And nothing ever has to decide what "the server could not match that id" means, because the
request that provoked that answer is not sent: the `200 { cancelled: true }` case is now **out of
reach from this window**, and a 409 means what `cancelChat` says it means.

None of the four fixes the plan warned against was used. The reason they all failed was that they
needed to know whether the row has a server name yet, and now `TurnOperation.began` is that fact.

### Three guards nothing could redden, and what was done about them

Every guard was probed by deleting it in a copy of the tree. Three reddened nothing:
`Tombstone.final`, and the `superseded` checks in `repair.succeeded` and in
`recovery.found`/`givenUp`. All three are unreachable *through the hook* for the same reason — the
write lands in `base` under a tombstone that is never lifted, so no reader can see it. They were kept
and pinned with reducer-level tests instead of deleted, because the argument that makes them
unreachable is one line long and the class of bug they stop has cost days here. Each now has a probe
that turns exactly one test red.

**`Tombstone` carries `by` and `final`, not just `by`.** `by` alone is what fixes the reported bug
(cancel → delete → the cancel's failure); `final` is the invariant stated rather than implied.

### Smaller things

- **`showing` went with the rest**, which the plan listed but did not explain. A new article is a new
  controller, so an abandoned repair or recovery dispatches into a controller nothing is reading. The
  two halves `tests/chat-error-scope.test.ts` pins are covered by that alone.
- **`recovering` is derived** from the recovery operations that exist. The plan called it "stored
  state" to be removed and did not say what replaces it.
- **`turn.disconnected` carries only an id and a deadline** for the recovery it hands over to; which
  conversation, which row and which attempt are facts about the turn, so the reducer fills them in.
  The attempt riding across is what let `attempts` go: a stop pressed while "connection lost —
  checking…" is on screen still names the answer the reader was watching.
- **The reducer commits a turn by calling the projection's own `turnMessages`.** What the reader was
  looking at and what is written down are one function of one piece of data. The two that used to do
  this — an optimistic `setThreads` and a `patchReply` — disagreed twice.
- **`thread.discarded` now refuses while a turn is drawing into the conversation.** A retry or an
  edit writes nothing to `base`, so a conversation whose only turn is being rewritten can have no
  stored messages and still be one the reader is watching; `withoutEmpty` alone would have taken it
  off the screen.

### What stage 3 inherits that this plan does not anticipate

- **The rename fence is untouched and is now slightly easier to fix.** Two PATCHes racing on the
  server is still real. What changed is that every title write goes through one transition in
  `reduce.ts`, so a server-side fence (an `expectedTitle`, the way `expectedTailId` works on the
  destructive path) has one place to be sent from and one place to admit its refusal.
- **`stopWanted` and `cancelWanted` are a `Set` and a `Map`**, not two `Set`s: the cancel's has to
  carry the name of the tombstone it laid, so that only its own failure can lift it. Folding them
  into one `intent` field has to carry that with it.
- **A stop on a row no operation is writing sends no attempt.** That is the same as the old behaviour
  for a row inherited from a load or a remount, and differs only in the frame between an answer
  finishing and the panel repainting, where `attempts` used to keep a value one moment longer. The
  server treats a stop with no attempt as "stop whatever is live", which for a finished turn is
  nothing.
- **The recovery loop reads `controller.state.operations` to decide whether to keep polling.** It is
  the same map the gate reads rather than a second vocabulary, and every *write* still goes through
  the gate — but it is a read after an `await`, which is the shape this file keeps getting wrong. It
  is the last one.

## What the review of stage 2 sent back

**GPT Sol refused `852eda2` — "DO NOT SHIP", three P1 blockers and one P2 —
[chat-operation-model-stage2-review-sol.md](chat-operation-model-stage2-review-sol.md), 2026-08-28.**
All four are fixed on top of it. The two that changed the shape of the work are first.

### The wish was lost in the only lifecycle production has

`cancelAndDiscard` recorded the wish and sent nothing; `ChatDialog` then called `onClose()` on the
very next line, the dialog unmounted, React ran the effect cleanup that clears `controller.onNamed`,
and when the `begin` frame arrived there was nobody left to send the `/cancel`. **No request ever
went out.** The server finished the answer, stored the conversation, and it came back on the
reader's next reload — with the screen, and every test, saying it had gone.

**The finding behind the finding is the test harness.** Every chat test in this repo mounts the hook
and keeps it mounted, so none of them could see this. That is why
[`tests/chat-unmounted-turn.test.ts`](../../tests/chat-unmounted-turn.test.ts) is a *lifecycle* file
rather than a bug file: mount, act, **unmount**, then let the world answer. It asserts on the
requests that left the tab, because after the unmount there is no screen left to ask — the same
reason [cancel-before-begin.md](../postmortems/cancel-before-begin.md) gives for
`tests/chat-intent-paths.test.ts`.

The fix is Sol's own direction: **pull the intent union forward from stage 3.** The wish is an
`IntentOperation` in the state; the *reducer* emits the `intent` command at `turn.began`; the
*controller* performs it. Nothing React owns is in the path, and the controller outlives the hook
because the stream still holds it.

**An operation of its own rather than a field on the turn**, which is the part Sol was explicit
about and the plan above was not: a cancellation can outlive the turn it was waiting on, and a stop
can be aimed at a row a *recovery* owns. So it is addressed — `waitingOn` names the operation, not
the row — and a turn that retires without ever being named drops what was waiting on it. It used to
be stranded in a `Set` under a row id that the **next retry re-uses**, so that attempt's `begin`
frame fired it and stopped an answer the reader had just asked for.

### `began` was not a sound cancel predicate

A retry writes into a row the server named long ago — it came back in a load — but its operation
starts `began: false` like every other turn, so a cancel of one waited for a frame it did not need.
Waiting is necessary for an attempt-specific **stop**, because the attempt is what the frame carries;
it is not necessary for a destructive **cancel** of a row the server can already name. Two questions,
two answers, and one flag had been standing in for both.

### A 409's repair could overwrite newer work

`repair.succeeded` replaced the whole conversation and guarded only against a turn that was live at
the instant it landed — and a snapshot is old from the moment it is taken. So it could put an older
title back over a rename that had already succeeded, remove a send that completed while it was out,
and land after another repair of the same conversation. And when a turn *was* live it was discarded
outright, so the external turns that caused the 409 stayed missing locally: the repair failing at the
one job it has.

It **merges** now, on three rules — the server's messages are the record; a row this tab has and the
server does not is kept, `mergedArrival`'s rule for `mergedArrival`'s reason; and the title is never
taken from the server, because a title is not withdrawn and the last writer to `base` wins, which is
the reader's own order. Repairs supersede each other. The refused turn's own optimistic rows are
named on the repair as `drop`, because a send writes its two rows into `base` and this is the one
case where the server says they never happened.

**The live-turn guard is gone**, and that is an assertion in
[`tests/chat-reduce.test.ts`](../../tests/chat-reduce.test.ts) that changed on purpose: the test that
said a repair does not land over a live turn now says it lands and takes nothing away. The cost of
the title rule is written down rather than discovered later: **a rename made in another tab is not
picked up by a repair**, and arrives on the next load with everything else.

### And the gate now covers stop and cancel

Their requests were still `fetch`es in the hook, so their failures dispatched ungated `error.set` and
`tombstone.removed`. Provenance already kept the thread deleted in `cancel → delete → late 409`, but
the obsolete cancel still wrote "Couldn't discard…" over a delete that had succeeded. A delete
supersedes everything for its conversation, the wish included, so a superseded wish's failure now
lifts nothing and says nothing — and a refused cancel lifts **its own** tombstone and writes its
error in one transition, which is what Sol asked for.

### The duplicate one-writer guard

Greg found, probing this stage, that `turn.disconnected` carried a second copy of the one-writer
check that `recovery.started` already had, and that deleting either reddened nothing. It is
reachable — retry into a row a recovery is chasing, and the turn then disconnects — but only one
panel change away rather than today, because the retry button is offered on the last answer and a
recovering row is `pending`. **Two copies of an invariant are one tested copy and one untested one**,
and the untested one is where it will next be got wrong. Both paths go through `startRecovery` now,
so there is one copy, and the probe that deletes it turns three tests red.

### The gap the browser pass pointed at: deleting into a live turn

**Not a bug, and now covered.** A browser pass on 2026-08-28 reported the delete button doing nothing
when pressed twice while an answer was streaming — against a tree three agents were editing, with HMR
failing and the dev server dying under it, so weak evidence about the code. What was real is that
**nothing in `tests/` covered deleting a conversation while a turn was live**, in either suite.

It does not reproduce. `delete.started` lays a `final` tombstone and emits its command
unconditionally, and [`tests/chat-delete-live-turn.test.ts`](../../tests/chat-delete-live-turn.test.ts)
now says so at the hook: the DELETE leaves the tab, the conversation goes, the still-open stream's
later `delta` and `done` frames cannot put it back, and a second press changes neither. **Asserted on
the request before the screen**, because a conversation vanishing is not evidence the server heard —
that is [cancel-before-begin.md](../postmortems/cancel-before-begin.md)'s whole shape. Watched red by
adding the refusal the browser pass implied: all three go red, as do three reducer tests.

**And the neighbouring case, because the two are one word apart in `ChatApi`.** `thread.discarded`
refuses while a turn draws into the conversation; `delete.started` deliberately does not. That is
right: `discard` is the local forget for a conversation nobody has said anything in, and a *retry*
writes nothing to `base`, so a conversation being rewritten can look empty while the reader watches
it. A **delete** that quietly did nothing because something happened to be streaming would be the
same silent success as the cancel that was never sent. Both halves are now asserted against one state
in [`tests/chat-reduce.test.ts`](../../tests/chat-reduce.test.ts) — that is where the empty-`base`
case can be built. The panel cannot confuse them either: `onDelete` always calls `remove`, and
`onDiscard` is called from one place, `leave()`, only when the conversation *on screen* has no
messages — which a drawing turn makes false.

## What the second review of stage 2 sent back

**GPT Sol refused it again**, 2026-08-28, with four more findings — two of them the same two blockers
in narrower form, which is the thing worth recording about this round.

### The tombstone was the fourth name for a conversation

`turn.began` swaps the thread, the question and the answer in one transition. The **tombstone** is
keyed by thread id too, and it was left behind: a cancel pressed before the frame laid one under the
id this client invented, the server answered with an id of its own, and the conversation the reader
had just discarded came back on screen under the new name — with its own refusal no longer able to
find the tombstone to lift.

**And so was every other operation.** A second question typed into a new conversation before the
first frame arrives registers a turn naming that conversation the only way it can, by the provisional
id; after the frame it draws into a thread that is not there, so the answer arrives nowhere. Same for
a rename, a delete, or a recovery started in that window. There is one `renamed()` now, and the rule
it states is the one the half-swap keeps teaching: **if a name changes, everything holding that name
changes with it, in the same transition.**

**No test in the repo could see this**, because every one of them pushed back the id the client had
guessed. Sol said so about this exact file.
[`tests/chat-unmounted-turn.test.ts`](../../tests/chat-unmounted-turn.test.ts) now has a case where
the server names the conversation something else.

### The repair, for the third time — and what closes it

Snapshot-over-newer-projection was in `refreshThread`, then in the repair replacing the conversation,
then in the **merge that replaced that** — which kept only rows the snapshot did not have. Every
operation that rewrites a row *keeps its id*: a retry answers into the row it replaces, an edit keeps
the question's id, a recovery patches the row it was chasing. So "absent from the snapshot" protected
a later **send**, which mints ids, and nothing else. Three narrowings, one bug.

The rule that closes it: **a live operation needs no protection** — it draws over `base` and is
re-projected over whatever lands — **so the only thing at risk is what retires while the repair is
out.** That is recorded on the repair itself, as `touched`: every write into `base` tells the repairs
in flight for that conversation which rows moved, and the merge keeps this tab's version of those. No
notion of time, nothing to keep in step, and it is exactly the sentence "whatever was written after
the question was asked cannot be answered by it."

### Supersession belonged at the gate

A superseded repair's *success* was silent and its *failure* still wrote `error` — so the reader
could be told a repair had failed moments after a newer one succeeded. That is bug 10 and bug 12's
shape again: the guard on the success path, forgotten on the failure path beside it. The cause is
that supersession was asked **branch by branch**, five times, and the branches disagreed. The gate
was finding the operation and never asking whether it still had standing.

It is asked once now, in `reduce`, for every kind: **a superseded operation retires, and does nothing
else.** Five per-branch checks went with it.

### The controller outlives the hook, and one thing must not

`#onThreadId` is the panel's own `setThread`. Called from a conversation the reader has left, it
reopens or repoints whatever they are looking at now. Unsubscribing removes the render listener and
says nothing about this. `controller.detach()` clears the callbacks from the hook's effect cleanup —
and only the callbacks. **What the controller decides for itself survives the unmount; what it was
doing on somebody else's behalf does not.** That distinction is the whole of why the cancel is an
operation and the `?thread=` correction is a callback.
