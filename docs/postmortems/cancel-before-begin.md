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

*(Quoted as it stood when this was found. `askToCancel`'s third argument — the rollback copy of the
conversation — went in stage 1, along with the `latest` ref that held it: a tombstoned conversation
is now projected away rather than removed, so removing the tombstone is the whole of putting it back.
Line numbers throughout this file are from before that change; the branch itself is untouched.)*

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

## What the one request that does go out actually does

**Added 2026-08-28, after stage 1**, because the paragraph above stops one step early. It says the
cancel is never re-sent with an id the server recognises, and leaves the impression that the cost is
a request wasted. It is not. That doomed request reaches a real route, and
[`cancelChat`](../../src/routes.ts) has **two** answers for it, neither of them "nothing happened".
Which one the reader gets depends on whether `beginTurn` has committed the conversation at the moment
the button is pressed. Both are pinned in
[`tests/chat-cancel-before-begin.test.ts`](../../tests/chat-cancel-before-begin.test.ts), read off the
route rather than guessed.

**The conversation is not on disk yet → `200 { cancelled: true }`.** The route's first line of
defence is `if (!thread) return { cancelled: true }`, and it is deliberate — the comment names "a
second tab, a double-press, or a reader who cancelled and reloaded". So the client is told the cancel
worked. Nothing is aborted, because there is nothing found to abort; `beginTurn` writes the
conversation a moment later; the answer streams to completion and is stored. **The reader is told
they discarded something that is still there**, and finds out on their next load.

This is the common case, and the ordering says why: the `begin` frame is emitted immediately after
that write, so "no frame has arrived yet" mostly means "not written yet". It is also the worse case,
because nothing on screen is wrong at the time — which is the exact shape of
[silent-success.md](../reusable/silent-success.md), and the reason this half is worth more than the
other.

**The conversation is on disk, the frame is still in flight → `409`.** The tail is the server's answer
id and the client sent its own, so `tail?.id !== messageId` and the route throws *"That is not the
answer at the end of this conversation"*. `askToCancel`'s `catch` reads any refusal as "the server
said the premise was wrong": it removes the tombstone, the conversation comes back on screen with an
error under it — and because it is no longer tombstoned, the stream's frames land again, so the reader
watches the answer they cancelled carry on typing itself. Neither is corrected afterwards, because
the branch that would correct it is the dead one above.

**So the dead branch was hiding a worse bug than itself.** That is the finding, and it inverts the
usual reading of dead code as merely inert. Had the correction been live, the 409 case would have been
loud — a conversation flickering back with an error on it — and someone would have chased it within a
day, the way every other visible chat race in this file was chased. Instead the branch that would have
made the noise never ran, so the failure that stayed was the quiet one: a `200` from a server that has
never heard of the row. The dead code was not the bug; it was the thing keeping the bug quiet.

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

**The one-line interim was considered and rejected, 2026-08-28.** Moving the cancel check to the
correct side of `pendingId = begun.messageId;` does make the wish fire — and firing it is what turns
the dead branch into a live one that **races** `askToCancel`'s restore. In the 409 case above, the
re-send goes out when the `begin` frame arrives and the 409 comes back from a round trip started
earlier, so the refusal's `catch` can land *after* the re-send has succeeded: the tombstone is
removed, and the reader is left looking at a conversation the server has just deleted. Today the
screen and the server at least agree with each other. A fix that trades a silent wrong state for a
visible wrong state is not obviously an improvement, and a fix that races is not a fix.

Three ways to close that race without new state were tried and all fail, each for its own reason.
They are written out in
[chat-operation-model.md](../plans/chat-operation-model.md) because
the next person to look at this will try all three. What matters here is that they fail for **one**
reason: each needs to know whether this row has a server name yet, and that is a fact about the turn,
which nothing represents.

**And that is also why the one-liner is not the fix for the class.** The constraint it depends on —
"this check must run before that reassignment" — remains an unstated fact about line order, true of
two checks today and of nothing that says so. A third wish, added the same way the second one was,
reintroduces exactly this.

**Fixed 2026-08-28, in stage 2** of
[chat-operation-model.md](../plans/chat-operation-model.md) — a stage earlier than this file first
said, and by a different move than the one it predicted.

What it turns on is the fact every failed fix needed and nothing had: **does this row have a name the
server would recognise yet?** `TurnOperation.began` is that fact. So `stop` and `cancelAndDiscard`
ask it before they post. If the row has a server name, the request goes out at once, as it always
did. If it has not, the wish waits, and the `begin` frame fires it **once** — with the id, the
attempt and the tail the server itself minted.

