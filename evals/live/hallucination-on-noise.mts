/**
 * **Does the input transcriber invent words when it hears no words?**
 *
 * Greg, 2026-08-31, after the first real conversation:
 *
 * > I noticed that it did the hallucination thing where it thought I'd said all
 * > the vocabulary when there was a period of silence/background noise.
 *
 * That is a specific and testable accusation, and the suspect is our own doing.
 * Live conversation primes the transcriber with `transcription.prompt` — the
 * same ~900 characters of app jargon, glossary terms and proper nouns that made
 * dictation's second pass work (docs/project/dictation.md). Whisper-family
 * models are known to **fall back on the prompt** when the audio contains no
 * speech, which would produce exactly what Greg saw: a turn whose transcript is
 * the vocabulary list.
 *
 * If that is what is happening then the vocabulary is not an innocent
 * bystander, it is the cause, and "tweak a parameter" is the wrong fix.
 *
 * ## How this asks the question
 *
 * Over the **WebSocket** transport, not WebRTC — this is server-to-server, it
 * needs no browser and no microphone, and the input path being measured is the
 * same one either way. It feeds ~18 seconds of band-limited noise at a
 * conversational level, which is what a quiet room sounds like to a VAD, and
 * reports every transcript that comes back. A transcript at all is a
 * hallucination: nobody said anything.
 *
 * `server_vad` rather than `semantic_vad`, deliberately. Semantic VAD asks
 * whether a *sentence* sounded finished, so on pure noise it may never commit a
 * turn — and a run that produces no transcripts because nothing was ever
 * submitted would look exactly like a clean result. Fixed-silence VAD commits on
 * a timer, which is what makes the arms comparable.
 *
 * `create_response: false`, so the model never speaks. This measures the
 * transcriber, and paying for spoken answers to nobody would be paying for
 * noise twice.
 *
 * ## What it costs
 *
 * Audio input only, four arms of ~18s. At $32/1M audio tokens that is a few
 * cents in total. It writes no row — see the note in `scripts/ai-cost.ts` and
 * docs/plans/live-conversation.md § What is missing.
 *
 * `npx tsx evals/live/hallucination-on-noise.mts`
 */

import { loadEnvLocal } from "../../src/env.js";
import { liveTools } from "../../src/live.js";

loadEnvLocal();

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY is not set");

const MODEL = "gpt-realtime-2.1";
const RATE = 24_000;
/**
 * **Each arm is asked up to three times, and that is not politeness.**
 *
 * Two arms came back "nothing was submitted" on one run and two *different*
 * arms on the next, which is the signature of a flaky harness rather than a
 * finding — and a flaky harness that reports silence is the dangerous kind,
 * because silence is what a clean result looks like here. Retrying until the
 * question is actually asked keeps a transport hiccup from being read as
 * evidence about a model.
 */
const RETRIES = 3;
const SECONDS = 18;

/** A stand-in for the real thing — the shape that matters is "a list of jargon". */
const VOCABULARY =
  "Spideryarn, granularity zoom, gist column, block id, block ids of the form spya-k3m9qt, " +
  "the shelf, reading view, remember mode, glossary, table of contents, computational " +
  "functionalism, substrate independence, qualia, Anil Seth, Ex Machina, Hinton, " +
  "phrenology, Alimentiveness, Broca, the hard problem of consciousness";

/**
 * Band-limited noise at roughly speech level.
 *
 * Not white noise and not digital silence, and both of those would have been
 * the wrong stimulus. Silence often fails to open a turn at all, so it cannot
 * distinguish "did not hallucinate" from "was never asked"; full-band white
 * noise is not what a room sounds like. This is a slow random walk, which puts
 * most of its energy low down like air conditioning and traffic do.
 */
function roomNoise(seconds: number): Buffer {
  const n = RATE * seconds;
  const pcm = Buffer.alloc(n * 2);
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = x * 0.97 + (Math.random() * 2 - 1) * 0.03;
    /* ~8% of full scale. Loud enough that a VAD at its default threshold of 0.5
       treats it as something, quiet enough to be plausibly a room rather than a
       fault. */
    pcm.writeInt16LE(Math.max(-1, Math.min(1, x * 3)) * 0.08 * 32767, i * 2);
  }
  return pcm;
}

interface Arm {
  label: string;
  transcription: Record<string, unknown>;
  noiseReduction?: { type: string };
}

