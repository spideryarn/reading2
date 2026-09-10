/**
 * Server-Sent Events for the fleet dashboard: the server pushes a new
 * snapshot as soon as `collect()` produces one, instead of the client polling
 * `/api/state` every few seconds.
 *
 * Direction: docs/project/overseer-direction.md. This is scaffolding for
 * v0.1 ("it should auto-update … hopefully we can come up with something
 * smarter", Greg, 2026-09-08), not a new capability of its own — the payload
 * is the same `FleetSnapshot` the poll already fetches from `/api/state`.
 *
 * **THE POLL IS `/api/state`, AND THIS FILE USED TO SAY `/api/agents` FIVE
 * TIMES.** `/api/agents` is the endpoint's original name, still mounted in
 * `server.ts` as an alias answering identical bytes, and called by nothing in
 * this repo: the browser polls `/api/state` (`web/src/transport.ts`) and so does
 * the Overseer (`tools/overseer/source.ts`). The alias stays — it costs one clause,
 * and something outside this repo may have it in a note or a bookmark — but the
 * prose here had to change, because this is the file somebody reads to learn how
 * the live stream works, and it was naming an endpoint no client uses as "the
 * poll". Instance 10 of docs/postmortems/260908b: the join was not missing, the
 * description was, which is the same class as a wrong comment above the code it
 * describes.
 *
 * NO IMPORT SIDE EFFECTS, same reason as status.ts: nothing here binds a port
 * or starts a timer at module scope. `server.ts` owns both — it creates the
 * heartbeat timer via `startHeartbeat()` and calls `broadcast()` from its own
 * refresh loop. This module only holds the subscriber set and the wire format.
 *
 * ## Wire contract (for the React client)
 *
 * `GET` the subscribe endpoint (`server.ts` mounts it, e.g. `/api/live`) with
 * `EventSource`. Two named events:
 *
 *   - `snapshot` — data is `JSON.stringify(FleetSnapshot & { error: string | null })`,
 *     the same shape `/api/state` already returns. Sent once immediately on
 *     connect (from whatever the server currently has cached — never blocks on
 *     a fresh collection) and again on every subsequent broadcast.
 *   - `ping` — a heartbeat, sent on an interval so a reverse proxy or phone
 *     radio does not decide the connection is idle and drop it. Data is a
 *     timestamp; the client does not need to do anything with it beyond
 *     noting the connection is still alive.
 *
 * `EventSource` retries on its own after a drop, using exponential-ish
 * backoff it controls, so the client does not need to reconnect by hand. What
 * it DOES need to do is distinguish "still connecting" from "gave up": listen
 * for the `error` event, and if no `snapshot` or `ping` has arrived in
 * `2.5 * <heartbeat interval>` (comfortably more than one missed beat), treat
 * the stream as dead — show the page as no-longer-live (e.g. "reconnecting…"
 * or "showing a stale copy, last updated <age>") and fall back to polling
 * `/api/state` until a fresh `open` event arrives. THIS IS THE PART THAT
 * MATTERS MOST: a live view that has silently stopped updating but still
 * looks current is exactly the failure mode docs/project/overseer-direction.md
 * and this whole project keep hitting (see also silent-success.md) — never
 * ship a "live" badge that isn't backed by a recent heartbeat.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

/** One subscriber: the response stream we write SSE frames to. */
type Subscriber = {
  res: ServerResponse;
  /** Set once so a subscriber already being torn down is never removed twice
   *  or written to after `res.end()` — see `removeSubscriber`. */
  closed: boolean;
  /**
   * A write returned `false` and no `drain` has arrived yet. **Nothing is
   * written while this is set** — that is the whole memory bound.
   */
  waitingToDrain: boolean;
  /** Destroys the subscriber if `drain` never comes. Cleared when it does. */
  drainTimer: ReturnType<typeof setTimeout> | null;
  /**
   * **The newest snapshot frame this subscriber missed while stalled, and
   * never more than one.** Sent the moment its socket drains — see
   * `markFull`. Null when nothing has been withheld, and null for a withheld
   * heartbeat, which is not worth keeping.
   *
   * It is a reference to the same string every other subscriber was handed,
   * so a stalled subscriber costs a pointer rather than a snapshot.
   */
  pending: string | null;
  /** Removes every listener this subscriber attached. Set by `subscribe`. */
  detach: () => void;
  /** The outstanding `drain` handler, so teardown can take it off again. */
  onDrain: (() => void) | null;
};

