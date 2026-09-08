/**
 * Where the Overseer's evidence comes from: the fleet dashboard's stream, with
 * its own `/api/state` behind it as the fallback.
 *
 * **There is one collector on this box and it is not ours.** A collection costs
 * ~12s of grepping thirty-five transcripts, and this box has hit load 391 with
 * the OOM killer firing, so a second collector is a real cost rather than
 * untidiness — docs/project/orchestrator-direction.md § Two tenses. This module
 * therefore *consumes*: it never calls `collect()`, and there is deliberately no
 * local fallback that would (the plan removed it: `FleetSnapshot` has no
 * `health` field, so a local collection would return a different contract and a
 * missing health block would read as a health *change*).
 *
 * ## Why a hand-written SSE reader rather than `EventSource`
 *
 * Node has a global `EventSource` now, and it reconnects on its own with its
 * own backoff. That is exactly the wrong behaviour here: a transport that
 * silently repairs itself is a transport whose failures never get written down,
 * and *falling back must be an observable state, not a silent switch* is the
 * whole requirement. `fetch` plus a frame parser gives us the two edges —
 * opened and closed — that the daemon turns into notes.
 *
 * ## The shape of the loop
 *
 *     stream → (it ends) → poll every pollIntervalMs → after streamRetryAfterMs, stream again
 *
 * Sequential and single, rather than a stream and a poller running at once.
 * Two concurrent transports would make "which one is this payload from?" a
 * race, and the answer is written into the history. While the stream is up
 * nothing polls, so the poll's own condition means what it says: the fallback
 * failed *when it was the only thing left*.
 *
 * A duplicate payload is not a problem for anyone downstream — `admissible()`
 * calls a repeated `collectedAt` a duplicate and does nothing with it, which is
 * the normal case by design — so the poll can be as eager as it likes. It reads
 * a cached JSON string; it does not make the box collect.
 */

/** Which pipe a payload came down. Recorded, because a history collected by polling is coarser. */
export type Transport = "sse" | "poll";

/**
 * What the source saw. Facts, not verdicts: this module never decides that
 * something is *degraded*, because the same closure means one thing after three
 * hours and nothing at all after two seconds. `notes.ts` owns the edges.
 */
export type SourceMessage =
  | { kind: "payload"; via: Transport; atMs: number; json: unknown }
  /** Bytes arrived and were not JSON. Kept apart from a payload so it cannot be parsed as an empty fleet. */
  | { kind: "unreadable"; via: Transport; atMs: number; why: string }
  | { kind: "stream-opened"; atMs: number; why: string }
  | { kind: "stream-closed"; atMs: number; why: string }
  | { kind: "poll-failed"; atMs: number; why: string };

export type SourceOptions = {
  /** The dashboard's origin, e.g. `http://127.0.0.1:8787`. */
  baseUrl: string;
  /** Aborting it ends the generator promptly, including mid-request and mid-sleep. */
  signal: AbortSignal;
  /** How often to poll while the stream is down. */
  pollIntervalMs?: number;
  /** How long to stay on the fallback before trying the stream again. */
  streamRetryAfterMs?: number;
  /** How long one poll may take before it is a failure. */
  pollTimeoutMs?: number;
  /** How long an open stream may deliver nothing — not even a heartbeat — before it is dead. */
  streamSilenceMs?: number;
  now?: () => number;
};

/**
 * 15s. The poll reads a cached string — the dashboard does not collect to
 * answer it — so this is bounded by JSON serialisation rather than by anything
 * expensive, and being at most 15s behind a collection while the stream is down
 * is worth four cheap requests a minute.
 */
export const POLL_INTERVAL_MS = 15_000;

/**
 * 60s on the fallback before trying the stream again.
 *
 * Long enough that a dashboard restart is not met by a reconnection attempt
 * every 200ms, short enough that the ordinary case — the dashboard was
 * restarted by the agent who owns it — repairs itself inside a minute without
 * anyone doing anything.
 */
export const STREAM_RETRY_AFTER_MS = 60_000;

/**
 * **20s, and the number matters less than the fact that there is one.**
 *
 * `fetch` has no default timeout: a socket that is accepted and never answered
 * parks this daemon's only loop indefinitely, with no error, no event, and no
 * way back — while the tick loop goes on writing a heartbeat, so the checkpoint
 * says the Overseer is alive and the source is simply gone. That is the failure
 * the producer had on 2026-09-08, in the other direction: `execFile` waited on
 * a child that had taken SIGTERM in uninterruptible IO, nothing threw, and the
 * refresh loop never reached its next iteration. **The thing that would have
 * reported the failure was the thing that had stopped.**
 *
 * A poll reads a cached string, so 20s is many times what it can honestly need,
 * even on a box at load 391.
 */
