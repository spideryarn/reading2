/**
 * **The cheap screen for plan 261001b**: in each arm's Simple level, how many
 * sentences explain a term the readers.json reader already knows ("…, called
 * large language models", "a neural network, which is…"). A screen, not a
 * verdict — prompting-guide.md § Measuring. Free.
 *
 *   npx tsx evals/simple/screen.ts <arm>...
 */
import fs from "node:fs";
import path from "node:path";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const KNOWN = /(language model|LLM|neural network|neuron|parameter|gradient|training|compute|entropy|mutual information)/i;
const EXPLAINS = /(called|known as|which (is|are)|a type of|that is,|meaning|means|in other words|think of)/i;

for (const arm of process.argv.slice(2)) {
  let sentences = 0;
  let hits = 0;
  const examples: string[] = [];
  for (const f of fs.readdirSync(path.join(RESULTS, arm)).filter((x) => x.endsWith(".json"))) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS, arm, f), "utf8")) as {
      ok: boolean;
      paragraphs?: { text: string }[];
    };
    if (!r.ok) continue;
    for (const p of r.paragraphs ?? []) {
      for (const s of p.text.split(/(?<=[.!?])\s+/)) {
        sentences += 1;
        if (KNOWN.test(s) && EXPLAINS.test(s)) {
          hits += 1;
          if (examples.length < 2) examples.push(s.slice(0, 140));
        }
      }
    }
  }
  console.log(`${arm.padEnd(22)} ${hits}/${sentences} sentences explain a known term`);
  for (const e of examples) console.log(`    e.g. ${e}`);
}
