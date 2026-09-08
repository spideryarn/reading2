/**
 * **`POST /api/transcribe` — the one route on this server that takes audio.**
 *
 * The model call is [`transcribe.ts`](./transcribe.ts) and the words it is
 * primed with are [`vocabulary.ts`](./vocabulary.ts); this file is the HTTP,
 * and deliberately only the HTTP, for the same reason `server.ts` says about
 * steering: a route that acquires opinions the tested module does not have
 * gives you two places to read and they diverge.
 *
 * ## It is a write route, so it takes the Origin check
 *
 * Not because it changes anything — it does not — but because it *spends money*
 * and *opens a socket to a third party* on behalf of whoever asked, and both of
 * those are things a page on another origin must not be able to make this box do
 * with a browser as its confused deputy. `checkOrigin` in
 * [`routes-steer.ts`](./routes-steer.ts) is the one copy; see
 * [`origin.ts`](./origin.ts) for why hostname matters as well as agreement.
 *
 * ## Three failures that must be told apart
 *
 * On a phone, *the microphone gave us nothing*, *the upload failed* and *the
 * model refused* are indistinguishable — all three are "the button does
 * nothing". So each has its own sentence with its own bracketed code, and the
 * ones that cannot succeed on a retry come back with a status that says so.
 * This tool spent 2026-09-08 fixing four features that were silently dead; a
 * dictation button that fails quietly would be the fifth.
 *
 * ## What is never logged
 *
 * The audio, the transcript, and the size of either. A failure logs its reason.
 * That is the whole of it — docs/project/logging.md's rule is the destination
 * rather than the function name, and this server's destination is `console.log`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type AudioFormat,
  MAX_AUDIO_BASE64,
  isAudioFormat,
  tooLongMessage,
} from "../../src/dictation-limits.js";
import { type BodyStream, checkOrigin, createRateLimiter, readBody } from "./routes-steer.js";
import { type FleetTranscription, transcribeForFleet } from "./transcribe.js";
import { type FleetVocabularySession, fleetVocabulary } from "./vocabulary.js";
import type { TranscribeRequest, TranscribeResponse } from "./wire.js";

export const PATH = "/api/transcribe";

/**
 * **One sentence for every way a request can arrive unreadable**, because they
 * are one branch as far as anybody acting on it is concerned: the browser sent
 * something this server cannot parse, and the same browser will send the same
 * thing again. Not retryable, and the client offers no Retry on a 400.
 *
 * One code, one sentence. Three call sites wrote three sentences under this code
 * in the first draft, which is exactly the failure
 * `tests/dictation-codes.test.ts` was written for after a bug report quoted four
 * characters that named two different problems.
 *
 * **And the code is `[mic-bad-request]`, not `[mic-format]`, since that test
 * widened to scan `tools/` as well as `src/`.** `[mic-format]` already names a
 * real and different branch — the browser encoded a container we cannot
 * transcribe, decided in the browser, before anything is sent. This one is the
 * server unable to read the request at all, which given our own client is a bug
 * on our side rather than a fact about somebody's audio. Same fix (none), two
 * causes, so two codes.
 */
const UNREADABLE_REQUEST = "That recording could not be sent from this browser. [mic-bad-request]";

/**
 * The body limit, which is the audio cap plus room for the JSON around it.
 *
 * `MAX_AUDIO_BASE64` is the shared number both ends check the *audio* against
 * (`src/dictation-limits.ts`); this is the *request*, so it needs the field
 * names, the context object and the quoting. 64 KB of slack, which is two
 * orders of magnitude more than the wrapper actually costs and still refuses a
 * body that is trying to be something else.
 *
 * **The browser checks the same cap before a megabyte goes over the wire.** This
 * is not a duplicate of that check, it is the one that holds when the browser is
 * not ours.
 */
export const MAX_TRANSCRIBE_BODY = MAX_AUDIO_BASE64 + 64 * 1024;