Both rules fall out of that, and the second one falls out for a better reason than "we read the
status more carefully". Send once, when there is an id the server can match. And nothing has to
decide what "the server could not match that id" *means*, because the request that provoked that
answer is never sent: the `200 { cancelled: true }` case is out of reach from this window, and a 409
now means what `cancelChat` says it means — somebody else moved this conversation on — so putting it
back is right rather than accidental.

None of the four rejected fixes was used. The `pendingId` reassignment they all had to reason about
is gone with `run` itself: an operation carries its own identity for its own lifetime, so there is no
second, mutable name for the row and no line whose position other code depends on.

`tests/chat-intent-paths.test.ts` and `tests/chat-cancel-before-begin.test.ts` pin the new behaviour
and both were watched failing against the old code first. **Stage 3 still closes the wider class**:
stop and cancel become one `intent` field the type will not let hold both at once, which is today an
invariant maintained by a comment.

### That fix did not work in production, and the reason is worth more than the fix

**Corrected 2026-08-28**, hours later, by GPT Sol's review of the built stage 2
([chat-operation-model-stage2-review-sol.md](../plans/chat-operation-model-stage2-review-sol.md),
finding 1). Everything above is true of the *decision* — `began` is the fact every failed fix needed
— and false of what the reader got, because of where the wish was consumed.

`cancelAndDiscard` recorded the wish and sent nothing. Then `ChatDialog` called `onClose()` on the
very next line ([`ChatDialog.tsx:245`](../../src/web/ChatDialog.tsx#L245)), the dialog unmounted,
React ran the effect cleanup that sets `controller.onNamed = null`, and when the `begin` frame
arrived there was nobody left to send the request. **So the correction was dead again**, in a
different way and for the third time in this one window: born dead, then live but unmounted.

Two things follow, and the second is the general one.

- **The wish must not live anywhere React can take away.** It is an `IntentOperation` in the
  reducer's state now: the reducer emits the request as a command at `turn.began` and the controller
  performs it. The controller outlives the hook because the stream still holds it. `began` is still
  the fact the decision turns on — it is just no longer consulted by anything that can be unmounted.
- **Every test in the file mounted the hook and kept it mounted.** That is the harness, not the
  feature, and it made an entire class of bug invisible: anything whose correctness depends on what
  happens *after* the reader closes the panel. This is the same lesson as the one above one level up
  — that file says a test has to ask about the request rather than the screen, and this says it has
  to ask at the moment production actually asks.
  [`tests/chat-unmounted-turn.test.ts`](../../tests/chat-unmounted-turn.test.ts) is that lifecycle:
  mount, act, **unmount**, then let the world answer. Both halves of this window are in it, and both
  were watched failing first.

A third correction came with it: `began` is not sound for a **retry**, whose row the server named
long ago. A cancel of one waited for a frame it did not need, and a stop of one that died before its
frame was left in the `Set` under a row id the *next* retry re-uses — so that attempt's `begin` frame
fired it and stopped an answer the reader had just asked for. Both are gone with the sets.

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

### Two more, from finding the 200 case a day later

**The dead branch is why nobody found the 200 case, and that is the general shape.** A dead branch is
usually read as inert — it does nothing, so it costs nothing but confusion. This one was load-bearing
in reverse: the noisy failure it would have caused was the *only* thing that would have sent anybody
looking, and by never running it left the quiet failure in place. When you find dead code, the
question is not only "what was it supposed to do" but "what would have gone wrong loudly if it had,
and is that thing going wrong quietly now?" Here it was: a `200` from a server that had never heard
of the row.

**A test whose name says the opposite of its body is worse than no test.** The test that pinned this
window was called *"posts /cancel immediately and again after begin"* while its body asserted
`toHaveLength(1)` — no second cancel — with a long note explaining why. The name is what anybody
skims: a reader scanning the file for whether this case was covered would have read "and again after
begin", believed the correction fired, and moved on. An absent test is honestly absent; a misnamed
one is a wrong answer with a green tick next to it. Renamed 2026-08-28 to say what it pins.

## See also

- [chat-operation-model.md](../plans/chat-operation-model.md) — the plan; stage 3 is the structural
  fix
- [chat-operation-model-acceptance.md](../plans/chat-operation-model-acceptance.md) — the audit that
  found `cancelAndDiscard` had never been called by any test before this net was built
- [chat-intent-paths.test.ts](../../tests/chat-intent-paths.test.ts) — the test that found this, and
  now the one that pins one request instead of two
- [chat-cancel-before-begin.test.ts](../../tests/chat-cancel-before-begin.test.ts) — what the reader
  was left with for each of the two answers the route gives the doomed request, rewritten in stage 2
  to ask the same two questions of the fixed client
- [half-swapped-message-ids.md](half-swapped-message-ids.md) — the same shape one file and two days
  earlier: a value nothing renders, corrected in one place and not the other it needed
- [silent-success.md](../reusable/silent-success.md) — the pattern this is an instance of
