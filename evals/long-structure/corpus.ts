/**
 * The documents the long-structure eval runs on, loaded without writing
 * anywhere. Plan 261005j § Stage 2.
 *
 *   npx tsx evals/long-structure/corpus.ts          # free: prints what was found
 *
 * Four ways in:
 *  - `db`: a local article's blocks, read from the local database (refused if
 *    `DATABASE_URL` is not 127.0.0.1);
 *  - `html`: a saved page, put through the pipeline's own `runExtract` and
 *    `runBlocks` in memory. Block ids are random, so `Math.random` is swapped
 *    for a seeded stream while the blocks are made: the same file gives the
 *    same ids on every run, which is what lets a saved proposal be rebuilt
 *    and judged in a later session. `idsSha` in the description is the check;
 *  - `blocks`: a `blocks.json` already on disk;
 *  - made documents: another document with its headings turned into
 *    paragraphs, or two documents joined.
 *
 * Files under the primary checkout are read, never written.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMain } from "../../src/is-main.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block } from "../../src/types.js";
import { mulberry32 } from "../reception/label-sheet.js";

/** The primary checkout: where `output/` and `data/` live. A worktree has neither. */
export const PRIMARY = process.env.SPIDERYARN_PRIMARY ?? "/home/greg/code/spideryarn2";

type Source =
  | { via: "db"; slug: string }
  | { via: "html"; file: string }
  | { via: "blocks"; file: string }
  | { via: "headingless"; of: string }
  | { via: "joined"; of: [string, string] };

export interface DocSpec {
  /** The name used on the command line and in file names. */
  name: string;
  what: string;
  source: Source;
}

export const DOCS: readonly DocSpec[] = [
  { name: "book", what: "250-page book, past the line", source: { via: "db", slug: "s3-doctorow-250p-spya-jg872v" } },
  { name: "paper", what: "160-page paper", source: { via: "db", slug: "s3-gdl-45mb-spya-cc9kr8" } },
  { name: "moby", what: "Moby-Dick (Gutenberg 2701)", source: { via: "html", file: "output/2701-h.html" } },
  { name: "g1228", what: "the second Gutenberg book (1228)", source: { via: "html", file: "output/1228-h.html" } },
  { name: "gwern", what: "long web page", source: { via: "blocks", file: "data/gwern-scaling-long/blocks.json" } },
  { name: "book-headingless", what: "the book, every heading turned into a paragraph", source: { via: "headingless", of: "book" } },
  { name: "moby+g1228", what: "Moby-Dick and 1228 joined, past the line", source: { via: "joined", of: ["moby", "g1228"] } },
  /* Not in the default seven: short, kept as a cheap target for the plumbing. */
  { name: "constitution", what: "360-block essay (not in the default corpus)", source: { via: "blocks", file: "data/constitution/blocks.json" } },
];

export const DEFAULT_DOCS = DOCS.filter((d) => d.name !== "constitution").map((d) => d.name);

export interface Doc {
  name: string;
  what: string;
  /** The slug stamped into trees. Never a database key here: nothing is written. */
  slug: string;
  title: string;
  blocks: Block[];
  body: Block[];
}

export interface DocDescription {
  name: string;
  what: string;
  slug: string;
  title: string;
  blocks: number;
  bodyBlocks: number;
  words: number;
  bodyWords: number;
  headingBlocks: number;
  idsSha: string;
}

export function describeDoc(doc: Doc): DocDescription {
  const words = (bs: readonly Block[]): number => bs.reduce((a, b) => a + b.words, 0);
  return {
    name: doc.name,
    what: doc.what,
    slug: doc.slug,
    title: doc.title,
    blocks: doc.blocks.length,
    bodyBlocks: doc.body.length,
    words: words(doc.blocks),
    bodyWords: words(doc.body),
    headingBlocks: doc.body.filter((b) => b.kind === "heading").length,
    idsSha: createHash("sha256").update(doc.blocks.map((b) => b.id).join("\n")).digest("hex").slice(0, 16),
  };
}

