/**
 * Server-sent events off a `fetch` body, for whatever in the client is waiting
 * on one.
 *
 * Written for chat and moved here unchanged when explanations started streaming
 * too — see docs/plans/260826l-explain-deeper-answers.md § 2. It knows nothing about
 * threads, comments or articles: it turns bytes into named frames, and the
 * meaning of the names belongs to the caller.
 *
 * The server half is `sse` in src/routes.ts; the OpenRouter half, which parses
 * a different SSE dialect, is `sseChunks` in src/openrouter-stream.ts.
 */
export interface ServerEvent {
  name: string;
  data: unknown;
}

/**
 * How long a stream may say nothing before we stop believing in it.
 *
 * The server beats every `SSE_HEARTBEAT_MS` (15 seconds, in src/routes.ts), so
 * this is four missed beats. **Not three.** At exactly three the third beat and
 * this timer are racing, and a browser that throttles timers in a background
 * tab — which every one of them does — wins that race often enough to kill
 * healthy streams. The extra 15 seconds buys the jitter. Raised from 45s on
 * GPT-5.6's advice, 2026-08-26.
 *
 * It is deliberately a clock on **bytes** rather than on frames: a heartbeat is
 * an SSE comment, `parseFrame` drops it, and a timer in the caller's
 * `for await` loop would therefore never see the one thing that proves the
 * connection is alive.
 *
 * Without the heartbeat this number would have to be longer than the longest
 * legitimate silence on a healthy stream — a 45-second tool run with a
 * `tool` frame at each end — which is to say a dead connection would go
 * unnoticed for a minute and a half. That trade is what the heartbeat buys out.
 */
export const STREAM_STALL_MS = 60_000;

/**
 * The stream stopped delivering bytes and never said why.
 *
 * Its own class rather than a plain `Error`, because the caller has something
 * much better to do about it than show a message: the server does not stop
 * working when a reader's connection dies — see `streamChat` in src/routes.ts —
 * so the answer is usually finishing on disk, and the honest response is to go
 * and look rather than to declare a failure. `src/web/useChat.ts` does exactly
 * that. Callers with nothing to recover to can treat it as any other failure.
 */
export class StreamStalled extends Error {
  /** For `wentQuiet` in src/messages.ts, which words this for a reader. */
  readonly seconds: number;
  constructor(ms: number) {
    super(`the stream sent nothing for ${Math.round(ms / 1000)}s`);
    this.name = "StreamStalled";
    this.seconds = Math.round(ms / 1000);
  }
}

export interface ReadEventsOptions {
  /**
   * Give up if no bytes arrive for this long. Omit for no clock at all, which
   * is what every caller had before 2026-08-26 and is still right for a stream
   * nobody is watching.
   */
  stallMs?: number;
}

/**
 * Server-sent events off a `fetch` body.
 *
 * The mirror of `sseChunks` in src/converse.ts, and it has the same three
 * traps — a frame split across two reads, blank lines between frames, and the
 * fact that a `data:` line is not necessarily JSON. The difference is that
 * frames here are separated by a **blank line** and carry an `event:` name, so
 * the split is on `\n\n` rather than on `\n`.
 *
 * A fourth trap, which is the reason `stallMs` exists: **a stream can stop
 * without ending.** A TCP connection that has gone away without being closed
 * delivers no bytes and no error, and `reader.read()` neither resolves nor
 * rejects — so a `for await` over this generator waits for ever and the caller
 * has no event to hang a failure on. That is not hypothetical; it is
 * docs/plans/260826a-chat-mode.md's "dropped SSE stream leaves the panel on thinking…
 * for ever", found in a browser pass on 2026-08-26.
 */
export async function* readEvents(
  body: ReadableStream<Uint8Array>,
  options: ReadEventsOptions = {},
): AsyncGenerator<ServerEvent> {
  const { stallMs } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /* The clock is armed by the **first byte**, not by the first read, and that
     one line is what keeps a buffering reverse proxy working.
     `X-Accel-Buffering: no` asks an intermediary not to hold the body, and an
     intermediary is free to ignore it — in which case nothing at all arrives,
     heartbeats included, until the answer is complete. A clock that started at
     the request would kill that stream on principle, having been told nothing
     except that the reader's proxy is old. Today such a stream still delivers,
     all at once, and it goes on delivering.
     After the first byte the rule is different and much stronger: a stream that
     has started talking and then stops has broken its own promise, because the
     server beats while it thinks. */
  let started = false;
  try {
    for (;;) {
      const { done, value } =
        stallMs === undefined || !started ? await reader.read() : await readBefore(reader, stallMs);
      if (done) break;
      // A zero-length chunk is not a byte. Vanishingly unlikely on a `fetch`
      // body, and the contract above says "the first byte" — so it says it.
      if ((value?.byteLength ?? 0) > 0) started = true;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line; anything after the last one is a
      // partial frame and waits for the next read.
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        cut = buffer.indexOf("\n\n");
      }
    }
  } finally {
    /* Cancel, then release — and in that order.
     *
     * `releaseLock()` alone was enough while the only way out of the loop was
     * the stream ending. It is not enough for the two ways out this file now
     * has: a stall, and a caller that `break`s. Both leave the body live, which
     * on a `fetch` response means the socket stays open and the browser goes on
     * receiving an answer nobody is reading. Cancelling closes it, which is
     * also how the server learns the reader has gone.
     *
     * Cancelling a stream that has already ended is a no-op that resolves, so
     * the ordinary path pays nothing for this. The `catch` is for a body that
     * is already errored, where `cancel` rejects and there is nothing to do
     * about it.
     *
     * **Not awaited**, which matters and cost an afternoon. `cancel()`'s
     * promise follows the underlying cancellation work — for a `fetch` body
     * that is a socket teardown, and on the stalled connection this exists to
     * escape from, that work is exactly what is not happening. Awaiting it hung
     * the generator's own exit: the stall was detected, the error was raised,
     * and it never left this block, so the caller waited for ever anyway. A
     * recovery that inherits the hang it is recovering from. Flagged in advance
     * by a GPT-5.6 review and then reproduced by
     * tests/use-chat-recovery.test.ts, 2026-08-26.
     *
     * `releaseLock` may error a read still pending from the race in
     * `readBefore`. That promise already has handlers — `Promise.race` attached
     * them — so it cannot surface as an unhandled rejection.
     */
    void reader.cancel().catch(() => {});
    try {
      reader.releaseLock();
    } catch {
      // Already released, or released under a pending read. Either way we are
      // leaving.
    }
  }
}

/**
 * One read, with a clock on it.
 *
 * The losing side of the race is deliberately left pending rather than
 * cancelled here: the generator's `finally` cancels the body a moment later,
 * which settles it. `Promise.race` has already attached handlers to it, so it
 * cannot become an unhandled rejection — which it would if this were written
 * with a bare `setTimeout` and no race.
 */
async function readBefore(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StreamStalled(ms)), ms);
      }),
    ]);
  } finally {
    // Every read that arrives in time clears its own timer, which is what makes
    // the clock measure *silence* rather than total elapsed time.
    clearTimeout(timer);
  }
}

function parseFrame(frame: string): ServerEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  // No `data:` line at all. Either a heartbeat — an SSE comment, `: ping`,
  // whose only job was to be bytes — or a frame we do not understand. Neither
  // is something to hand a caller.
  if (data.length === 0) return null;
  try {
    return { name, data: JSON.parse(data.join("\n")) };
  } catch {
    // A frame we cannot read loses a few words rather than the answer. Same
    // judgement as the server side, and for the same reason.
    return null;
  }
}
