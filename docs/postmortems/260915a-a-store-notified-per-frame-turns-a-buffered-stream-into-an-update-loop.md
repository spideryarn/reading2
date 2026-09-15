# A store notified per frame turns a buffered stream into an update loop

**Reported 2026-09-12 by Greg** (Sentry `SPIDERYARN-READING2-3X`, build `d358f773`): pressing "?" on
a passage, the answer began arriving and then stopped, and in its place the dialog printed *"Minified
React error #185"* — React's "Maximum update depth exceeded". **It reached a reader**: the answer was
lost on the client after the server had finished writing it, and what replaced it was React's own
sentence. Fixed by
[260915a-question-press-answer-does-not-loop.md](../plans/260915a-question-press-answer-does-not-loop.md),
which holds the evidence in full.

## What happened

> In a question mark comment response. Minified React error #185
>
> — Greg, 2026-09-12

The "?" opens an anchored chat, and its answer streams through `ChatController`
(`src/web/chat/controller.ts`), a store `useChat` reads with `useSyncExternalStore`. Reproduced in
jsdom and in a real browser by answering the chat POST with begin + 150 deltas + done **already
buffered**:

```
…word word word word Maximum update depth exceeded. This can happen when a component repeatedly
calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested
updates to prevent infinite loops. The answer failed.
```

About fifty words, then the throw. There was no loop in the code — three separate reads of it,
including GPT Sol's, found none, and neither did a whole-App test that fed the frames one at a time.

## A store that forces a synchronous render per event is a budget any burst can spend

Four facts, each harmless alone:

1. **`useSyncExternalStore` always re-renders at `SyncLane`.** React's `forceStoreRerender` has no
   other lane. So a store that notifies once per event makes one synchronous commit per event.
2. **The stream dispatched once per SSE frame, and a buffered stream drains in one microtask
   chain.** `drainTurn` is `for await` over an async generator over `reader.read()`; when chunks are
   already waiting, every step resolves as a microtask and React's scheduler — a macrotask — never
   runs in between.
3. **React counts consecutive commits that leave work pending as nested.** In 19.2 `commitRoot`
   increments `nestedUpdateCount` when a commit leaves Sync or Default work on the root, resets it
   only when one leaves none, and the next update past fifty throws.
4. **Something re-schedules an update after every commit.** Here, `ChatPanel`'s `setAway(false)`
   on every word — same value, but it does not take React's eager bailout. A *single* pending
   update is not enough, which GPT Sol and I both believed until the build proved otherwise: React
   19.2 renders pending Sync and Default work together (`getHighestPriorityLanes` returns
   `lanes & 42`), so one early update is spent by the first commit. It takes a re-arm per commit.

So a burst of fifty frames is an "infinite loop" to React, and the throw comes out of the store's
own listener call, inside the stream loop. `runTurn`'s `catch` read it as the stream failing and
`describeFetchFailure` passed its message through, on the assumption that *"an Error we threw
ourselves already carries a real message from the server"*.

**The class: an external store that notifies React synchronously for every event it receives.** The
rate of commits is then set by whoever feeds the store, not by the screen — and a network, a busy
device or a replay can feed it faster than React will tolerate. It is invisible while events arrive
paced, which is almost always.

**Siblings: none.** Of the eighteen client files that use `useSyncExternalStore`, only the chat
controller is fed a frame at a time. The other eight SSE consumers write each frame into ordinary
`useState` / `useReducer`, which from outside React is a Default-lane update the scheduler batches —
fifty buffered frames there cost one render.

**Introduced by** `6f35022c` (2026-08-28, *"The load's success and its failure are now refused by
the same rule"*), stage 1 of the chat operation model, which turned `useChat` from `setThreads` into
a controller read through `useSyncExternalStore`. Its reason was sound and still is — *"a stop pressed
before the begin frame needs the answer on the same line, and a dispatch gives it on the next
render"* — and it is why the fix keeps the controller synchronous and changes only when React hears
about it. The update that armed the counter in the reproduction came in earlier, with `abb5de1f`
(2026-08-26); before `6f35022c` it was harmless, since Default-lane `setThreads` calls batched.

## Why nothing went red

- **Every chat test fed the stream one frame per `act`.** `act` flushes each frame's work before
  the next, so the counter never climbed. The tests shared the code's assumption that frames arrive
  one at a time — [silent-success.md](../reusable/silent-success.md)'s commonest shape.
- **Real use paces the frames.** Fifteen live attempts in a browser against the real model did not
  reproduce it; OpenRouter rarely hands the client fifty frames in one read.
- **The failure looked like a model failure, not a crash.** No error boundary saw it — the throw
  was caught by `runTurn` — so nothing reached the console or Sentry as an exception, and no
  component stack existed to find. The reader's report was the only record.
- **Three reads of the code looked for a loop**, which is the thing React's message says. There
  was none: the bound is on consecutive commits, not on cycles.

## What would have caught it, ranked by ease against value

1. **A buffered-stream case beside every streamed-answer test** — the whole-App test in
   `tests/question-press-answer-does-not-loop.test.tsx` enqueues the whole answer before the
   response returns and feeds nothing through `act`. Cheap, and it is the shape that was missing.
   Written, and red on the unfixed code.
2. **A class test at the store's boundary**, independent of any component: a real controller, a
   `useSyncExternalStore` subscriber, *one* unrelated pending update, a 200-event burst — and
   beside it the controller's notification contract with no React at all. It stays red if every
   `ChatPanel` effect is removed, which the whole-App test cannot promise. Being built in this run.
3. **A notification bound in the store itself** — at most one notify per browser task, leading and
   trailing, state kept synchronous. This bounds the burst for this store whatever the subtree
   does. Being built in this run; the plan has the state machine.
4. **Stop printing foreign exceptions as the answer.** `describeFetchFailure` trusts any `Error`'s
   message to be the server's. Deferred to its own plan: after (3) the burst no longer produces
   React's exception, but a leading listener still runs inside the stream loop, so the route is
   narrowed rather than closed; making "the server wrote this" a type touches three hooks.
5. **A lint rule against `setState` in effects** — rejected. The re-arm can be any effect anywhere in
   the subtree that updates on every commit, including a same-value update that looks free, and a
   rule strict enough to catch those would flag a great deal of correct code.

## The fix that is right for the long term

The store notification bound (3), with the `ChatPanel` guard as hygiene. The one-line guard alone
turned the reproduction green and would have been the fastest ship, but it fixes the instance: the
next effect anyone writes that updates state on every commit re-arms it. The rule for the next
store is in [web-client.md](../project/web-client.md).

## The thing I would tell myself

React's message says *loop*, so I and three agents went looking for a cycle, and there wasn't one.
The spike that settled it took ten minutes and asked a different question — not "what calls setState
repeatedly?" but "what makes fifty commits in a row?" — and a rate is not something you find by
reading code for cycles.
