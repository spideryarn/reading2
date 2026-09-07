/**
 * **A real browser, a real `MediaRecorder`, and the words that come back.**
 *
 *   npx tsx scripts/spike-dictation-browser.ts
 *
 * Dictation moved to a different endpoint on 2026-09-07
 * (docs/plans/260907c-dictation-onto-an-openai-transcriber.md), and the failure
 * that whole job was about is a transcription path that passes every unit test
 * and then fails on the bytes a browser actually produces. Nothing in `tests/`
 * can catch that: the suite stubs `fetch`, and the committed clips in
 * `evals/dictation/clips/` were made by `ffmpeg` on a Mac, not by Chrome.
 *
 * So this drives system Chrome on the box, records through the real
 * `MediaRecorder` in the real page context, and puts the resulting blob through
 * the real `transcribe()` — the same function the request path calls.
 *
 * ## Getting speech in without a microphone
 *
 * **There is no audio input device on this box**, and Chrome's fake one does not
 * rescue it: `--use-fake-device-for-media-capture`, with and without
 * `--use-file-for-fake-audio-capture`, gives `NotFoundError: Requested device
 * not found` in headless. Measured 2026-09-07, all three variants.
 *
 * So the microphone is skipped and the *encoder* is not, which is the right way
 * round — `getUserMedia` is not what this job put at risk. The page decodes the
 * committed clip with `decodeAudioData` (Chrome does webm/opus natively), plays
 * it into a `MediaStreamAudioDestinationNode`, and records **that** stream with
 * a real `MediaRecorder`. What comes out is bytes Chrome's own Opus encoder
 * wrote, in the container `mic-recording.ts` would have chosen, which is exactly
 * the artefact the unit tests cannot produce.
 *
 * **What it still is not:** synthetic speech, one voice, no room and no accent,
 * and no `getUserMedia`. It proves the *path*, never the ear. See
 * evals/dictation/README.md.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";
import { loadEnvLocal } from "../src/env.js";
import { transcribe } from "../src/transcribe.js";

loadEnvLocal();

const CHROME = "/usr/bin/google-chrome-stable";
const CLIP = path.join(import.meta.dirname, "../evals/dictation/clips/site-terms.webm");

/** The words the clip says, and the two that decide whether it worked. */
const HARD = ["Spideryarn", "spya-k3m9qt"];

function say(label: string, detail: string) {
  console.log(`${label.padEnd(34)} ${detail}`);
}

/**
 * Decode the committed clip, play it into a stream, and record that stream.
 *
 * The `mimeType` selection mirrors `src/web/mic-recording.ts`: it prefers
 * AAC-in-MP4 and falls back to WebM, so whatever comes back is what a reader on
 * this browser would send. It is **reported rather than assumed**, because the
 * container is the thing this whole job turned on — and because the format that
 * Safari and an iPad choose is precisely the one still unmeasured against this
 * endpoint (260907c § Open questions).
 */
async function recordThroughMediaRecorder(
  browser: Browser,
): Promise<{ base64: string; mimeType: string; seconds: number }> {
  const page = await browser.newPage();
  /* A real origin: Web Audio and `MediaRecorder` are both happier off
     `about:blank`, and file:// is blocked on this box. */
  await page.route("**/dictation-spike", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" }),
  );
  await page.goto("https://example.invalid/dictation-spike");

  const b64 = fs.readFileSync(CLIP).toString("base64");
  const out = await page.evaluate(async (data: string) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(bytes.buffer as ArrayBuffer);

    /* The whole point: a `MediaStream` with no device behind it, whose samples
       are the clip, handed to the same recorder the app uses. */
    const destination = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(destination);

    const preferred = [
      'audio/mp4;codecs="mp4a.40.2"',
      "audio/mp4",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(destination.stream, mimeType ? { mimeType } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && parts.push(e.data);

    rec.start();
    source.start();
    /* Real time, because `MediaRecorder` encodes in real time — there is no way
       to hurry it, and stopping early truncates the words. */
    await new Promise((r) => setTimeout(r, (buf.duration + 0.5) * 1000));
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    await ctx.close();

    const blob = new Blob(parts, { type: rec.mimeType });
    const raw = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of raw) binary += String.fromCharCode(byte);
    return { base64: btoa(binary), mimeType: rec.mimeType, seconds: buf.duration };
  }, b64);
  await page.close();
  return out;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let recorded: { base64: string; mimeType: string; seconds: number };
try {
  recorded = await recordThroughMediaRecorder(browser);
} finally {
  await browser.close();
}
say("clip decoded by Chrome", `${recorded.seconds.toFixed(1)}s`);

const bytes = Math.round((recorded.base64.length * 3) / 4);
say("MediaRecorder produced", `${recorded.mimeType}, ${(bytes / 1024).toFixed(0)} KB`);

/* `formatOf` is the app's own mapping and is deliberately not reimplemented
   here: a wrong `format` is not a rejection, it is a transcript of noise. */
const { formatOf } = await import("../src/dictation-limits.js");
const format = formatOf(recorded.mimeType);
if (!format) throw new Error(`no AudioFormat for ${recorded.mimeType}`);
say("mapped to AudioFormat", format);

const started = Date.now();
const out = await transcribe(recorded.base64, format, { kind: "profile" });
say("transcribed in", `${Date.now() - started}ms by ${out.answeredBy ?? out.model}`);
console.log(`\n  ${JSON.stringify(out.text)}\n`);

const missing = HARD.filter((term) => !out.text.toLowerCase().includes(term.toLowerCase()));
if (out.text.trim() === "") {
  console.log("FAILED — nothing came back. A real recorder blob was not transcribed.");
  process.exit(1);
}
say("hard terms", missing.length === 0 ? "both present" : `MISSING ${missing.join(", ")}`);
/* The vocabulary for `profile` does not carry an article's glossary, so a miss
   here is worth reporting and is not by itself a failure of the path. */
console.log(missing.length === 0 ? "\nPASS\n" : "\nPASS (path works; see hard terms above)\n");
