/**
 * Synthetic documents of a chosen size and density: real `Block[]`, minted by
 * the real `blocks` step from generated HTML.
 *
 * Lifted on 2026-10-04 out of scripts/eval-big-imports.ts, which measured where
 * a long document stops importing, so that tests/stated-limits.test.ts pins the
 * same documents the measurement was made on rather than a copy of them. Both
 * import from here; the generator is seeded, so a size and a density name one
 * document for ever, and changing a word list or a sentence length below moves
 * every number either of them records.
 */
import { runBlocks } from "../../src/blocks.js";
import type { Block } from "../../src/types.js";

const WORDS = (
  "time order memory structure paradigm science normal crisis anomaly theory measure observe " +
  "history reader argument evidence chapter section method result claim account model world " +
  "question answer puzzle community practice change revolution light energy entropy present past " +
  "future event thing process relation field quantum gravity clock rhythm language meaning"
).split(" ");

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export function words(rand: () => number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rand() * WORDS.length)] ?? "word");
  return out.join(" ");
}

export const sentence = (rand: () => number, n: number): string => {
  const s = words(rand, n);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
};

export interface Density {
  name: string;
  blocksPerPage: number;
  headingsPerPage: number;
  source: string;
}

export const DENSITIES: Density[] = [
  {
    name: "dense paper",
    blocksPerPage: 14.4,
    headingsPerPage: 1.8,
    source: "Kuhn, measured: 142 pages, 2,025–2,046 blocks, 254 headings (plan 260904b)",
  },
  {
    name: "book",
    blocksPerPage: 5,
    headingsPerPage: 0.1,
    source:
      "assumed. The Order of Time is 1,041 blocks (docs/user-feedback/261001_1829); its page count " +
      "is not in that report, so 5 blocks a page is a guess that puts it at about 208 pages",
  },
  {
    name: "headingless prose",
    blocksPerPage: 14.4,
    headingsPerPage: 0,
    source: "the dense paper's block rate with every heading removed",
  },
];

/**
 * Is block `i` of a stream at this density a heading? A property of the index
 * alone, so a prefix of a long stream is the same document as a short one —
 * which is what lets the bisection slice one array rather than rebuild it.
 */
export function isHeadingAt(i: number, density: Density): boolean {
  const rate = density.headingsPerPage / density.blocksPerPage;
  if (rate <= 0) return false;
  return i === 0 || Math.floor(i * rate) !== Math.floor((i - 1) * rate);
}

/** HTML of exactly `n` elements, headings and ~90-word paragraphs only. */
export function plainHtml(n: number, density: Density, seed = 7): string {
  const rand = rng(seed);
  const parts: string[] = ["<article>"];
  for (let i = 0; i < n; i++) {
    parts.push(
      isHeadingAt(i, density)
        ? `<h2>${sentence(rand, 4).slice(0, -1)} ${i}</h2>`
        : `<p>${sentence(rand, 30)} ${sentence(rand, 30)} ${sentence(rand, 30)}</p>`,
    );
  }
  parts.push("</article>");
  return parts.join("\n");
}

/** Real `Block[]`, minted by the real blocks step, from `plainHtml`. */
export function plainBlocks(n: number, density: Density): { blocks: Block[]; html: string } {
  const run = runBlocks({ slug: "synthetic-document", extractedHtml: plainHtml(n, density), previous: undefined });
  if (run.blocks.length !== n) {
    throw new Error(`synthetic document: asked for ${n} blocks and the blocks step made ${run.blocks.length}`);
  }
  return { blocks: run.blocks, html: run.html };
}
