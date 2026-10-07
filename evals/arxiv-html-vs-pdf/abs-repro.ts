/**
 * **What an arXiv abstract-page link imported as, before plan 261005l.**
 *
 *   npx tsx evals/arxiv-html-vs-pdf/abs-repro.ts
 *
 * Greg's link from report spya-ayettj, through the same three steps the queue
 * takes: `normaliseUrl`, `fetchDocument`, `runExtract`, `splitIntoBlocks`.
 * Free: no model. It prints what would have been the article.
 */
import { splitIntoBlocks } from "../../src/blocks.js";
import { runExtract } from "../../src/extract.js";
import { fetchDocument } from "../../src/fetch.js";
import { normaliseUrl, slugFromUrl, urlKey } from "../../src/ingest.js";

const raw =
  "https://arxiv.org/abs/2608.13566?utm_campaign=ai-tinkerers__paperclub__join-our-paper-club-with-jetbrains-research-the-benchmark-trap-does-coding-benchmark-performance-generalize&utm_content=link1&utm_medium=ai-tinkerers&utm_source=paperclub";
const url = normaliseUrl(raw);
console.log(`normalised: ${url.slice(0, 70)}…`);
console.log(`slug: ${slugFromUrl(url)}   key: ${urlKey(url)}`);
const doc = await fetchDocument(url);
console.log(`kind: ${doc.kind}   final: ${doc.url.slice(0, 60)}…   bytes: ${doc.bytes.byteLength}`);
const out = await runExtract({ html: doc.text ?? "", url: doc.url, slug: "abs-repro" });
const { blocks } = splitIntoBlocks(out.extractedHtml);
console.log(`title: ${out.meta.title}`);
console.log(`words: ${blocks.reduce((n, b) => n + b.words, 0)}   blocks: ${blocks.length}`);
for (const b of blocks) console.log(` - ${b.kind} | ${b.text.slice(0, 100).replace(/\n/g, " ")}`);
process.exit(0);