export const POLL_TIMEOUT_MS = 20_000;

/**
 * 90s of an open stream saying nothing at all — six missed heartbeats.
 *
 * `server.ts` pings every 15s (`FLEET_HEARTBEAT_MS`), so silence this long is a
 * connection that is open and dead: a half-closed socket the kernel has not
 * noticed, or a proxy holding it up. `live.ts` suggests 2.5 heartbeats for the
 * browser; this is more tolerant because a reconnect costs the producer a
 * subscriber churn, and because timers on this box run late under load — and
 * because the freshness watchdog is the real backstop, five minutes behind.
 */
export const STREAM_SILENCE_MS = 90_000;

/** One `event:`/`data:` pair, reassembled. */
export type SseFrame = { event: string; data: string };

/**
 * An incremental SSE parser: push bytes, get whole frames.
 *
 * **A frame does not arrive in one chunk**, and assuming it does is the bug
 * that shows up as a JSON parse error every few hours under load and never in a
 * test. A 60 KB snapshot is several TCP segments; the split lands wherever it
 * lands. So the tail is kept until a blank line closes the frame.
 *
 * Per the spec: `data:` lines are joined with newlines, one leading space after
 * the colon is stripped, an absent `event:` means `message`, and a line
 * beginning `:` is a comment. `\r\n` is tolerated because a proxy may rewrite
 * line endings and a stray `\r` inside the JSON would be a parse failure with a
 * baffling message.
 */
export function sseFrames(): { push(chunk: string): SseFrame[] } {
  let buffer = "";
  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      for (;;) {
        const end = buffer.indexOf("\n\n");
        const endCrlf = buffer.indexOf("\r\n\r\n");
        const at = end === -1 ? endCrlf : endCrlf === -1 ? end : Math.min(end, endCrlf);
        if (at === -1) break;
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + (at === endCrlf && endCrlf !== end ? 4 : 2));
        const frame = parseFrame(raw);
        if (frame !== null) frames.push(frame);
      }
      return frames;
    },
  };
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (clean === "" || clean.startsWith(":")) continue;
    const colon = clean.indexOf(":");
    const field = colon === -1 ? clean : clean.slice(0, colon);
    const rest = colon === -1 ? "" : clean.slice(colon + 1);
    const value = rest.startsWith(" ") ? rest.slice(1) : rest;
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0 && event === "message") return null;
  return { event, data: data.join("\n") };
}

/**
 * The source, as an async generator, for as long as the signal allows.
 *
 * A generator rather than callbacks because the daemon's whole job is a
 * sequential fold over these messages, and `for await` makes "handle one
 * message completely before the next" the default rather than something to
 * remember. Back-pressure comes free: while the daemon is writing to disk,
 * nothing is being read off the socket.
 */
export async function* fleetSource(options: SourceOptions): AsyncGenerator<SourceMessage> {
  const now = options.now ?? Date.now;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const streamRetryAfterMs = options.streamRetryAfterMs ?? STREAM_RETRY_AFTER_MS;
  const pollTimeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  const streamSilenceMs = options.streamSilenceMs ?? STREAM_SILENCE_MS;
  const base = options.baseUrl.replace(/\/+$/, "");
  const { signal } = options;

  while (!signal.aborted) {
    yield* readStream(`${base}/api/live`, signal, now, streamSilenceMs);
    if (signal.aborted) return;

    // THE FALLBACK, and it runs for a bounded time rather than for ever: the
    // stream is the transport we want back, and a source that only retried it
    // on a poll failure would stay on the fallback all week after one blip.
    const until = now() + streamRetryAfterMs;
    while (!signal.aborted && now() < until) {
      yield await pollOnce(`${base}/api/state`, signal, now, pollTimeoutMs);
      if (signal.aborted) return;
      await sleep(pollIntervalMs, signal);
    }
  }
}

/**
 * One attempt at the stream: everything it yields, until it ends.
 *
 * A failure to connect and a stream that ended after an hour are the same
 * message with different sentences, deliberately — the daemon does not treat
 * them differently, and inventing two conditions for one fact is how a log
 * stops being readable.
 */
