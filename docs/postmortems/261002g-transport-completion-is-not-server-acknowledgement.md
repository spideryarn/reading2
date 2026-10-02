# Transport completion is not server acknowledgement

Stage-2 review of [the quick-search plan](../plans/261002h-quick-search-bar-in-the-dock.md)
found an automatic revision could overtake a request whose connection had failed before its
`begin` frame. This was caught before the reviewer approved landing; no reader incident was
established. The possible effects were an older answer replacing newer words, a second saved row,
or a delayed request recreating a deleted id.

## Transport completion mistaken for server acknowledgement

Introduced by **226a8907f** (`261002h stage 2: quick search as you type, in the panel`), confirmed
by `git blame` on the former `src/web/useSearch.ts:711–717`. The commit intended to serialize
requests through `begin`, but its `finally` sent the parked revision when a request failed before
that acknowledgement. A dropped connection was treated like proof that the server had not begun.
It proves neither rejection nor completion.

Let A wait on the server while its connection fails. The client sends parked B; B begins first.
Delayed A then either revises the row back to older words or, for an initial non-revision request,
finds B's pending row and mints another id. The finish attempt fence cannot help: it orders
finishes according to which request began last. If the reader deletes B before delayed A begins,
the absent-id fallback can create the row again.

The plan's F3 had already identified this distinction. The fallback nevertheless reintroduced it
as recovery code. Successful-stream tests exercised acknowledgements, superseded frames and
deletion, leaving failure *before* acknowledgement unchecked.

## The narrow fix and its evidence

[useSearch](../../src/web/useSearch.ts) retains a failed, unacknowledged lane as a barrier. Later
edits update its latest criterion without sending automatic successors; explicit retry replaces
the lane. Merely removing the `finally` send would leave the next pause free to repeat the race.
The row shows the latest words with its error so recovery does not silently discard intent.

The reviewer first watched **“keeps a failed unacknowledged request as a barrier to automatic
revisions”** in [use-search.test.ts](../../tests/use-search.test.ts) fail, then pass. It covers both
the parked successor and a later edit, and verifies explicit retry uses the latest words.
The targeted four-file suite passed 74 tests after C1–C5 fixes, as reported by the reviewer.

## Countermeasures ranked by ease against value

1. **Fault-inject before acknowledgement, then try another operation** — implemented above.
   Cheap, and checks the uncertainty boundary rather than only the normal ordering.
2. **Require positive acknowledgement before automatic dependent writes** — implemented as the
   retained lane. A rejected or disconnected transport is not that acknowledgement.
3. **Persist server revision sequences** — the stronger option if automatic recovery must work
   across lost acknowledgements or tabs. Not added here: it changes client/server identity and
   ordering contracts; the barrier fixes this tab's automatic overtaking with fewer moving parts.
4. **Persist deletion tombstones** — not added here. They would address recreation, but cannot
   order revisions and require a separate policy for retention and intentional reuse.

The wider protocol limitation remains: a stale tab can recreate an id deleted in another tab
because `withRun` treats an absent id on `revises` as an ordinary new request. This review does
not claim to fix that. A long-term cross-tab guarantee needs server ordering and deletion policy,
rather than stronger assumptions about fetch completion.

I would tell myself: the server acknowledgement was the ordering evidence I needed. Losing the
channel that could deliver it must preserve uncertainty, not release the next write.

Up: [Postmortems](../project/postmortems.md).
