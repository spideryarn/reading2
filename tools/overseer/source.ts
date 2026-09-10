/**
 * Where the Overseer's evidence comes from: the fleet dashboard's stream, with
 * its own `/api/state` behind it as the fallback.
 *
 * **There is one collector on this box and it is not ours.** A collection costs
 * ~12s of grepping thirty-five transcripts, and this box has hit load 391 with
 * the OOM killer firing, so a second collector is a real cost rather than
 * untidiness — docs/project/overseer-direction.md § Two tenses. This module
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
  /** Most bytes one poll response body may be. */
  maxPollBytes?: number;
  /** Most characters one INCOMPLETE SSE frame may reach before the stream is called broken. */
  maxFrameChars?: number;
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

/**
 * 4 MB, and the number matters less than the fact that there is one.
 *
 * `/api/state` is a serialised `FleetSnapshot` — thirty-five rows with pane
 * titles and statuses, tens of kilobytes — so this is two orders of magnitude
 * of headroom rather than a limit anybody will meet. It exists for the case
 * where the thing answering is not the dashboard: a proxy streaming an error
 * page for ever, or a route that started printing and did not stop. `fetch`'s
 * own `text()` has no bound at all, and this daemon is meant to run for weeks.
 */
export const MAX_POLL_BYTES = 4 * 1024 * 1024;

/**
 * 4 M characters of a frame that has not been terminated.
 *
 * **Characters, not bytes, and deliberately named that way.** The parser holds
 * decoded text, so this is what it can actually count; a character is at least
 * one byte, so bounding characters bounds the memory too — as UTF-16 code
 * units, which is what V8 actually holds. It does NOT bound the UTF-8 wire
 * bytes to twice this: a BMP character can be three UTF-8 bytes, so the wire
 * figure is up to 3x. That is fine, because the thing being protected is this
 * process's heap and not the network. Counting bytes here would mean
 * re-encoding every chunk to bound a buffer, which costs more than the thing
 * it protects.
 *
 * The bound is on the INCOMPLETE TAIL, not on throughput: a stream may pass
 * gigabytes through this parser as long as its frames end.
 */
export const MAX_FRAME_CHARS = 4 * 1024 * 1024;

/** The sentence for each bound, exported so a test holds the same one the log does. */
export function pollBodyTooBig(maxBytes: number): string {
  return `the poll body passed ${maxBytes} bytes without ending, so it was refused rather than buffered`;
}

export function frameTooBig(maxChars: number): string {
  return (
    `an incomplete SSE frame reached ${maxChars} characters with no blank line to close it — ` +
    `whatever is on the other end is not framing events, so the stream is being dropped rather than buffered`
  );
}

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
 * beginning `:` is a comment. CR, LF and CRLF are all line endings; normalising
 * them before parsing keeps transport spelling out of field values.
 *
 * **And the tail is bounded.** "Keep it until a blank line closes the frame" is
 * an unbounded buffer written as a sentence: a producer that never sends the
 * blank line grows it for ever. `push` THROWS on overflow rather than
 * returning a flag, because there is exactly one caller and its `catch`
 * already means *this stream is broken, close it and fall back* — which is the
 * correct handling, and a flag would be a second way to say it that somebody
 * could forget to read.
 */
