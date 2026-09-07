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

/* eslint-disable @typescript-eslint/no-explicit-any */
function report(label: string, status: number, ms: number, raw: string) {
  let json: any;
  try {
    json = JSON.parse(raw);
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
console.log();
