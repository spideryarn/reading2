/**
 * Talking to OpenRouter over a stream, for anything that needs to.
 *
 * Everything here was written for chat and lived in src/converse.ts, and every
 * comment in it is load-bearing: each of the three notes on `sseChunks` records
 * a bug that actually happened, and the abort helpers exist because three
 * different causes all throw the same `AbortError`. It moved out unchanged when
 * `explain` became a stream too — see docs/plans/260826l-explain-deeper-answers.md § 2.
 *
 * **It no longer opens a call.** It grew a second job for a while — the routing
 * preference and the error mapping the three streaming callers had to agree on —
 * and on 2026-08-27 both of those, and the `fetch` itself, moved into
 * [`src/ai-call.ts`](ai-call.ts), which makes a request and its spend record one
 * indivisible operation. What is left here is the byte-level work: parsing SSE
 * and telling three kinds of abort apart. See docs/project/ai-gateway.md.
 *
 * **This module knows nothing about chat, comments, articles or readers.** It
 * parses a byte stream and tells aborts apart. If something here starts needing
 * a thread id or a block id, it belongs back in its caller.
 *
 * The three callers are src/converse.ts (chat), src/explain.ts (explanations
 * and glossary lookups) and src/search.ts (finding passages) — the last of
 * which arrived on 2026-08-26, and this header said "it does not stream at all"
 * until then. All three now reach `sseChunks` through `openRouterStream` rather
 * than calling it directly.
 *
 * They differ in two ways, both deliberate. Chat sets `cache_control` at the
 * top level and explain sets it on a content part — see
 * docs/project/prompt-caching.md, because the shape of the cached prefix is the
 * caller's business and not this file's. And **search reads the stream
 * strictly**: the other two carry prose, where a dropped frame costs a few
 * words, while search carries one JSON object, where a dropped frame can lose a
 * whole result and still leave text that parses. See the note on the parse in
 * `sseChunks`.
 */
import {
  PROVIDER_FAILED_MID_ANSWER,
  PROVIDER_UNREADABLE,
  tookTooLong,
  wentQuiet,
} from "./messages.js";
import type { Citation } from "./types.js";
/* `src/urls.ts` has no imports of its own, and `src/types.ts` only a type from
   `messages.js` — so neither drags a logger, a store or a reader in here. That
   is the constraint this module's header states, and it is checked from outside
   by tests/public-imports.test.ts and tests/client-imports.test.ts. */
