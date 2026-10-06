/**
 * **Why a model call failed, as a label from a list written down here** — the
 * vocabulary of `ai_calls.failure_phase` and `ai_calls.failure_class`, and the
 * pure functions that pick from it.
 *
 * Two wires fill those columns ([`ai-call.ts`](ai-call.ts) and
 * [`messages-stream.ts`](messages-stream.ts)) and neither owns the words, for
 * the reason [`transport-retry.ts`](transport-retry.ts) gives for the numbers:
 * each wire knows what its own errors look like, and a count that adds the two
 * together needs them to have meant the same thing by `network`.
 *
 * ## Mapped, never sanitised
 *
 * **Every function here returns a literal this file spells out, or a fixed
 * fallback.** Nothing an error carries is ever stored, filtered or not: not its
 * message, not its name, not a cause's `code`, not an abort's reason. A code
 * is looked up in a set and the *set's* string is what comes back; one that is
 * not in the set becomes plain `network`, however harmless it looks. A
 * character filter would let `reader_search_term` through, and an error's
 * `name` and `code` are writable properties that anything can have put there.
 * The request on these wires is an article, a reader's question or their
 * voice, and a ledger column is read by more people than a log is.
 *
 * So adding a label means adding it to a list below, and the type follows.
 * Plan docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md.
 *
 * No imports, on purpose: `src/ai-spend.ts` takes its types from here, and it
 * may not import a gateway (see the top of that file).
 */

/**
 * Whether the failure came before the answer began or after.
 *
 * **The boundary is each seam's own acceptance boundary, not "what the retry
 * covers"**: a `2xx` with a body in hand on the OpenRouter stream,
 * `message_start` on the Messages wire, `2xx` response headers on the four
 * whole-call OpenRouter seams. The two happen to agree nearly everywhere and
 * differ where it matters: 503 headers followed by a body that will not read
 * is `before_answer` and is not asked again today.
 *
 * The column has a CHECK holding it to these two words
 * (`ai_calls_failure_phase_known` in src/db/schema.ts), so a third is a
 * migration as well as an edit here.
 */
export type FailurePhase = "before_answer" | "mid_answer";

/**
 * The network failures told apart. Node's own, then undici's. A dropped
 * connection from `fetch` is a `TypeError("fetch failed")` whose `cause` has
 * one of these as its `code`; the Anthropic SDK wraps that again, so the code
 * can sit two causes down.
 */
export const NETWORK_CODES = [
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
] as const;

/**
 * The `type` of an in-band `error` event on the Messages wire — Anthropic's
 * closed set. Two of them arrive as the same class with no status
 * (`overloaded_error` and `authentication_error` are both a bare `APIError`),
 * so the class alone cannot tell a bad second from a bad key.
 */
export const PROVIDER_EVENT_TYPES = [
  "overloaded_error",
  "api_error",
  "timeout_error",
  "rate_limit_error",
  "authentication_error",
  "permission_error",
  "invalid_request_error",
  "not_found_error",
  "request_too_large",
  "billing_error",
] as const;

/**
 * Every value `ai_calls.failure_class` may hold.
 *
 * - `refused` — a non-2xx response. Which one is in `failure_status`.
 * - `network`, `network:<CODE>` — the connection, with the code when it is one
 *   of `NETWORK_CODES`.
 * - `provider:<type>` — a Messages-wire `error` event of a known type.
 * - `in_band` — an error the provider sent inside a `2xx`: an OpenRouter error
 *   chunk or envelope, or a Messages event whose type is not on the list.
 * - `unfinished` — a stream that ended without saying it had finished.
 * - `unreadable` — a `2xx` whose body could not be read as an answer.
 * - `other` — none of the above. A count of these that grows is a label
 *   missing from this file.
 *
 *
 * And the three an `aborted` row carries, which say who stopped the call
 * (`abortClass` below picks between them):
 *
 * - `stall` — our stall clock: the provider sent nothing for too long.
 * - `deadline` — our deadline: the whole call took too long.
 * - `abort` — anything else, a reader's Stop among them. Recorded rather than
 *   left null on purpose: it says the row was written by code that could tell
 *   the three apart, so an `aborted` row with no class is one that could not.
 */
export type FailureClass =
  | "refused"
  | "network"
  | `network:${(typeof NETWORK_CODES)[number]}`
  | `provider:${(typeof PROVIDER_EVENT_TYPES)[number]}`
  | "in_band"
  | "unfinished"
  | "unreadable"
  | "other"
  | AbortClass;

/** Who stopped a call that was aborted. See `FailureClass` and `abortClass`. */
export type AbortClass = "stall" | "deadline" | "abort";

/**
 * What a failed or aborted attempt's row says about how it ended. On a
 * `SpendRecord` this is `null` for a call that answered.
 *
 * On an `aborted` row the class is one of `AbortClass`, and the phase and the
 * status mean what they mean on an error: how far the call had got.
 */
export interface CallFailure {
  phase: FailurePhase;
  class: FailureClass;
  /**
   * The HTTP status of the response, when there was one — so `200` on a call
   * that died after a `200`, and `null` when no response ever arrived. A
   * number, which is why it needs no list.
   */
  status: number | null;
}

/**
 * **What a stall clock aborts with**: no chunk arrived for as long as the
 * runner was willing to wait. A class rather than a plain `Error`, because a
 * gateway is handed one signal made of the reader's, a deadline and a stall
 * clock, and the reason is all it has to tell them apart by. A plain `Error`
 * is what a reader's Stop looks like.
 *
 * The message is the one the plain `Error` had. Every runner with a stall
 * clock aborts with this; tests/call-failure.test.ts scans `src/` for one
 * that does not.
 */
