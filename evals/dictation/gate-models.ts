/**
 * **Which candidates can serve the request this app actually sends?**
 *
 *   npx tsx evals/dictation/gate-models.ts
 *
 * Run this before [`bench-models.ts`](bench-models.ts). It is pennies and a
 * minute, and it exists because the expensive way to discover that a model
 * cannot be routed is a fifty-minute benchmark full of rows marked "lost".
 *
 * ## The request it gates changed door on 2026-09-07
 *
 * Dictation used to be a chat request — `provider: { zdr: true,
 * require_parameters: true }`, a strict `json_schema`, and the audio as an
 * `input_audio` part of a user message. It now goes to
 * **`POST /v1/audio/transcriptions`** with `openai/gpt-transcribe`: `model`,
 * `input_audio: {data, format}` in **webm/opus** (what Chrome's `MediaRecorder`
 * produces), `response_format: "json"`, and the vocabulary as
 * `provider.options.openai.keywords`.
 * docs/plans/260907c-dictation-onto-an-openai-transcriber.md.
 *
 * **So this file was measuring a route the app had abandoned.** Its candidate
 * list was fifteen *chat* models, and not one of them appears among the models
 * OpenRouter documents as serving transcription — a gate asking about a door
 * nobody knocks on any more. The gate loop below now goes through
 * `transcribeWith`, which is the shipped request, over models that door serves.
 *
 * It prints one line per candidate: the round trip, whether a transcript came
 * back, **which model actually answered**, and the first words of it. Read the
 * answered-by column — a candidate scored while a fallback answered is a
 * candidate nobody measured.
 *
 * **There is no cost column and that is on purpose.** This endpoint answers
 * `usage: {seconds, cost}` with `cost: 0` for every call — measured at 3 seconds
 * and at 22 on 2026-09-07 — so a `$` column here could only ever be a row of
 * zeroes that somebody totals. What a run really cost comes from the account:
 * `npm run cost -- --reconcile`.
 *
 * ## The second half is a record, not a diagnosis
 *
 * Below the gate is `diagnose()`, which takes the *old* chat request apart one
 * constraint at a time against OpenAI's two audio chat models. It is kept
 * because it is the evidence behind "why not OpenAI?" — the finding that sent
 * dictation to a different endpoint in the end — and because the first version
 * of this work ran those probes in a throwaway script, deleted it, and left two
 * documents claiming a finding could be reproduced by something that could not
 * reproduce it. GPT Sol's review, item 5. A measurement worth quoting is worth
 * being able to re-run.
 */
import fs from "node:fs";
import { loadEnvLocal } from "../../src/env.js";
import { transcribeWith } from "../../src/transcribe.js";

loadEnvLocal();
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

const DIR = new URL(".", import.meta.url).pathname;

/**
 * The models that door serves, as far as anybody here knows.
 *
 * **Hand-collected on 2026-09-07** from OpenRouter's zero-data-retention
 * endpoint list and its speech-to-text guide. Not from `GET /api/v1/models`,
 * which is where the fifteen chat models that used to be here came from and is
 * not reliable for this question: it says what a model *takes* as input, and
 * "takes audio" is exactly what an audio chat model and a transcriber have in
 * common while going to different doors. There is no field on it saying "serves
 * `/v1/audio/transcriptions`", so this list is a person reading two pages, and
 * it goes stale the way a person reading two pages goes stale. Re-read them
 * rather than trusting it.
 */
const CANDIDATES = [
  "openai/gpt-transcribe", // the incumbent since 2026-09-07
  "openai/whisper-large-v3",
  "mistralai/voxtral-mini-transcribe",
  "microsoft/mai-transcribe-2",
  "fish-audio/transcribe-1",
];

/* The `site-terms` clip, because a gate should fail on a model that cannot be
   routed *and* on one that transcribes nothing useful, and this clip says
   `Spideryarn` and a block id — the two things the whole vocabulary exists for.
   One run each: this is a gate, not a measurement. */