import { isWebUrl } from "./urls.js";
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
    return new Error(tookTooLong(Math.round(timeoutMs / 1000)).message);
  }
  if (stalled.aborted) {
    return new Error(wentQuiet(Math.round(stallMs / 1000)).message);
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
 *
 * A fourth thing is a per-caller trade rather than a fact about the wire
 * format, so it is a parameter rather than baked in: **what to do with a
 * `data:` frame that isn't valid JSON.** `options.malformedFrames` decides.
 * See it below.
 */
/**
 * Whether a stream ended properly, shared with the caller through an object
 * because a generator's `return` value is not available to `for await`.
 */
export interface StreamEnd {
  terminated: boolean;
  /**
   * The last non-null `choice.finish_reason` the stream carried, or `null`.
   *
   * **Written here rather than scraped by the caller**, which is what all seven
   * of them used to do with the identical line
   * `if (choice?.finish_reason) finishReason = choice.finish_reason`. The
   * duplication was not the problem; what each of them then *did* with it was —
   * six read a non-null reason as evidence the reply was whole, which is true
   * of `"stop"` and the exact opposite of `"length"`. See `classifyEnd` and
   * docs/postmortems/260901c-the-success-signal-that-outlived-its-witness.md.
   *
   * **Written by `openRouterStream` in src/ai-call.ts, not here.** This file
   * is the SSE parser and `terminated` is a framing fact — `[DONE]` is part of
   * the wire format. A finish reason is payload, and belongs with the shim that
   * already reads every chunk for the meter. GPT Sol drew that line on review.
   *
   * Optional so that the seven existing `{ terminated: false }` literals keep
   * compiling while their files migrate one at a time.
   */
  finishReason?: string | null;
  /**
   * Whether any chunk at all arrived — as opposed to a stream that opened and
   * said nothing. Written by `openRouterStream`, as above. Distinguishes "the provider answered and was cut off" from
   * "the provider never spoke", which every caller currently re-derives from a
   * local `answered` flag.
   */
  answered?: boolean;
}

export interface SseChunksOptions {
  /**
   * What to do with a `data:` frame that is not valid JSON.
   *
   * `"skip"` (the default) is chat (converse.ts) and explain.ts's trade,
   * unchanged: their payload is prose, a dropped frame costs a few words, and
   * ending a working answer over one bad line is the wrong call. **Do not
   * change what the default means** — that is exactly what this being a
   * named string rather than a bare boolean is for. A boolean `strict` was
   * the first version of this parameter, and Sol's review called it out as
   * an API footgun: a 5th positional `true`/`false` reads as noise at the
   * call site, and a slip from `true` to `false` (or the reverse, on a
   * future caller) changes behaviour silently, with nothing at the call
   * site to say what either value means. `malformedFrames: "skip"` /
   * `"throw"` cannot be inverted by a typo without the diff saying so in
   * words.
   *
   * `"throw"` is search.ts's opt-in. Its payload is JSON, not prose, and the
   * same trade is wrong there: a dropped frame can be exactly one element of
   * the `hits` array, and the text either side can still go on to parse as
   * valid JSON — so silently skipping it would let search store a
   * confidently wrong result rather than noticing anything went missing.
   * Found by a GPT Sol review, 2026-08-26.
   */
  malformedFrames?: "skip" | "throw";
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
  options?: SseChunksOptions,
): AsyncGenerator<StreamChunk> {
  const strict = options?.malformedFrames === "throw";
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
        /* Parsing and yielding are two separate steps, deliberately — the
           `try` used to wrap the `yield` too, which means it was also
           catching whatever a *consumer* threw while this generator sat
           suspended at that yield (a `.throw()`, or the consumer's own
           exception propagating back in). Folding "the frame didn't parse"
           and "the caller broke" into the same catch is a different bug from
           the one `strict` is about, and separating them costs nothing. */
        let parsed: StreamChunk;
        try {
          parsed = JSON.parse(payload) as StreamChunk;
        } catch {
          if (strict) throw providerSpokeNonsense();
          // Lenient (the default — chat, explain): a malformed chunk is not
          // worth ending a working answer over — the stream carries many,
          // and one unparseable line loses a few words rather than the
          // reply. Not logged: at one line per token this could be
          // thousands of lines, and the answer's own length is already in
          // the summary line above. See `SseChunksOptions.malformedFrames`
          // on this function for why search.ts cannot make the same trade.
          continue;
        }
        yield parsed;
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

/**
 * Read one delta's `annotations` into the answer's citation list.
 *
 * **It lives here because the wire shape does.** `Annotation` above is
 * OpenRouter's, and every rule below is a rule about *that* shape rather than
 * about chat or about explanations — `type` is the discriminator and not the
 * presence of `url_citation`, the URL is optional on the wire, and the same
 * page cited by five sentences arrives as five annotations. Chat and explain
 * each had their own byte-identical copy until 2026-08-28; a fix to one of them
 * would not have reached the other, and the fix this most needed protecting is
 * the `isWebUrl` one below.
 *
 * `into` is the caller's accumulator rather than a return value because a
 * streamed answer collects across many deltas and the caller drains it once at
 * the end with `[...into.values()]`. Keyed on the URL, which is what makes the
 * dedupe a dedupe.
 *
 * **`onDropped` takes no argument, deliberately.** The one thing it could
 * usefully carry is the URL, and the URL is the one thing its callers must not
 * log: a citation is a page the *model* chose because of what the reader asked,
 * so the URL is a fact about a reader's question and a path can carry the
 * question inside it (docs/project/logging.md § "Host, not URL, when the URL
 * was not the reader's"). A callback that cannot be handed the URL cannot leak
 * it, which is a cheaper guarantee than a sentence asking people not to. The
 * two callers each keep their own `line.warn`, and they are not interchangeable:
 * explain's logger carries a `blockId` child field and chat's does not.
 *
 * This module still has no logger and must not grow one — see the header.
 */
export function collectCitations(
  annotations: Annotation[] | undefined,
  into: Map<string, Citation>,
  onDropped?: () => void,
): void {
  for (const a of annotations ?? []) {
    const c = a.url_citation;
    if (a.type !== "url_citation" || !c?.url || into.has(c.url)) continue;
    // Refused here rather than guarded at the point of render, because this
    // is where model output stops being a string and starts being stored.
    if (!isWebUrl(c.url)) {
      onDropped?.();
      continue;
    }
    into.set(c.url, { url: c.url, ...(c.title ? { title: c.title } : {}) });
  }
}

/**
 * One function call the model is asking for, **as it arrives** — which is to
 * say, in pieces.
 *
 * `index` is the only thing that ties the pieces together and it is the whole
 * reason this shape is awkward. The first delta for a call carries `id` and
 * `function.name` with an empty `arguments`; every delta after it carries a
 * fragment of the JSON argument string and nothing else. So a caller has to
 * keep a slot per `index` and concatenate — parsing any single delta gives you
 * `{"query": "predictive process` and a `SyntaxError`.
 *
 * Verified against a live streamed response on 2026-08-26 rather than taken
 * from documentation, because the deltas after the first genuinely do omit
 * `id`, and code that reads `tc.id` on every delta silently starts a second
 * empty call. `accumulateToolCalls` in src/converse.ts is the one place that
 * does this, and tests/chat-tools.test.ts pins it to the real frames.
 */
export interface ToolCallDelta {
  index: number;
  /** Only on the first delta of a call. */
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface StreamChunk {
  model?: string;
  /**
   * Which upstream answered — OpenRouter puts it on every chunk of a chat
   * completion, and it is not always the one the routing table asked for. A
   * report that shows only the requested provider attributes the money to
   * somebody who never ran the call.
   */
  provider?: string;
  error?: { message: string };
  usage?: Usage;
  choices?: {
    finish_reason?: string;
    delta?: { content?: string; annotations?: Annotation[]; tool_calls?: ToolCallDelta[] };
  }[];
}

/* --------------------------------------------- what is left in this file, and why --
   Two of the three things that used to live down here have gone to
   src/ai-call.ts: `PROVIDER_ORDER`, which is now one row of `AI_JOB_ROUTE`, and
   `providerRefused`, which is now the `ProviderRefused` class — an error that
   carries the status, a classified `kind` and a parsed retry delay rather than a
   sentence a caller has to re-derive the number from.

   **Both were deleted rather than left exported**, which is the point of this
   note. A `PROVIDER_ORDER` still sitting here is a routing preference a seventh
   caller can reach for, bypassing the exhaustive table that exists so nobody has
   to remember which jobs are Anthropic's — and it would work, and would answer,
   and would be wrong only on the bill. Dead code that still compiles is a trap
   with a docstring on it. */

/**
 * A 200 that carries an error in its body or its stream — a provider failing
 * mid-generation. Same rule as above: the provider's own words are dropped.
 */
export function providerFailedMidAnswer(): Error {
  return new Error(PROVIDER_FAILED_MID_ANSWER.message);
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
  return new Error(PROVIDER_UNREADABLE.message);
}