const subscribers = new Set<Subscriber>();

/**
 * 30s for a socket to accept one frame it has already been handed.
 *
 * **Two heartbeats and half a collection.** A phone whose radio slept, or a
 * laptop lid closed for ten seconds, is back inside this; a socket that has
 * not moved a byte in thirty seconds is not coming back, and holding it costs
 * a snapshot's worth of memory each. Long enough that no healthy client is
 * ever punished, short enough that a wedged one is not held for a whole
 * refresh cycle.
 */
export const DRAIN_DEADLINE_MS = 30_000;

/** How many clients are currently connected. For `server.ts` to log and for the page to show. */
export function subscriberCount(): number {
  return subscribers.size;
}

/**
 * Write one SSE frame. Multi-line data is folded into multiple `data:` lines
 * per the spec — a JSON payload never contains a bare newline, but the
 * heartbeat's timestamp string is trivially single-line too, so this is
 * cheap insurance rather than a case we expect to hit.
 */
function frame(event: string, data: string): string {
  const lines = data.split("\n").map((line) => `data: ${line}`);
  return `event: ${event}\n${lines.join("\n")}\n\n`;
}

/**
 * Write a frame to one subscriber, never letting a bad socket propagate.
 *
 * A write to a connection the OS has already torn down (client gone, but the
 * `close` event hasn't fired yet — there is always a window) can throw
 * synchronously. That must not stop the broadcast loop for every other
 * subscriber, and must not reach the collector's refresh loop that called us.
 * Returns `res.write`'s own answer, and **every caller must act on a false** —
 * see `writeUnlessFull`.
 */
function safeWrite(sub: Subscriber, data: string): boolean {
  if (sub.closed) return false;
  try {
    return sub.res.write(data);
  } catch {
    // A synchronous throw from `write` means this socket is already dead.
    // Treat it exactly like a `close` event: remove it so it stops being
    // written to, and so it stops being counted as a live subscriber.
    dropSubscriber(sub);
    return false;
  }
}

/**
 * Write, unless this subscriber's buffer is already full — **the one place a
 * `false` is acted on**, so no path writes a frame and ignores the answer.
 *
 * `retain` says whether this frame is worth keeping for the subscriber if it
 * cannot be written now: true for a snapshot, false for a heartbeat. See
 * `markFull` for why a late ping is worse than no ping.
 *
 * **`false` DOES NOT MEAN THE SOCKET IS DEAD, and an earlier draft of this
 * file assumed it did.** A `ServerResponse` has a 16 KB high-water mark and a
 * fleet snapshot is ~59 KB, so `write` returns `false` on the FIRST frame to a
 * perfectly healthy client, every time. Destroying on that would have
 * disconnected every subscriber — the Overseer daemon included, which would
 * have recorded a real `sse-stream` degraded edge and dropped to polling for
 * sixty seconds — on every collection, for ever. Measured by GPT Sol against a
 * real `ServerResponse`: `writableLength: 60524` after one 59 KB write.
 * 2026-09-08.
 *
 * So `false` means exactly what Node says it means: **stop writing until
 * `drain`.** That alone is the memory bound — at most one frame is ever
 * outstanding per subscriber, because the next broadcast writes nothing. What
 * makes it a bound rather than a hope is `DRAIN_DEADLINE_MS`: a socket that
 * never drains is destroyed, and a socket that drains is back in the fold with
 * the next snapshot, which carries everything the skipped one did.
 */
