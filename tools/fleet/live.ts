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
};

const subscribers = new Set<Subscriber>();

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
 * Returns false when the write failed OR when `res.write` reports backpressure,
 * so the caller can decide what to do about a slow client (see `broadcast`).
 */
function safeWrite(sub: Subscriber, data: string): boolean {
  if (sub.closed) return false;
  try {
    return sub.res.write(data);
  } catch {
    // A synchronous throw from `write` means this socket is already dead.
    // Treat it exactly like a `close` event: remove it so it stops being
    // written to, and so it stops being counted as a live subscriber.
    removeSubscriber(sub);
    return false;
  }
}

function removeSubscriber(sub: Subscriber): void {
  if (sub.closed) return;
  sub.closed = true;
  subscribers.delete(sub);
}

/**
 * Backpressure decision: drop, don't queue.
 *
 * `res.write` returning `false` means the socket's kernel buffer is full —
 * this client (probably a flaky phone connection) is not draining as fast as
 * we're producing. The alternatives are (a) buffer frames for it ourselves,
 * or (b) skip it and let the next broadcast — or its next reconnect — bring
 * it current. We do (b): a fleet snapshot is a *replaceable* state update,
 * not an event log a client must see every entry of, so an unboundedly
 * growing per-subscriber queue on a box that already hit load average 391
 * with the OOM killer firing (server.ts) is a strictly worse failure mode
 * than one client occasionally missing an intermediate frame. The client
 * self-heals: the next successful broadcast carries the latest snapshot, and
 * on reconnect `subscribe()` sends the current snapshot immediately (see
 * below), so a slow client is at worst stale, never wrong.
 *
 * We do NOT disconnect a slow client just for one `false` — that would punish
 * a momentary stall on the same footing as a dead socket. It only gets
 * dropped from the set on an actual `close`/`error`, or on a thrown `write`.
 */
function broadcastFrame(data: string): void {
  for (const sub of subscribers) {
    safeWrite(sub, data);
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
  broadcastFrame(frame("snapshot", payloadJson));
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

  const sub: Subscriber = { res, closed: false };
  subscribers.add(sub);

  if (initialPayloadJson !== null) {
    safeWrite(sub, frame("snapshot", initialPayloadJson));
  }

  const cleanup = (): void => removeSubscriber(sub);
  // `close` fires on both a clean end and an abrupt drop (phone locks, tab
  // closes); `error` covers a reset socket. Either must remove the
  // subscriber — an accumulating set on a process meant to run for weeks is
  // exactly the slow leak the brief calls out, and it is invisible until
  // someone happens to look at `subscriberCount()`.
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", cleanup);
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
    broadcastFrame(frame("ping", String(Date.now())));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
