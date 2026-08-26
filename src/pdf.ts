/**
 * Pipeline stage 2, for a PDF — **pass 0: everything the file will tell us for
 * free.** See docs/plans/pdf-ingestion.md.
 *
 *   npx tsx src/pdf.ts evals/pdf/easy/source.pdf
 *
 * No model call, no network, no native binary, about 0.4 s for 17 pages. What
 * it produces is used four times over:
 *
 *   - the page count, so an 800-page book is refused with a sentence rather
 *     than a bill;
 *   - words per page, so "this is a scan with no text in it" is a fact we
 *     state rather than a surprise the model runs into;
 *   - the repeated lines — running headers, footers, page numbers — which the
 *     model is told to drop and which therefore must not count against it;
 *   - and the per-page text, which is the BASELINE every transcribed page is
 *     checked against. That is the whole reason this stage exists: a model
 *     transcribing a page can drop a paragraph, summarise one, or invent one,
 *     and all three read as fluent English. Only something that already knows
 *     what is on the page can tell.
 *
 * A scan has none of this, which is exactly why a scan is the hard case —
 * see docs/plans/pdf-ingestion.md#a-scan-with-no-text-layer.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

/** One text run as pdf.js found it: where it sits on the page, and what it says. */
export interface TextItem {
  /** Points from the left edge. Two clusters of these is what a two-column page looks like. */
  x: number;
  /** Points from the *bottom* edge — pdf.js uses PDF coordinates, so bigger is higher. */
  y: number;
  text: string;
}

export interface PageText {
  /** 1-based, and the number every later artefact addresses this page by. */
  page: number;
  /** Line breaks preserved; runs of spaces and tabs collapsed. */
  text: string;
  words: number;
  items: TextItem[];
}

export interface Pass0 {
  pages: PageText[];
  /**
   * True when the pages carry no extractable text — a photographic scan.
   *
   * Judged on the *content* pages rather than on all of them, because a
   * digitisation service's own generated rights page does carry text: the
   * Wellcome scan in evals/pdf/much-harder has 95 words in the whole file and
   * every one of them is on Wellcome's cover sheet. A test of "every page is
   * empty" says that document is not a scan, which is the opposite of true.
   */
  isScan: boolean;
  /**
   * Lines that repeat across pages: running headers, footers, page numbers.
   *
   * Normalised, because a running header carries the page number and so is
   * never byte-identical twice. The model is told to leave these out, so they
   * have to come out of the baseline too — otherwise a correct transcription
   * loses recall for obeying its instructions, and the threshold gets widened
   * to accommodate it until it stops catching anything.
   */
  furniture: Set<string>;
}

/** How many pages must share a line before it is furniture rather than prose. */
const FURNITURE_PAGES = 3;

/** Below this, a page has no usable text layer. A stray character is not a text layer. */
const SCAN_WORDS_PER_PAGE = 20;

/**
 * Fold a line to what two pages of running header have in common.
 *
 * Digits go as well as punctuation — the page number is the part that changes,
 * and keeping it means the header never repeats and never gets recognised.
 * That costs us a line of pure prose that happens to be nothing but numbers,
 * on three or more pages, which is not a document we are trying to serve.
 */
export const foldLine = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();

/**
 * Every line that appears on `FURNITURE_PAGES` or more pages.
 *
 * Counted once per page, so a phrase repeated three times on one page is not
 * furniture — that is a refrain, and it is the author's.
 */
export function repeatedLines(pages: { text: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const page of pages) {
    const onThisPage = new Set(
      page.text.split("\n").map(foldLine).filter((l) => l.length > 3),
    );
    for (const line of onThisPage) seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n >= FURNITURE_PAGES).map(([line]) => line));
}

/**
 * The text layer, page by page.
 *
 * `hasEOL` rather than guessing from `y`: pdf.js already knows where the line
 * ended, and reconstructing it from coordinates gets superscripts and inline
 * maths wrong. Line breaks are kept because `repeatedLines` needs them — a
 * running header is a *line*, and a text blob has none.
 *
 * `isEvalSupported: false` because a PDF is a stranger's file and pdf.js will
 * otherwise compile pattern code out of it. See docs/project/security.md.
 */
export async function pass0(source: string | Uint8Array): Promise<Pass0> {
  const data = typeof source === "string" ? new Uint8Array(await readFile(source)) : source;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false })
    .promise;

  const pages: PageText[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        items.push({
          x: Math.round(item.transform[4]!),
          y: Math.round(item.transform[5]!),
          text: item.str,
        });
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      const trimmed = text.replace(/[ \t]+/g, " ").trim();
      pages.push({
        page: n,
        text: trimmed,
        words: trimmed ? trimmed.split(/\s+/).length : 0,
        items,
      });
    }
  } finally {
    await doc.cleanup?.();
  }

  const withText = pages.filter((p) => p.words >= SCAN_WORDS_PER_PAGE);
  return {
    pages,
    isScan: withText.length <= 1 && pages.length > 1,
    furniture: repeatedLines(pages),
  };
}

/**
 * The baseline a transcribed page is checked against: this page's text layer
 * with the furniture lines removed.
 *
 * Returned as lines rather than tokens so the caller decides how to compare —
 * the scorer wants tokens, a human reading a failure wants lines.
 */
export function baselineFor(pass: Pass0, page: number): string[] {
  const found = pass.pages.find((p) => p.page === page);
  if (!found) return [];
  return found.text
    .split("\n")
    .filter((line) => line.trim() && !pass.furniture.has(foldLine(line)));
}

// ---------------------------------------------------------------- CLI

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: tsx src/pdf.ts <file.pdf>");
    process.exit(1);
  }
  const { pages, isScan, furniture } = await pass0(input);
  const words = pages.map((p) => p.words).sort((a, b) => a - b);
  console.log(`File:      ${path.resolve(input)}`);
  console.log(`Pages:     ${pages.length}${isScan ? "   (a scan — no text layer)" : ""}`);
  console.log(
    `Words:     ${words.reduce((a, b) => a + b, 0)} total, per page min ${words[0]} median ${words[words.length >> 1]} max ${words.at(-1)}`,
  );
  console.log(`Furniture: ${furniture.size} repeated line(s)`);
  for (const line of furniture) console.log(`             ${line.slice(0, 90)}`);
}

/* Resolved paths, not a suffix match — see the same guard in src/blocks.ts for
   why `endsWith` runs the CLI as a side effect of an unrelated import. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