function writeUnlessFull(sub: Subscriber, data: string, retain: boolean): void {
  if (sub.closed) return;
  if (sub.waitingToDrain) {
    // Not written, and — if it is a snapshot — not lost either. The previous
    // retained snapshot is simply overwritten: the newer one says everything
    // it did, which is exactly why this is a bound and not a queue.
    if (retain) sub.pending = data;
    return;
  }
  if (safeWrite(sub, data)) return;
  markFull(sub);
}

/**
 * Stop writing to this subscriber until its buffer empties, and give it a
 * deadline to do so.
 *
 * `once("drain")` rather than a poll, because that is the event Node emits for
 * exactly this. A conforming writable cannot emit it before the synchronous
 * `write` that returned `false` has returned and this listener is attached, so
 * there is no window to miss it in. The timer is unref'd: a stalled subscriber
 * must never be the reason this process stays up.
 *
 * ## And on `drain`, the newest snapshot goes out at once
 *
 * **This used to send nothing at all.** Be careful about what that did and did
 * not cost, because the first draft of this comment overstated it and GPT Sol
 * caught it: a `false` does not withhold the frame that caused it — Node has
 * already buffered that one and it goes out when the socket moves. What was
 * lost was any snapshot broadcast **while the subscriber was still blocked**,
 * and those simply vanished: `drain` cleared the block and sent nothing, so the
 * subscriber sat a generation behind until the next publish, up to 60 seconds
 * later (`server.ts`'s refresh loop).
 *
 * That is a narrow race rather than the ordinary case — publishes are 60s apart
 * and `DRAIN_DEADLINE_MS` destroys a subscriber that has not drained in 30 — so
 * the reason to hold the invariant is not the size of the incident. It is that
 * *a subscriber that is alive when a snapshot is published receives that
 * snapshot or a newer one* is a sentence this module can be trusted on,
 * whatever the box's cadence happens to be, and it costs one reference.
 *
 * So a withheld **snapshot** is kept (`sub.pending`, one frame, overwritten by
 * anything newer) and written the moment the socket empties. A withheld
 * **ping** is dropped: a heartbeat is a claim about *now*, and one delivered
 * four seconds late tells the client something the snapshot beside it already
 * proves. Retaining it would also mean a stalled subscriber could come back to
 * a heartbeat and no state, which is the wrong half.
 */
function markFull(sub: Subscriber): void {
  if (sub.closed || sub.waitingToDrain) return;
  sub.waitingToDrain = true;
  const timer = setTimeout(() => {
    // Thirty seconds and the buffer has still not fallen below its high-water
    // mark. (Not "not one byte moved" — `drain` is a threshold, not a byte
    // counter, and the earlier comment here said the stronger thing.) Give up:
    // the memory this is holding is worth more than the connection.
    dropSubscriber(sub);
  }, DRAIN_DEADLINE_MS);
  timer.unref?.();
  sub.drainTimer = timer;
  const onDrain = (): void => {
    if (sub.drainTimer !== null) clearTimeout(sub.drainTimer);
    sub.drainTimer = null;
    sub.onDrain = null;
    sub.waitingToDrain = false;
    // Taken before the write, so a second `false` re-retains the CURRENT frame
    // through `writeUnlessFull` rather than looping on a stale one.
    const missed = sub.pending;
    sub.pending = null;
    // `closed` is checked by `writeUnlessFull`: a drain that arrives after the
    // deadline gave up must not resurrect a subscriber that is already gone.
    if (missed !== null) writeUnlessFull(sub, missed, true);
  };
  sub.onDrain = onDrain;
  sub.res.once("drain", onDrain);
}

/**
 * Forget a subscriber. For a socket that has ALREADY gone (a `close`/`error` event).
 *
 * **Everything this subscriber owns goes here, and there is nothing else that
 * owns anything**: the set entry, the drain deadline, the retained frame, the
 * `drain` handler and the three connection listeners `subscribe` attached. A
 * departed subscriber must leave nothing behind that could be called or held,
 * because this process is meant to run for weeks and a slow leak here is
 * invisible until somebody happens to look at `subscriberCount()`.
 */
