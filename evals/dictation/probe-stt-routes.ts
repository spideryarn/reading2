/**
 * **Four questions about the transcription endpoint, asked of both providers.**
 *
 *   npx tsx evals/dictation/probe-stt-routes.ts
 *
 * [`gate-models.ts`](gate-models.ts) probes the *chat* endpoint, because that is
 * where dictation has always gone. This probes `POST /audio/transcriptions`,
 * which is a different door with different rules, and it exists because the
 * research on 2026-09-07 found two facts that between them undo the reason
 * dictation avoided that door in the first place:
 *
 * - OpenAI's chat `input_audio.format` is a **closed enum of `wav` and `mp3`**
 *   in their own OpenAPI spec, so no amount of routing gets a browser's webm
 *   through it. The transcription endpoint accepts `webm` explicitly.
 * - `gpt-transcribe` takes a **`keywords` array** — "words or phrases to guide
 *   transcription". [260903i](../../docs/plans/260903i-which-model-transcribes-dictation.md)
 *   ruled the dedicated transcribers out because they had nowhere to put a
 *   vocabulary and `prompt` "answers 200 and changes nothing". `keywords` is
 *   somewhere to put one, and that claim needs re-testing rather than
 *   inheriting.
 *
 * **The point of the run is the four rows about `spideryarn`.** OpenRouter
 * normalises only a handful of transcription fields and *"unrecognized keys are
 * silently dropped"*, so `provider.options.openai.keywords` answering 200 is
 * not evidence that anything was forwarded — docs/reusable/silent-success.md.
 * The only evidence is the transcript: the `site-terms` clip says *Spideryarn*
 * and the block id `spya-k3m9qt`, and a route that has really been given the
 * words spells them differently from one that has not. Read the `HARD` column,
 * never the status.
 *
 * It sends a committed synthetic clip and nobody's voice.
 */
import fs from "node:fs";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();
const OPENAI = process.env.OPENAI_API_KEY;
const OPENROUTER = process.env.OPENROUTER_API_KEY;
if (!OPENAI) throw new Error("OPENAI_API_KEY is not set");
if (!OPENROUTER) throw new Error("OPENROUTER_API_KEY is not set");

const DIR = new URL(".", import.meta.url).pathname;
const WEBM = fs.readFileSync(`${DIR}clips/site-terms.webm`);

/**
 * The words the clip actually contains, as the vocabulary would supply them.
 *
 * Kept short and literal: `keywords` is documented as rejecting the whole
 * request on `<`, `>`, CR or LF in any entry, so whatever builds this list in
 * the app will have to sanitise. Here they are hand-written and safe.
 */
const KEYWORDS = [
  "Spideryarn",
  "granularity zoom",
  "gist column",
  "block id",
  "spya-k3m9qt",
  "OpenRouter",
  "reading view",
];

/** The two spellings that say whether the words got through. */
function hard(text: string): string {
  const said = (re: RegExp) => (re.test(text) ? "yes" : "NO ");
  return `spideryarn=${said(/spideryarn/i)} blockid=${said(/spya-?k3m9qt/i)}`;
}

/* The two fields any of these answers can carry, and nothing wider: an `any`
   here drew a lint warning and deserved to, because the shape is known. */
interface Answer {
  text?: unknown;
  error?: { message?: string };
}

function report(label: string, status: number, ms: number, raw: string) {
  let json: Answer | undefined;
  try {
    json = JSON.parse(raw) as Answer;
  } catch {
    /* A body that is not JSON is itself the answer; the status carries it. */
  }
  if (status !== 200) {
    console.log(
      `${label.padEnd(52)} ${String(status).padStart(3)}  ${String(`${ms}ms`).padStart(7)}  ${(json?.error?.message ?? raw.slice(0, 110)).replace(/\s+/g, " ")}`,
    );
    return;
  }
  const text = String(json?.text ?? "");
  console.log(
    `${label.padEnd(52)} ${String(status).padStart(3)}  ${String(`${ms}ms`).padStart(7)}  ${hard(text)}  ${JSON.stringify(text.slice(0, 60))}`,
  );
}

