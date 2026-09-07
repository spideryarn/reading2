/**
 * **Which candidates can serve the request this app actually sends?**
 *
 *   npx tsx evals/dictation/gate-models.ts
 *
 * Run this before [`bench-models.ts`](bench-models.ts). It is pennies and a
 * minute, and it exists because the expensive way to discover that a model
 * cannot be routed is a fifty-minute benchmark full of rows marked "lost".
 *
 * Dictation does not send a bare chat request. It sends
 * `provider: { zdr: true, require_parameters: true }` — see `AI_JOB_ROUTE` in
 * [`src/ai-call.ts`](../../src/ai-call.ts) — plus a strict `json_schema` and the
 * audio as `input_audio` in **webm/opus**, which is what Chrome's
 * `MediaRecorder` produces. Each of those four can independently leave a model
 * with no eligible endpoint, and `require_parameters` turns "this upstream does
 * not do structured outputs" into a 404 rather than a wrong answer. So a
 * candidate that looks perfect on a leaderboard may simply not be reachable
 * from here, and that is a fact about *our* request, not about the model.
 *
 * It prints one line per candidate: the round trip, whether a transcript came
 * back, **which model actually answered**, and the first words of it. Read the
 * answered-by column: `zdr` routing means OpenRouter is choosing an upstream
 * under a constraint, and a candidate scored while a fallback answered is a
 * candidate nobody measured.
 *
 * **Then, for each candidate that failed, it takes the constraints off one at a
 * time** — so a refusal says *what* it was refusing rather than only that it
 * refused. That is where the answer to "why not OpenAI?" comes from, and it is
 * in this file rather than in a throwaway script because the first version of
 * this work ran those probes, deleted them, and left two documents claiming a
 * finding could be reproduced by something that could not reproduce it.
 */
import fs from "node:fs";
import { loadEnvLocal } from "../../src/env.js";
import { transcribeWith } from "../../src/transcribe.js";

loadEnvLocal();
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

const DIR = new URL(".", import.meta.url).pathname;

/**
 * Every model OpenRouter lists as taking audio input, minus the ones that are
 * not candidates: `:batch` variants (a queue, not a reader waiting), `:free`
 * tiers, `openrouter/auto` (which would pick for us), and the 2.5 generation,
 * which the incumbent already superseded on the same measurements.
 *
 * Recorded from `GET /api/v1/models`, filtered on
 * `architecture.input_modalities` containing `audio`, on 2026-09-03. Re-run that
 * filter rather than trusting this list to still be complete.
 */
const CANDIDATES = [
  "google/gemini-3.1-flash-lite", // the incumbent
  "google/gemini-3.5-flash-lite",
  "google/gemini-3-flash-preview",
  "google/gemini-3.5-flash",
  "google/gemini-3.6-flash",
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-audio",
  "openai/gpt-audio-mini",
  "mistralai/voxtral-small-24b-2507",
  "thinkingmachines/inkling",
  "thinkingmachines/inkling-small",
  "meta/muse-spark-1.3",
  "xiaomi/mimo-v2.5",
];

/* The `site-terms` clip, because a gate should fail on a model that cannot be
   routed *and* on one that transcribes nothing useful, and this clip says
   `Spideryarn` and a block id — the two things the whole vocabulary exists for.
   One run each: this is a gate, not a measurement. */
const AUDIO = fs.readFileSync(`${DIR}clips/site-terms.webm`).toString("base64");
const VOCABULARY =
  "Spideryarn, granularity zoom, gist column, block id, spya-k3m9qt, OpenRouter, reading view";

console.log(`${CANDIDATES.length} candidates, one webm call each, the production request shape.\n`);
const failed: string[] = [];
for (const model of CANDIDATES) {
  try {
    const out = await transcribeWith(AUDIO, "webm", VOCABULARY, { model });
    const answered = out.answeredBy && out.answeredBy !== model ? `  ANSWERED-BY ${out.answeredBy}` : "";
    console.log(
      `${model.padEnd(34)} ${String(`${out.ms}ms`).padStart(7)}  $${(out.usd ?? 0).toFixed(5)}  ${JSON.stringify(out.text.slice(0, 70))}${answered}`,
    );
  } catch (err) {
    /* `transcribe.ts` flattens every provider refusal to one reader-facing
       sentence on purpose — it must never echo a provider's body, which may
       contain the reader's voice. That is right for the server and useless for
       a diagnosis, which is why `diagnose` below asks the provider directly
       rather than through the app. */
    console.log(`${model.padEnd(34)}    FAIL  ${(err as Error).message}`);
    failed.push(model);
  }
}