function removeSubscriber(sub: Subscriber): void {
  if (sub.closed) return;
  sub.closed = true;
  if (sub.drainTimer !== null) clearTimeout(sub.drainTimer);
  sub.drainTimer = null;
  if (sub.onDrain !== null) {
    try {
      sub.res.off("drain", sub.onDrain);
    } catch {
      // A half-dead socket. The listener goes with it either way.
    }
    sub.onDrain = null;
  }
  sub.pending = null;
  sub.detach();
  subscribers.delete(sub);
}

/**
 * Forget a subscriber **and close its socket.** For one we are giving up on
 * rather than one that left.
 *
 * `destroy()` and not `end()`: `end` writes a final chunk and waits for it to
 * flush, and the whole reason we are here is a socket that is not flushing —
 * so `end` on a wedged client is one more buffer nobody drains. `destroy`
 * releases the memory now, and `EventSource` reconnects on its own.
 *
 * Guarded, because `destroy` on a half-dead socket can throw, and this is
 * called from inside the refresh loop's broadcast.
 */
function dropSubscriber(sub: Subscriber): void {
  removeSubscriber(sub);
  try {
    sub.res.destroy();
  } catch {
    // Already gone. There is nothing left to release.
  }
}

/**
 * Backpressure decision: **wait for `drain`; don't queue, and don't keep
 * writing.**
 *
 * `res.write` returning `false` means Node has already buffered this frame in
 * *our* process because the socket would not take it yet. Four policies:
 *
 *  (a) buffer frames for it ourselves — unbounded memory, obviously wrong;
 *  (b) skip this frame, keep writing on every later broadcast;
 *  (c) destroy it immediately;
 *  (d) write nothing until `drain`, and destroy only if `drain` never comes.
 *
 * **This file has now been wrong in two directions, and both are recorded
 * because the reasoning matters more than the answer.** It shipped (b), which
 * is (a) wearing a disguise: the frame that returned `false` is already in
 * memory, and writing the one after that, and the one after that, is unbounded
 * growth per half-alive client. Measured: a wedged socket and 5,000 snapshots
 * held **287.8 MB**, still climbing, on a box that has hit load average 391
 * with the OOM killer firing (server.ts). E-stream, docs/plans/260908f-….
 *
 * Then it briefly became (c) — which is worse, because **`false` is the normal
 * case here.** A `ServerResponse`'s high-water mark is 16 KB and a snapshot is
 * ~59 KB, so the very first frame to a healthy client returns `false`. (c)
 * would have destroyed every subscriber on every collection, the Overseer
 * daemon included. Caught by GPT Sol before it landed, against a real
 * `ServerResponse` rather than the test's double.
 *
 * So (d), which is the one that reads Node's contract literally: `false` means
 * *stop until `drain`*, and says nothing at all about the socket's health. At
 * most one frame is outstanding per subscriber; a drain puts it straight back;
 * a subscriber that cannot drain inside `DRAIN_DEADLINE_MS` is destroyed, and
 * `EventSource` reconnects into `subscribe`'s immediate cached snapshot.
 *
 * **`false` is not a dropped frame.** The bytes went into the buffer; what we
 * refuse to do is keep filling a buffer nobody is emptying.
 */
function broadcastFrame(data: string, retain: boolean): void {
  // A copy, because a write can drop a subscriber (a throw, or the drain
  // deadline firing) and delete from `subscribers` as we go. Node Sets tolerate
  // deletion during iteration, but this loop is the one place a bug would be
  // silent — a skipped subscriber just quietly stops updating.
  for (const sub of [...subscribers]) {
    writeUnlessFull(sub, data, retain);
  }
}

/**
 * Push a fresh snapshot to every connected subscriber.
 *
 * `payload` is whatever `server.ts` already builds for `/api/state` —
 * `{ ...snapshot, error }` — passed as a pre-serialised JSON string so this
 * module does not need to know `FleetSnapshot`'s shape (and can't drift from
 * it: there is exactly one place that assembles the wire object).
 */
