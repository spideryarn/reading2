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
import { type BodyStream, checkOrigin, readBody } from "./routes-steer.js";
import { transcribeForFleet } from "./transcribe.js";
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
 */
const UNREADABLE_REQUEST = "That recording could not be sent from this browser. [mic-format]";

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

/** The shape a `TranscribeRequest` has to have, checked rather than cast. */
function parse(raw: unknown): { ok: true; value: ParsedRequest } | { ok: false; why: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, why: "the body is not an object" };
  const o = raw as Record<string, unknown>;
  if (typeof o.audio !== "string" || o.audio === "")
    return { ok: false, why: "audio must be a non-empty base64 string" };
  /* A closed list rather than a pass-through: this string is handed to
     OpenRouter, and an unvalidated one is a field a caller controls in somebody
     else's request. */
  if (!isAudioFormat(o.format)) return { ok: false, why: "format is not a container we can transcribe" };
  const c = o.context;
  if (typeof c !== "object" || c === null) return { ok: false, why: "context is missing" };
  const ctx = c as Record<string, unknown>;
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
 * Mount the route. Returns false if this request is not for it, exactly like
 * the other routes on this server, so `server.ts`'s dispatch stays one line.
 *
 * @param sessions read at request time rather than closed over, because the
 *   snapshot is replaced by the refresh loop and a closure would freeze
 *   whichever one existed when the server started.
 */
export function handleTranscribeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: () => readonly FleetVocabularySession[],
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

    const vocabulary = fleetVocabulary(orderForContext(parsed.value.context, sessions()));
    const result = await transcribeForFleet({
      audio: parsed.value.audio,
      format: parsed.value.format,
      vocabulary,
    });
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
    console.error(`transcribe: threw — ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      json(res, 500, { error: "Something went wrong transcribing that. [mic-unexpected]" });
    }
  });
  return true;
}
