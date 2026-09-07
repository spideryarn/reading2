/**
 * **Sending a dictation up to be transcribed properly.**
 *
 * The client half of `POST /api/transcribe`. Its own file rather than lines
 * inside [`useDictation`](./useDictation.ts) because it is the one piece of
 * that hook with no browser audio in it at all — it takes a `Blob` and returns
 * a string — which makes it the piece worth testing on its own.
 *
 * The server does the model call and assembles the vocabulary; see
 * [`src/transcribe.ts`](../transcribe.ts) for which model and why — a chat
 * model until 2026-09-07, because the dedicated transcribers of 2026-08-27 had
 * nowhere to put a vocabulary, and `openai/gpt-transcribe` since, because one
 * of them turned out to have a `keywords` array after all. Nothing on this side
 * changed: it is the same `Blob` in the same request either way.
 */
import { MAX_AUDIO_BYTES, formatOf, tooLongMessage } from "../dictation-limits.js";
import { apiFetch, failure } from "./lib/api.js";
import type { DictationContext } from "./useDictation.js";

/**
 * Base64 in chunks, because the one-liner breaks on real recordings.
 *
 * `btoa(String.fromCharCode(...bytes))` is the obvious spelling and it throws
 * `RangeError: Maximum call stack size exceeded` somewhere around a hundred
 * thousand arguments — which is two seconds of audio. It would therefore have
 * worked in every test anybody wrote by hand and failed on the first real
 * dictation. 32 KB at a time is comfortably under every engine's limit.
 */
function base64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/**
 * The transcript, or a reason there isn't one.
 *
 * `text` may be an empty string on success — a reader who pressed the button
 * and said nothing gets a successful transcription of nothing, and the box must
 * be left exactly as it was rather than told something went wrong.
 */
export type TranscriptionResult =
  | { ok: true; text: string }
  | {
      ok: false;
      message: string;
      /**
       * **Whether sending the same bytes again could possibly work.**
       *
       * The reason a Retry button needs a field rather than a guess:
       * [copy.md](../../docs/project/copy.md) is explicit that telling somebody
       * to try again when retrying cannot work is the expensive mistake — they
       * do it four or five times and conclude the app is broken. A recording
       * this browser cannot encode, or one over the size cap, will be refused
       * identically for ever; a 502 or a dropped connection very likely will
       * not. GPT Sol's plan review, F5.
       */
      retryable: boolean;
    }
  /** The reader navigated away or pressed again. Say nothing to anybody. */
  | { ok: false; abandoned: true; message: string; retryable: false };

/**
 * How long the client waits before giving the box back.
 *
 * **Not the same guarantee as the server's 90 seconds**, and that is why it
 * exists. The server's deadline only helps once the request has reached the
 * server; a connection that never establishes, or a response that never
 * arrives, would otherwise leave `sendForTranscription` pending for ever — and
 * a promise that never settles here means a text box that stays `readOnly` for
 * the rest of the page's life, with a spinner on it, holding the reader's
 * words hostage. GPT Sol's plan review, item 7: *"define a visible timeout so
 * the field cannot remain read-only indefinitely."*
 *
 * Longer than the server's, so that in the ordinary case the server's own
 * failure — which has a sentence attached — is what the reader sees, and this
 * is only reached when there was nothing on the other end at all.
 */
const CLIENT_TIMEOUT_MS = 120_000;

export async function sendForTranscription(
  blob: Blob,
  mimeType: string,
  context: DictationContext,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const format = formatOf(mimeType);
  if (!format) {
    /* The same browser will encode the same way next time. */
    return {
      ok: false,
      retryable: false,
      message: "This browser recorded audio in a format we can't transcribe. [mic-format]",
    };
  }
  /* **Checked before the megabyte goes over the wire**, not after. The recorder
     stops below this, so reaching here means its own accounting and reality
     disagreed — which is exactly what a *bitrate hint* an encoder may exceed
     makes possible. The reader is told the recording was too long rather than
     handed whatever a refused request looks like from here. */
  if (blob.size > MAX_AUDIO_BYTES) {
    /* **The same sentence the server would have sent**, from the file that owns
       the number. Two ends wrote their own until 2026-09-05, and a reader who
       hit the client one and a reader who hit the server one quoted the same
       four characters at us for two different sentences. */
    return { ok: false, retryable: false, message: tooLongMessage() };
  }
  /* One signal out of two: the caller's, which is the reader moving on, and
     ours, which is nothing having answered. `AbortSignal.any` rather than a
     hand-rolled pair, so the fetch sees one thing and there is no state to keep
     in step. */
  const deadline = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const give_up = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const audio = base64(new Uint8Array(await blob.arrayBuffer()));
    const res = await apiFetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio, format, context }),
      signal: give_up,
    });
    if (!res.ok) {
      const err = await failure(res);
      /* **From the status, not from the sentence.** A 429 is a service that is
         busy and a 5xx is one that broke, and both are worth another go in ten
         seconds; a 400, a 402, a 413 or a 401 is a refusal of *this* request or
         of this app's account, and no amount of pressing a button changes
         either. Reading the code out of the prose would work today and stop
         working the moment somebody rewords a message, which is the thing
         copy.md keeps freely rewritable on purpose.

         **503 is the exception, and it is not a generic one.** It used to be one
         case and since 2026-09-07 it is a family, all of the same kind:
         `[mic-not-set-up]` when this server has no `OPENROUTER_API_KEY`, and
         every provider refusal that cannot succeed on a second attempt — a 400
         the service found malformed, a 403 it declined, a 404 for a model this
         app is no longer allowlisted for. `src/transcribe.ts` maps those
         deliberately, using `canRetry` over copy.md's `FailureKind` rather than
         a list of statuses.

         All of them are copy.md's `ours`, `bug` or `blocked`: nothing the reader
         can do, and a Retry button under any of them is the expensive mistake
         that file names, where somebody presses five times and concludes the app
         is broken. A retryable provider 503 arrives here as a **502** for
         exactly that reason. If this endpoint ever grows a genuinely transient
         503 of its own, this is the line to revisit. */
      const retryable = res.status === 429 || (res.status >= 500 && res.status !== 503);
      return { ok: false, message: err.message, retryable };
    }
    const json = (await res.json()) as { text?: unknown };
    return { ok: true, text: typeof json.text === "string" ? json.text : "" };
  } catch (err) {
    /* An abort is the reader moving on, not a fault. Told apart here rather
       than at the call site, because every caller would otherwise need to know
       what `AbortError` is called on three engines. */
    if ((err as { name?: string } | null)?.name === "AbortError") {
      /* **Told apart, because they are not the same event.** The caller's abort
         is the reader moving on and nobody needs telling; our own deadline
         firing is a failure they are watching a spinner for, and returning
         `abandoned` for that would hand the box back with no explanation at
         all. `TimeoutError` is what `AbortSignal.timeout` aborts with. */
      if (deadline.aborted) {
        return {
          ok: false,
          retryable: true,
          message: "That took too long to transcribe. Try again, or type it. [mic-slow]",
        };
      }
      return { ok: false, abandoned: true, retryable: false, message: "" };
    }
    if ((err as { name?: string } | null)?.name === "TimeoutError") {
      return {
        ok: false,
        retryable: true,
        message: "That took too long to transcribe. Try again, or type it. [mic-slow]",
      };
    }
    return {
      ok: false,
      retryable: true,
      message: "We couldn't reach the server to transcribe that. [mic-offline]",
    };
  }
}