export function broadcast(payloadJson: string): void {
  // Retained if a subscriber is stalled: a snapshot is the thing the page is
  // for, and the newest one replaces any older one already held.
  broadcastFrame(frame("snapshot", payloadJson), true);
}

/**
 * Attach a new subscriber and stream the current snapshot immediately.
 *
 * `initialPayloadJson` is the same pre-serialised JSON `broadcast` takes —
 * caller passes whatever it currently has cached (possibly the very first
 * snapshot, possibly none yet: caller's choice what to send when nothing has
 * been collected). Sending it synchronously on connect is what keeps a new
 * client from being blank for up to `REFRESH_MS`: it sees the last-known
 * state immediately, then live updates from there.
 *
 * `heartbeatMs` is accepted here (rather than only in `startHeartbeat`) so a
 * test can drive a subscriber without starting the real interval at all —
 * this function itself starts no timer.
 */
export function subscribe(req: IncomingMessage, res: ServerResponse, initialPayloadJson: string | null): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
    // Disables buffering on nginx-style proxies sitting in front of this —
    // harmless to send even though this box has none today.
    "x-accel-buffering": "no",
  });
  // Flush headers now rather than waiting for the first frame: some clients
  // (and some proxies) treat "no bytes yet" as "not connected".
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sub: Subscriber = {
    res,
    closed: false,
    waitingToDrain: false,
    drainTimer: null,
    pending: null,
    // Replaced below. It has to be callable from the moment the subscriber
    // exists, because the initial write can drop it before the listeners the
    // real `detach` removes have even been attached.
    detach: () => {},
    onDrain: null,
  };
  subscribers.add(sub);

  const cleanup = (): void => removeSubscriber(sub);
  // `close` fires on both a clean end and an abrupt drop (phone locks, tab
  // closes); `error` covers a reset socket. Either must remove the
  // subscriber — an accumulating set on a process meant to run for weeks is
  // exactly the slow leak the brief calls out, and it is invisible until
  // someone happens to look at `subscriberCount()`.
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", cleanup);
  // And taken off again on teardown, so a connection this module has finished
  // with holds no reference back into it. `off` on an emitter that has already
  // gone can throw, and teardown runs from inside the broadcast loop.
  sub.detach = (): void => {
    try {
      req.off("close", cleanup);
      req.off("error", cleanup);
      res.off("error", cleanup);
    } catch {
      // The connection is gone; its listeners went with it.
    }
  };

  if (initialPayloadJson !== null) {
    // Goes through the same gate as any other write, which matters more here
    // than anywhere: a 59 KB snapshot into a fresh 16 KB buffer returns `false`
    // EVERY TIME, and an earlier draft destroyed the connection on it.
    //
    // AFTER the listeners, not before: a write that throws drops the
    // subscriber, and dropping one whose `detach` was still the placeholder
    // would leave the three listeners above attached to a connection nothing
    // is tracking any more.
    writeUnlessFull(sub, frame("snapshot", initialPayloadJson), true);
  }
}

/**
 * Start the heartbeat timer. Returns a stop function rather than the raw
 * `Timeout`, so a caller (or a test) never needs to know it's a `setInterval`
 * under the hood.
 *
 * `unref()`'d so this timer can never by itself keep the process alive — the
 * refresh loop in server.ts already does that on purpose with its own
 * interval; this one must not duplicate that responsibility or the process
 * would stay up on an idle box with zero subscribers for the wrong reason.
 *
 * Guards against the box ever binding a port or starting a timer just from
 * `import "./live.js"` (see file header) by requiring the caller to invoke
 * this explicitly, exactly like `refresh()`/`setInterval` in server.ts today.
 */
export function startHeartbeat(intervalMs: number): () => void {
  const timer = setInterval(() => {
    // NOT retained: a heartbeat withheld from a stalled subscriber is dropped
    // rather than kept, because it is a claim about the moment it was sent.
    // See `markFull`.
    broadcastFrame(frame("ping", String(Date.now())), false);
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
