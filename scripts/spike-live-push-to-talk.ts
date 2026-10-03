/**
 * **Tap to talk against OpenAI's real Realtime server**, over a WebSocket.
 *
 *   npx tsx scripts/spike-live-push-to-talk.ts
 *
 * Plan 261003d (spya-kzdmhb) turns the voice detector off for one call and
 * commits each turn by hand. The unit tests drive a fake wire, which agrees with
 * whatever the hook sends, so they cannot say whether the service accepts it.
 * This asks the service. The event protocol is the same over a WebSocket as over
 * the browser's WebRTC data channel; only the audio transport differs, which is
 * why the audio here is appended as base64 rather than sent as a track.
 *
 * It answers, in order:
 *
 *  A. **Does continuous noise hold a semantic-VAD turn open?** The session is
 *     configured exactly as `liveSession` configures a reader's (laptop
 *     placement), then fed fifteen seconds of noise at real-time pace and three
 *     of silence. Prints every `speech_started`, `speech_stopped` and
 *     `committed`, with the time each arrived.
 *  B. **Is a partial `session.update` with `turn_detection: null` accepted, and
 *     does it leave the rest of the session alone?** Compares the echoed
 *     session's instructions, transcription and noise reduction with A's.
 *  C. **Does an error name the client event that caused it?** Commits an empty
 *     buffer under an `event_id` and prints `error.event_id`.
 *  D. **Does a hand-made turn come back as a normal turn?** Appends one spoken
 *     sentence (OpenAI TTS, `pcm` is 24 kHz 16-bit mono, the Realtime input
 *     format), commits it, waits for `committed`, then `response.create`, and
 *     prints the reader's transcription and the reply's.
 *
 * Costs a few cents. Writes nothing.
 */

import { loadEnvLocal } from "../src/env.js";
import { LIVE_MODEL, liveSession } from "../src/live.js";
import type { Block, Meta } from "../src/types.js";

loadEnvLocal();
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY is not set");

const RATE = 24_000;
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

type Ev = Record<string, unknown> & { type: string };

/** Fifteen seconds of something like traffic: brown noise, which is mostly low rumble. */
function noise(seconds: number, amplitude: number): Int16Array {
  const out = new Int16Array(Math.round(seconds * RATE));
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(last * 3.5 * amplitude * 32767)));
  }
  return out;
}

const b64 = (pcm: Int16Array) => Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString("base64");

async function speech(text: string): Promise<Int16Array> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

