# Bounded transport: stalled consumers must not stall supervision

The stage is
[260908f § Bounded transport](260908f-overseer-and-fleet-improvement-roadmap.md#stage-bounded-transport-stalled-consumers-must-not-stall-supervision),
queue item `qi-8hsc8b4e`, dispatched by the Overseer on 2026-09-10.

**What it is for.** Three transports carry supervision evidence, and each has a peer that can stop
answering without saying so: the dashboard writes SSE frames to browsers (`tools/fleet/live.ts`), the
Overseer daemon reads a stream from the dashboard (`tools/overseer/source.ts`), and the browser polls
`/api/state` (`tools/fleet/web/src/transport.ts`). A phone that stalls, a proxy that streams an error
page for ever, a tab that is closed mid-request — none of them may cost this box unbounded memory, an
unbounded wait, or a supervisor that has quietly gone deaf.

## What was already true before this plan

**Most of the stage's five checkboxes were met by E-stream on 2026-09-08**, which landed in the same
files and is documented at length inside them. Establishing that, rather than rebuilding it, was the
first day's work; the baseline is `tests/fleet-live.test.ts` + `tests/overseer-source.test.ts`, 40
tests green at `4ef94674`.

| Checkbox | State on arrival |
| --- | --- |
| 1. Real Node `Writable`, small highWaterMark, assert pending bytes and write count | **Partly.** `fleet-live.test.ts` § "a raw node Writable that never drains" uses a real `Writable` at `highWaterMark: 1` over 200 broadcasts and asserts one buffered frame. It never **delays and then delivers** a callback, and no ping is interleaved. |
| 2. Pause-until-drain or close-and-reconnect; retain at most the newest snapshot; clean up listeners | **Partly.** Policy (d) — pause until `drain`, destroy after `DRAIN_DEADLINE_MS` — is implemented and reasoned about in the file. **Nothing is retained**, and `removeSubscriber` removes no listeners. See "The defect" below. |
| 3. Error headers + never-ending body in `source.ts`; bound `sseFrames` | **Nearly, and this row said "met" until Sol's review.** `discardBody` cancels rather than drains on both paths, `readBounded` bounds the poll body, `sseFrames` bounds the incomplete tail per-frame and per-tail, all tested including the packetization trap. But the *time* bound had a hole (the awaited cancel) and `sseFrames` mis-splits bare-CR line endings the spec allows. Both in Stage 2. |
| 4. Stop/abort through both polling paths; unmounted page owns nothing; manual refresh mid-flight | **Not met, and `pollingTransport` has no tests at all.** Two real defects — see Stage 3. |
| 5. Keep browser polling unless a measurement says otherwise | **Met by doing nothing.** No measurement says otherwise, so this plan adds no `EventSource`. |

So this plan is three narrow stages against three real defects, plus the evidence the stage asks for
in the form it asks for. **It is deliberately not a rewrite of code that was reviewed nine days ago
and is right.**

### The gap in `live.ts` — and the version of it I got wrong first

**The first draft of this plan said a two-second stall costs a phone up to a minute of staleness.
That is false, and GPT Sol's review of this plan is what caught it.** `res.write` returning `false`
does not withhold the frame: Node has *already buffered it*, and it goes out as soon as the socket
moves. A subscriber that stalls and then drains therefore still receives the snapshot that filled its
buffer. Two other parts of the story were wrong with it — the browser does not consume this endpoint
at all today (it polls `/api/state`), and the only SSE consumer is the Overseer daemon.

What is actually lost is any snapshot broadcast **while the subscriber was still blocked**. Those
were dropped on the floor: `drain` cleared the block and sent nothing, so the subscriber held a
generation-old snapshot until the next publish — up to 60 seconds later, since `server.ts`'s refresh
loop publishes once per cycle (`server.ts:121`, `:509`). The window is narrow, and the arithmetic is
why: publishes are 60 s apart and a subscriber that has not drained within `DRAIN_DEADLINE_MS` (30 s)
is destroyed and reconnects into a fresh cached snapshot. So it takes a block that begins inside the
30 seconds before a publish, or a new subscriber whose initial cached snapshot blocks while a
collection that was already running publishes its replacement.

So the honest case for the fix is not a dramatic one. It is the roadmap's requirement in its own
words — *retaining at most the newest snapshot* — held as a **transport invariant**: a subscriber
that is alive when a snapshot is published receives that snapshot or a newer one, without depending
on how the box's refresh cadence happens to line up against a stall. It costs one nullable reference
per subscriber, and it removes a case where the next consumer of this endpoint (a browser, when the
`EventSource` swap eventually happens) would silently be a generation behind.

## Stage 1 — a subscriber that drains gets the newest snapshot, not the next one

- [x] Red first: a real `Writable` with `highWaterMark: 64` whose `write` callback is **held and then
      released** — the checkbox's "delays callbacks", which the existing never-drains double cannot
      express. Assert across ~200 snapshots and interleaved pings: exactly one frame handed to the
      sink while stalled, `writableLength` never above one frame, and — the red part — that releasing
      the callback delivers the **newest** snapshot rather than nothing.
- [x] Retain at most one frame per subscriber, and only a `snapshot`: a withheld `ping` is worthless
      (it claims liveness at a moment that has passed), so pings are dropped rather than queued. The
      retained value is the same shared frame string every other subscriber was handed, so the cost
      is one pointer per stalled subscriber, not one snapshot.
- [x] Teardown removes the listeners it added — `close`/`error` on the request, `error` and any
      outstanding `drain` on the response — so a subscriber that leaves owns nothing. Assert an
      unaffected subscriber goes on receiving throughout.

**Status.** Done. `writeUnlessFull` now takes the frame's kind; `markFull` stores `sub.pending`; the
`drain` handler clears the old deadline, flushes the newest snapshot through the same gate (which
blocks again and arms a fresh deadline) and drops any withheld ping. `subscribe` builds a `detach()`
that `removeSubscriber` calls, and the `drain` listener is taken off rather than left on a socket
about to be destroyed.

Evidence: `tests/fleet-live.test.ts` § "backpressure, measured against a real Writable that delays its
callbacks" — 7 tests, two of them red against the previous `live.ts`. The write count is asserted on
`res.write` calls rather than on the sink's `_write` callbacks, because Node queues a second write
internally without calling `_write` again and counting those would credit this module with restraint
that was Node's. Sol asked for a second cycle and was right to: at `highWaterMark: 64` the flush
itself returns `false`, and the four-step test proves the replacement deadline owns the new blocked
period — mutation-checked by removing the `clearTimeout` from the drain handler, which reds that test
alone.

## Stage 2 — `source.ts`: the one awaited cancel, and a consumer that walks away

`source.ts` says, twice and at length, *do not await a peer that has stopped answering* — and then
`readStream`'s `finally` does `await reader.cancel()`. `readBounded`, ten lines down, does
`void reader.cancel().catch(...)` and cites the same reason for not awaiting.

- [x] Red first: a consumer that `break`s out of `for await` while a hostile server is holding the
      body open. Assert the generator's `return()` settles inside a bound. **If it settles anyway,
      that is the answer and it is recorded as a negative control rather than fixed** — a claim that
      an await hangs is a claim that has to be shown.
- [x] Bring the line into agreement with the file's own doctrine, whichever way the test points.
- [x] **Added after Sol's review**: arrange the case a real peer cannot — a `ReadableStream` whose
      `cancel()` never settles — because a probe that cannot fail is not evidence.
- [x] **Added after Sol's review, P2**: accept bare `\r` line endings in `sseFrames`, which the HTML
      Standard permits and this parser refused.

**Status.** Done, and **the first answer was wrong.** Against a real server the awaited cancel
settles in single-digit milliseconds, so the negative control came back clean and this plan was
briefly ready to record "measured, no defect". Sol's review refused that: a cancel promise is allowed
to reflect an underlying source shutting down asynchronously, so nothing *structural* bounded the
wait, and no HTTP peer can produce the case — which makes a real-server probe a test that cannot
fail. Worse, the `finally` runs on every exit, the parser refusing an oversized frame included, so an
unbounded cancel parks the generator **after** it has yielded `stream-closed`: the log says the
transport failed and the poll fallback three lines below is never reached.

Arranged with a `ReadableStream` whose `cancel()` never settles
(`tests/overseer-source.test.ts` § "a body that refuses to be cancelled"). It hangs for the full 30 s
test timeout against the awaited version — the abort in the harness cannot rescue it either — and
passes once the cancel is fire-and-forget, as `readBounded` already was. What is given up is the
guarantee that the socket is released before the consumer's `break` returns; the neighbouring test
watches the dashboard's subscriber count fall to zero straight afterwards.

**And a second finding, P2, also Sol's — which then took two attempts to get right; the first is in
the review record below.** `sseFrames` recognised `\n` and `\r\n` but not a bare
`\r`, which the HTML Standard permits. A producer or proxy using CR-only line endings would have had
every frame held as incomplete until the 4 MB bound refused a perfectly valid stream — bounded, and
wrong. Fixed by normalising line endings on the way in, holding back a trailing `\r` until the next
chunk says whether it was a `\n` belonging to that same line ending. That also **removed** three
special cases: one terminator to find instead of two, one separator to split on, and a one-character
partial delimiter instead of three.

## Stage 3 — the browser transport: an unmounted page must own nothing

`pollingTransport` is the only thing in `tools/fleet/web/src/` that owns a fetch, a timer and two
window listeners, and it has **no tests**. Two defects, both found by reading it against checkbox 4:

1. **`stop()` does not abort the in-flight fetch.** The `AbortController` is local to `tick()`, so a
   closed tab leaves a request open for up to `REQUEST_TIMEOUT_MS` (20 s) — and on a box that has hit
   load 391, twenty seconds of a request nobody will read is a real cost, repeated on every navigation.
   The result is discarded (`if (stopped) return`), which is why nothing looked wrong.
2. **A manual refresh during an in-flight request disappears.** `refresh()` calls `tick()`, which
   returns immediately on `inFlight`, having cleared the pending timer. The in-flight request's
   `finally` then schedules the next one at the ordinary interval. So pressing the button on a page
   that is mid-poll does nothing at all for up to five seconds, and if the in-flight request *fails*,
   the press is swallowed into a backoff the person pressed the button to escape.

- [x] Red first, in a new `tests/fleet-transport.test.ts`: `stop()` aborts the signal the fetch was
      handed; `stop()` removes `visibilitychange` and `online` (fire both afterwards, assert no
      further fetch); refresh mid-flight produces exactly **one** fresh attempt and no overlap.
- [x] Fix both: hoist the controller to transport scope and abort it in `stop()`; a `pendingRefresh`
      flag that `finally` acts on once.
- [x] Cover the rest of the transport while there is a file to put it in — the hidden tab that keeps
      its rhythm without fetching, visibility and `online` refreshing, the backoff doubling and
      resetting on success, `stop()` idempotent under StrictMode's double teardown.

**Status.** Done. Both defects were red first, and `tests/fleet-transport.test.ts` now covers with 16
tests the file that had none — the rhythm, the whole backoff curve to the millisecond, the hidden
tab, visibility and `online`, the timeout wording, and teardown.

One addition from Sol's review, and it is the one worth keeping: every other test drives `stop()` by
hand, which proves the transport *can* clean up and says nothing about whether anything ever asks it
to. The call lives in one line of `useFleetState`'s effect teardown. So the last test mounts the hook
and unmounts it — and deleting that line reds that test **and nothing else in the repo**, including
all 432 tests of `fleet-web.test.tsx`.

## What this plan is not doing, and why

- **No `EventSource` in the browser.** Checkbox 5 is explicit, and nothing measured here says polling
  is inadequate. The swap is still one function in `transport.ts`; the note describing it is still
  accurate.
- **No replay log.** Snapshots are replaceable — the newest one carries everything the skipped one
  did — so retention is one frame, and the roadmap forbids the other thing by name.
- **No change to `DRAIN_DEADLINE_MS` or the pause-versus-close policy.** The roadmap allows either,
  and pause-with-a-deadline **is** close-and-reconnect with a 30 s grace: `false` is the normal case
  for a healthy client (16 KB high-water mark, ~59 KB snapshot), so a policy that closes on the first
  `false` closes every subscriber on every collection. That was measured on 2026-09-08 and the
  reasoning is in the file. Stage 1 keeps it and adds the retention the roadmap asked for alongside.
- **Nothing outside the file set.** `collect.ts`, `health.ts`, `useActions.ts`, `daemon.ts`,
  `wire.ts` and the detail components belong to other live sessions.

## The simpler option passed over

For Stage 1, the simpler thing is to leave the drain path alone and let the next 60-second broadcast
carry the state — which is what the code does today, and it is not *wrong*, only up to a minute late.
It was passed over because the cost of the fix is one nullable string per subscriber and one branch in
a handler that already exists, and because "the live view is silently a minute behind for anyone whose
phone hiccupped" is the precise failure mode this project keeps writing postmortems about.

## The reviews

- GPT Sol reviewed the plan before any code was written (`--sandbox review`, exit 0, non-empty answer,
  ~12 minutes): **REVISE**, no P0, three P1 and two P2. All five were acted on, and two of them
  changed what this branch does rather than how it is described — the false staleness story above, and
  the cancel probe that could not fail. Both were things I had already written into code comments,
  which is the class this repo keeps meeting: a claim travels from a brief into a source comment
  without anybody tracing it.
- The stage diff then went back to Sol (`--sandbox workspace-write`, so it fixed inside the stage),
  with the scoped diff and the raw output of the five affected suites. **REVISE**, no P0, one P1 and
  two P2 — and the P1 was a defect this branch had introduced the day before.

  Accepting bare-CR line endings, I held back a trailing `\r` until the next chunk could say whether
  it was a line ending or half a CRLF, and wrote that into a test as *the one thing that legitimately
  waits*. It is wrong. **A CR is already a complete line ending**; the ambiguity is only ever about
  whether a FOLLOWING `\n` is a second one, never about whether this one ended a line. So
  `data: 1\r\r` dispatches at exactly the same point as `data: 1\r\r\n`, and holding it delayed
  every frame of a CR-only stream by a chunk and **lost the last frame entirely** when the stream
  ended — which is this stage's own subject, in miniature. Now the CR normalises immediately and a
  following LF is suppressed instead.

  The two P2s: the memory bound was misstated as exactly one buffered frame (several small pings can
  accumulate below Node's high-water mark before one write crosses it, so the bound is the queue up
  to the mark, plus the crossing write, plus one retained reference — and the stalled-subscriber test
  now asserts `> 1` rather than `> 0`, which is the stronger claim); and three load-bearing comments
  said things the code does not do, two of them older than this branch — that `EventSource`'s
  `onmessage` receives named events, and that `/api/state` costs a 12-second collection when it is
  served from cache.

  What it attacked and could not break: duplicate or out-of-order delivery in `live.ts`, a deadline
  left armed or un-armed across a second drain cycle, listener teardown ordering (it added a test for
  an initial write that throws), the fire-and-forget cancel, overlap or a lost press in
  `pollingTransport`, and whether normalisation can destroy a payload character — it cannot, since a
  raw CR or LF is not permitted inside an SSE field value.

  **It could not bind port 0 in its sandbox**, so it never executed the HTTP half of
  `tests/overseer-source.test.ts` and said so. Those were run here.
- A third artefact, `tests/sse-frames-splits.test.ts`, exists because this parser has now been wrong
  about packetization three times in three days and every previous test pushed one tidy frame per
  `push`. It asserts the property instead: **how a stream is cut must not change what comes out of
  it**, for seven streams across LF, CRLF, bare CR and mixed endings, over every single and double
  cut, plus the size bound at a limit the stream sits exactly on. It survived the round-1 rewrite
  unchanged; only its one *exception* clause needed replacing, because that clause was the thing Sol
  falsified.
- Round 2 sent Sol's own fixes back to Sol, on the house rule that a reviewer's edits are somebody
  else's unreviewed code the next time round. **APPROVE on the functional side** — no P0, no P1, and
  an independent 24,692-case packetization probe of the new parser found no divergence. Two P2s, both
  about tests being weaker than they read: the stalled-subscriber assertion was `> 1`, and a mutation
  that made `live.ts` keep writing after Node returned `false` — all four frames offered — still
  passed it. It is now exactly 2, which is what Node's accounting gives for 33-byte pings against a
  64-byte high-water mark.
- **Neither review round could bind `127.0.0.1` in its sandbox** (`listen EPERM`), so neither ever
  executed the seventeen HTTP-backed `overseer-source` tests, and round 2's `npm run typecheck` fell
  back to the direct `tsx` invocation. Both were run on the box instead. This is worth knowing for
  the next stage that sends network-dependent tests to a reviewer: it will report the rest as
  passing, and say so only if asked.

## Where this ended

**Finished.** All five roadmap checkboxes are met, `dev` has it at `f1f55776`, and nothing is left
that this stage's acceptance paragraph asks for. Three things are worth carrying forward, none of
them blocking:

- **A restart is needed for the two server-side changes to be live.** `live.ts` and `source.ts` are
  loaded by the running fleet dashboard and Overseer daemon, which this session must not restart.
  `transport.ts` reaches a browser on the next fleet client build.
- **A third environment red exists in a fresh worktree**, beyond the two the brief names:
  `tests/fleet-decisions-route.test.ts` fails because `server.ts` calls `process.exit(2)` when there
  is no built client at `tools/fleet/web/dist`. It passes after `npm run build:fleet`. Same family as
  `cold-start-lazy-imports` and `pdf-bundle-trace` — a missing build artefact, not a defect.
- **"Both polling paths" in checkbox 4 was read as the transport's scheduled tick and its
  event-driven refresh**, both of which are audited. If it meant `transport.ts` *and* `useActions.ts`,
  the second belongs to the Session continuity session and was left alone.

## Gates

- `tests/fleet-live.test.ts`, `tests/overseer-source.test.ts`, `tests/fleet-transport.test.ts`,
  `tests/fleet-web.test.tsx` focused; then `npm test` and `npm run typecheck` in full.
- Two environment reds are expected in any worktree without `api-dist/`: `cold-start-lazy-imports`
  and `pdf-bundle-trace`.
- GPT Sol reviews this plan before Stage 1, and the diff at the end of every stage
  (`--sandbox workspace-write`, so it fixes inside the stage).
