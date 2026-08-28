# The cancel-before-begin correction that never ran

**2026-08-28.** Found writing [`tests/chat-intent-paths.test.ts`](../../tests/chat-intent-paths.test.ts),
part of the acceptance net for
[chat-operation-model.md](../plans/chat-operation-model.md). Not reported by Greg, not found by a
review, not found by reading the code — found because a test that asked "does a cancel pressed
before the server names the row send exactly one request" gave a different answer than expected, and
the code that should have answered it turned out never to run at all.

## What the code does

Two wishes, recorded before the server has a real id to act on, and honoured once it does. Both live
in `nameRow`, the function that runs when the `begin` frame arrives
([`src/web/useChat.ts:1288`](../../src/web/useChat.ts#L1288)). `pendingId` starts the function
holding the id the client invented, and partway through is reassigned to the server's:

```ts
// src/web/useChat.ts:1313-1318
const wanted =
  stopWanted.current.delete(pendingId) || stopWanted.current.delete(begun.messageId);
if (begun.attempt !== undefined) {
  attempts.current.set(begun.messageId, begun.attempt);
}
pendingId = begun.messageId;
```

The stop check runs first, while `pendingId` still holds the client's invented id — the id `stop()`
would have recorded the wish under, if pressed before this frame. It matches, `wanted` is `true`, and
the correction fires later:

```ts
// src/web/useChat.ts:1343
if (wanted) void askToStop(current, pendingId);
```

The cancel check runs after the reassignment, sixteen lines later:

```ts
// src/web/useChat.ts:1333-1339
if (
  cancelWanted.current.delete(pendingId) ||
  cancelWanted.current.delete(begun.messageId)
) {
  stopWanted.current.delete(begun.messageId);
  void askToCancel(current, begun.messageId, undefined);
  return;
}
```

Both of its clauses ask `cancelWanted` about `begun.messageId` — one directly, one through `pendingId`,
which by this point already equals `begun.messageId`. But `cancelAndDiscard` only ever recorded the
*provisional* id:

```ts
// src/web/useChat.ts:1019-1022
const cancelAndDiscard = useCallback(
  (threadId: string, messageId: string) => {
    cancelWanted.current.add(messageId);
```

`messageId` here is whatever the caller passed — the id of the row on screen when the reader clicked.
`cancelAndDiscard` has exactly one call site, `ChatDialog.tsx:247`: `cancelAndDiscard(thread.id,
tail.id)`, where `tail` is the last message currently rendered — and before `begin` that is the
provisional one. The server's id is never in `cancelWanted`. The check can never match. `cancelAndDiscard` still does one thing on its own — it fires `askToCancel` immediately, with
the provisional id, the moment it is called ([`src/web/useChat.ts:1025`](../../src/web/useChat.ts#L1025))
— and that is the only request that ever goes out. A cancel pressed before `begin` removes the
conversation from every screen and asks the server to cancel an answer under an id the server has
never heard of, and nothing ever asks again with the id it actually recognises.

## Root cause

Not the line that broke — the line never worked. The cause is that `pendingId` is a mutable variable
that means two different things depending on where in the function you read it, and the correctness
of a check against `cancelWanted` or `stopWanted` depends entirely on which side of the reassignment
it sits. The stop check was written on the correct side. The cancel check was written on the wrong
one, a day later, by someone who did not re-derive that constraint — and the surrounding code gives
no signal that the constraint exists. Nothing marks `pendingId = begun.messageId` as a line whose
position other code depends on; it reads like an ordinary reassignment, not a boundary.

The comment on the cancel branch shows the gap in the author's model directly:

> `cancelAndDiscard` cannot have sent anything real yet, because until this frame there was no id the
> server would accept.

This is true of the correction the author was writing, and false of `cancelAndDiscard` as a whole —
it already sends a request the moment it is called, exactly as `stop` does, with whatever id it was
given. The comment reasons as if this branch were the *only* request, when it was always meant to be
the *second* one, correcting the first. Because it never fires, there never is a second one.

## Which commit, and whether it was ever live

`git log -S 'cancelWanted' --oneline -- src/web/useChat.ts` returns exactly one commit:
`a16b5ea8`, "Make a selection open a conversation instead of buying an answer", 2026-08-27 00:02:41.
Everything that touches `cancelWanted` — its declaration, `cancelAndDiscard`, the check in `nameRow`
— was added in that one commit and never edited again. The diff shows the cancel-check block inserted
as new lines directly after the pre-existing `onThreadId?.(begun.threadId);`, which was already
sitting after `pendingId = begun.messageId;` in the code the commit started from. **It was born dead.**
No later edit moved a reassignment out from under a working check; the check never had a moment where
it worked.

The stop check it was modelled on was correct from the day before: `abb5de1`, "Let a reader copy,
retry, edit and stop a chat turn", 2026-08-26 01:50:54, placed
`stopWanted.current.delete(pendingId) || stopWanted.current.delete(begun.messageId)` immediately
*before* `pendingId = begun.messageId;` — deliberately, on the correct side, from the start. One day
later the cancel feature copied the shape of the check without copying its position relative to the
reassignment.

## The fix

**Interim, one line:** move the cancel check to sit before `pendingId = begun.messageId;`, the same
side the stop check is already on. That alone closes this one instance.

**Not the fix for the class**, because the constraint it depends on — "this check must run before
that reassignment" — remains an unstated fact about line order, true of two checks today and of
nothing that says so. A third wish, added the same way the second one was, reintroduces exactly this.

The structural fix is in
[chat-operation-model.md](../plans/chat-operation-model.md#stage-3-intent-and-the-invariants): stop
and cancel stop being two `Set`s of message ids consulted against a variable that changes meaning
mid-function, and become one `intent` field on the operation itself, set once, read once, with no
step in between where the id it is compared against can have moved. There is no reassignment for the
read to fall on the wrong side of, because there is no second, mutable name for the row — the
operation carries its own identity for its own lifetime. That is what closes the class rather than
the instance.

## What would have caught this earlier, and what does now

**Nothing did, and nothing could have without a new test.** The branch is dead code — no path through
the app reaches it and produces a wrong answer that render, because no rendered answer depends on the
second `/cancel` request ever having been sent. `cancelAndDiscard`'s own optimistic removal happens
regardless, so the screen is correct even when the server request is not. Every existing chat test
suite stayed green through both commits, and stays green today with the bug still in place — dead
code cannot turn a test red, because there is no execution of it to get wrong. The general point is
sharper than "add a test": **a check that never runs and a check that runs and is always false look
identical from outside the function, and both look identical to a suite that never calls it in the
one order that would ask.** No amount of testing `cancelAndDiscard` called after `begin` — which is
the ordinary case, and the one every other cancel test exercises — would ever reach this line.

`tests/chat-intent-paths.test.ts` catches it now, and only because it asserts on the *requests*
leaving the hook rather than on what ends up on screen — `posts.toHaveLength(1)`, not "is the
conversation gone." A test that only checked the screen, the way most of this file's tests do, would
have passed against the bug: the conversation *does* vanish from screen, correctly, regardless of
whether the server ever heard about it. The lesson matches
[half-swapped-message-ids.md](half-swapped-message-ids.md#the-lesson-worth-carrying) from two days
earlier, in the same file: the thing that silently fails here is not rendered, so a test has to ask
about it directly rather than about the screen the reader sees.

## See also

- [chat-operation-model.md](../plans/chat-operation-model.md) — the plan; stage 3 is the structural
  fix
- [chat-operation-model-acceptance.md](../plans/chat-operation-model-acceptance.md) — the audit that
  found `cancelAndDiscard` had never been called by any test before this net was built
- [chat-intent-paths.test.ts](../../tests/chat-intent-paths.test.ts) — the test that found this
- [half-swapped-message-ids.md](half-swapped-message-ids.md) — the same shape one file and two days
  earlier: a value nothing renders, corrected in one place and not the other it needed
- [silent-success.md](../reusable/silent-success.md) — the pattern this is an instance of
