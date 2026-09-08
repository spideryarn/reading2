/**
 * **The browser half of `POST /api/transcribe`, for this dashboard.**
 *
 * A `Transcriber` — the parameter `src/web/useDictation.ts` takes instead of
 * knowing where its recordings go. That hook, the recorder, the microphone lock
 * and the level meter are all reused from the product; this file is the ~90
 * lines that were the product coupling, written again for a server that answers
 * on 8787 and has no auth session.
 *
 * `src/web/dictation-upload.ts` is the product's equivalent and this is
 * deliberately shaped like it, because the *decisions* in it are not
 * product-specific and were expensive to get right:
 *
 *  - **Base64 in chunks.** `btoa(String.fromCharCode(...bytes))` is the obvious
 *    spelling and it throws `RangeError: Maximum call stack size exceeded`
 *    somewhere around a hundred thousand arguments — which is two seconds of
 *    audio. It would have worked in every test written by hand and failed on the
 *    first real dictation.
 *  - **Retryable is read off the STATUS, not out of the sentence.** A 429 is a
 *    service that is busy and a 5xx is one that broke; a 400 or a 413 is a
 *    refusal of *this* request, and no amount of pressing a button changes it.
 *    Reading a code out of the prose would work today and stop working the
 *    moment somebody rewords a message. `copy.md` is explicit that inviting a
 *    futile retry is the expensive mistake.
 *  - **Our own deadline, longer than the server's.** The server's helps only
 *    once the request has reached it; a connection that never establishes would
 *    otherwise leave this promise pending for ever, and a promise that never
 *    settles here is a text box that stays `readOnly` with a spinner on it for
 *    the rest of the page's life.
 *  - **An abort is the reader moving on, not a fault**, and it is told apart
 *    from our own deadline firing — which is a failure somebody is watching a
 *    spinner for and needs a sentence.
 *
 * What is NOT shaped like it: there is no `apiFetch`, no bearer token and no
 * offline store. This page is reached over the tailnet and its whole access
 * control is reachability.
 */
import { MAX_AUDIO_BYTES, formatOf, tooLongMessage } from "../../../../src/dictation-limits.js";
import type { Transcriber, TranscriptionResult } from "../../../../src/web/transcriber.js";
import type { TranscribeRequest } from "../../wire.js";

/** Where a dictation on this page is going. The wire type is the contract. */
export type FleetDictationContext = TranscribeRequest["context"];

/** See the header: the one-liner throws on anything longer than two seconds. */
function base64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/**
 * Longer than the server's 45 seconds, so that in the ordinary case the
 * server's own failure — which has a sentence attached — is what is shown, and
 * this is only reached when there was nothing on the other end at all.
 */
const CLIENT_TIMEOUT_MS = 75_000;

export const sendForTranscription: Transcriber<FleetDictationContext> = async (
  blob,
  mimeType,
  context,
  signal,
) => {
  const format = formatOf(mimeType);
  if (!format) {
    /* The same browser will encode the same way next time, so no Retry. */
    return {
      ok: false,
      retryable: false,
      message: "This browser recorded audio in a format we can't transcribe. [mic-format]",
    };
  }
  /* **Checked before the megabyte goes over the wire.** The recorder stops below
     this, so reaching here means its own accounting and reality disagreed —
     which is what a bitrate *hint* an encoder may exceed makes possible. The
     sentence comes from the file that owns the number, so the browser and the
     server cannot say two different things under one bracketed code. */
  if (blob.size > MAX_AUDIO_BYTES) {
    return { ok: false, retryable: false, message: tooLongMessage() };
  }

  const deadline = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const give_up = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const audio = base64(new Uint8Array(await blob.arrayBuffer()));
    const body: TranscribeRequest = { audio, format, context };
    const res = await fetch("/api/transcribe", {
      method: "POST",
      /* Half the CSRF defence: a cross-site HTML form cannot set this header,
         and the browser adds `Origin`, which the route checks. */
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
      signal: give_up,
    });
    if (!res.ok) {
      /* The server's own sentence, which carries the bracketed code somebody
         would quote. Never the raw body: an unparsed body is somebody else's
         HTML — a proxy's, a captive portal's — and putting it on screen is how
         you get a stack trace rendered as an error message. */
      /* The product's wording for this code, because a code names a branch and
         Greg cannot tell which of the two servers he is quoting from. */
      let message = "Something went wrong while transcribing that. [mic-unexpected]";
      try {
        const parsed = (await res.json()) as { error?: unknown };
        if (typeof parsed.error === "string" && parsed.error !== "") message = parsed.error;
      } catch {
        /* Left as the default sentence above. */
      }
      const retryable = res.status === 429 || (res.status >= 500 && res.status !== 503);
      return { ok: false, message, retryable };
    }
    const json = (await res.json()) as { text?: unknown };
    return { ok: true, text: typeof json.text === "string" ? json.text : "" };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "AbortError") {
      /* Told apart, because they are not the same event. The caller's abort is
         somebody pressing the button again and nobody needs telling; our own
         deadline firing is a failure they are watching a spinner for, and
         returning `abandoned` for it would hand the box back with no
         explanation at all. */
      if (deadline.aborted) return slow();
      return { ok: false, abandoned: true, retryable: false, message: "" };
    }
    if (name === "TimeoutError") return slow();
    return {
      ok: false,
      retryable: true,
      message: "We couldn't reach the server to transcribe that. [mic-offline]",
    };
  }
};

function slow(): TranscriptionResult {
  return {
    ok: false,
    retryable: true,
    message: "That took too long to transcribe. Try again, or type it. [mic-slow]",
  };
}
