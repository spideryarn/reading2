/**
 * **Sending a dictation up to be transcribed properly.**
 *
 * The client half of `POST /api/transcribe`. Its own file rather than lines
 * inside [`useDictation`](./useDictation.ts) because it is the one piece of
 * that hook with no browser audio in it at all — it takes a `Blob` and returns
 * a string — which makes it the piece worth testing on its own.
 *
 * The server does the model call and assembles the vocabulary; see
 * [`src/transcribe.ts`](../transcribe.ts) for why a chat model rather than one
 * of OpenRouter's nineteen dedicated transcribers.
 */
import { MAX_AUDIO_BYTES, formatOf } from "../dictation-limits.js";
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
  | { ok: false; message: string }
  /** The reader navigated away or pressed again. Say nothing to anybody. */
  | { ok: false; abandoned: true; message: string };

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
    return { ok: false, message: "This browser recorded audio in a format we can't transcribe. [mic-format]" };
  }
  /* **Checked before the megabyte goes over the wire**, not after. The recorder
     stops below this, so reaching here means its own accounting and reality
     disagreed — which is exactly what a *bitrate hint* an encoder may exceed
     makes possible. The reader is told the recording was too long rather than
     handed whatever a refused request looks like from here. */
  if (blob.size > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      message: "That recording is too long to transcribe in one go. Try a shorter passage. [mic-too-long]",
    };
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
      return { ok: false, message: err.message };
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
        return { ok: false, message: "That took too long to transcribe. Try again, or type it. [mic-slow]" };
      }
      return { ok: false, abandoned: true, message: "" };
    }
    if ((err as { name?: string } | null)?.name === "TimeoutError") {
      return { ok: false, message: "That took too long to transcribe. Try again, or type it. [mic-slow]" };
    }
    return { ok: false, message: "We couldn't reach the server to transcribe that. [mic-offline]" };
  }
}
