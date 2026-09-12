/**
 * **Where the time goes between pressing stop and the words arriving** — each leg
 * measured on its own, because Greg's report asked exactly that.
 *
 *   npx tsx scripts/spike-dictation-latency.ts [--out evals/dictation/results-latency.json]
 *
 * > I'm on an iPad on a not very good Wi-Fi. I don't know where that slowness is.
 * > Is it the transcription? I wonder if it's the upload.
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-39)
 *
 * The legs, in the order a dictation pays them:
 *
 * 1. **The recording** — how many bytes a second each container and bitrate
 *    produces, from Chrome's real `MediaRecorder` on the box. Several recorders
 *    listen to one playthrough at once, so every row heard identical audio.
 * 2. **The upload** — the app's own request body, POSTed from the page to a local
 *    sink under Chrome's network throttling (CDP `Network.emulateNetworkConditions`).
 *    The sink reads the body and answers at once, so this leg is the wire and
 *    nothing else.
 * 3. **The vocabulary** — the server-side read that precedes the model call.
 * 4. **The transcriber** — `transcribeWith`, the request path's own function, per
 *    encoding, with a fixed keyword list so the model time is not mixed with (3).
 *    OpenRouter's transcription endpoint does not stream (its API reference
 *    documents no `stream` parameter), so time-to-first-token *is* time-to-answer
 *    on this route, and that is what is timed.
 *
 * **What it is not**, the same caveats as scripts/spike-dictation-browser.ts:
 * synthetic `say` voices, no microphone (the box has none, so the recorders are
 * fed from Web Audio), and **Chrome's encoders, not an iPad's**. Safari's AAC
 * encoder is Apple's and its default bitrate is not measured here. And the
 * throttle is Chrome's model of a bad link — a fixed rate plus a fixed latency —
 * not packet loss on real Wi-Fi.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium } from "playwright-core";
import { type AudioFormat, formatOf } from "../src/dictation-limits.js";
import { loadEnvLocal } from "../src/env.js";
import { transcribeWith } from "../src/transcribe.js";
import { vocabularyTermsFor } from "../src/vocabulary-sources.js";
import { edits, has } from "../evals/dictation/score.js";

loadEnvLocal();

const CHROME = "/usr/bin/google-chrome-stable";
const CLIPS = path.join(import.meta.dirname, "../evals/dictation/clips");
const UTTERANCES = path.join(import.meta.dirname, "../evals/dictation/utterances.json");
const outArg = process.argv.indexOf("--out");
const OUT =
  outArg > 0 && process.argv[outArg + 1]
    ? process.argv[outArg + 1]!
    : path.join(import.meta.dirname, "../evals/dictation/results-latency.json");

/** Enough clips, played back to back, to make one ordinary dictation. */
const CLIP_IDS = ["site-terms", "fowler-names", "noema-glossary", "constitution-mixed"];

/**
 * What to record. The first row is what the app asks for today on Chrome and
 * Safari alike (`mic-recording.ts`'s `ATTEMPTS[0]`); the fifth is its fallback.
 * The AAC rows with a hint are here because a hint on AAC is what threw
 * `EncodingError` on 2026-08-27, and whether it still does decides whether the
 * cheap fix is available on the container Safari records.
 */
const CONFIGS: Array<{ label: string; type: string; bps?: number }> = [
  { label: "aac-default", type: "audio/mp4;codecs=mp4a.40.2" },
  { label: "aac-64k", type: "audio/mp4;codecs=mp4a.40.2", bps: 64_000 },
  { label: "aac-32k", type: "audio/mp4;codecs=mp4a.40.2", bps: 32_000 },
  { label: "aac-24k", type: "audio/mp4;codecs=mp4a.40.2", bps: 24_000 },
  { label: "opus-webm-32k", type: "audio/webm;codecs=opus", bps: 32_000 },
  { label: "opus-webm-24k", type: "audio/webm;codecs=opus", bps: 24_000 },
  { label: "opus-webm-16k", type: "audio/webm;codecs=opus", bps: 16_000 },
  { label: "opus-mp4-24k", type: "audio/mp4;codecs=opus", bps: 24_000 },
  /* **An iPad-sized recording, not an iPad's recording.** Headless Chrome on
     Linux has no AAC encoder at all (the four AAC rows above report "not
     supported" — measured 2026-09-12), and WebKit records at 192 kbps when no
     hint is given (`LargeAudioBitRate` in WebKit's MediaRecorderPrivate.cpp).
     The upload leg cares only about bytes, so Opus at the same rate stands in
     for its size — and says whether the transcriber slows down on a big file. */
  { label: "ipad-sized-192k", type: "audio/webm;codecs=opus", bps: 192_000 },
];

