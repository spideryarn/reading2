/**
 * Judge the bake-off — through **the production checker**, not a copy of it.
 *
 *   npx tsx evals/pdf/bakeoff/score.mts
 *   npx tsx evals/pdf/bakeoff/score.mts much-harder     # one document
 *
 * It used to be a second implementation of the same idea living in this file,
 * and that is how the bake-off shipped a result its own scoring could not see:
 * the copy grouped records by the page the *model* claimed, so a page emitted
 * nowhere produced no row rather than a zero. Two reviewers found it
 * independently. A scorer that only ever runs on the eval is a scorer nobody
 * fixes, so this now calls src/pdf-score.ts — which has tests — and does
 * nothing but load files and print a table.
 *
 * **Read this before reading its numbers.** The saved responses in
 * scratch-bakeoff/ were produced by the bake-off's older prompt, which told the
 * model to LEAVE OUT footnotes and references. The baseline still contains them.
 * So a legitimate exclusion shows up here as a missing run, and the failures
 * below over-count. The production prompt transcribes and labels them instead —
 * src/pdf.ts § RecordType — which is what makes the run gate affordable at all.
 */
import "../../../src/env.js";
import { readdir, readFile } from "node:fs/promises";
import { pass0, type PdfRecord } from "../../../src/pdf.js";
import { check } from "../../../src/pdf-score.js";
import { DOCS } from "./docs.mjs";

const OUT = process.env.BAKEOFF_OUT ?? "scratch-bakeoff";
const only = process.argv[2];

const files = (await readdir(OUT)).filter((f) => /\.c\d+\./.test(f));

console.log("doc          ch  reader                    pages   recall   prec  order  runs  invented  covered");
for (const doc of DOCS.filter((d) => !only || d.name === only)) {
  const pass = await pass0(doc.file);
  for (const file of files.filter((f) => f.startsWith(`${doc.name}.c`)).sort()) {
    const saved = JSON.parse(await readFile(`${OUT}/${file}`, "utf-8"));
    if (!saved.records) continue;
    const chunk = doc.chunks[saved.chunk];
    if (!chunk) continue;
    const records = saved.records as PdfRecord[];
    const result = check(records, chunk.pages, pass);
    const scored = result.pages.filter((p) => p.recall !== null);
    const mean = (pick: (p: (typeof scored)[number]) => number | null) =>
      scored.length ? (scored.reduce((a, p) => a + (pick(p) ?? 0), 0) / scored.length).toFixed(3) : "    —";
    const label = file.replace(`${doc.name}.c${saved.chunk}.`, "").replace(/\.json$/, "");
    console.log(
      `${doc.name.padEnd(12)} ${String(saved.chunk).padStart(2)}  ${label.padEnd(24)} ` +
        `${[...new Set(records.map((r) => r.page))].sort((a, b) => a - b).join("+").padEnd(6)} ` +
        `${String(mean((p) => p.recall)).padStart(6)} ${String(mean((p) => p.precision)).padStart(6)} ` +
        `${String(mean((p) => p.order)).padStart(6)}  ${String(result.pages.reduce((a, p) => a + p.spans.length, 0)).padStart(4)}  ` +
        `${String(result.pages.reduce((a, p) => a + p.invented.length, 0)).padStart(8)}  ` +
        `${result.coverage.missing.length || result.coverage.blank.length ? `NO: ${[...result.coverage.missing, ...result.coverage.blank].join(",")}` : "yes"}`,
    );
  }
}