/**
 * **Admission control, because this is the route that spends money.**
 *
 * Every other route here costs the box some tmux commands. This one opens a
 * socket to a third party and is billed for it, and the page has no
 * authentication at all — reachability over the tailnet is the whole boundary,
 * so anything that gets inside it can spend without limit. That is a different
 * exposure from the steering route, which can type into a live agent but cannot
 * run up an invoice. GPT Sol's review of the built code, finding 2.
 *
 * Numbers chosen from what a person can actually do: a dictation takes seconds
 * to speak and ~2 to transcribe, so **one every 3 seconds** is well clear of
 * anybody talking and nowhere near a loop. The burst ceiling of **10 in 60
 * seconds** is the one that matters — it bounds the bill rather than the pace.
 *
 * Keyed by the context, so the New session box and each session's composer have
 * their own floor. Two boxes on screen are two people's worth of dictating in
 * the worst case, and one of them should not lock the other out.
 *
 * `check` reads and `record` spends, and they are separate for the reason
 * routes-steer.ts gives at length: a slot recorded at the moment of asking means
 * ten malformed requests spend the whole allowance without a single paid call
 * having been made.
 */
const limiter = createRateLimiter({ minIntervalMs: 3_000, burstMax: 10, burstWindowMs: 60_000 });

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * The request as this server may act on it — **derived from the wire type, not
 * a second declaration of it.**
 *
 * `TranscribeRequest.format` is a `string`, because `wire.ts` may not import and
 * `AudioFormat` lives in `src/dictation-limits.ts`. That is the right shape for
 * the wire and the wrong one for the code below, which hands the value to
 * OpenRouter — so the `Omit` re-types exactly that field and nothing else. A new
 * field on the wire type is not in the `Omit`, so it arrives here and the parse
 * stops compiling until somebody decides what to do about it.
 */
type ParsedRequest = Omit<TranscribeRequest, "format"> & { format: AudioFormat };

/**
 * Base64, and nothing that merely looks like a string.
 *
 * **Without this an arbitrary non-empty string triggers a paid call.** The
 * length floor in `transcribeForFleet` keeps a short one free, but 60 KB of `x`
 * would have gone up the wire and been billed for. GPT Sol's review of the built
 * code, finding 5.
 *
 * Length as well as alphabet: base64 encodes three bytes as four characters, so
 * a length that is not a multiple of four cannot be a whole encoding of
 * anything.
 */
function isBase64(s: string): boolean {
  return s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/**
 * The keys a request may carry. Anything else is refused rather than dropped.
 *
 * **This is the "sent, then quietly dropped" class**, and it is the one this
 * whole feature has a scar from: OpenRouter accepted a `prompt` field for eleven
 * days, answered 200, and ignored it. A parser that reconstructs the fields it
 * knows about does the same thing to its own callers — a future optional field
 * would arrive, be silently discarded, and the only symptom would be the feature
 * it was added for not working. The product's endpoint refuses unknown keys and
 * so does this. GPT Sol's finding 5.
 */
const ALLOWED_KEYS = new Set(["audio", "format", "context"]);

/** The shape a `TranscribeRequest` has to have, checked rather than cast. */
function parse(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; why: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, why: "the body is not an object" };
  const o = raw as Record<string, unknown>;
  const surplus = Object.keys(o).filter((k) => !ALLOWED_KEYS.has(k));
  if (surplus.length > 0) return { ok: false, why: `unknown field(s): ${surplus.join(", ")}` };
  if (typeof o.audio !== "string" || o.audio === "")
    return { ok: false, why: "audio must be a non-empty base64 string" };
  if (!isBase64(o.audio)) return { ok: false, why: "audio is not base64" };
  /* A closed list rather than a pass-through: this string is handed to
     OpenRouter, and an unvalidated one is a field a caller controls in somebody
     else's request. */
  if (!isAudioFormat(o.format)) return { ok: false, why: "format is not a container we can transcribe" };
  const c = o.context;
  if (typeof c !== "object" || c === null) return { ok: false, why: "context is missing" };
  const ctx = c as Record<string, unknown>;
  const ctxSurplus = Object.keys(ctx).filter((k) => k !== "kind" && k !== "sessionId");
  if (ctxSurplus.length > 0) return { ok: false, why: `unknown context field(s): ${ctxSurplus.join(", ")}` };
  if (ctx.kind === "new-session" && Object.keys(ctx).length !== 1) {
    return { ok: false, why: "a new-session context carries nothing else" };
  }
  if (ctx.kind === "new-session") {
    return { ok: true, value: { audio: o.audio, format: o.format, context: { kind: "new-session" } } };
  }
  if (ctx.kind === "session" && typeof ctx.sessionId === "string" && ctx.sessionId !== "") {
    return {
      ok: true,
      value: { audio: o.audio, format: o.format, context: { kind: "session", sessionId: ctx.sessionId } },
    };
  }
  return { ok: false, why: "context must be {kind:'session',sessionId} or {kind:'new-session'}" };
}

