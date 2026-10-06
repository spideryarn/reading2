/**
 * **The fetch step's candidate loop, against live arXiv.** Free: no model.
 *
 *   npx tsx evals/arxiv-html-vs-pdf/fetch-step-live.ts [<address> …]
 *
 * For each address: what `resolvePaperSource` makes of it, then
 * `fetchFirstCandidate` with the real `fetchDocument`, exactly as the `fetch`
 * step calls it (src/pipeline.ts). It prints which candidate was used, what
 * kind of document came back, its size and, for a PDF, its page count.
 *
 * With no arguments it runs the link from report spya-ayettj, a paper arXiv
 * has no HTML for, an old-style id, and an ordinary page as the control.
 */
import { fetchDocument } from "../../src/fetch.js";
import { normaliseUrl, slugFromUrl, urlKey } from "../../src/ingest.js";
import { resolvePaperSource } from "../../src/paper-sources.js";
import { pass0 } from "../../src/pdf.js";
import { fetchFirstCandidate } from "../../src/pipeline.js";

const DEFAULTS = [
  "https://arxiv.org/abs/2608.13566?utm_campaign=ai-tinkerers__paperclub&utm_content=link1&utm_medium=ai-tinkerers&utm_source=paperclub",
  "arxiv.org/html/2609.28681v1",
  "https://arxiv.org/pdf/hep-th/9901001.pdf",
  "https://example.com/",
];

const given = process.argv.slice(2);
for (const raw of given.length > 0 ? given : DEFAULTS) {
  const url = normaliseUrl(raw);
  const paper = resolvePaperSource(url);
  console.log(`\n${raw.slice(0, 80)}`);
  console.log(`  key ${urlKey(url)}   slug ${slugFromUrl(url)}   source ${paper?.source ?? "(none)"}`);
  const candidates = paper?.candidates ?? [{ url }];
  console.log(`  candidates: ${candidates.map((c) => c.url).join("  then  ")}`);
  try {
    const { doc, candidate, tried } = await fetchFirstCandidate(candidates, {
      signal: new AbortController().signal,
      fetchDocument,
    });
    const pages = doc.kind === "pdf" ? `, ${(await pass0(new Uint8Array(doc.bytes))).pages.length} pages` : "";
    console.log(
      `  used ${candidate.url} (tried ${tried}): ${doc.kind}, ${Math.round(doc.bytes.byteLength / 1024)} KB${pages}, final ${doc.url}`,
    );
  } catch (err) {
    console.log(`  failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  /* arXiv asks scripts for no more than one request every three seconds. */
  await new Promise((r) => setTimeout(r, 3000));
}
process.exit(0);
