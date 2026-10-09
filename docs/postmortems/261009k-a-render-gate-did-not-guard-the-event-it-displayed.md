# A render gate did not guard the event it displayed

Nothing reached a reader. Code review of the uncommitted delete-from work found that an armed bin
left over from an earlier render could start a prune after the conversation had become unsettled.
The server would usually refuse it, but the rows would disappear optimistically, then return with an
error; a second prune could be sent too.

Up: [postmortems.md](../project/postmortems.md).

## What happened

Both real call sites passed `onDeleteFrom` only when `settled(threadId)` was true. That made the
button correct for the state React had rendered. The controller deliberately coalesces some
notifications, though, and event handlers read a button from the last commit while the controller
may already contain a new turn, rename, recovery, spoken append or prune.

The destructive callback read the current rows but never asked whether the current state still
permitted deletion, and `prune.started` registered unconditionally. The defect was introduced only
in the uncommitted implementation reviewed under plan 261009o, so there is no introducing commit.

## A render gate did not guard the event it displayed

This is a **presentation-only safety gate**: render-time eligibility controlled whether an action
looked available, but the state transition did not enforce the same predicate. A render is a
snapshot, not an authority token. This is sharper with a two-press control because eligibility can
change after the first press while the old armed button still has focus.

## Why nothing went red

The panel tests supplied the callback directly and checked only whether the button was present. The
reducer tests started prune only from a settled state. Neither drove a stale rendered action against
newer controller state.

The regression was watched red before the fix: `tests/chat-prune-reduce.test.ts` received a `prune`
command while a turn operation was already live. The same test now covers a live operation, an
earlier prune and an unnamed conversation.

## What would have caught it, ranked by ease against value

1. **Enforce eligibility in the reducer transition** — done. `prune.started` now returns the same
   state and no command unless `isSettled` is true at the event itself.
2. **Test stale controls against current state** — done for the three distinct reasons the action is
   ineligible: another operation, an earlier prune and an unnamed thread.
3. **Flush every controller notification synchronously** — rejected. Coalescing prevents streamed
   answers from forcing one React commit per frame, and presentation freshness is not a substitute
   for an authoritative transition guard anyway.

## The long-term fix

The reducer gate is the long-term fix because every caller, present and future, goes through it. The
render gate remains useful feedback—it hides an action that will not work—but no longer carries the
safety invariant by itself.

## The thing I would tell myself

If a predicate decides whether an operation is valid, I would put it on the transition that creates
the operation first. I would use the same predicate during render only to explain that decision to
the reader.
