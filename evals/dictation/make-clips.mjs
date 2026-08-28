/**
 * Turn `utterances.json` into the audio the benchmark sends.
 *
 * `say` for the voice, `ffmpeg` for the container — Opus in WebM at 32 kbps,
 * because that is what Chrome's `MediaRecorder` hands us and a codec is not a
 * neutral pipe for a speech model. Both are on every Mac plus Homebrew.
 *
 *   node evals/dictation/make-clips.mjs
 *
 * The clips are committed, so nobody has to run this to re-run the benchmark.
 * Run it when the utterances change, or when you want to hear one.
 *
 * **What synthetic speech can and cannot settle** is set out in README.md and
 * is worth reading before quoting any number from here. The short of it: these
 * clips are good for whether telling a model the words fixes the spelling of
 * them, and good for nothing about accents, noise or mumbling.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const { utterances } = JSON.parse(fs.readFileSync(`${dir}utterances.json`, "utf8"));
fs.mkdirSync(`${dir}clips`, { recursive: true });

for (const u of utterances) {
  const aiff = `${dir}clips/${u.id}.aiff`;
  const webm = `${dir}clips/${u.id}.webm`;
  execFileSync("say", ["-v", u.voice, "-o", aiff, u.text]);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", aiff,
    "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1",
    webm,
  ]);
  fs.rmSync(aiff);
  const seconds = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", webm,
  ]).toString().trim();
  console.log(
    `${u.id.padEnd(26)} ${u.voice.padEnd(9)} ${Number(seconds).toFixed(1)}s  ` +
      `${(fs.statSync(webm).size / 1024).toFixed(0)} KB`,
  );
}
