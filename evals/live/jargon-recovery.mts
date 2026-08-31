/**
 * **Does `keywords` actually do anything, and can we keep our jargon if we stop
 * using `prompt`?**
 *
 * The sibling of `hallucination-on-noise.mts`, and it exists because that one
 * produced half an answer. Feeding noise proved that `gpt-4o-transcribe` with
 * our vocabulary in `transcription.prompt` **reads the vocabulary back as a
 * transcript** — Greg's bug, reproduced — and that `gpt-live-transcribe` does
 * not. So the model should change.
 *
 * The half it did not answer is what to do with the vocabulary itself.
 * OpenAI's transcription guide says `prompt` is for scene-setting prose and
 * that a term list belongs in **`keywords`**, which carries the guard we want
 * in its own documentation: *"Keywords are hints, not required output. The
 * transcript should include a keyword only when the audio contains it."*
 *
 * **But `keywords` cannot be verified by looking.** Probed on 2026-08-31: a
 * realtime session accepts it with a 200 and **does not echo it back**, while
 * `prompt` and `languages` in the same object are echoed. The parameter is
 * certainly *known* — a typo returns `Did you mean 'keywords'?`, and
 * `gpt-4o-transcribe` refuses it with "not supported for this model" — but
 * accepted-and-not-echoed is precisely the shape of OpenRouter's `prompt`,
 * which answered `200` and ignored the field, and cost this app a whole route
 * (docs/project/dictation.md § It transcribes twice).
 *
 * So this asks the only question that cannot be faked: **say the jargon out
 * loud and see whether it comes back spelled right.** Nothing is inferred from
 * the session object.
 *
 * ## Method
 *
 * The words are spoken by `gpt-4o-mini-tts` rather than by a person. That is a
 * real limitation and it is the same one the dictation benchmark has
 * (evals/dictation/README.md): a synthetic voice is clearer than a human in a
 * room, so these numbers are a ceiling, not a prediction. What it settles is
 * the *comparison* between arms, which is what is being asked.
 *
 * Recovery is scored on whether each term appears in the transcript, case- and
 * punctuation-insensitive. `spya-k3m9qt` is in the list deliberately: it is the
 * string every dedicated speech-to-text model mangled, and the one that proves
 * a hint was used rather than guessed.
 *
 * `npx tsx evals/live/jargon-recovery.mts`
 */

import { loadEnvLocal } from "../../src/env.js";

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

/** What the voice will say. Every one of these is a term the app really uses. */
const SENTENCE =
  "In Spideryarn, granularity zoom is the main idea, and the block id spya-k3m9qt " +
  "points at the paragraph about computational functionalism.";

/** Scored individually. The block id is the hard one. */
const TERMS = ["Spideryarn", "granularity zoom", "spya-k3m9qt", "computational functionalism"];

/** The list as `keywords` wants it — an array, one term per entry. */
const KEYWORDS = [
  "Spideryarn",
  "granularity zoom",
  "gist column",
  "spya-k3m9qt",
  "computational functionalism",
  "substrate independence",
  "qualia",
];

/** The same list as our current code sends it — one comma-separated string. */
const VOCABULARY_PROMPT = KEYWORDS.join(", ");

/** Scene-setting prose, which is what the guide says `prompt` is actually for. */
const SCENE = "A reader talking about an article they have open, using the app's own jargon.";

/** Speak the sentence once, as 24kHz mono PCM16, and reuse it for every arm. */
async function say(text: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      /* Raw samples at the rate realtime wants, so nothing has to be decoded or
         resampled on the way in — a resampler would be one more thing that
         could explain a bad result. */
      response_format: "pcm",
    }),
  });
  if (!res.ok) throw new Error(`tts failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

interface Arm {
  label: string;
  transcription: Record<string, unknown>;
}

const ARMS: Arm[] = [
  {
    label: "gpt-4o-transcribe, vocabulary in prompt   (today)",
    transcription: { model: "gpt-4o-transcribe", prompt: VOCABULARY_PROMPT },
  },
  {
    label: "gpt-live-transcribe, no hints at all      (floor)",
    transcription: { model: "gpt-live-transcribe" },
  },
  {
    label: "gpt-live-transcribe, vocabulary in prompt",
    transcription: { model: "gpt-live-transcribe", prompt: VOCABULARY_PROMPT },
  },
  {
    label: "gpt-live-transcribe, keywords array",
    transcription: { model: "gpt-live-transcribe", keywords: KEYWORDS },
  },
  {
    label: "gpt-live-transcribe, keywords + scene prompt",
    transcription: { model: "gpt-live-transcribe", keywords: KEYWORDS, prompt: SCENE },
  },
  {
    label: "gpt-transcribe, vocabulary in prompt",
    transcription: { model: "gpt-transcribe", prompt: VOCABULARY_PROMPT },
  },
  {
    label: "gpt-transcribe, keywords array",
    transcription: { model: "gpt-transcribe", keywords: KEYWORDS },
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
        audio: {
          input: {
            transcription: arm.transcription,
            /* Committed by hand, for the reason the sibling eval gives at
               length: a VAD that declines to open a turn produces a clean-
               looking result from a question that was never asked. */
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

async function transcribe(arm: Arm, pcm: Buffer): Promise<{ text: string; commits: number }> {
  const token = await mint(arm);
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${MODEL}`, [
    "realtime",
    `openai-insecure-api-key.${token}`,
  ]);
  let text = "";
  let commits = 0;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 25_000);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    };
    ws.onopen = () => {
      const slice = RATE * 0.1 * 2;
      for (let off = 0; off < pcm.length; off += slice) {
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: pcm.subarray(off, Math.min(off + slice, pcm.length)).toString("base64"),
          }),
        );
      }
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    };
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data)) as Record<string, unknown>;
      if (e.type === "input_audio_buffer.committed") commits++;
      if (e.type === "conversation.item.input_audio_transcription.completed") {
        text = String(e.transcript ?? "").trim();
        clearTimeout(timer);
        ws.close();
        resolve();
      }
      if (e.type === "error") {
        const err = e.error as { message?: string } | undefined;
        console.log(`    ! ${err?.message ?? "unknown"}`);
      }
    };
  });

  return { text, commits };
}

/** Case- and punctuation-insensitive containment, term by term. */
function recovered(text: string): string[] {
  const flat = text.toLowerCase().replace(/[^a-z0-9\s-]/g, "");
  return TERMS.filter((t) => flat.includes(t.toLowerCase()));
}

console.log(`Speaking one sentence with ${TERMS.length} jargon terms in it, then asking`);
console.log(`${MODEL} to transcribe it five ways.\n`);
console.log(`  "${SENTENCE}"\n`);

const pcm = await say(SENTENCE);
console.log(`(${(pcm.length / 2 / RATE).toFixed(1)}s of speech, reused for every arm)\n`);

for (const arm of ARMS) {
  console.log(arm.label);
  try {
    let text = "";
    let commits = 0;
    let tries = 0;
    while (tries < RETRIES && (commits === 0 || text === "")) {
      tries++;
      ({ text, commits } = await transcribe(arm, pcm));
    }
    if (commits === 0 || text === "") {
      console.log(`    !! no transcript after ${tries} attempt(s) — this arm measured nothing\n`);
      continue;
    }
    const got = recovered(text);
    const missed = TERMS.filter((t) => !got.includes(t));
    console.log(`    ${got.length}/${TERMS.length} terms   "${text.slice(0, 150)}"`);
    if (missed.length > 0) console.log(`    missed: ${missed.join(" · ")}`);
    console.log();
  } catch (err) {
    console.log(`    failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
