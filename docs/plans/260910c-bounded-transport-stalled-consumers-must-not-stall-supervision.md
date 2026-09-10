# Bounded transport: stalled consumers must not stall supervision

The stage is
[260908f § Bounded transport](260908f-overseer-and-fleet-improvement-roadmap.md#stage-bounded-transport--stalled-consumers-must-not-stall-supervision),
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
| 3. Error headers + never-ending body in `source.ts`; bound `sseFrames` | **Met.** `discardBody` cancels rather than drains on both paths, `readBounded` bounds the poll body, `sseFrames` bounds the incomplete tail per-frame and per-tail. Tested, including the packetization trap. One inconsistency remains — see Stage 2. |
| 4. Stop/abort through both polling paths; unmounted page owns nothing; manual refresh mid-flight | **Not met, and `pollingTransport` has no tests at all.** Two real defects — see Stage 3. |
| 5. Keep browser polling unless a measurement says otherwise | **Met by doing nothing.** No measurement says otherwise, so this plan adds no `EventSource`. |

So this plan is three narrow stages against three real defects, plus the evidence the stage asks for
in the form it asks for. **It is deliberately not a rewrite of code that was reviewed nine days ago
and is right.**

### The defect in `live.ts`, in one paragraph

`writeUnlessFull` writes nothing to a subscriber whose buffer is full — correct, and the whole memory
bound. But when `drain` arrives, `waitingToDrain` is cleared **and nothing is sent**: the subscriber
waits for the *next* broadcast. The collector's `REFRESH_MS` is 60 seconds (`server.ts:121`). So a
phone that stalls for two seconds during a broadcast shows a snapshot that is up to a minute stale,
on a page whose entire purpose is to say what is true now, and the staleness is invisible because the
connection is healthy and the heartbeat is arriving. The roadmap's own words for the fix are already
in the checkbox: *retaining at most the newest snapshot*.

## Stage 1 — a subscriber that drains gets the newest snapshot, not the next one

- [ ] Red first: a real `Writable` with `highWaterMark: 64` whose `write` callback is **held and then
      released** — the checkbox's "delays callbacks", which the existing never-drains double cannot
      express. Assert across ~200 snapshots and interleaved pings: exactly one frame handed to the
      sink while stalled, `writableLength` never above one frame, and — the red part — that releasing
      the callback delivers the **newest** snapshot rather than nothing.
- [ ] Retain at most one frame per subscriber, and only a `snapshot`: a withheld `ping` is worthless
      (it claims liveness at a moment that has passed), so pings are dropped rather than queued. The
      retained value is the same shared frame string every other subscriber was handed, so the cost
      is one pointer per stalled subscriber, not one snapshot.
- [ ] Teardown removes the listeners it added — `close`/`error` on the request, `error` and any
      outstanding `drain` on the response — so a subscriber that leaves owns nothing. Assert an
      unaffected subscriber goes on receiving throughout.

**Status.** Not started.

## Stage 2 — `source.ts`: the one awaited cancel, and a consumer that walks away

`source.ts` says, twice and at length, *do not await a peer that has stopped answering* — and then
`readStream`'s `finally` does `await reader.cancel()`. `readBounded`, ten lines down, does
`void reader.cancel().catch(...)` and cites the same reason for not awaiting.

- [ ] Red first: a consumer that `break`s out of `for await` while a hostile server is holding the
      body open. Assert the generator's `return()` settles inside a bound. **If it settles anyway,
      that is the answer and it is recorded as a negative control rather than fixed** — a claim that
      an await hangs is a claim that has to be shown.
- [ ] Bring the line into agreement with the file's own doctrine, whichever way the test points.

**Status.** Not started. The two outcomes above are both acceptable endings; which one it is will be
written here once the test has run.

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

- [ ] Red first, in a new `tests/fleet-transport.test.ts`: `stop()` aborts the signal the fetch was
      handed; `stop()` removes `visibilitychange` and `online` (fire both afterwards, assert no
      further fetch); refresh mid-flight produces exactly **one** fresh attempt and no overlap.
- [ ] Fix both: hoist the controller to transport scope and abort it in `stop()`; a `pendingRefresh`
      flag that `finally` acts on once.
- [ ] Cover the rest of the transport while there is a file to put it in — the hidden tab that keeps
      its rhythm without fetching, visibility and `online` refreshing, the backoff doubling and
      resetting on success, `stop()` idempotent under StrictMode's double teardown.

**Status.** Not started.

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

## Gates

- `tests/fleet-live.test.ts`, `tests/overseer-source.test.ts`, `tests/fleet-transport.test.ts`,
  `tests/fleet-web.test.tsx` focused; then `npm test` and `npm run typecheck` in full.
- Two environment reds are expected in any worktree without `api-dist/`: `cold-start-lazy-imports`
  and `pdf-bundle-trace`.
- GPT Sol reviews this plan before Stage 1, and the diff at the end of every stage
  (`--sandbox workspace-write`, so it fixes inside the stage).