/**
 * How the vocabulary is ordered for one request.
 *
 * **The named session first, if there is one.** Somebody dictating into a
 * session's message box is very often about to say that session's own name, or
 * the name of the worktree it is in. Everything else follows in the order the
 * page has it, which is the order it is looked at in.
 *
 * A `sessionId` that matches nothing is not an error: the snapshot moves, and a
 * dictation into a box for a session that has just gone should still be
 * transcribed. It simply gets the fleet-wide list.
 */
export function orderForContext(
  context: TranscribeRequest["context"],
  sessions: readonly FleetVocabularySession[],
): FleetVocabularySession[] {
  if (context.kind === "new-session") return [...sessions];
  const named = sessions.filter((s) => s.id === context.sessionId);
  return [...named, ...sessions.filter((s) => s.id !== context.sessionId)];
}

/**
 * Turning a recording into words — the one thing this route does that costs
 * money, behind a parameter so a test can drive the route without spending any.
 *
 * **The seam exists because a test found it missing.** A flood test aimed at the
 * rate limiter reached the real gateway, and `tests/setup/provider-guard.ts`
 * refused the call and said so — a guard this repo has because a suite that
 * quietly spends is one nobody notices until the invoice. Without the seam, the
 * route's own handling of a provider failure and of a caller hanging up could
 * not be tested at all: both are paths through code that only runs after the
 * money would have been spent.
 */
export type TranscribeDeps = {
  transcribe(args: {
    audio: string;
    format: AudioFormat;
    vocabulary: readonly string[];
    signal?: AbortSignal;
  }): Promise<FleetTranscription>;
};

/**
 * Mount the route. Returns false if this request is not for it, exactly like
 * the other routes on this server, so `server.ts`'s dispatch stays one line.
 *
 * @param sessions read at request time rather than closed over, because the
 *   snapshot is replaced by the refresh loop and a closure would freeze
 *   whichever one existed when the server started.
 * @param deps injected only by tests. `server.ts` passes nothing.
 */
