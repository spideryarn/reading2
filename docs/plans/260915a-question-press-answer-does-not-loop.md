# A "?" answer that arrives in a burst must not throw React #185

**Status: plan reviewed, not yet built** — evidence: the whole-App reproduction is red three runs
of three; GPT Sol's plan review says "build with the listed changes", all of which are folded in
below; `git diff HEAD -- src/` is empty.

Overseer queue item `qi-tcxxvsvm`; Sentry `SPIDERYARN-READING2-3X`, reported 2026-09-12 11:20Z on
build `d358f773`. From Greg, an admin, so trusted input — [feedback-reports.md](../project/feedback-reports.md).

> In a question mark comment response. Minified React error #185; visit
> https://react.dev/errors/185 for the full message or use the non-minified dev environment for full
> errors and additional helpful warnings.
>
> — Greg, 2026-09-12

He was on `/read/temporal-context-reinstatement-spya-dhqkf9?…&mode=summary&term=…&at=…` — Summary in
the band, a glossary term open.

## What the "?" is

Not a comment answer. Since 078bf436 (2026-09-05) the "?" press opens an **anchored chat** whose
first message carries `help: true`, and the answer streams into the floating chat dialog —
[comments.md](../project/comments.md), [chat-tools.md](../project/chat-tools.md). So the path is
`ChatDialog` → `useChat` → the chat controller's store → `ChatPanel`.

## Root cause

Not an infinite loop, which is why three separate reads of the code found none. It is React's
nested-update counter tripping on a **burst**, and it needs three things at once:

1. **The chat store forces a Sync render on every change.** `ChatController.dispatch`
   (`src/web/chat/controller.ts`) notifies its `useSyncExternalStore` listeners synchronously, and
   React's `forceStoreRerender` always schedules `SyncLane`.
2. **One dispatch per SSE frame, and a buffered stream drains in one microtask chain.** `drainTurn`
   (`src/web/chat/effects.ts`) is `for await` over `readEvents` (`src/web/lib/sse.ts`), an async
   generator over `reader.read()`. When chunks are already waiting — a busy or slow device, a
   backgrounded tab, a provider that flushes a batch — every `read()` and every generator step
   resolves as a microtask. N frames become N Sync commits, and React's scheduler, which runs in a
   macrotask, never gets a turn in between.
3. **Something leaves a Default-lane update pending at the end of each commit.** `ChatPanel`'s
   scroll effect (`src/web/ChatPanel.tsx`, keyed on `[chars, thread.messages.length, last?.status]`)
   calls `setAway(false)` on every streamed word. Same value, but it does not take React's eager
   bailout, so an update is queued.

React 19.2's `commitRoot` increments `nestedUpdateCount` when a commit leaves Sync/Default work
pending on the same root, and resets it only when one leaves none. Past 50, the **next update
anywhere throws** — and the next update is the store's own listener call inside `sink.delta`. So
the throw surfaces in the stream loop, `runTurn`'s `catch` turns it into `sink.failed(e.message)`,
and the answer's error line shows React's own text. That is exactly what Greg saw: the error *in*
the response, not a boundary's fallback.

Why the tests never saw it: every existing chat test feeds frames one `act` at a time, and a
handful of them. `act` flushes each frame's work before the next arrives, so the counter never
climbs.

### The evidence

`tests/spike-uses-burst-185.test.tsx` (a spike, deleted before commit) — a bare
`useSyncExternalStore` store, real microtasks, no `act`, 120 frames buffered in a `ReadableStream`:

| subscriber | frames | yield between frames | result |
|---|---|---|---|
| plain | 120 | no | no throw |
| `setState(sameValue)` in an effect | 120 | no | **#185, thrown from the dispatch** |
| `setState(newValue)` in an effect | 120 | no | **#185** |
| `setState(newValue)` in an effect | 40 | no | no throw |
| `setState(newValue)` in an effect | 120 | `setTimeout(0)` | no throw |

