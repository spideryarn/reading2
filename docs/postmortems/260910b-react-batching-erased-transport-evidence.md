# React batching erased transport evidence

Stage 1 of session continuity was still under review; nothing reached a reader. Two successive
fleet payloads delivered in one JavaScript turn could be collapsed into one React render. That let
an established conversation conflict disappear behind an unreadable reading, and let a
dialog-scoped refusal return for a byte-identical new dialog after the old dialog had ended.

## What happened

The components correctly adjusted their own state during render: `Conversation` retained a conflict
through an unverifiable reading, and `SessionDetail` cleared a refusal when its dialog key changed.
But both mechanisms assumed they would render every payload handed to `TransportSink.onState`.
React 19 automatically batched two `setState` calls in one turn, so these sequences:

```text
conflicting -> unknown
question A -> no question -> identical question A
```

could render only their final member. The component code had no opportunity to record the conflict
or the end of the dialog. Focused regressions failed before the fix: the first drew the old
transcript without its previous-conversation label; the second kept all answer buttons withheld.

Commit `c71ddbac4ab41c573739300a55ff2a74ac916dd1` introduced both transition-sensitive render updates.
The transport hook's ordinary batched `setState` predated them, but became a defect only when a
consumer needed every delivered transition rather than only the newest snapshot.

## The class: a snapshot store was asked to preserve an event

`useFleetState` was a last-value store. A consumer then treated changes between its values as an
event log: *a conflict was observed*, *this dialog ended*. Last-value stores may coalesce intermediate
values; event claims may not. The individual render-phase updates were guarded and safe even when
React discarded a render. The lost evidence was one boundary earlier, where no render was created.

The sibling was the answering-disabled latch in the same stage. A payload delivered before a
refusal but not yet committed was mistaken for evidence delivered after it, because the latch used a
layout-effect ref. In one batched turn the receipt order and the commit order were different.

## Why nothing went red

Every existing transition test put each `feed.push` in a separate `act`, forcing a commit between
the states. The tests therefore shared the implementation's assumption that one delivery meant one
render. StrictMode and Profiler coverage checked committed frames, not two inputs coalesced before a
frame existed. The transport contract allowed either callback any number of times, but no test
delivered two successful snapshots in one React turn.

## What would have caught it, ranked by ease against value

1. **Put two transport deliveries in one `act` for every stateful transition guard.** Done for the
   conflict and dialog-end sequences, plus payload-before-refusal ordering. It directly reproduces
   React's batching rather than simulating its result.
2. **Name whether an input is a snapshot or an event at the seam.** A consumer that derives a
   durable fact from a transition must either receive every value atomically or move that derivation
   to the input boundary.
3. **Move all continuity bookkeeping into a separate event reducer.** Rejected for now. It would
   preserve transitions without synchronous commits, but duplicates parsing and identity rules in a
   second state tree for three low-frequency fleet observations.
4. **Disable React batching generally.** Rejected. Batching is useful and broad; only fleet snapshot
   delivery has the event semantics that require an atomic commit.

## The fix that is right for the long term

`useFleetState` now commits each successful transport delivery synchronously and records the latest
delivered payload at the callback boundary. Fleet snapshots arrive every several seconds today and
would arrive only on snapshot events under SSE, so this is a deliberately narrow synchronous
boundary rather than a rendering policy for the application.

If fleet delivery ever becomes high-frequency, the long-term replacement is an explicit reducer of
continuity evidence at the transport boundary, with React rendering its latest reduced state. Until
then, that machinery would cost more surface area than the low-rate atomic commit it replaces.

## The thing I would tell myself

I checked whether a discarded render could leak state and stopped at the component boundary. The
more dangerous question was the inverse: can the input be discarded before the component gets a
render at all? When correctness depends on a transition, I need to test two inputs in one turn.

---

Up: [Postmortems](../project/postmortems.md)