async function* readStream(
  url: string,
  signal: AbortSignal,
  now: () => number,
  silenceMs: number,
): AsyncGenerator<SourceMessage> {
  // A DEADLINE THAT IS PUSHED FORWARD BY EVERY BYTE, rather than one budget for
  // the whole connection: an SSE stream is meant to stay open for weeks, so the
  // thing to time out is silence, not duration.
  const local = new AbortController();
  let silent = false;
  let deadline = setTimeout(expire, silenceMs);
  function expire(): void {
    silent = true;
    local.abort();
  }
  function heard(): void {
    clearTimeout(deadline);
    deadline = setTimeout(expire, silenceMs);
  }
  const both = AbortSignal.any([signal, local.signal]);
  const silence = (): string => `no bytes for ${silenceMs}ms, not even a heartbeat, so the stream is open and dead`;

  let response: Response;
  try {
    response = await fetch(url, { signal: both, headers: { accept: "text/event-stream" } });
  } catch (cause) {
    clearTimeout(deadline);
    if (signal.aborted) return;
    yield { kind: "stream-closed", atMs: now(), why: silent ? silence() : `could not connect: ${message(cause)}` };
    return;
  }
  heard();
  if (!response.ok || response.body === null) {
    clearTimeout(deadline);
    // Drain, so the socket is released rather than left half-read.
    await response.text().catch(() => "");
    yield { kind: "stream-closed", atMs: now(), why: `the stream answered ${response.status} ${response.statusText}` };
    return;
  }

  yield { kind: "stream-opened", atMs: now(), why: `subscribed to ${url}` };

  const parser = sseFrames();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        yield { kind: "stream-closed", atMs: now(), why: "the dashboard ended the stream" };
        return;
      }
      // A `ping` counts. It carries no snapshot and is not yielded, and it is
      // the whole evidence that this socket is still a socket.
      heard();
      for (const frame of parser.push(decoder.decode(chunk.value, { stream: true }))) {
        // `ping` is the heartbeat and carries no snapshot. It is not yielded:
        // it proves the socket is alive, which the absence of a `stream-closed`
        // already says, and the thing that matters — whether a NEW COLLECTION
        // arrived — is the freshness watchdog's question, not this one's.
        if (frame.event !== "snapshot") continue;
        yield readPayload(frame.data, "sse", now());
      }
    }
  } catch (cause) {
    if (signal.aborted) return;
    yield { kind: "stream-closed", atMs: now(), why: silent ? silence() : `the stream broke: ${message(cause)}` };
  } finally {
    clearTimeout(deadline);
    // Cancelling releases the socket when the consumer breaks out of the loop
    // — otherwise a `break` in the daemon leaks a connection per restart, and
    // `subscriberCount()` on the dashboard slowly climbs for no reason.
    await reader.cancel().catch(() => undefined);
  }
}

async function pollOnce(url: string, signal: AbortSignal, now: () => number, timeoutMs: number): Promise<SourceMessage> {
  // `AbortSignal.timeout` rather than a hand-rolled controller: it is the one
  // that cannot be forgotten in an early return, and its reason is legible.
  const deadline = AbortSignal.timeout(timeoutMs);
  const both = AbortSignal.any([signal, deadline]);
  const timedOut = (cause: unknown): string =>
    deadline.aborted ? `the dashboard accepted the connection and answered nothing within ${timeoutMs}ms` : `could not connect: ${message(cause)}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: both, headers: { accept: "application/json" } });
  } catch (cause) {
    return { kind: "poll-failed", atMs: now(), why: timedOut(cause) };
  }
  if (!response.ok) {
    await response.text().catch(() => "");
    return { kind: "poll-failed", atMs: now(), why: `the poll answered ${response.status} ${response.statusText}` };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    // The deadline covers the body as well as the headers: a server that sends
    // a 200 and then stops is the same hang one layer down.
    return { kind: "poll-failed", atMs: now(), why: deadline.aborted ? timedOut(cause) : `the body did not arrive: ${message(cause)}` };
  }
  return readPayload(text, "poll", now());
}

/**
 * JSON, or a message saying it was not.
 *
 * NEVER `null` ON A PARSE FAILURE. `parseObservation(null)` refuses it, so
 * nothing downstream would be *wrong* — but the sentence in the log would be
 * "the payload is null, not an object" rather than what actually happened,
 * which was a proxy returning an HTML error page.
 */
function readPayload(text: string, via: Transport, atMs: number): SourceMessage {
  try {
    return { kind: "payload", via, atMs, json: JSON.parse(text) as unknown };
  } catch (cause) {
    return {
      kind: "unreadable",
      via,
      atMs,
      why: `${message(cause)} — the first 120 characters were ${JSON.stringify(text.slice(0, 120))}`,
    };
  }
}

/** Resolves early, and without an unhandled rejection, when the daemon is stopping. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