Three diagnoses in parallel before that — a jsdom reproduction of the whole App (six cases, all
green on HEAD and on `d358f773`), a GPT Sol read of the chat path, and a real-browser attempt —
found no self-sustaining loop, which is what sent this toward a counter that climbs without one.

**Then reproduced three ways:**

- **The whole App, in jsdom** — `tests/question-press-answer-does-not-loop.test.tsx` § *does not
  loop when the whole answer arrives already buffered*: the real "?" at Greg's address, the chat
  POST answered with begin + 150 deltas + done enqueued before the response returns, no per-frame
  `act`. Red three runs out of three; the page reads *"…word word word Maximum update depth
  exceeded… The answer failed."* — about fifty words, then the throw. A temporary
  `if (away) setAway(false)` turned it green (reverted).
- **A real browser** — Playwright against this worktree's dev server, the report's own query
  string, the real gutter "?", the chat POST fulfilled with the same buffered body: the dialog
  showed fifty words, then React's development-mode text in the failed-answer colour. Fifteen
  naturally paced attempts against the real model did **not** reproduce it, which is the diagnosis
  again: OpenRouter's pacing rarely hands the client fifty frames in one read, and an iPad that is
  busy while they arrive is one way it does.
- **No component stack exists to find.** The throw unwinds out of `dispatch` inside the stream loop
  and is caught by `runTurn`, so no error boundary ever sees it and nothing reaches the console.
  Asking Sentry for the stack would not have helped.

### How far the class reaches

Only the chat controller. Eight other client files read SSE through `readEvents` (`useComments`,
`useGlossary`, `useQuiz`, `useClaims`, `useCriteria`, `useSearch`, `useMirror`, `link-facts`) and
every one of them turns a frame into an ordinary `useState` / `useReducer` update. An update from
outside React gets the Default lane and is batched by the scheduler, so fifty buffered frames cost
one render, not fifty commits. `link-facts`' per-token `wake` is a `useReducer` bump, which is the
same thing. `useSyncExternalStore` is what forces `SyncLane`, and of the eighteen files that use it
only `chat/controller.ts` is fed a frame at a time.

### Two things the diagnosis turned up

- **The reader was shown React's own sentence as the failure.** `describeFetchFailure` passes an
  `Error`'s `message` through on the reasoning that *"an Error we threw ourselves already carries a
  real message from the server"* — and an exception from inside React is not one of ours. That is
  [copy.md](../project/copy.md)'s avoid-list, and it is also a wrong claim: the server finished the
  answer; it was the client that lost it.
- **`Cannot update a component (App) while rendering a different component (SignedIn)`** is logged
  on every page load in development, before any chat — a render-phase update somewhere under
  `SignedIn` (`src/web/App.tsx`). Unrelated to this path and not chased here; recorded so it is not
  rediscovered as news.

## The fix

**The store stops telling React more than once per browser task.** `ChatController` keeps
everything it does now synchronous — the reducer, the commands, `dispatch`'s return value,
`controller.state` and `controller.threads` — and changes only *when its listeners hear about it*:

- **leading**: a state change with no window open notifies at once, as today — so a press, a
  `begin` or a paced delta normally draws exactly when it always did;
- **trailing**: a change while a window is open only marks the store dirty, and when the window's
  `setTimeout(0)` fires, one notification carries the latest snapshot — and opens the next window,
  so a burst that runs across tasks still costs one Sync commit per task. A change made inside an
  already-open trailing window can therefore draw a task later than it would have (Sol, R5).

This bounds the burst and gives React's scheduler somewhere to run between two of ours, which is
what lets a pending Default commit reset the counter. It does not claim anything about the order of
tasks from different sources (Sol, R6). `getSnapshot` returning something newer than the last
notification is safe: React reads the current snapshot at render and re-checks it after commit.

### The state machine, exactly

