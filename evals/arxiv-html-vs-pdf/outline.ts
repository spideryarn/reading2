/**
 * **One arm's extracted page, as the blocks a reader would get.**
 *
 *   npx tsx evals/arxiv-html-vs-pdf/outline.ts output/arxiv-eval/<file>.html [from] [to] [width]
 *
 * Prints each block's index, kind, word count and the start of its text, so two
 * arms of one paper can be read side by side. Free; reads a file `run.ts` wrote.
 */
import { readFile } from "node:fs/promises";

import { splitIntoBlocks } from "../../src/blocks.js";

const [file, from = "0", to = "100000", width = "110"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npx tsx evals/arxiv-html-vs-pdf/outline.ts <extracted.html> [from] [to] [width]");
  process.exit(1);
}
const { blocks } = splitIntoBlocks(await readFile(file, "utf-8"));
const kinds = new Map<string, number>();
for (const b of blocks) kinds.set(b.kind, (kinds.get(b.kind) ?? 0) + 1);
console.log(`${blocks.length} blocks: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
blocks.slice(Number(from), Number(to)).forEach((b, i) => {
  console.log(
    `${String(i + Number(from)).padStart(4)} ${b.kind.padEnd(8)} ${String(b.words).padStart(4)}w | ${b.text.slice(0, Number(width)).replace(/\s+/g, " ")}`,
  );
});
process.exit(0);