const AUDIO = fs.readFileSync(`${DIR}clips/site-terms.webm`).toString("base64");
/* **A list, not a joined line.** `keywords` takes an array, and joining only to
   split again would lose exactly what the split has to guess at — a term
   containing a comma comes back as two. Hand-written and short, because a
   keyword containing `<`, `>`, CR or LF is documented as getting the whole
   request refused. */
const VOCABULARY = [
  "Spideryarn",
  "granularity zoom",
  "gist column",
  "block id",
  "spya-k3m9qt",
  "OpenRouter",
  "reading view",
];

console.log(`${CANDIDATES.length} candidates, one webm call each, the production request shape.\n`);
for (const model of CANDIDATES) {
  try {
    const out = await transcribeWith(AUDIO, "webm", VOCABULARY, { model });
    const answered = out.answeredBy && out.answeredBy !== model ? `  ANSWERED-BY ${out.answeredBy}` : "";
    /* No `$` column: `usage.cost` is 0 on every call from this endpoint, so the
       figure would be a zero pretending to be a measurement — see the file
       comment, and `npm run cost -- --reconcile` for the real spend. */
    console.log(
      `${model.padEnd(34)} ${String(`${out.ms}ms`).padStart(7)}  ${JSON.stringify(out.text.slice(0, 70))}${answered}`,
    );
  } catch (err) {
    /* `transcribe.ts` flattens every provider refusal to one reader-facing
       sentence on purpose — it must never echo a provider's body, which may
       contain the reader's voice. That is right for the server and useless for
       a diagnosis, which is why `diagnose` below asks the provider directly
       rather than through the app. */
    console.log(`${model.padEnd(34)}    FAIL  ${(err as Error).message}`);
  }
}

/* --------------------------------------------------- the road not taken */

/**
 * **The record of the route dictation gave up on: which part of the chat
 * request was OpenAI's audio model refusing?**
 *
 * This is not a diagnosis of anything failing today. The gate above sends the
 * request the app sends, and this sends the one it *used* to — the chat
 * endpoint, with all four constraints and then with them taken off one at a
 * time, so a refusal says what it was refusing rather than only that it
 * refused. It is the evidence behind "why not OpenAI?", which is the finding
 * that eventually moved dictation to a different door altogether, and the
 * documents that cite it name this file.
 *
 * **So it is kept, and it must not be deleted and then cited.** The first
 * version of this work ran exactly these probes in a throwaway script, deleted
 * it, and left two documents claiming a finding could be reproduced by
 * something that could not reproduce it. GPT Sol's review, item 5.
 *
 * It talks to OpenRouter directly rather than through `transcribeWith`, because
 * the whole point is to send requests the app never would — and since 2026-09-07
 * that includes every request in here. Nothing below is a model call this app
 * makes any more, and the audio is a clip in this repo rather than anybody's
 * voice.
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

     The `zdr, ..., WAV` row was the one worth running on its own account: `zdr`
     is a filter over *endpoints*, so it should refuse a WAV exactly as it
     refuses a webm — but "should" is the word that costs the most here, since a
     200 on that row would have meant the copy beside the microphone could go on
     saying the reader's voice is not stored. That question left with the route:
     `AI_JOB_ROUTE.dictation.provider` is `null` today, so nothing the app sends
     carries `zdr` at all. The row stays because the record is of what was
     asked, and a probe edited to match what we would ask now is not a record. */
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

/**
 * OpenAI's two audio chat models, **by name rather than by whichever candidate
 * happened to fail**.
 *
 * It used to run over the gate's failures, which was right while the gate was a
 * chat gate: a model that could not be routed was a model worth taking apart. It
 * is wrong now — the gate's candidates are transcription models, and posting one
 * of those to chat/completions would produce a row of 400s that say nothing
 * about anything. These two are the pair the record is *about*.
 */
const ABANDONED_ROUTE = ["openai/gpt-audio", "openai/gpt-audio-mini"];
console.log("\nThe chat endpoint, which dictation left on 2026-09-07 — kept as the record");
console.log("of why, with the constraints taken off one at a time:");
for (const model of ABANDONED_ROUTE) await diagnose(model);
