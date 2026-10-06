/** Run with: node --import tsx docs/plans/261006f-preview-cost-probe.mjs
 * Synthetic timing evidence for the 261006f code review, not a performance gate.
 * Every sample recomputes an opening; the suffix contains many markdown blocks.
 */
import { answerOpening } from "../../src/answer-opening.js";

const paragraph = "Another **paragraph** with [a link](https://example.com).\n\n";
answerOpening(paragraph); // Warm the module/parser before measuring.
for (const kib of [4, 16, 32, 128, 512]) {
  const text = "Opening answer.\n\n" + paragraph.repeat(Math.ceil(kib * 1024 / paragraph.length));
  const durations = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    if (answerOpening(text) !== "Opening answer.") throw new Error("unexpected opening");
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  console.log(JSON.stringify({
    bytes: text.length,
    medianMs: +durations[2].toFixed(2),
    samplesMs: durations.map(n => +n.toFixed(2)),
  }));
}
