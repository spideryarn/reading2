# A completion event is lost when its listener belongs to a provisional identity

Up: [postmortems.md](../project/postmortems.md). Found during the code review of
[261007o](../plans/261007o-the-guide-acts-without-a-press-and-opens-every-new-article.md),
2026-10-07. Production impact was not measured.

## The class: a live event outlives the identity that owns its listener

`bc94cf25a` introduced automatic guide actions with the completion subscription and pending act
owned by `Conversation`. That component captures its thread id and is keyed by the same id.

A new conversation starts with a provisional id. The stream's `begin` frame replaces it with the
server's id, which also remounts `Conversation`. If `begin`, deltas and `done` arrive before React
commits, the old listener rejects the completion's server id and the replacement listener misses
the event. Accepting the original alias inside the old component alone would still lose its
pending act on the keyed remount.

The ownership error is giving a live operation's completion to a component whose identity the
operation itself changes.

## Why nothing went red

The existing live-stream tests exercise notification batching, but use the same thread id before
and after `begin` and render an unkeyed `Conversation`. They test the finished-answer gate without
crossing the production identity boundary.

The new test in `tests/guide-acts-live-stream.test.tsx`, “acts through the real panel when a new
guide is named and finishes in one buffered task,” uses distinct ids and the real `ChatPanel`.
Before the fix its chip-presence assertion passed, then the action assertion failed:

```text
expected "vi.fn()" to be called 1 times, but got 0 times
```

## The fix that is right for the long term

The stable `ChatPanel` owns the subscription and pending act, passing the act into its keyed
`Conversation`. The controller's completion event carries both the turn's starting thread id and
its confirmed id, so the panel recognizes a completion before or after React draws the correction.
The starting name is operation-scoped and pruned when the operation retires.

The chips retain the finished-answer, visibility and single-use gates. Completion remains a live
event: loading history, recovery or mounting a listener later supplies no act. Leaving the
conversation spends any pending act, so returning cannot release it.

## What would have caught it, ranked by ease against value

1. **Test identifier replacement through the real composition.** Cheap and done: the distinct-id
   buffered regression crosses the key, subscription and stream boundaries together.
2. **Vary timing around identifier replacement.** Also done: completion after the corrected-id
   commit, after leaving and reopening, and inside a hidden band. Check action counts as well as
   the rendered chip.
3. **Retain or replay completion events for replacement listeners — rejected.** This could revive
   an action after reopening history or showing an offscreen conversation. Stable ownership closes
   the race without extending an event's authority.

The lesson is to test the identity change and completion together through the parent that supplies
the key. Testing batching with unchanged ids leaves that boundary untouched.