/** OpenAI's own endpoint: multipart, `keywords[]` repeated, per their docs. */
async function direct(label: string, model: string, keywords: string[] | null) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(WEBM)], { type: "audio/webm" }), "clip.webm");
  form.set("model", model);
  form.set("response_format", "json");
  if (keywords) for (const k of keywords) form.append("keywords[]", k);
  const started = Date.now();
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI}` },
    body: form,
  });
  report(label, r.status, Date.now() - started, await r.text());
}

/**
 * OpenRouter's: base64 JSON, `input_audio: {data, format}`, and anything the
 * gateway does not normalise pushed down through `provider.options.openai`.
 */
async function router(
  label: string,
  model: string,
  extra: Record<string, unknown>,
) {
  const started = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input_audio: { data: WEBM.toString("base64"), format: "webm" },
      response_format: "json",
      ...extra,
    }),
  });
  report(label, r.status, Date.now() - started, await r.text());
}

console.log("\nOpenAI directly — does `keywords` change the spelling?\n");
await direct("gpt-transcribe, no keywords", "gpt-transcribe", null);
await direct("gpt-transcribe, keywords", "gpt-transcribe", KEYWORDS);
await direct("gpt-4o-transcribe, keywords", "gpt-4o-transcribe", KEYWORDS);

console.log("\nOpenRouter — is webm taken, are keywords forwarded, does zdr route?\n");
await router("gpt-transcribe, no keywords", "openai/gpt-transcribe", {});
await router("gpt-transcribe, keywords", "openai/gpt-transcribe", {
  provider: { options: { openai: { keywords: KEYWORDS } } },
});
await router("gpt-transcribe, keywords + zdr", "openai/gpt-transcribe", {
  provider: { zdr: true, options: { openai: { keywords: KEYWORDS } } },
});
await router("gpt-transcribe, zdr alone", "openai/gpt-transcribe", {
  provider: { zdr: true },
});

/**
 * **Is the `provider` block read at all on this endpoint?**
 *
 * These four rows were run as throwaway `curl`s on 2026-09-07 and quoted in
 * [260907c](../../docs/plans/260907c-dictation-onto-an-openai-transcriber.md)
 * without being committed — which is the precise failure `gate-models.ts`'s own
 * docstring was written about, and GPT Sol's review of that plan caught it. They
 * are here now because they carry more weight than any other line in this file:
 * they are why `/privacy` stopped promising a reader's voice is unstored.
 *
 * **Anthropic serves no transcription model**, so `only: ["anthropic"]` is a
 * request that cannot be satisfied. A 200 with a transcript therefore means the
 * constraint was not read. OpenRouter documents this for three of the four keys
 * — *"Routing preferences (`order`, `only`, `ignore`) are not applied to
 * transcription requests"* — and says nothing about `zdr`, which is why the
 * `zdr` rows above matter and why this block is the control for them.
 *
 * **What these rows do *not* establish**, and the plan now says so: that no ZDR
 * is obtainable anywhere. OpenAI's own data-controls table lists
 * `/v1/audio/transcriptions` as ZDR-eligible and retaining nothing, and
 * OpenRouter has account-level and guardrail-level ZDR settings that a
 * per-request flag says nothing about. The claim these support is the narrow
 * one: **we cannot substantiate the promise from a per-request flag on this
 * route**, which is all a privacy page needs to stop making it.
 */
/**
 * **Does a five-minute recording come back before OpenRouter gives up?**
 *
 *   npx tsx evals/dictation/probe-stt-routes.ts --long
 *
 * Behind a flag because it uploads about 13 MB and the rest of this file is
 * pennies and seconds. It answers GPT Sol's second blocker on
 * [260907c](../../docs/plans/260907c-dictation-onto-an-openai-transcriber.md):
 * OpenRouter documents a **60-second upstream processing timeout**, the recorder
 * stops at five minutes (`mic-recording.ts`), and every clip anybody had
 * measured was 3 or 22 seconds. Extrapolating from 22 seconds to 300 is not
 * evidence, and the failure it would hide is a reader talking for four minutes
 * and getting nothing back.
 *
 * **A tone, not speech, and that limits what a pass means.** There is no ffmpeg
 * on this box and no way to synthesise five minutes of talking, so this measures
 * how the endpoint handles *duration and bytes* and says nothing about how long
 * it takes to transcribe dense speech. A pass here is necessary and not
 * sufficient; a failure here is conclusive.
 */
async function longAudioProbe() {
  const seconds = 300;
  const rate = 16_000;
  const pcm = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++)
    pcm.writeInt16LE(Math.round(4000 * Math.sin((2 * Math.PI * 180 * i) / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([h, pcm]);
  const b64 = wav.toString("base64");
  console.log(
    `\n${seconds}s of tone — ${(wav.length / 1024 / 1024).toFixed(1)} MB raw, ${(b64.length / 1024 / 1024).toFixed(1)} MB base64\n`,
  );
  const started = Date.now();
  const r = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-transcribe",
      input_audio: { data: b64, format: "wav" },
      response_format: "json",
    }),
  });
  report(`${seconds}s wav`, r.status, Date.now() - started, await r.text());
}

console.log("\nIs the provider block read here at all? (Anthropic serves no transcriber)\n");
for (const [label, block] of [
  ['only: ["anthropic"]', { only: ["anthropic"] }],
  ['zdr + only: ["anthropic"]', { zdr: true, only: ["anthropic"] }],
  ['order: ["anthropic"], no fallbacks', { order: ["anthropic"], allow_fallbacks: false }],
  ["zdr + require_parameters", { zdr: true, require_parameters: true }],
] as const) {
  await router(label, "openai/gpt-transcribe", { provider: block });
}

if (process.argv.includes("--long")) await longAudioProbe();
console.log();
