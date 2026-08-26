/**
 * One reader, one chunk, in full — the failure sentences and the missing runs,
 * rather than the row. `score.mts` says which reader to look at; this says why.
 *
 *   npx tsx evals/pdf/bakeoff/detail.mts harder 1 gpt-luna.n1
 */
import "../../../src/env.js";
import { readFile } from "node:fs/promises";
import { pass0, type PdfRecord } from "../../../src/pdf.js";
import { check, report } from "../../../src/pdf-score.js";
import { DOCS } from "./docs.mjs";

const OUT = process.env.BAKEOFF_OUT ?? "scratch-bakeoff";
const [name, chunkArg, reader] = process.argv.slice(2);
const doc = DOCS.find((d) => d.name === name);
if (!doc || chunkArg === undefined || !reader) {
  console.error("Usage: tsx evals/pdf/bakeoff/detail.mts <doc> <chunk> <reader-label>");
  process.exit(1);
}
const chunk = doc.chunks[Number(chunkArg)]!;
const saved = JSON.parse(await readFile(`${OUT}/${name}.c${chunkArg}.${reader}.json`, "utf-8"));
const result = check(saved.records as PdfRecord[], chunk.pages, await pass0(doc.file));
console.log(`${name} c${chunkArg} ${reader} — ${chunk.why}\n`);
console.log(report(result));
for (const page of result.pages) {
  if (page.spans.length) {
    console.log(`\npage ${page.page}, ${page.spans.length} missing run(s):`);
    for (const s of page.spans.slice(0, 6)) console.log(`  ${s.words}w (${s.lost} gone)  ${s.text.slice(0, 150)}`);
  }
  if (page.invented.length) console.log(`\npage ${page.page} invented: ${page.invented.join(" ")}`);
}