async function main() {
  const spoken = await speech("What does the author mean by entropy in the second section?");
  console.log(`[${at()}] speech clip: ${(spoken.length / RATE).toFixed(1)}s`);
  const babble = await speech(
    "So I told him we would meet at the corner by the bakery, and then the bus was late again, honestly every single morning this week, and she said she would call me back after lunch.",
  );

  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${LIVE_MODEL}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  } as unknown as string[]);
  const seen: Ev[] = [];
  const waiters: { test: (e: Ev) => boolean; resolve: (e: Ev) => void }[] = [];
  ws.addEventListener("message", (m) => {
    const e = JSON.parse(String(m.data)) as Ev;
    seen.push(e);
    if (/speech_started|speech_stopped|committed|^error$|session\.updated|response\.created|response\.done/.test(e.type)) {
      const extra = e.type === "error" ? ` ${JSON.stringify(e.error)}` : "";
      console.log(`[${at()}] ← ${e.type}${extra}`);
    }
    for (const w of [...waiters]) {
      if (w.test(e)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(e);
      }
    }
  });
  const next = (test: (e: Ev) => boolean, ms = 30_000) =>
    new Promise<Ev | null>((resolve) => {
      const w = { test, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        resolve(null);
      }, ms);
    });
  const send = (e: Record<string, unknown>) => ws.send(JSON.stringify(e));
  await new Promise((r, j) => {
    ws.addEventListener("open", r);
    ws.addEventListener("error", j);
  });
  console.log(`[${at()}] connected to ${LIVE_MODEL}`);

  /* The reader's session, as src/live.ts mints it, minus the model (it is in the URL). */
  const meta = { slug: "spike", title: "A spike about entropy" } as Meta;
  const blocks = [{ id: "spya-aaaaaa", tag: "p", kind: "paragraph", text: "Entropy measures how many microstates fit one macrostate.", words: 8, html: "" }] as unknown as Block[];
  const { model: _model, ...config } = liveSession({ meta, blocks, placement: "laptop" });
  send({ type: "session.update", session: config });
  const first = await next((e) => e.type === "session.updated" || e.type === "error");
  const before = first?.session as { instructions?: string; audio?: { input?: Record<string, unknown> } } | undefined;
  console.log(`[${at()}] A. turn_detection: ${JSON.stringify(before?.audio?.input?.turn_detection)}`);

  /* A: noise at real-time pace, in 100 ms chunks, then silence. Brown noise
     alone (traffic rumble) was measured first and opened no turn at all — far
     field noise reduction takes it out. A street also has people in it, so
     the noise here is rumble plus other voices, quieter than a reader's. */
  const rumble = noise(15, 0.2);
  for (let i = 0; i < rumble.length; i++) {
    const v = (rumble[i] ?? 0) + Math.round(0.35 * (babble[i % babble.length] ?? 0));
    rumble[i] = Math.max(-32768, Math.min(32767, v));
  }
  const chunk = RATE / 10;
  for (let i = 0; i < rumble.length; i += chunk) {
    send({ type: "input_audio_buffer.append", audio: b64(rumble.subarray(i, i + chunk)) });
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`[${at()}] A. fifteen seconds of noise sent; now three of silence`);
  const quiet = new Int16Array(chunk);
  for (let i = 0; i < 30; i++) {
    send({ type: "input_audio_buffer.append", audio: b64(quiet) });
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 2_000));
  const count = (t: string) => seen.filter((e) => e.type === t).length;
  console.log(`[${at()}] A. speech_started ${count("input_audio_buffer.speech_started")}, speech_stopped ${count("input_audio_buffer.speech_stopped")}, committed ${count("input_audio_buffer.committed")}, responses ${count("response.created")}`);
  /* Let any reply A provoked finish before B, so it cannot collide with D's. */
  if (count("response.created") > count("response.done")) await next((e) => e.type === "response.done");

  /* B: the partial update tap to talk sends. */
  send({ type: "session.update", event_id: "spya-tap-1", session: { type: "realtime", audio: { input: { turn_detection: null } } } });
  const second = await next((e) => e.type === "session.updated" || e.type === "error");
  const after = second?.session as typeof before;
  console.log(`[${at()}] B. ${second?.type}: turn_detection ${JSON.stringify(after?.audio?.input?.turn_detection)}`);
  console.log(`[${at()}] B. instructions kept: ${after?.instructions === before?.instructions}; transcription kept: ${JSON.stringify(after?.audio?.input?.transcription) === JSON.stringify(before?.audio?.input?.transcription)}; noise_reduction kept: ${JSON.stringify(after?.audio?.input?.noise_reduction) === JSON.stringify(before?.audio?.input?.noise_reduction)}`);
  send({ type: "input_audio_buffer.clear", event_id: "spya-tap-2" });

  /* C: an empty commit. */
  send({ type: "input_audio_buffer.commit", event_id: "spya-tap-3" });
  const refused = await next((e) => e.type === "error" || e.type === "input_audio_buffer.committed", 10_000);
  console.log(`[${at()}] C. ${refused?.type ?? "nothing"}; error.event_id = ${JSON.stringify((refused?.error as { event_id?: unknown } | undefined)?.event_id)}`);

  /* D: a hand-made turn, with street noise either side of the sentence. */
  send({ type: "input_audio_buffer.clear", event_id: "spya-tap-4" });
  const turn = new Int16Array(spoken.length + RATE);
  turn.set(noise(0.5, 0.3), 0);
  turn.set(spoken, RATE / 2);
  turn.set(noise(0.5, 0.3), RATE / 2 + spoken.length);
  for (let i = 0; i < turn.length; i += chunk) send({ type: "input_audio_buffer.append", audio: b64(turn.subarray(i, i + chunk)) });
  send({ type: "input_audio_buffer.commit", event_id: "spya-tap-5" });
  const committed = await next((e) => e.type === "input_audio_buffer.committed" || e.type === "error");
  console.log(`[${at()}] D. ${committed?.type} item ${String(committed?.item_id ?? "")}`);
  const userItem = await next((e) => (e.type === "conversation.item.added" || e.type === "conversation.item.created") && (e.item as { role?: string } | undefined)?.role === "user", 5_000);
  console.log(`[${at()}] D. user item event: ${userItem?.type ?? "none"}`);
  send({ type: "response.create", event_id: "spya-tap-6" });
  const heard = next((e) => e.type === "conversation.item.input_audio_transcription.completed", 30_000);
  const done = await next((e) => e.type === "response.done", 60_000);
  const transcript = await heard;
  console.log(`[${at()}] D. reader said: ${JSON.stringify(transcript?.transcript ?? null)}`);
  const reply = seen.filter((e) => e.type === "response.output_audio_transcript.done").at(-1);
  console.log(`[${at()}] D. ${done ? `response.done ${String((done.response as { status?: string }).status)}` : "no response.done"}; reply: ${JSON.stringify(String(reply?.transcript ?? "").slice(0, 160))}`);
  const output = ((done?.response as { output?: { type?: string; name?: string; content?: { type?: string; transcript?: string; text?: string }[] }[] } | undefined)?.output ?? []);
  console.log(`[${at()}] D. reply output: ${JSON.stringify(output.map((o) => ({ type: o.type, name: o.name, content: o.content?.map((c) => ({ type: c.type, words: (c.transcript ?? c.text ?? "").slice(0, 80) })) })))}`);
  console.log(`[${at()}] D. speech_started after B: ${seen.slice(seen.indexOf(second as Ev)).filter((e) => e.type === "input_audio_buffer.speech_started").length} (should be 0 with the detector off)`);
  ws.close();
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