GPT Sol's plan review (R1, R2) found two ways a naïve version leaves a subscriber showing a stale
chat for ever, so the ordering is part of the plan, not left to the builder:

```
notify():                         // called by dispatch when state changed
  if window open:  dirty = true; return
  openWindow()                    // install the boundary timer FIRST
  emit()

close():                          // the timer
  window = null
  if !dirty: return
  dirty = false
  if no listeners: return         // reset-only: nothing to tell, open nothing
  openWindow()                    // the next boundary, installed before emitting
  emit()

emit():
  for each listener in a FRESH copy of the set, taken now:
    try listener() catch e → keep the first
  rethrow the first, after every listener has been told
```

- **Listeners are read when the emit runs, never when the timer is scheduled** (R1). Otherwise:
  change B queues a flush for L1, L1 unsubscribes, L2 subscribes, change C is suppressed by the open
  window, the timer tells only L1, and L2 shows B for ever.
- **The window and its timer are installed before any emit, and one throwing listener neither
  leaves the gate stuck nor stops the others hearing** (R2). React has already shown this listener
  can throw.
- **Re-entrancy**: a dispatch from inside a leading listener joins the current window's trailing
  flush; one from inside a trailing listener is flushed once, in the next window.
- **With nobody listening**, an already-queued timer runs once and resets. A listener that
  subscribes later is covered by `useSyncExternalStore` itself, which reads the snapshot on
  subscribe.

**K = 1, not "just under fifty".** A threshold chosen to sit below React's `NESTED_UPDATE_LIMIT`
couples the store to an undocumented number and leaves no headroom for the rest of the root's work.
GPT Sol, S8.

**`setTimeout(0)` rather than `MessageChannel`**, because `tests/use-chat-recovery.test.ts` already
advances zero-length fake timers and a `MessageChannel` would need a flush seam of its own. Its cost
— a background tab clamps timers to a second — delays only a render nobody can see; the state is
live throughout.

**Plus the local guard, as hygiene rather than as the fix.** `ChatPanel`'s scroll effect clears
`away` only when it is set, since a same-value `setState` on every word is a render per word for
nothing. It is not the safety boundary: any one pending Default update arms the counter — on an
iPad, `useVisualViewport`'s mount-time `setBox` on the very fiber that holds the store subscription
is the likeliest (Sol, S5) — and a future effect would re-arm it.

### What it costs

- **Thirteen `useChat` tests settle by draining microtasks only** (Sol, S10: `chat-arrival-race`,
  `chat-cancel-before-begin`, `chat-delete-live-turn`, `chat-edit-guard`, `chat-error-scope`,
  `chat-help-reaches-the-server`, `chat-intent-paths`, `chat-kind-reaches-the-server`,
  `chat-title-ownership`, `chat-turn-paths`, `chat-unmounted-turn`, `chat-write-paths`,
  `load-failed-flags`). Their settle step has to cross one task boundary inside `act`. That is a
  change to how the tests wait, not to what they assert.
- **A listener that throws in a trailing flush throws in the timer task**, where the global error
  handler reports it, rather than into the stream loop. A *leading* listener still runs inside
  `sink.delta`, so `runTurn` can still catch a throw from one; this fix removes the burst that
  produced #185, not the route (Sol, R6).
- **The spoken-write waiter's comment promises too much afterwards.** It resolves once the
  controller's projection is current; React may be one notification behind. No data or order is
  lost; the comment is corrected to promise the projection, not a finished commit (Sol, R5).
- **Intermediate snapshots can be skipped.** Safe because every domain decision — the gate, the
  operations, the commands — runs in the controller, never in a React effect reading a snapshot.

### Passed over

- **The local guard alone.** One line, and it is what turned the whole-App test green — but it
  fixes the instance and leaves the class: the reader's own scroll, the viewport hook, the draft
  reset, or the next effect anyone writes each re-arm it. Sol, S8.