export function sseFrames(maxChars: number = MAX_FRAME_CHARS): { push(chunk: string): SseFrame[] } {
  let buffer = "";
  /** A CR is normalised immediately; if the next chunk starts with its optional
   * LF, suppress that LF so a split CRLF remains one line ending. */
  let dropLeadingLf = false;
  return {
    push(chunk: string): SseFrame[] {
      /* **LINE ENDINGS ARE NORMALISED ON THE WAY IN, and that is what makes
         everything below able to think only in `\n`.**
         The spec allows CR, LF or CRLF to end a line, and this parser used to
         know two of them: it looked for `\n\n` or `\r\n\r\n` and split fields
         on `\n` alone. A producer — or the proxy that rewrote its line endings,
         which is the reason CRLF was tolerated at all — using bare CR would
         have had every frame held as incomplete until the bound refused a
         perfectly healthy stream. Found by GPT Sol reviewing plan 260910c,
         2026-09-10.

         Normalising is safe because an event stream's payload cannot contain a
         raw CR or LF: they ARE the line endings, so there is nothing here to
         corrupt. A CR is already a complete line ending; only a following LF's
         meaning is unresolved. Normalise the CR now so a bare-CR terminator can
         close a frame immediately, and remember to suppress an LF at the start
         of the next chunk. */
      if (dropLeadingLf && chunk !== "") {
        if (chunk.startsWith("\n")) chunk = chunk.slice(1);
        dropLeadingLf = false;
      }
      if (chunk.endsWith("\r")) dropLeadingLf = true;
      buffer += chunk.replace(/\r\n?/g, "\n");
      /**
       * **THE BOUND IS CHECKED AFTER THE COMPLETE FRAMES ARE TAKEN OUT, and an
       * earlier draft checked it before.** That draft threw on a single chunk
       * carrying four small, complete, perfectly valid frames, because their
       * combined length passed the limit — which is the opposite of the
       * contract this function documents, and would have killed a healthy
       * stream the first time two snapshots arrived in one TCP segment. GPT
       * Sol found it by handing the parser 136 characters of four good frames
       * under a 64-character limit, 2026-09-08. **A test that pushed each
       * frame separately could never have seen it.**
       *
       * So the rule is per-frame and per-tail, never per-chunk: an individual
       * frame whose terminator lies beyond the bound is refused below, and
       * what is left over when every complete frame has been taken is checked
       * at the end.
       */
      const frames: SseFrame[] = [];
      for (;;) {
        // One terminator, because every line ending is a `\n` by the time it
        // reaches here.
        const at = buffer.indexOf("\n\n");
        if (at === -1) break;
        // One frame, on its own, longer than we are prepared to hold.
        if (at > maxChars) {
          buffer = "";
          throw new Error(frameTooBig(maxChars));
        }
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const frame = parseFrame(raw);
        if (frame !== null) frames.push(frame);
      }
      /* What is left is an INCOMPLETE frame, and this is the only thing the
         bound is about: a producer that never sends the blank line.

         **Minus whatever of the terminator has already arrived**, because
         otherwise the SAME BYTES pass or fail according to how TCP split them:
         a frame whose body is exactly `maxChars` is fine when its `\n\n`
         lands in the same chunk, and an overflow when the first `\n` arrives
         and the second has not. GPT Sol probed it at an eight-character limit,
         2026-09-08. Packetization is not something a producer controls, so it
         must not decide whether a stream is called broken.

         Normalisation shrank this from three pending characters to one.
         `data: xx\r\n\r` under an eight-character bound is still accepted, and
         `data: xxxxx\r\n\r` is still refused. */
      if (buffer.length - partialDelimiter(buffer) > maxChars) {
        buffer = "";
        throw new Error(frameTooBig(maxChars));
      }
      return frames;
    },
  };
}

/**
 * How many trailing characters could be the start of a terminator we have not
 * finished receiving — **one**, now that every line ending is a `\n` by the
 * time it reaches the buffer. It used to be up to three, from `\r\n\r`.
 *
 * A tail ending in `\n` might equally be the end of a `data:` line, and
 * discounting one character there costs nothing: the bound is four million.
 */
