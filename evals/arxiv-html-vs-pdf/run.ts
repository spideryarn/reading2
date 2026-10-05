/**
 * **arXiv's HTML rendering against its PDF, through our own two extractors.**
 *
 *   npx tsx evals/arxiv-html-vs-pdf/run.ts [--html-only] <arxiv id> [<arxiv id> …]
 *
 * For each paper it fetches `arxiv.org/html/<id>` and `arxiv.org/pdf/<id>`
 * through `fetchDocument` (the pipeline's own stage 1), runs each through the
 * extractor stage 2 would pick for it (`runExtract` for HTML, `runPdfExtract`
 * for the PDF), splits the result into blocks with stage 3's `splitIntoBlocks`,
 * and counts what a reader would get: words, headings, maths spans, figures,
 * tables, reference entries. Both arms are also compared, word for word,
 * against the PDF's own free text layer (`pass0`), which neither arm produced.
 *
 * **The PDF arm is paid** (a model reads the pages); the HTML arm is free.
 * `--html-only` skips the paid arm. Spend is recorded in the ledger under the
 * `eval` scope and printed per paper.
 *
 * It writes each arm's extracted page to `output/arxiv-eval/` (gitignored: it
 * is the papers' prose, regenerable) and the numbers to
 * `evals/results/arxiv-html-vs-pdf-<date>/results.json`.
 *
 * The write-up is docs/investigations/261005e-arxiv-html-rendering-against-its-pdf.md.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { collectSpend, formatNanos, totalSpend } from "../../src/ai-spend.js";
import { splitIntoBlocks } from "../../src/blocks.js";
import { loadEnvLocal } from "../../src/env.js";
import { runExtract } from "../../src/extract.js";
import { FetchFailure, fetchDocument } from "../../src/fetch.js";
import { jsdom } from "../../src/jsdom-lazy.js";
import { modelFor } from "../../src/models.js";
import { environmentOwnerId } from "../../src/owner.js";
import { pass0 } from "../../src/pdf.js";
import { openRouterAuthorsReader } from "../../src/pdf-authors.js";
import { openRouterFrontMatterReader } from "../../src/pdf-frontmatter.js";
import { runPdfExtract } from "../../src/pdf-read.js";
import { comparisonWords } from "../../src/pdf-score.js";
import { costStore } from "../../src/store/ai-calls.js";
import { nullCheckpointStore } from "../../src/store/checkpoints.js";
import type { Block } from "../../src/types.js";

interface ArmCounts {
  words: number;
  blocks: number;
  headings: number;
  /** `\(…\)` spans in block text. */
  inlineMaths: number;
  /** `\[…\]` spans in block text. */
  displayMaths: number;
  /** `<math>` elements left in the page: maths that did not become TeX. */
  mathmlLeft: number;
  figures: number;
  /** `<img>` elements with a src, anywhere in the page. */
  images: number;
  /** PDF figure markers (the picture is recovered two stages later, or not). */
  pdfFigureMarkers: number;
  tables: number;
  tableCells: number;
  /** Blocks after the last heading that reads References / Bibliography. */
  referenceBlocks: number;
  /** Share of the PDF text layer's words (as a multiset) found in this arm. */
  recallVsTextLayer: number | null;
  /** Share of this arm's words found in the PDF text layer. */
  precisionVsTextLayer: number | null;
}

interface ArmResult {
  ok: boolean;
  /** A failure's code or message, when `ok` is false. */
  why?: string;
  finalUrl?: string;
  fetchMs?: number;
  bytes?: number;
  extractMs?: number;
  costUsd?: number;
  modelCalls?: number;
  title?: string;
  counts?: ArmCounts;
  /** The PDF extractor's own per-page recall, for the PDF arm. */
  pdfRecall?: number | null;
  pages?: number;
}