/**
 * Network profiles, in bytes per second and milliseconds. `fast-3g` and
 * `slow-3g` are DevTools' own presets; `weak-wifi` is a guess at Greg's link,
 * named as a guess.
 */
const PROFILES: Array<{ label: string; up: number; down: number; latency: number }> = [
  { label: "unthrottled", up: -1, down: -1, latency: 0 },
  { label: "weak-wifi", up: 125_000, down: 250_000, latency: 150 },
  { label: "fast-3g", up: 93_750, down: 180_000, latency: 562 },
  { label: "slow-3g", up: 50_000, down: 50_000, latency: 2000 },
];
/** Which recordings go up the wire. The rest only differ in the size column. */
const UPLOADS = ["ipad-sized-192k", "aac-default", "opus-webm-32k", "opus-webm-24k", "opus-webm-16k"];

interface Utterance {
  id: string;
  text: string;
  hard: string[];
}
const utterances = (JSON.parse(fs.readFileSync(UTTERANCES, "utf8")) as { utterances: Utterance[] })
  .utterances;
const chosen = CLIP_IDS.map((id) => {
  const u = utterances.find((x) => x.id === id);
  if (!u) throw new Error(`no utterance ${id}`);
  return u;
});
const REFERENCE = chosen.map((u) => u.text).join(" ");
const HARD = [...new Set(chosen.flatMap((u) => u.hard))];
/** What a vocabulary would carry: the hard terms plus the app's own. */
const KEYWORDS = [...new Set(["Spideryarn", "Greg Detre", ...HARD])];

/* **The scorer has to be able to fail**, or a 0.0% down the whole column is a
   property of the scorer rather than of the audio. The first run printed
   exactly that, so this refuses to go on unless a wrong answer scores badly. */
{
  const empty = edits(REFERENCE, "");
  const wrong = edits(REFERENCE, "the quick brown fox jumps over the lazy dog");
  const same = edits(REFERENCE, REFERENCE);
  if (same.edits !== 0 || empty.edits / empty.words < 0.99 || wrong.edits / wrong.words < 0.9)
    throw new Error("the WER scorer cannot tell a wrong transcript from a right one");
  if (HARD.filter((h) => has("nothing relevant here", h)).length !== 0)
    throw new Error("the hard-term check matches text that does not contain the terms");
}

/* ------------------------------------------------------------- the sink -- */

const sink = http.createServer((req, res) => {
  if (req.method === "POST") {
    let bytes = 0;
    req.on("data", (c: Buffer) => {
      bytes += c.length;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ bytes }));
    });
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body>dictation latency spike</body></html>");
});
await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
const port = (sink.address() as AddressInfo).port;

/* ------------------------------------------------------ leg 1: recording -- */