/* ----------------------------------------------------------------- why not */

/**
 * **For a candidate that failed: which part of the request did it?**
 *
 * The gate sends all four constraints at once, so a failure says "no" without
 * saying to what. This takes them off one at a time — and it exists because the
 * first version of this work did the same thing in a throwaway script, deleted
 * it, and then left two documents claiming the gate could reproduce a finding
 * it could not. GPT Sol's review, item 5. A measurement worth quoting is worth
 * being able to re-run.
 *
 * It deliberately talks to OpenRouter directly rather than through
 * `transcribeWith`, because the whole point is to send requests the app never
 * would. Nothing here is a model call the app makes, and the audio is a clip in
 * this repo rather than anybody's voice.
 */
async function diagnose(model: string) {
  const body = (extra: Record<string, unknown>, data: string, format: string) => ({
    model,
    max_tokens: 500,
    ...extra,
    messages: [
      { role: "system", content: "Transcribe the audio verbatim." },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this." },
          { type: "input_audio", input_audio: { data, format } },
        ],
      },
    ],
  });
  const schema = {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "transcription",
        strict: true,
        schema: {
          type: "object",
          properties: { transcript: { type: "string" } },
          required: ["transcript"],
          additionalProperties: false,
        },
      },
    },
  };
  /* **A synthetic WAV, not a transcode.** There is no ffmpeg on the box this
     was written on, and the question is only whether the *container* gets past
     the door — a second of quiet tone answers that and carries no words, so a
     `200` here means "accepted", never "transcribed well". */
  const wav = (() => {
    const rate = 16_000;
    const pcm = Buffer.alloc(rate * 2);
    for (let i = 0; i < rate; i++)
      pcm.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
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
    return Buffer.concat([h, pcm]).toString("base64");
  })();

  /* **The WAV rows exist because the webm rows cannot separate two reasons.**
     Until 2026-09-07 the last row took the schema off *and* changed the
     container, so a `200` there was evidence about the pair and not about
     either — and the row above it could not tell "this provider will not take
     webm" from "this provider will not take a schema". The four WAV rows put
     each constraint back one at a time over a container that is known to get
     through the door.

     The `zdr, ..., WAV` row is the one worth running on its own account: `zdr`
     is a filter over *endpoints*, so it should refuse a WAV exactly as it
     refuses a webm — but "should" is the word that costs the most here, since a
     200 on that row would mean the copy beside the microphone can go on saying
     the reader's voice is not stored. Measure it rather than reason about it. */
  const probes: [string, Record<string, unknown>, string, string][] = [
    ["no provider block, schema, webm", schema, AUDIO, "webm"],
    ["require_parameters only, schema, webm", { ...schema, provider: { require_parameters: true } }, AUDIO, "webm"],
    ["zdr only, schema, webm", { ...schema, provider: { zdr: true } }, AUDIO, "webm"],
    ["no provider block, no schema, webm", {}, AUDIO, "webm"],
    ["no provider block, no schema, WAV", {}, wav, "wav"],
    ["no provider block, schema, WAV", schema, wav, "wav"],
    ["require_parameters only, schema, WAV", { ...schema, provider: { require_parameters: true } }, wav, "wav"],
    ["zdr only, schema, WAV", { ...schema, provider: { zdr: true } }, wav, "wav"],
    ["zdr only, no schema, WAV", { provider: { zdr: true } }, wav, "wav"],
  ];
  console.log(`\n  ${model} — one constraint at a time:`);
  for (const [label, extra, data, format] of probes) {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY as string}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body(extra, data, format)),
    });
    const text = await r.text();
    let json: { error?: { message?: string } } | undefined;
    try {
      json = JSON.parse(text);
    } catch {
      /* A body that is not JSON is itself the answer; the status carries it. */
    }
    console.log(
      `    ${label.padEnd(42)} ${String(r.status).padStart(3)}  ${r.ok ? "ok" : (json?.error?.message ?? text.slice(0, 90))}`,
    );
  }
}

if (failed.length) {
  console.log(
    `\n${failed.length} candidate(s) could not serve the request. Taking the constraints off one`,
  );
  console.log("at a time, so a refusal says what it was refusing:");
  for (const model of failed) await diagnose(model);
}
