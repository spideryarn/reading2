/**
 * **Does this dashboard's transcriber actually work, and is the vocabulary
 * actually reaching the model?**
 *
 *     npx tsx tools/fleet/probe-transcribe.ts
 *
 * Two paid calls, about $0.001, against the real OpenRouter endpoint. Run it
 * when anything about `transcribe.ts` or `vocabulary.ts` changes, and before
 * believing any claim that dictation on this page is working.
 *
 * ## Why an A/B and not a smoke test
 *
 * A smoke test would send one clip and print the transcript, and it would pass
 * identically whether the `keywords` array reached the model or was silently
 * dropped. That is not hypothetical: OpenRouter's chat route accepted a `prompt`
 * field for eleven days, answered `200`, and changed nothing — confirmed by
 * sending it a field called `wibble_not_a_real_field`, which also answered
 * `200`. docs/project/dictation.md § It transcribes twice.
 *
 * **So the evidence has to be the transcript changing**, not the status code. It
 * sends the same clip twice, once with the fleet vocabulary and once with none,
 * and prints both. If the two are identical, the vocabulary is not doing
 * anything and this dashboard's transcriber is one that has never heard the word
 * `worktree`.
 *
 * ## What it cannot tell you
 *
 * Nothing about a microphone. The clip is a committed file. Whether
 * `getUserMedia` opens a device on Greg's phone is not a question any process on
 * this box can answer — there is no audio input device here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FLEET_TERMS } from "./vocabulary.js";
import { transcribeForFleet } from "./transcribe.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/* The product's own eval clip. It says "Add this to Spideryarn please…", and
   `Spideryarn` is in FLEET_TERMS — so it is a word this tool's vocabulary claims
   to fix, spoken in a file that already exists. Nothing on this box can make a
   new clip: `say` is a Mac and there is no ffmpeg here either. */
const CLIP = path.join(here, "..", "..", "evals", "dictation", "clips", "site-terms.webm");

async function main(): Promise<void> {
  const audio = readFileSync(CLIP).toString("base64");
  console.log(`clip: ${path.relative(process.cwd(), CLIP)} (${Math.round(audio.length / 1024)} KB base64)`);

  for (const [label, vocabulary] of [
    ["with the fleet vocabulary", FLEET_TERMS],
    ["with NO vocabulary", [] as readonly string[]],
  ] as const) {
    const started = Date.now();
    const result = await transcribeForFleet({ audio, format: "webm", vocabulary });
    const ms = Date.now() - started;
    if (result.ok) console.log(`\n${label} (${ms} ms):\n  ${result.text}`);
    else console.log(`\n${label} (${ms} ms): FAILED ${result.status}\n  ${result.message}`);
  }

  console.log(
    "\nThe two lines above must DIFFER on 'Spideryarn'. If they are identical the\n" +
      "keywords array is not reaching the model, and a 200 does not say otherwise.",
  );
}

void main();
