/**
 * **The two facts about a dictation that the browser and the server both need**
 * — how big it may be, and what containers we can transcribe.
 *
 * Its own file, with **no imports at all**, and that is the whole reason it
 * exists. The server's half lives in [`transcribe.ts`](./transcribe.ts), which
 * reaches the store and the article API; the client's half is in
 * [`web/dictation-upload.ts`](./web/dictation-upload.ts), which runs in a
 * browser. Neither may import the other, so a constant they must agree on has
 * nowhere to live but here.
 *
 * The alternative — two copies with a comment on each saying "keep in step with
 * the other one" — is the shape of a bug that only appears in production: a
 * client that records more than the server will take produces a 413 after a
 * reader has talked for two minutes, and a server that takes more than Vercel
 * will pass produces no response at all.
 */

/**
 * How much base64 audio one request may carry.
 *
 * **Vercel refuses a request body over 4.5 MB before any of our code runs** —
 * before the body is read, before the auth gate, before the copy in
 * `messages.ts`, before the request is logged. A limit above that is not a
 * limit, it is a blank failure the reader gets no sentence about.
 *
 * The first draft put this at 4 MB, on arithmetic from the 32 kbps the recorder
 * *asks* for. GPT Sol's plan review took it apart: the recorder prefers
 * AAC-in-MP4 and on that container deliberately sends **no bitrate hint at
 * all** — the hint is what made the encoder throw, see `mic-recording.ts`. Its
 * measured rate is ~14 KB/s, so five minutes is ~4.2 MB raw and ~5.6 MB base64,
 * which Vercel would have refused silently.
 *
 * 3 MB of base64 is ~2.25 MB of audio, with room underneath Vercel's ceiling
 * for the JSON around it.
 */
export const MAX_AUDIO_BASE64 = 3_000_000;

/**
 * The raw bytes that fit in it. Base64 is four characters per three bytes.
 *
 * `mic-recording.ts` stops the recorder below this, so in the ordinary case a
 * dictation ends by itself rather than being refused. This is the figure the
 * two ends check against, for the case where the recorder's own accounting and
 * reality disagree — which is exactly the case a bitrate *hint* creates.
 */
export const MAX_AUDIO_BYTES = Math.floor((MAX_AUDIO_BASE64 * 3) / 4);

/**
 * The containers a browser's `MediaRecorder` actually produces, and nothing
 * else.
 *
 * A closed set rather than a pass-through, because this string is handed
 * straight to OpenRouter and an unvalidated one is a field a caller controls in
 * somebody else's request.
 *
 * `webm` is here on **measurement rather than documentation**: OpenRouter's
 * `input_audio` docs list `wav, mp3, aiff, aac, ogg, flac, m4a, pcm16, pcm24`
 * and not `webm`, and `webm` transcribes perfectly — checked 2026-08-27,
 * because Chrome and Firefox both record it and a feature that believed the doc
 * would have been broken on two browsers out of three. The docs also warn that
 * support varies by provider, so this is a fact about the route we use today
 * and not a general contract.
 */
/* Not exported: `isAudioFormat` and `formatOf` below are the whole of what
   anyone needs, and a list that can be imported is a list that gets copied. */
const AUDIO_FORMATS = ["webm", "m4a", "mp4", "ogg", "wav", "mp3", "aac"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export function isAudioFormat(x: unknown): x is AudioFormat {
  return typeof x === "string" && (AUDIO_FORMATS as readonly string[]).includes(x);
}

/**
 * What the server calls the container, from what the recorder called it.
 *
 * `MediaRecorder` hands back a full MIME type with parameters —
 * `audio/webm;codecs=opus` — and OpenRouter wants a bare container word. The
 * mapping is small and closed on purpose: an unrecognised type returns null and
 * the recording is **not sent**, rather than being sent under a guess. A wrong
 * `format` is not a rejection, it is a transcript of noise.
 */
export function formatOf(mimeType: string): AudioFormat | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "audio/webm") return "webm";
  if (base === "audio/mp4" || base === "audio/x-m4a") return "m4a";
  /* Its own answer rather than `m4a`, which is what it said for one round.
     `audio/aac` is raw AAC in ADTS framing and `audio/mp4` is AAC inside an MP4
     container — the same codec in two different files, and telling a decoder
     the wrong one is not a rejection, it is a transcript of noise.
     GPT Sol's code review, item 9. */
  if (base === "audio/aac") return "aac";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/wav" || base === "audio/wave" || base === "audio/x-wav") return "wav";
  if (base === "audio/mpeg") return "mp3";
  return null;
}

/**
 * **What a reader is told when their recording is too long — once, for both
 * ends.**
 *
 * The cap is checked twice: in the browser before a megabyte goes over the wire
 * ([`web/dictation-upload.ts`](./web/dictation-upload.ts)) and on the server
 * over the base64 that arrived ([`routes.ts`](./routes.ts)). Until 2026-09-05
 * each wrote its own sentence, and they were different sentences under one
 * code — so `[mic-too-long]` named two branches, which is the one thing
 * [copy.md](../docs/project/copy.md) says a code must never do. Found by
 * `tests/dictation-codes.test.ts`, which exists because a feedback report that
 * quoted four characters could not be resolved to a branch.
 *
 * The number is here rather than in either sentence for the same reason the
 * constants above are: *"the number in an error message is the one thing in it
 * somebody acts on"*, and two ends computing it separately is how they come to
 * disagree. Raw audio, not base64 — base64 is a third larger than the file it
 * encodes, and quoting the encoded figure overstates what a reader may record
 * by exactly that third.
 */
export function tooLongMessage(): string {
  const mb = Math.round((MAX_AUDIO_BYTES / 1024 / 1024) * 10) / 10;
  return `That recording is too long — the limit is about ${mb} MB of audio. Try a shorter passage. [mic-too-long]`;
}