- **Coalescing in `drainTurn`** (merge the deltas of one read, or yield a task between reads).
  Local to the stream, but `readEvents` erases read boundaries (Sol, S2), a yield per read adds
  latency to every answer, and the store would still have no bound of its own for the next caller
  that dispatches in a loop.
- **Moving chat off `useSyncExternalStore`.** The store is right; only the notification rate is
  wrong.

### Deferred

- **`describeFetchFailure` passing any `Error`'s message through** on the assumption that it is
  ours. After this fix the burst no longer produces React's exception, but a leading listener still
  runs inside the stream loop, so a foreign exception from some other cause could still be printed
  as an answer's failure (Sol, R6). Making "a sentence the server wrote" a type rather than
  a hope touches three hooks and every caller; worth its own small plan.
- **The `SignedIn` render-phase update warning** — § Two things the diagnosis turned up.

## Stages

1. **Red, twice.**
   - *The reader's path* — `tests/question-press-answer-does-not-loop.test.tsx`: the "?" pressed at
     Greg's address, the chat POST answering with begin + 150 deltas + done **all buffered**, no
     per-frame `act`; asserts the answer lands whole and no error text appears. Red on current code
     (done — three runs of three).
   - *The class, with React* (Sol, S11 and R3) — a real `ChatController`, a
     `useSyncExternalStore` subscriber, **one** new-value Default update scheduled in a sibling on
     the same root just before the burst, then 150–200 delta events through buffered microtasks,
     no per-frame `act`. Asserts no #185 and the whole answer rendered. It must stay red with every
     `ChatPanel` effect removed, which is what the whole-App test cannot promise. Never assert
     *which* frame throws — that is React's counter, not ours.
   - *The controller's contract, without React* (R3) — a direct subscriber, dispatches made
     synchronously and across microtasks, task boundaries crossed deliberately. The exact
     sequence, not "at most one" (zero satisfies that): one leading notification; none more before
     a task boundary; exactly one trailing notification, seeing the latest state; a dispatch made
     from the trailing listener notified once, in the next window; `controller.state` current after
     every dispatch. Plus R1's cases — the last listener unsubscribes and another subscribes before
     the timer, then a dispatch, and the replacement sees the latest snapshot — and R2's: a throwing
     listener does not stop the others hearing, and the next change still notifies.
2. **Fix** — the state machine above in `controller.ts`, the `ChatPanel` guard, the spoken-waiter
   comment, and the thirteen tests' settle step. **One task boundary is not enough** (R4): a
   trailing flush opens a new window, so a settle that crosses one boundary can hand the next test
   action an open window and lose its leading render. A small shared helper that drains microtasks
   and crosses at least two task boundaries, with a round in between for notification-driven
   effects to dispatch, replaces each file's own. No fake timers for those thirteen;
   `use-chat-recovery` keeps its own, which already advances zero-length timers repeatedly. Green,
   then the mutation check: take the coalescing out and both class tests go red; take the guard out
   and neither should (it is hygiene).
3. **Postmortem** —
   `docs/postmortems/260915a-a-store-notified-per-frame-turns-a-buffered-stream-into-an-update-loop.md`
   (drafted) — and whatever prevention it recommends, in this run.
4. GPT Sol code review, gates, push to `dev`, the feedback note.

## Decisions

- **Store-level coalescing (B) over the one-line guard (A)** — GPT Sol's design consult, S8;
  answer kept at `sol-design-answer-1.md` in the session scratchpad. The guard stays, as hygiene.
- **GPT Sol's plan review: "build with the listed changes"** (R1–R8, 2026-09-15). All eight
  accepted: the state machine is now specified (R1, R2), the class test is two tests with an exact
  sequence (R3), the settle helper crosses two boundaries (R4), the promises about timing and about
  foreign exceptions are narrowed (R5, R6), the drafted postmortem and note no longer claim work
  that is not built (R7), and the scope count is eight, not nine (R8).