interface Recorded {
  label: string;
  asked: string;
  bps: number | null;
  supported: boolean;
  mimeType: string;
  bytes: number;
  base64: string;
  encodeMs: number;
  stopMs: number | null;
  error: string | null;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();
/* tsx compiles with `keepNames`, which wraps every named function below in a
   `__name(…)` helper that exists in Node and not in the page — so the first
   `page.evaluate` with a named arrow inside it dies on a ReferenceError. A
   string, because a function here would be compiled the same way. */
await page.addInitScript("window.__name = (f) => f;");
await page.goto(`http://127.0.0.1:${port}/`);

const clipData = CLIP_IDS.map((id) => fs.readFileSync(path.join(CLIPS, `${id}.webm`)).toString("base64"));
const { seconds, recorded } = await page.evaluate(
  async ({ clips, configs }) => {
    const ctx = new AudioContext({ sampleRate: 48_000 });
    const buffers: AudioBuffer[] = [];
    for (const data of clips) {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      buffers.push(await ctx.decodeAudioData(bytes.buffer as ArrayBuffer));
    }
    /* One mono buffer, back to back, with a short gap — a microphone track is
       mono, and mono is the case the AAC hint failed on. */
    const gap = Math.round(0.4 * ctx.sampleRate);
    const length = buffers.reduce((n, b) => n + b.length + gap, 0);
    const all = ctx.createBuffer(1, length, ctx.sampleRate);
    const out = all.getChannelData(0);
    let at = 0;
    for (const b of buffers) {
      for (let ch = 0; ch < b.numberOfChannels; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < d.length; i++) out[at + i]! += d[i]! / b.numberOfChannels;
      }
      at += b.length + gap;
    }
    const dest = ctx.createMediaStreamDestination();
    dest.channelCount = 1;
    const source = ctx.createBufferSource();
    source.buffer = all;
    source.connect(dest);

    type Slot = {
      label: string;
      asked: string;
      bps: number | null;
      supported: boolean;
      rec: MediaRecorder | null;
      parts: Blob[];
      error: string | null;
      stopMs: number | null;
    };
    const slots: Slot[] = configs.map((c) => {
      const slot: Slot = {
        label: c.label,
        asked: c.type,
        bps: c.bps ?? null,
        supported: MediaRecorder.isTypeSupported(c.type),
        rec: null,
        parts: [],
        error: null,
        stopMs: null,
      };
      if (!slot.supported) return slot;
      try {
        const rec = new MediaRecorder(dest.stream, {
          mimeType: c.type,
          ...(c.bps ? { audioBitsPerSecond: c.bps } : {}),
        });
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) slot.parts.push(e.data);
        };
        rec.onerror = (e) => {
          slot.error = (e as Event & { error?: DOMException }).error?.name ?? "error";
        };
        /* The app's timeslice, so the chunking overhead is the app's too. */
        rec.start(1000);
        slot.rec = rec;
      } catch (err) {
        slot.error = String(err);
      }
      return slot;
    });
    source.start();
    await new Promise((r) => setTimeout(r, (all.duration + 0.5) * 1000));
    await Promise.all(
      slots.map((s) => {
        const rec = s.rec;
        if (!rec || rec.state === "inactive") return Promise.resolve();
        return new Promise<void>((resolve) => {
          const t0 = performance.now();
          rec.onstop = () => {
            s.stopMs = performance.now() - t0;
            resolve();
          };
          rec.stop();
        });
      }),
    );
    await ctx.close();

    /* The app's own base64 (dictation-upload.ts), timed, because on a slow
       device it is part of the wait. */
    const base64 = (bytes: Uint8Array) => {
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const w = window as unknown as { __blobs: Record<string, Blob>; __b64: Record<string, string> };
    w.__blobs = {};
    w.__b64 = {};
    const results = [];
    for (const s of slots) {
      const mimeType = s.rec?.mimeType ?? "";
      const blob = new Blob(s.parts, { type: mimeType });
      const t0 = performance.now();
      const b64 = blob.size ? base64(new Uint8Array(await blob.arrayBuffer())) : "";
      const encodeMs = performance.now() - t0;
      w.__blobs[s.label] = blob;
      w.__b64[s.label] = b64;
      results.push({
        label: s.label,
        asked: s.asked,
        bps: s.bps,
        supported: s.supported,
        mimeType,
        bytes: blob.size,
        base64: b64,
        encodeMs,
        stopMs: s.stopMs,
        error: s.error,
      });
    }
    return { seconds: all.duration, recorded: results };
  },
  { clips: clipData, configs: CONFIGS },
);

console.log(`\n${seconds.toFixed(1)}s of speech (${CLIP_IDS.join(" + ")}), mono 48 kHz\n`);
console.log("LEG 1 — the recording (Chrome's MediaRecorder)");
console.log("  label             produced                        KB      KB/s   kbps  b64 KB  encode");
for (const r of recorded as Recorded[]) {
  const status = !r.supported ? "not supported" : r.error ? `ERROR ${r.error}` : "";
  console.log(
    `  ${r.label.padEnd(17)} ${(r.mimeType || "-").padEnd(30)} ${(r.bytes / 1024).toFixed(0).padStart(5)} ${(
      r.bytes / 1024 / seconds
    )
      .toFixed(1)
      .padStart(8)} ${((r.bytes * 8) / 1000 / seconds).toFixed(0).padStart(6)} ${(r.base64.length / 1024)
      .toFixed(0)
      .padStart(7)} ${r.encodeMs.toFixed(0).padStart(5)}ms ${status}`,
  );
}

/* --------------------------------------------------------- leg 2: upload -- */

const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
const uploads: Array<{ profile: string; label: string; body: "json" | "raw"; bytes: number; ms: number }> =
  [];