function multiset(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

/** |a ∩ b| / |a|, as multisets. */
function share(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  let hit = 0;
  for (const [w, n] of a) {
    total += n;
    hit += Math.min(n, b.get(w) ?? 0);
  }
  return total === 0 ? 0 : Math.round((hit / total) * 1000) / 1000;
}

function count(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

function countsOf(extractedHtml: string, blocks: Block[], textLayer: Map<string, number> | null): ArmCounts {
  const { JSDOM } = jsdom();
  const doc = new JSDOM(extractedHtml).window.document;
  const text = blocks.map((b) => b.text).join("\n");
  let lastRefs = -1;
  blocks.forEach((b, i) => {
    if (b.kind === "heading" && /^\W*(?:\d+\.?\s*)?(references|bibliography|works cited)\W*$/i.test(b.text)) lastRefs = i;
  });
  let referenceBlocks = 0;
  if (lastRefs >= 0) {
    for (const b of blocks.slice(lastRefs + 1)) {
      if (b.kind === "heading") break;
      referenceBlocks += 1;
    }
  }
  const mine = multiset(comparisonWords(text));
  return {
    words: blocks.reduce((n, b) => n + b.words, 0),
    blocks: blocks.length,
    headings: blocks.filter((b) => b.kind === "heading").length,
    inlineMaths: count(text, /\\\(/g),
    displayMaths: count(text, /\\\[/g),
    mathmlLeft: doc.querySelectorAll("math").length,
    figures: doc.querySelectorAll("figure").length,
    images: doc.querySelectorAll("img[src]").length,
    pdfFigureMarkers: doc.querySelectorAll("[data-spya-pdf-figure]").length,
    tables: doc.querySelectorAll("table").length,
    tableCells: doc.querySelectorAll("td, th").length,
    referenceBlocks,
    recallVsTextLayer: textLayer ? share(textLayer, mine) : null,
    precisionVsTextLayer: textLayer ? share(mine, textLayer) : null,
  };
}

async function timedFetch(url: string) {
  const started = Date.now();
  try {
    const doc = await fetchDocument(url);
    return { ok: true as const, doc, ms: Date.now() - started };
  } catch (err) {
    if (!(err instanceof FetchFailure)) throw err;
    return { ok: false as const, why: `${err.code}${err.status ? ` ${err.status}` : ""}`, ms: Date.now() - started };
  }
}

const OUT = path.join("output", "arxiv-eval");

async function onePaper(id: string, htmlOnly: boolean): Promise<{ id: string; html: ArmResult; pdf: ArmResult }> {
  const slug = id.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  console.log(`\n=== ${id}`);

  const pdfFetch = await timedFetch(`https://arxiv.org/pdf/${id}`);
  const htmlFetch = await timedFetch(`https://arxiv.org/html/${id}`);

  let textLayer: Map<string, number> | null = null;
  let pages: number | undefined;
  if (pdfFetch.ok && pdfFetch.doc.kind === "pdf") {
    const pass = await pass0(pdfFetch.doc.bytes);
    pages = pass.pages.length;
    textLayer = multiset(comparisonWords(pass.pages.map((p) => p.text).join("\n")));
  }

  /* The HTML arm: free, no model. */
  let html: ArmResult;
  if (!htmlFetch.ok) {
    html = { ok: false, why: htmlFetch.why, fetchMs: htmlFetch.ms };
  } else if (htmlFetch.doc.kind !== "html" || htmlFetch.doc.text === null) {
    html = { ok: false, why: `served ${htmlFetch.doc.kind}`, fetchMs: htmlFetch.ms };
  } else {
    const started = Date.now();
    try {
      const out = await runExtract({ html: htmlFetch.doc.text, url: htmlFetch.doc.url, slug: `${slug}-html` });
      const { blocks } = splitIntoBlocks(out.extractedHtml);
      const extractMs = Date.now() - started;
      await writeFile(path.join(OUT, `${slug}.html-arm.html`), out.extractedHtml, "utf-8");
      await writeFile(path.join(OUT, `${slug}.source.html`), htmlFetch.doc.text, "utf-8");
      html = {
        ok: true,
        finalUrl: htmlFetch.doc.url,
        fetchMs: htmlFetch.ms,
        bytes: htmlFetch.doc.bytes.byteLength,
        extractMs,
        costUsd: 0,
        modelCalls: 0,
        title: out.meta.title,
        counts: countsOf(out.extractedHtml, blocks, textLayer),
      };
    } catch (err) {
      html = { ok: false, why: err instanceof Error ? `${err.name}: ${err.message}` : String(err), fetchMs: htmlFetch.ms };
    }
  }
  console.log(`  html: ${JSON.stringify(html)}`);

  /* The PDF arm: a model reads the pages. */
  let pdf: ArmResult;
  if (!pdfFetch.ok) {
    pdf = { ok: false, why: pdfFetch.why, fetchMs: pdfFetch.ms };
  } else if (pdfFetch.doc.kind !== "pdf") {
    pdf = { ok: false, why: "served html", fetchMs: pdfFetch.ms };
  } else if (htmlOnly) {
    await writeFile(path.join(OUT, `${slug}.pdf`), pdfFetch.doc.bytes);
    pdf = { ok: false, why: "skipped (--html-only)", fetchMs: pdfFetch.ms, bytes: pdfFetch.doc.bytes.byteLength, pages };
  } else {
    const bytes = pdfFetch.doc.bytes;
    await writeFile(path.join(OUT, `${slug}.pdf`), bytes);
    const started = Date.now();
    try {
      const { result: out, report } = await collectSpend(
        () =>
          runPdfExtract({
            frontMatter: openRouterFrontMatterReader(modelFor("pdf-frontmatter", "standard")),
            authors: openRouterAuthorsReader(modelFor("pdf-frontmatter", "standard")),
            bytes: new Uint8Array(bytes),
            url: pdfFetch.doc.url,
            checkpoints: nullCheckpointStore(),
            slug: `${slug}-pdf`,
          }),
        { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
      );
      const extractMs = Date.now() - started;
      const { blocks } = splitIntoBlocks(out.extractedHtml);
      await writeFile(path.join(OUT, `${slug}.pdf-arm.html`), out.extractedHtml, "utf-8");
      const { nanos, unpriced } = totalSpend(report.calls);
      console.log(`  pdf spend: ${formatNanos(nanos)} over ${report.calls.length} call(s), ${unpriced} unpriced`);
      pdf = {
        ok: true,
        finalUrl: pdfFetch.doc.url,
        fetchMs: pdfFetch.ms,
        bytes: bytes.byteLength,
        extractMs,
        costUsd: Math.round((nanos / 1e9) * 10000) / 10000,
        modelCalls: report.calls.length,
        title: out.meta.title,
        counts: countsOf(out.extractedHtml, blocks, textLayer),
        pdfRecall: out.recall,
        pages: out.pages,
      };
    } catch (err) {
      pdf = {
        ok: false,
        why: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        fetchMs: pdfFetch.ms,
        extractMs: Date.now() - started,
        pages,
      };
    }
  }
  console.log(`  pdf:  ${JSON.stringify(pdf)}`);
  return { id, html, pdf };
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const htmlOnly = args.includes("--html-only");
  const ids = args.filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    console.error("Usage: npx tsx evals/arxiv-html-vs-pdf/run.ts [--html-only] <arxiv id> …");
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const resultsDir = path.join("evals", "results", "arxiv-html-vs-pdf-261005");
  await mkdir(resultsDir, { recursive: true });
  const resultsFile = path.join(resultsDir, "results.json");
  /* Merged by id, so a paper can be re-run without re-buying the others. */
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(resultsFile, "utf-8")) as Record<string, unknown>;
  } catch {
    /* First run. */
  }
  for (const id of ids) {
    const row = await onePaper(id, htmlOnly);
    const before = existing[id] as { pdf?: ArmResult } | undefined;
    /* An `--html-only` re-run keeps the paid arm already bought. */
    if (htmlOnly && before?.pdf?.ok) row.pdf = before.pdf;
    existing[id] = { ...row, ranAt: new Date().toISOString() };
    await writeFile(resultsFile, `${JSON.stringify(existing, null, 2)}\n`, "utf-8");
    /* arXiv asks for no more than one request every three seconds from a script. */
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`\nWritten: ${resultsFile}`);
  /* pdf.js and undici keep handles open. */
  process.exit(0);
}

await main();