/** Every heading block as an ordinary paragraph, as evals/long-documents/note-comparison.ts did it. */
export function unheaded(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => {
    if (b.kind !== "heading") return b;
    const { level: _level, ...rest } = b;
    return { ...rest, tag: "p", kind: "text" as const };
  });
}

function seedOf(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32LE(0);
}

async function withSeededRandom<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

const loaded = new Map<string, Promise<Doc>>();

/** Load one document by name. Throws, with the reason, when it cannot be had. */
export function loadDoc(name: string): Promise<Doc> {
  const hit = loaded.get(name);
  if (hit) return hit;
  const spec = DOCS.find((d) => d.name === name);
  if (!spec) throw new Error(`no document "${name}"; known: ${DOCS.map((d) => d.name).join(", ")}`);
  const made = make(spec);
  loaded.set(name, made);
  return made;
}

async function make(spec: DocSpec): Promise<Doc> {
  const finish = (slug: string, title: string, blocks: Block[]): Doc => ({
    name: spec.name,
    what: spec.what,
    slug,
    title,
    blocks,
    body: splitBlocks(blocks).body,
  });
  const s = spec.source;
  if (s.via === "db") {
    const host = new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname;
    if (host !== "127.0.0.1") throw new Error(`DATABASE_URL host is ${host}, not 127.0.0.1; refusing.`);
    const { loadArticle } = await import("../../src/store/index.js");
    const article = (await loadArticle(s.slug)) as unknown as { blocks: Block[]; meta?: { title?: string } };
    return finish(s.slug, article.meta?.title ?? s.slug, article.blocks);
  }
  if (s.via === "blocks") {
    const file = path.join(PRIMARY, s.file);
    if (!existsSync(file)) throw new Error(`${file} is not there`);
    const { blocks } = JSON.parse(readFileSync(file, "utf8")) as { blocks: Block[] };
    /* A bare blocks.json has no meta beside it: the first heading is the nearest thing to a title. */
    return finish(spec.name, blocks.find((b) => b.kind === "heading")?.text.trim() || spec.name, blocks);
  }
  if (s.via === "html") {
    const file = path.join(PRIMARY, s.file);
    if (!existsSync(file)) throw new Error(`${file} is not there`);
    const html = readFileSync(file, "utf8");
    const { runExtract } = await import("../../src/extract.js");
    const { runBlocks } = await import("../../src/blocks.js");
    return withSeededRandom(seedOf(html), async () => {
      const extracted = await runExtract({ html, url: null, slug: spec.name });
      const run = runBlocks({ slug: spec.name, extractedHtml: extracted.extractedHtml, previous: undefined });
      return finish(spec.name, extracted.meta.title ?? spec.name, run.blocks);
    });
  }
  if (s.via === "headingless") {
    const of = await loadDoc(s.of);
    return finish(`${of.slug}-headingless`, of.title, unheaded(of.blocks));
  }
  const [a, b] = await Promise.all([loadDoc(s.of[0]), loadDoc(s.of[1])]);
  /* Bodies only: a supplement in the middle would stop `splitBlocks` treating
     the apparatus as one trailing run. Ids are random 6-character strings, so
     a collision between two books would be a fault worth stopping on. */
  const blocks = [...a.body, ...b.body];
  if (new Set(blocks.map((x) => x.id)).size !== blocks.length) throw new Error("the joined documents share a block id");
  return finish(spec.name, `${a.title} / ${b.title}`, blocks);
}

if (isMain(import.meta.url)) {
  const { loadEnvLocal } = await import("../../src/env.js");
  const { wholeDocumentRequest } = await import("../../src/structure.js");
  const { TooLongForOnePass } = await import("../../src/token-budget.js");
  loadEnvLocal();
  for (const spec of DOCS) {
    try {
      const doc = await loadDoc(spec.name);
      let fits = true;
      try {
        wholeDocumentRequest(doc.body);
      } catch (err) {
        if (!(err instanceof TooLongForOnePass)) throw err;
        fits = false;
      }
      console.log(JSON.stringify({ ...describeDoc(doc), fitsOneAnswer: fits }));
    } catch (err) {
      console.log(JSON.stringify({ name: spec.name, couldNotBeHad: (err as Error).message.slice(0, 200) }));
    }
  }
  process.exit(0);
}