console.log("\nLEG 2 — the upload (the app's request body, to a sink, throttled)");
for (const profile of PROFILES) {
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latency,
    uploadThroughput: profile.up,
    downloadThroughput: profile.down,
  });
  const cases: Array<{ label: string; body: "json" | "raw" }> = [
    ...UPLOADS.map((label) => ({ label, body: "json" as const })),
    { label: "ipad-sized-192k", body: "raw" },
    { label: "opus-webm-24k", body: "raw" },
  ];
  for (const c of cases) {
    const rec = (recorded as Recorded[]).find((r) => r.label === c.label);
    if (!rec || rec.bytes === 0) continue;
    const format = formatOf(rec.mimeType);
    const got = await page.evaluate(
      async ({ label, body, format }) => {
        const w = window as unknown as { __blobs: Record<string, Blob>; __b64: Record<string, string> };
        const blob = w.__blobs[label]!;
        const init: RequestInit =
          body === "json"
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audio: w.__b64[label], format, context: { kind: "profile" } }),
              }
            : { method: "POST", headers: { "Content-Type": blob.type }, body: blob };
        const t0 = performance.now();
        const res = await fetch("/sink", init);
        const json = (await res.json()) as { bytes: number };
        return { ms: performance.now() - t0, bytes: json.bytes };
      },
      { label: c.label, body: c.body, format },
    );
    uploads.push({ profile: profile.label, label: c.label, body: c.body, ...got });
    console.log(
      `  ${profile.label.padEnd(12)} ${c.label.padEnd(15)} ${c.body.padEnd(5)} ${(got.bytes / 1024)
        .toFixed(0)
        .padStart(5)} KB  ${(got.ms / 1000).toFixed(2).padStart(6)}s`,
    );
  }
}
await browser.close();
sink.close();

/* ----------------------------------------------------- leg 3: vocabulary -- */

console.log("\nLEG 3 — the vocabulary (local store; production reads Supabase from Vercel)");
const vocab: Array<{ where: string; ms: number; terms: number | null; error?: string }> = [];
for (const where of [{ kind: "profile" as const }, { kind: "profile" as const }]) {
  const t0 = performance.now();
  try {
    const terms = await vocabularyTermsFor(where);
    vocab.push({ where: where.kind, ms: performance.now() - t0, terms: terms.length });
  } catch (err) {
    vocab.push({ where: where.kind, ms: performance.now() - t0, terms: null, error: String(err) });
  }
  const v = vocab.at(-1)!;
  console.log(`  ${v.where.padEnd(10)} ${v.ms.toFixed(0).padStart(5)}ms  ${v.terms ?? v.error} terms`);
}

/* ---------------------------------------------------- leg 4: transcriber -- */

console.log("\nLEG 4 — the transcriber (transcribeWith, from the box to OpenRouter)");
const transcribed: Array<{
  label: string;
  run: number;
  ms: number;
  wer: number | null;
  hardHit: number;
  hardOf: number;
  text: string;
  error?: string;
}> = [];
for (const r of recorded as Recorded[]) {
  if (r.bytes === 0) continue;
  const format = formatOf(r.mimeType) as AudioFormat | null;
  if (!format) continue;
  for (const run of [1, 2]) {
    const t0 = performance.now();
    try {
      const out = await transcribeWith(r.base64, format, KEYWORDS, { where: "spike" });
      const e = edits(REFERENCE, out.text);
      const hardHit = HARD.filter((h) => has(out.text, h)).length;
      transcribed.push({
        label: r.label,
        run,
        ms: performance.now() - t0,
        wer: e.words ? e.edits / e.words : null,
        hardHit,
        hardOf: HARD.length,
        text: out.text,
      });
    } catch (err) {
      transcribed.push({
        label: r.label,
        run,
        ms: performance.now() - t0,
        wer: null,
        hardHit: 0,
        hardOf: HARD.length,
        text: "",
        error: String((err as Error).message ?? err),
      });
    }
    const t = transcribed.at(-1)!;
    console.log(
      `  ${r.label.padEnd(15)} run ${run}  ${(t.ms / 1000).toFixed(2).padStart(5)}s  WER ${
        t.wer === null ? "  -  " : (t.wer * 100).toFixed(1).padStart(5)
      }%  hard ${t.hardHit}/${t.hardOf} ${t.error ?? ""}`,
    );
  }
}

fs.writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      readme:
        "Written by scripts/spike-dictation-latency.ts. Chrome's encoders on the Hetzner box, synthetic speech, Chrome's network throttle. See docs/plans/260912b-dictation-slow-on-weak-wifi.md.",
      at: new Date().toISOString(),
      chrome: browser.version(),
      seconds,
      clips: CLIP_IDS,
      recorded: (recorded as Recorded[]).map(({ base64, ...rest }) => ({ ...rest, base64Chars: base64.length })),
      uploads,
      vocab,
      transcribed,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nwrote ${path.relative(process.cwd(), OUT)}`);