const ARMS: Arm[] = [
  {
    label: "gpt-4o-transcribe + vocabulary  (what we ship today)",
    transcription: { model: "gpt-4o-transcribe", prompt: VOCABULARY },
  },
  {
    label: "gpt-4o-transcribe, NO vocabulary",
    transcription: { model: "gpt-4o-transcribe" },
  },
  {
    label: "gpt-live-transcribe + vocabulary",
    transcription: { model: "gpt-live-transcribe", prompt: VOCABULARY },
  },
  {
    label: "gpt-live-transcribe + vocabulary + near_field",
    transcription: { model: "gpt-live-transcribe", prompt: VOCABULARY },
    noiseReduction: { type: "near_field" },
  },
  /* **The candidate.** `jargon-recovery.mts` shows this one recovers all four
     jargon terms including the block id, which is the whole reason a vocabulary
     exists. The question here is the other half: having got the terms into the
     session as `keywords` rather than as a `prompt`, does it still read them
     back when nobody has said anything? */
  {
    label: "gpt-live-transcribe + KEYWORDS + near_field  (the candidate)",
    transcription: {
      model: "gpt-live-transcribe",
      keywords: VOCABULARY.split(",").map((t) => t.trim()),
    },
    noiseReduction: { type: "near_field" },
  },
];

async function mint(arm: Arm): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 120 },
      session: {
        type: "realtime",
        model: MODEL,
        instructions: "You are a reading companion.",
        tools: liveTools(),
        audio: {
          input: {
            transcription: arm.transcription,
            ...(arm.noiseReduction ? { noise_reduction: arm.noiseReduction } : {}),
            /* **Turn detection OFF, and the buffer committed by hand.**
               The first version of this used `server_vad` and got zero
               speech-starts in all four arms — which reads as "nothing was
               invented" and actually means the question was never put. A VAD
               that declines to open a turn on noise is a null instrument, and
               it fails in the direction that looks like good news.
               `input_audio_buffer.commit` asks the transcriber directly: here
               is some audio, what are the words? That is the question. */
            turn_detection: null,
          },
        },
      },
    }),
  });
  const body = (await res.json()) as { value?: string; error?: { message?: string } };
  if (!res.ok || !body.value) throw new Error(body.error?.message ?? `mint failed ${res.status}`);
  return body.value;
}

interface Result {
  transcripts: string[];
  speechStarts: number;
  /** How many buffers were actually submitted. Zero means the arm proved nothing. */
  commits: number;
  failures: number;
}

async function run(arm: Arm): Promise<Result> {
  const token = await mint(arm);
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, [
    "realtime",
    `openai-insecure-api-key.${token}`,
  ]);

  const out: Result = { transcripts: [], speechStarts: 0, commits: 0, failures: 0 };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, (SECONDS + 8) * 1000);

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    };

    ws.onopen = () => {
      const pcm = roomNoise(SECONDS);
      /* In 100ms slices, as a real capture would arrive. One giant append is a
         different thing to a VAD than a stream is. */
      const slice = RATE * 0.1 * 2;
      for (let off = 0; off < pcm.length; off += slice) {
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: pcm.subarray(off, Math.min(off + slice, pcm.length)).toString("base64"),
          }),
        );
      }
      /* The whole point, now that no VAD will do it for us. Without this the
         audio sits in a buffer nobody ever reads. */
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    };

    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data)) as Record<string, unknown>;
      const type = String(e.type);
      if (type === "input_audio_buffer.speech_started") out.speechStarts++;
      /* The receipt that the question was actually asked. Without it, "no
         transcripts" is ambiguous between the two things this eval most needs
         to tell apart. */
      if (type === "input_audio_buffer.committed") out.commits++;
      if (type === "conversation.item.input_audio_transcription.completed") {
        const t = String(e.transcript ?? "").trim();
        if (t !== "") out.transcripts.push(t);
      }
      if (type === "conversation.item.input_audio_transcription.failed") out.failures++;
      if (type === "error") {
        const err = e.error as { message?: string } | undefined;
        console.log(`    ! ${err?.message ?? "unknown error"}`);
      }
    };
  });

  return out;
}

/** How much of a phantom transcript came out of the vocabulary we supplied? */
function overlapWithVocabulary(text: string): number {
  const terms = VOCABULARY.toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 4);
  const lower = text.toLowerCase();
  const hits = terms.filter((t) => lower.includes(t));
  return hits.length;
}

console.log(`Feeding ${SECONDS}s of room noise to ${MODEL}, four arms.`);
console.log(`Nobody says anything. Every transcript below is invented.\n`);

for (const arm of ARMS) {
  process.stdout.write(`${arm.label}\n`);
  try {
    let r = await run(arm);
    for (let i = 1; i < RETRIES && r.commits === 0; i++) r = await run(arm);
    console.log(
      `    ${r.commits} commit(s), ${r.transcripts.length} transcript(s), ${r.failures} failure(s)`,
    );
    if (r.commits === 0) {
      /* Said loudly, because this is the result that looks like success. */
      console.log(`      !! NOTHING WAS SUBMITTED — this arm measured nothing.`);
    }
    for (const t of r.transcripts) {
      const hits = overlapWithVocabulary(t);
      const flag = hits > 0 ? `  <-- ${hits} VOCABULARY TERM(S)` : "";
      console.log(`      "${t.slice(0, 160)}"${flag}`);
    }
    if (r.transcripts.length === 0 && r.commits > 0) {
      console.log(`      (asked ${r.commits}x, invented nothing)`);
    }
  } catch (err) {
    console.log(`    failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log();
}