export function handleTranscribeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: () => readonly FleetVocabularySession[],
  deps: TranscribeDeps = { transcribe: transcribeForFleet },
): boolean {
  const url = (req.url ?? "/").split("?")[0];
  if (url !== PATH) return false;
  if (req.method !== "POST") {
    json(res, 405, { error: "POST only" });
    return true;
  }

  const origin = checkOrigin(req.headers);
  if (!origin.ok) {
    json(res, origin.status, { error: origin.why, code: origin.code });
    return true;
  }

  void (async () => {
    const body = await readBody(req as BodyStream, MAX_TRANSCRIBE_BODY);
    if (!body.ok) {
      /* `body-too-large` is the recording being over the cap, which is the one
         failure here a person can act on — they say less. It is not retryable
         with the same bytes, and the client must not offer a Retry for it. */
      const tooBig = body.code === "body-too-large";
      /* **The same sentence the browser would have shown**, from the file that
         owns the number. Two ends writing their own is how one bracketed code
         comes to name two branches, which is the one thing copy.md says a code
         must never do — `tests/dictation-codes.test.ts` exists because that
         happened in the product. */
      json(res, tooBig ? 413 : 400, {
        error: tooBig ? tooLongMessage() : UNREADABLE_REQUEST,
      });
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch {
      json(res, 400, { error: UNREADABLE_REQUEST });
      return;
    }
    const parsed = parse(raw);
    if (!parsed.ok) {
      /* `why` names a FIELD, never a value — the values here are base64 audio
         and a session handle, and neither belongs in a response or a log. */
      console.error(`transcribe: refused a request — ${parsed.why}`);
      json(res, 400, { error: UNREADABLE_REQUEST });
      return;
    }

    /* **After the parse, before the money.** A request refused for its shape
       cost us nothing and must not spend a slot; this is the last line before
       one does. */
    const key = parsed.value.context.kind === "session" ? parsed.value.context.sessionId : "new-session";
    const now = Date.now();
    const verdict = limiter.check(key, now);
    if (!verdict.ok) {
      res.setHeader("retry-after", String(Math.ceil(verdict.retryAfterMs / 1000)));
      /* 429, which the client reads as retryable — it is: the fix is to wait.
         `why` is the limiter's own sentence about pace, and carries no part of
         the request. */
      json(res, 429, { error: `Too many dictations at once — ${verdict.why}. [ai-busy]` });
      return;
    }
    limiter.record(key, now);

    const vocabulary = fleetVocabulary(orderForContext(parsed.value.context, sessions()));
    /* **Hanging up cancels the paid call.** Without this the browser aborts its
       fetch — on a navigation, an unmount, or a second press — and the
       transcription carries on being billed for an answer nobody will read.
       The product's route has had this since it was written; mine did not, and
       GPT Sol found it as finding 3.

       Installed AFTER the body is read, deliberately: `readBody` destroys the
       socket on an over-size request, and a `close` fired by our own refusal is
       not a caller hanging up. */
    const hangup = new AbortController();
    res.on("close", () => hangup.abort());
    const result = await deps.transcribe({
      audio: parsed.value.audio,
      format: parsed.value.format,
      vocabulary,
      signal: hangup.signal,
    });
    /* Nothing to answer to. `499` is what `transcribeForFleet` returns for the
       caller's own abort, and writing to a closed socket throws. */
    if (hangup.signal.aborted) return;
    if (result.ok) {
      /* No log line at all on success. Not the length, not the duration, not a
         count — see the header. */
      const payload: TranscribeResponse = { text: result.text };
      json(res, 200, payload);
      return;
    }
    /* The SENTENCE is logged, which is ours, and nothing of the recording. */
    console.error(`transcribe: ${result.message}`);
    json(res, result.status, { error: result.message });
  })().catch((err: unknown) => {
    /* Everything above is built not to reject, and this is here because "built
       not to" is not a guarantee. Without it the request hangs until the phone
       gives up, which is indistinguishable from the box being down. */
    /* **A fixed reason, not `err.message`.** Everything above is built to turn
       its own failures into sentences, so reaching here means an exception
       nobody classified — and an unclassified exception on this route can carry
       body-derived material, which is somebody talking. The invariant this file
       states is that no part of the audio is ever logged; interpolating an
       arbitrary message is that invariant holding only for the errors we
       happened to think of. GPT Sol's finding 4. The stack is not lost: it is
       one `NODE_OPTIONS` away for anybody debugging this deliberately. */
    void err;
    console.error("transcribe: an unclassified exception reached the route boundary");
    if (!res.headersSent) {
      /* The product's wording, verbatim. See the note on UNREADABLE_REQUEST. */
      json(res, 500, { error: "Something went wrong while transcribing that. [mic-unexpected]" });
    }
  });
  return true;
}