function partialDelimiter(buffer: string): number {
  return buffer.endsWith("\n") ? 1 : 0;
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  // Only `\n`: `sseFrames` normalised CR and CRLF away before this saw them.
  for (const clean of raw.split("\n")) {
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
  const maxPollBytes = options.maxPollBytes ?? MAX_POLL_BYTES;
  const maxFrameChars = options.maxFrameChars ?? MAX_FRAME_CHARS;
  const base = options.baseUrl.replace(/\/+$/, "");
  const { signal } = options;

  while (!signal.aborted) {
    yield* readStream(`${base}/api/live`, signal, now, streamSilenceMs, maxFrameChars);
    if (signal.aborted) return;

    // THE FALLBACK, and it runs for a bounded time rather than for ever: the
    // stream is the transport we want back, and a source that only retried it
    // on a poll failure would stay on the fallback all week after one blip.
    const until = now() + streamRetryAfterMs;
    while (!signal.aborted && now() < until) {
      yield await pollOnce(`${base}/api/state`, signal, now, pollTimeoutMs, maxPollBytes);
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
  maxFrameChars: number,
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
    /**
     * **CANCEL, DO NOT DRAIN — and this line used to say `await
     * response.text()`.**
     *
     * The silence deadline is cleared one line above, and the fetch signal has
     * nothing left to fire, so awaiting a body that never ends parked this
     * generator for ever: no message, no error, and — because the daemon's
     * tick loop goes on writing a heartbeat — a checkpoint saying the Overseer
     * is alive while it was never going to hear anything again. That is the
     * exact failure overseer-direction.md § Two tenses says must not happen,
     * one layer down from the one it describes: *a dead dashboard is a fact
     * the Overseer records, not a silence it sits in.*
     *
     * The status line is the whole answer; there is nothing in the body we
     * were going to read. Request cancellation without waiting on whoever is
     * holding it open.
     */
    discardBody(response);
    yield { kind: "stream-closed", atMs: now(), why: `the stream answered ${response.status} ${response.statusText}` };
    return;
  }

  yield { kind: "stream-opened", atMs: now(), why: `subscribed to ${url}` };

  const parser = sseFrames(maxFrameChars);
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
    /* Request cancellation on every way out of this function — the consumer
       breaking out of the loop, the parser refusing a frame, an abort, an error
       — because otherwise each one leaks a connection and `subscriberCount()`
       on the dashboard climbs for no reason.

       **NOT AWAITED, and it was until 2026-09-10.** Same rule as `discardBody`
       and `readBounded` below, and this is the place it matters most: a cancel
       promise is allowed to reflect an underlying source that shuts down
       asynchronously, so nothing bounds it structurally. Awaiting one here
       parks the whole generator *after* it has yielded `stream-closed` — so the
       daemon's log says the transport failed, the poll fallback is three lines
       further down, and it is never reached. Every failure would be correctly
       reported and permanently unrecovered, which is a worse shape than either
       half alone.

       The real-server fixture did not produce that: the current undici path
       cancelled and resolved promptly, which is why an earlier draft of this
       comment cited that measurement as proof there was nothing to fix. There
       was — the probe could not reach it. GPT Sol's review named the case, and
       `tests/overseer-source.test.ts` § "a body that refuses to be cancelled"
       arranges it with a `ReadableStream` whose `cancel()` never settles. It
       hangs for thirty seconds against the awaited version.

       What is given up is the guarantee that the socket is gone by the time the
       consumer's `break` returns. That was never worth a hostage: the release
       still starts immediately, and the same test's neighbour watches the
       dashboard's subscriber count fall to zero straight after. The `catch`
       covers a body that has already errored, where cancelling rejects. */
    void reader.cancel().catch(() => undefined);
  }
}

async function pollOnce(
  url: string,
  signal: AbortSignal,
  now: () => number,
  timeoutMs: number,
  maxBytes: number,
): Promise<SourceMessage> {
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
    // Cancel rather than drain, for `readStream`'s reason. Here the deadline
    // was still live so this was bounded rather than infinite — but it burned
    // the whole poll timeout waiting for a body whose contents we never look
    // at, which on the fallback transport is the difference between one late
    // observation and none.
    discardBody(response);
    return { kind: "poll-failed", atMs: now(), why: `the poll answered ${response.status} ${response.statusText}` };
  }
  let text: string;
  try {
    text = await readBounded(response, maxBytes);
  } catch (cause) {
    // The deadline covers the body as well as the headers: a server that sends
    // a 200 and then stops is the same hang one layer down. The size bound
    // covers the other half — a server that never stops sending.
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

/**
 * Let go of a body we are never going to read, **without awaiting anything.**
 *
 * Not `await body.cancel()`: the whole class of bug this closes is *we waited
 * on a peer that had stopped answering*, and re-entering it one level down to
 * be tidy would be the joke version of the fix. `cancel()` requests release of
 * the underlying resource; whether that has finished by the time we yield the
 * message is nobody's business. The `catch` is there because cancelling a
 * stream that is already errored rejects, and an unhandled rejection here
 * takes the daemon down.
 */
function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/**
 * The whole body as text, or a refusal — never an unbounded `text()`.
 *
 * Bytes off the wire rather than characters of the result, because that is
 * what the memory bound is actually about, and because a multi-byte character
 * split across a chunk boundary must not be counted twice. `TextDecoder` in
 * streaming mode holds the split character for us.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error(pollBodyTooBig(maxBytes));
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    // Releases the socket on the refusal path, and is a no-op once the body
    // has ended. Not awaited, for `discardBody`'s reason.
    void reader.cancel().catch(() => undefined);
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