export class StallReached extends Error {
  constructor() {
    super("stalled");
    this.name = "StallReached";
  }
}

/**
 * **What a per-call deadline aborts with when it is a `setTimeout` and a
 * controller** rather than an `AbortSignal.timeout`, whose own reason
 * `abortClass` already recognises. For one call's clock only: a budget for a
 * whole job (`DeadlineReached` in src/jobs.ts) is not a verdict on any one
 * call, and is recorded as `abort`.
 */
export class CallDeadlineReached extends Error {
  constructor(message = "the call's deadline passed") {
    super(message);
    this.name = "CallDeadlineReached";
  }
}

/**
 * **Who stopped an aborted call**, from the reason its signal carries.
 * `AbortSignal.any` passes on the reason of whichever signal fired first, so
 * this is the first clock or person to stop the call, and nothing later.
 *
 * **First, as long as something was listening.** On Node 26 a composite with
 * no `abort` listener settles its reason when it is first read, from the first
 * aborted source in list order: two sources that both fired before anybody
 * looked give the earlier one in the list, not the earlier one in time. A
 * call in flight always has a listener (`fetch`, `sseChunks`, the SDK,
 * `waitOrStop`), so this is the gap between two of them and no wider.
 *
 * Tested, never stored, and tested by what the reason *is*: a plain
 * `Error("stalled")` and an object that merely has `name: "TimeoutError"` are
 * both `abort`. A deadline is any `AbortSignal.timeout` on the signal,
 * whoever set it; every one in `src/` that reaches a gateway is ours.
 */
export function abortClass(reason: unknown): AbortClass {
  if (reason instanceof StallReached) return "stall";
  if (reason instanceof CallDeadlineReached) return "deadline";
  if (reason instanceof DOMException && reason.name === "TimeoutError") return "deadline";
  return "abort";
}

/**
 * Whether an aborted attempt was stopped by our stall clock or our deadline.
 * Those two get a log line on both wires (`ai call stopped by our clock`); a
 * reader's Stop does not.
 */
export function stoppedByOurClock(failure: CallFailure): boolean {
  return failure.class === "stall" || failure.class === "deadline";
}

/** How far down a `cause` chain to look. The deepest real one is the SDK's, at two. */
const CAUSE_DEPTH = 4;

const NETWORK_CODE_SET: ReadonlySet<string> = new Set(NETWORK_CODES);
const PROVIDER_EVENT_SET: ReadonlySet<string> = new Set(PROVIDER_EVENT_TYPES);

/** `err` and up to `CAUSE_DEPTH` of its causes, outermost first. Bounded, so a chain that loops ends. */
function chain(err: unknown): object[] {
  const links: object[] = [];
  let at: unknown = err;
  for (let depth = 0; depth <= CAUSE_DEPTH; depth++) {
    if (typeof at !== "object" || at === null) break;
    links.push(at);
    at = (at as { cause?: unknown }).cause;
  }
  return links;
}

/** The first allowlisted network code on `err` or its causes, as the list spells it. */
function networkCodeOf(links: readonly object[]): (typeof NETWORK_CODES)[number] | null {
  for (const link of links) {
    const code = (link as { code?: unknown }).code;
    if (typeof code !== "string" || !NETWORK_CODE_SET.has(code)) continue;
    /* The list's own string, found by value: what is returned was typed in
       this file, not read off the error. */
    const known = NETWORK_CODES.find((c) => c === code);
    if (known) return known;
  }
  return null;
}

/**
 * The label for a failure **the caller already knows was the network** — an
 * error `fetch` itself rejected with, or the SDK's connection error.
 * `network:<CODE>` when a known code is on it or its causes, `network`
 * otherwise.
 */
export function networkClass(err: unknown): FailureClass {
  const code = networkCodeOf(chain(err));
  return code ? `network:${code}` : "network";
}

/**
 * The label for something thrown **where the caller cannot say what it was** —
 * a body that broke while it was being read. A known code, or a `TypeError`
 * anywhere in the chain (what undici throws for a body that was cut off, and
 * what the SDK wraps), is the network; anything else is `other`.
 */
export function thrownClass(err: unknown): FailureClass {
  const links = chain(err);
  const code = networkCodeOf(links);
  if (code) return `network:${code}`;
  return links.some((link) => link instanceof TypeError) ? "network" : "other";
}

/** The label for a Messages-wire `error` event, from its `type`. */
export function providerEventClass(type: unknown): FailureClass {
  if (typeof type !== "string" || !PROVIDER_EVENT_SET.has(type)) return "in_band";
  const known = PROVIDER_EVENT_TYPES.find((t) => t === type);
  return known ? `provider:${known}` : "in_band";
}

/**
 * **Is this parsed `2xx` body an error rather than an answer?** — a top-level
 * `error` that says something, and neither `choices` nor `data`. OpenRouter
 * sends that shape when an upstream fails after the gateway has already
 * answered `200`.
 *
 * `choices` and `data` are the guard against calling a real answer a failure:
 * they are where a chat answer and an embeddings or images answer keep their
 * content, and a body with one of them and an `error` is whatever its caller
 * decides it is. Nothing of the `error` is read beyond whether it is there.
 */
export function isErrorEnvelope(json: unknown): boolean {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return false;
  const body = json as { error?: unknown; choices?: unknown; data?: unknown };
  if (body.error === undefined || body.error === null) return false;
  return body.choices === undefined && body.data === undefined;
}
