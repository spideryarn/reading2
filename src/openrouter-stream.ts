/**
 * Talking to OpenRouter over a stream, for anything that needs to.
 *
 * Everything here was written for chat and lived in src/converse.ts, and every
 * comment in it is load-bearing: each of the three notes on `sseChunks` records
 * a bug that actually happened, and the abort helpers exist because three
 * different causes all throw the same `AbortError`. It moved out unchanged when
 * `explain` became a stream too — see docs/plans/explain-deeper-answers.md § 2.
 *
 * It has since grown a second job, at the bottom of the file: the parts of an
 * OpenRouter call that **three** callers must not answer differently — where to
 * route, and what may be repeated from a failure. `search.ts` is the third, and
 * it does not stream at all, which is why those live here rather than inside the
 * streaming machinery.
 *
 * **This module knows nothing about chat, comments, articles or readers.** It
 * parses a byte stream and tells aborts apart. If something here starts needing
 * a thread id or a block id, it belongs back in its caller.
 *
 * The two callers are src/converse.ts (chat) and src/explain.ts (explanations),
 * and they differ in one way that is deliberate rather than accidental: chat
 * sets `cache_control` at the top level and explain sets it on a content part.
 * See docs/project/prompt-caching.md — the shape of the cached prefix is the
 * caller's business, not this file's.
 */
/**
 * Was that abort the *reader*, rather than one of our own clocks?
 *
 * All three signals throw the same `AbortError`, so the only way to tell them
 * apart is to ask which one fired — and the order matters: a deadline that
 * fires while a stop is in flight is still a deadline, and calling it a stop
 * would tell the reader they ended an answer the model had already given up on.
 *
 * Two callers, and that is the whole reason it is a function. A stop can land
 * in the initial `fetch` — before a single byte of the response exists — or
 * inside the chunk loop, and the first of those was missed when this was
 * written inline: an immediate stop was thrown as `AbortError: stopped by the
 * reader` and stored as a failed answer. Found by pressing the button quickly.
 */
export function readerAborted(
  signal: AbortSignal | undefined,
  deadline: AbortSignal,
  stalled: AbortSignal,
): boolean {
  return Boolean(signal?.aborted) && !deadline.aborted && !stalled.aborted;
}

export function stoppedByReader(
  err: unknown,
  signal: AbortSignal | undefined,
  deadline: AbortSignal,
  stalled: AbortSignal,
): boolean {
  if (!readerAborted(signal, deadline, stalled)) return false;
  /* And the throw has to actually BE the abort.

     Not every failure that happens while the signal is aborted was caused by
     it. `OpenRouter: <provider message>` is thrown by our own code a few lines
     up when a 200 carries an error in the stream, and a provider failing at the
     same moment the reader presses stop is not far-fetched — a stall on the
     provider's side is exactly what makes somebody press it. Asking only "is
     the signal aborted" threw that message away and committed the half answer
     as a clean stop, so the one event that could explain what went wrong was
     the one thing not recorded. Aborting rejects with the signal's own reason,
     so identity is the test; the name check covers a caller who aborts without
     giving one. */
  return err === signal?.reason || (err as Error | undefined)?.name === "AbortError";
}

/**
 * An abort turned into a sentence a reader can act on.
 *
 * A cut-off fetch throws `AbortError: This operation was aborted`, which tells
 * the reader nothing and — stored on the message — reads like a bug rather than
 * a slow model. The three causes want three different sentences, and only the
 * signals can tell them apart.
 */
export function explainAbort(
  err: unknown,
  deadline: AbortSignal,
  stalled: AbortSignal,
  timeoutMs: number,
  stallMs: number,
): unknown {
  if (deadline.aborted) {
    return new Error(`The model did not finish within ${Math.round(timeoutMs / 1000)}s. Try again.`);
  }
  if (stalled.aborted) {
    return new Error(
      `The answer stopped arriving after ${Math.round(stallMs / 1000)}s of silence. Try again.`,
    );
  }
  return err;
}

/**
 * Server-sent events, parsed into the JSON objects OpenRouter puts in them.
 *
 * Three things here are not obvious, and each one produced a real bug somewhere
 * before it was written down:
 *
 *  - **A chunk of bytes is not a line.** A `data:` line can be split across two
 *    reads, so the tail of each read is held over. Parsing per-read works
 *    perfectly until the day a long answer is fast enough to fill the buffer
 *    mid-object.
 *  - **`: OPENROUTER PROCESSING` is a comment, not data.** OpenRouter sends
 *    these as keep-alives. They are not JSON and must be skipped rather than
 *    parsed — and note they also count as activity for the stall timer, which
 *    is correct: the connection is alive.
 *  - **`data: [DONE]` is not JSON either.** It is the terminator.
 */
/**
 * Whether a stream ended properly, shared with the caller through an object
 * because a generator's `return` value is not available to `for await`.
 */
export interface StreamEnd {
  terminated: boolean;
}

export async function* sseChunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  /**
   * Called on **every read**, parsed or not.
   *
   * This is what makes the stall timer measure silence rather than
   * uninterestingness. `touch()` used to be called by the consumer, once per
   * yielded chunk — so OpenRouter's `: OPENROUTER PROCESSING` keep-alives,
   * which are discarded in here before anything is yielded, did not count as
   * activity. A connection dutifully sending keep-alives through a long web
   * search was aborted as stalled at 45 seconds, and the header comment claimed
   * the opposite. Found by a GPT-5.6 review, 2026-08-26.
   */
  onActivity: () => void,
  /** Set to `terminated: true` only when `data: [DONE]` actually arrives. */
  end: StreamEnd,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /* Belt and braces, and worth being honest about which is which.
     Undici *does* error the body stream when the fetch's signal aborts — a
     pending `reader.read()` rejects with the abort reason, which is what
     actually ends this loop — so this listener is not the mechanism, it is the
     backstop for a caller who stops iterating without an abort, and for any
     fetch implementation that does not propagate. The comment here used to
     claim the opposite (that the response having arrived meant the signal no
     longer reached it), which was the sentence someone would have trusted the
     next time this plumbing was touched. Corrected in review, 2026-08-26. */
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      buffer += decoder.decode(value, { stream: true });
      // Everything up to the last newline is complete; the remainder is a
      // partial line and waits for the next read.
      const cut = buffer.lastIndexOf("\n");
      if (cut === -1) continue;
      const lines = buffer.slice(0, cut).split("\n");
      buffer = buffer.slice(cut + 1);
      for (const raw of lines) {
        const line = raw.trim();
        if (line === "" || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          // The terminator, and the only clean end there is. Recording it is
          // what lets the caller tell a finished answer from a connection that
          // merely stopped — see the check after the loop in `converse`.
          end.terminated = true;
          return;
        }
        try {
          yield JSON.parse(payload) as StreamChunk;
        } catch {
          // A malformed chunk is not worth ending a working answer over — the
          // stream carries many, and one unparseable line loses a few words
          // rather than the reply. It is not logged: at one line per token this
          // could be thousands of lines, and the answer's own length is already
          // in the summary line above.
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    /* Cancel, then release. A consumer that stops early — `break`, `return`, or
       a throw from inside the `for await` — runs this `finally` with the
       response body still open and unread, and releasing the lock alone leaves
       the connection alive until the socket eventually times out. `cancel()`
       on an already-finished stream is a no-op, so this is safe on the normal
       path too. Latent rather than live today, because the one caller drains to
       the end deliberately; noted by a GPT-5.6 review, 2026-08-26, and fixed
       because the next caller will not know that. */
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * How many web searches the model ran, or `null` if this chunk did not say.
 *
 * Both spellings, exactly as explain.ts reads both — OpenRouter's docs say
 * `server_tool_use` and OpenRouter's responses have been observed to say
 * `server_tool_use_details`. `null` rather than `0` for "not stated" so a chunk
 * without usage cannot reset a count a previous chunk gave us.
 */
export function searchCount(usage: Usage | undefined): number | null {
  return whereSearchCountCameFrom(usage).searches;
}

/**
 * Where a search count came from — and it is worth knowing which.
 *
 * `neither` is the interesting one: `usage` arrived and neither field was in
 * it. That is what a third rename by OpenRouter would look like, and from the
 * outside it is indistinguishable from a model that chose not to search.
 * `no-usage` is a different fault again — the response carried no accounting at
 * all, so the token counts logged beside it are missing too.
 *
 * src/explain.ts logs this field on every call for exactly that reason: `0` on
 * its own is a number a reader believes and an operator cannot check. If it
 * ever reads `neither` on every call, the count has quietly become a permanent
 * zero and nothing else will say so.
 *
 * `typeof ... === "number"` rather than `??` so a genuine `0` counts as
 * *found*. Telling "the model searched zero times" apart from "we could not
 * find the field" is the whole job.
 */
export function whereSearchCountCameFrom(usage: Usage | undefined): {
  searches: number | null;
  from: SearchUsagePath;
} {
  const observed = usage?.server_tool_use_details?.web_search_requests;
  if (typeof observed === "number") return { searches: observed, from: "server_tool_use_details" };
  const documented = usage?.server_tool_use?.web_search_requests;
  if (typeof documented === "number") return { searches: documented, from: "server_tool_use" };
  return { searches: null, from: usage ? "neither" : "no-usage" };
}

export type SearchUsagePath =
  | "server_tool_use_details"
  | "server_tool_use"
  | "neither"
  | "no-usage";

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  server_tool_use_details?: { web_search_requests?: number };
  server_tool_use?: { web_search_requests?: number };
  /* What the cache did. On a streamed response these arrive in the same final
     usage chunk as the token counts — the one with an empty `choices` array —
     so nothing extra has to be subscribed to.

     **Two spellings of the write count, for the same reason the search count
     has two.** A live streamed call on 2026-08-26 put it at
     `prompt_tokens_details.cache_write_tokens`; the non-streamed path this
     replaced read a top-level `cache_write_tokens` and got a real number from
     it. Which of those is OpenRouter's current answer is not worth betting a
     silent zero on, so `cacheWriteTokens` in src/explain.ts reads both. A wrong
     one here reads as "nothing was cached", which is precisely the shape of the
     bug prompt caching was introduced to fix. */
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  cache_write_tokens?: number;
}

interface Annotation {
  type: string;
  url_citation?: { url?: string; title?: string };
}

export interface StreamChunk {
  model?: string;
  error?: { message: string };
  usage?: Usage;
  choices?: {
    finish_reason?: string;
    delta?: { content?: string; annotations?: Annotation[] };
  }[];
}

/* ------------------------------------------ what the three callers must agree --
   converse.ts, explain.ts and search.ts each open an OpenRouter call, and there
   are two things they must not answer differently. Both used to be written out
   in all three files, comments included, with nothing checking they matched. */

/**
 * Where to send the call, and why it is a preference rather than a rule.
 *
 * Ordered, **not** `allow_fallbacks: false`. A cache lives on the upstream that
 * wrote it, so naming Anthropic first is what keeps repeat calls landing where
 * the article already is — and OpenRouter's own sticky routing hashes the first
 * user message, which varies here, so the heuristic would miss exactly the case
 * this is for.
 *
 * But forbidding fallback outright would turn an Anthropic outage into a hard
 * failure on a call a reader is sitting and waiting for. A cache miss costs
 * money; an unavailable feature costs the reader the feature. Preference, not a
 * ban.
 */
export const PROVIDER_ORDER = { order: ["anthropic"] } as const;

/**
 * The provider refused, and **what it said about why is not ours to repeat.**
 *
 * OpenRouter's error body is the one place an upstream might echo part of what
 * we sent back at us, and what we sent is the whole article plus the reader's
 * question or selection. All three callers used to put up to 400 characters of
 * it into `Error.message`, which routes.ts hands to Pino and also returns to the
 * client — so article prose could reach a log, which
 * docs/project/logging.md forbids outright.
 *
 * The body is discarded **here, at the boundary**, rather than carried on a
 * field marked do-not-log: sensitive data parked on an object is sensitive data
 * waiting for the next serialiser to find it.
 *
 * Be honest about the cost: something *was* lost. The provider's own reason used
 * to reach the stored error and the reader's screen, and occasionally a log, and
 * it is sometimes the fastest explanation of a failure. It was not safe to keep
 * and it is not coming back in that form — but "nothing diagnostic was lost" (as
 * an earlier draft of this comment claimed) is not true. What every caller still
 * logs on its own line before throwing is the status, the model and the elapsed
 * time, which is what separates a bad key from a slow model. If more is ever
 * needed, the safe shape is structured and allowlisted — a request id header, or
 * a provider error *code* — never the prose.
 *
 * The status stays **in the sentence** on purpose. It is what a later decision
 * about telling the reader "busy, try again" apart from "this is broken" would
 * have to key on, and putting it there now means that change is a wording
 * change rather than a plumbing one. See docs/plans/simplification-audit.md § A.5
 * — the wording here is interim and Greg's to settle.
 */
export function providerRefused(status: number): Error {
  return new Error(`The model provider refused this request (HTTP ${status}). Try again.`);
}

/**
 * A 200 that carries an error in its body or its stream — a provider failing
 * mid-generation. Same rule as above: the provider's own words are dropped.
 */
export function providerFailedMidAnswer(): Error {
  return new Error("The model provider reported an error while answering. Try again.");
}

/**
 * The provider answered with something that is not JSON.
 *
 * Its own reason is dropped for a reason that is easy to miss: V8 puts the
 * first characters of the offending input **into the `SyntaxError` message** —
 * `Unexpected token 'S', "SECRET art"... is not valid JSON`. So rethrowing the
 * parse error, or handing it to `errorFields`, publishes a prefix of whatever
 * the provider sent, which on a mangled response can be a prefix of what we
 * sent it. Same rule as `providerRefused`, arriving by a route nobody would
 * think to check.
 */
export function providerSpokeNonsense(): Error {
  return new Error("The model provider returned an unreadable response. Try again.");
}
