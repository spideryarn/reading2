/**
 * **How much of an article Skim's route actually touches**, at each of
 * its three depths — Gist, More, Most. Reads only; writes nothing.
 *
 *     npx tsx scripts/skim-coverage.ts <slug> [<slug>…] [--json]
 *
 * docs/plans/260928a-trajectory-mode-stage6-coverage-baseline.md is the
 * baseline this produced. docs/project/skim.md is the vision;
 * docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md is the
 * build; docs/plans/260928a-trajectory-mode-stage1-real-runs.md is the first,
 * hand-written measurement this script replaces with something re-runnable.
 *
 * ## What "in" and "next to" mean
 *
 * An Idea's occurrences each name a block (`IdeaOccurrence.blockId`,
 * src/types.ts). A stop's passage is the block its quote sits in
 * (`Quote.blockId`). For one idea, at one depth:
 *
 * - **"in"** — some stop visible at that depth sits in the SAME block as one of
 *   the idea's occurrences.
 * - **"in or next to"** — some stop sits in that block OR the block
 *   immediately before or after it **in document order** (the blocks array
 *   index, never the block id — ids are random, docs/project/block-ids.md).
 *   This is the more generous number: an idea whose passage is one paragraph
 *   over from a stop is still something a reader skimming that stop would
 *   likely notice.
 *
 * Both are computed per idea (true if ANY of its occurrences qualifies) and
 * then reported as a share of all Ideas.
 *
 * ## Section coverage and the "ceiling"
 *
 * A **top-level section** is a direct child of the tree's root node
 * (`Tree.nodes[Tree.rootId].children`). Its word span is every block whose
 * document-order index falls inside its `range`, which also covers every
 * subsection under it — ranges are contiguous and nested, so this needs no
 * recursion.
 *
 * **"body words"** excludes any block with `treatment === "supplement"`
 * (footnotes, references — `Block.treatment`, src/types.ts). A section with no
 * body words (an all-supplement one, if it is its own top-level node) is
 * excluded from both the numerator and the denominator of section coverage —
 * there is nothing there a stop could cover.
 *
 * **Quotes-per-top-level-section is the coverage ceiling**, not a Skim
 * number: Skim's stops are a subset of Quotes (docs/project/skim.md
 * § One set of highlights, not another), so a section with zero quotes can
 * never get a stop at any depth, however deep Most goes.
 *
 * ## Reading the artefacts
 *
 * Through `pgArticleReader` (src/store/pg.ts), the same adapter the reading
 * view itself calls — `loadArticle` for blocks and tree, `loadIdeas`,
 * `loadQuotes`, `loadSkim`. Each of the latter three throws (`status:
 * 404`) when the article has none, and this script lets that propagate rather
 * than printing zeros: a missing artefact is a reason to stop, not a reason to
 * report "0% coverage" for a route that was never built (CLAUDE.md's rule
 * against a check reporting success — silent-success.md — applies to a report
 * script too).
 */
import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

const { closeDb } = await import("../src/db/client.js");
const { pgArticleReader } = await import("../src/store/pg.js");
const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
const { blockIndex } = await import("../src/section-path.js");
const { PROMPT_VERSION: SKIM_PROMPT_VERSION } = await import("../src/skim.js");

import type { Article, Block, Idea, Quote, Skim, SkimDepth, TreeNode } from "../src/types.js";

const DEPTHS: readonly SkimDepth[] = [1, 2, 3];

function die(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/* --------------------------------------------------------------- shaping -- */

interface SectionSpan {
  node: TreeNode;
  lo: number;
  hi: number;
  bodyWords: number;
}

/** Direct children of the root, each carrying the block-index span its range resolves to. */
function topLevelSections(article: Article, idx: ReadonlyMap<string, number>): SectionSpan[] {
  const { tree, blocks } = article;
  const root = tree.nodes[tree.rootId];
  if (!root) return [];
  const out: SectionSpan[] = [];
  for (const childId of root.children) {
    const node = tree.nodes[childId];
    if (!node) continue;
    const lo = idx.get(node.range[0]);
    const hi = idx.get(node.range[1]);
    if (lo === undefined || hi === undefined) continue;
    let bodyWords = 0;
    for (let i = lo; i <= hi; i++) {
      const block = blocks[i];
      if (block && block.treatment !== "supplement") bodyWords += block.words;
    }
    out.push({ node, lo, hi, bodyWords });
  }
  return out;
}

function bodyWordsTotal(blocks: readonly Block[]): number {
  return blocks.reduce((sum, b) => (b.treatment === "supplement" ? sum : sum + b.words), 0);
}

/** Unique block ids the stops visible at depth `d` sit on, route order preserved. */
function stopBlocksAtDepth(
  skim: Skim,
  quoteBlockOf: ReadonlyMap<string, string>,
  depth: SkimDepth,
): { blockIds: string[]; unresolved: number } {
  const blockIds: string[] = [];
  const seen = new Set<string>();
  let unresolved = 0;
  for (const stop of skim.stops) {
    if (stop.depth > depth) continue;
    const blockId = quoteBlockOf.get(stop.quoteId);
    if (!blockId) {
      unresolved++;
      continue;
    }
    if (seen.has(blockId)) continue; // stops are already one-per-block by construction; defensive.
    seen.add(blockId);
    blockIds.push(blockId);
  }
  return { blockIds, unresolved };
}

interface IdeaCoverage {
  in: number;
  inOrNext: number;
  total: number;
}

function ideaCoverage(
  ideas: readonly Idea[],
  stopIdx: readonly number[],
  idx: ReadonlyMap<string, number>,
): IdeaCoverage {
  let inCount = 0;
  let nextCount = 0;
  for (const idea of ideas) {
    let isIn = false;
    let isNext = false;
    for (const occ of idea.occurrences) {
      const at = idx.get(occ.blockId);
      if (at === undefined) continue;
      for (const s of stopIdx) {
        const d = Math.abs(s - at);
        if (d === 0) isIn = true;
        if (d <= 1) isNext = true;
      }
      if (isIn && isNext) break;
    }
    if (isIn) inCount++;
    if (isNext) nextCount++;
  }
  return { in: inCount, inOrNext: nextCount, total: ideas.length };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

/* -------------------------------------------------------------- reporting -- */

interface DepthRow {
  depth: SkimDepth;
  stops: number;
  words: number;
  wordsPct: number;
  ideasIn: number;
  ideasInOrNext: number;
  ideasTotal: number;
  sectionsWithStop: number;
  sectionsWithBodyWords: number;
  unresolvedStops: number;
}

interface ArticleReport {
  slug: string;
  title: string | null;
  bodyWords: number;
  topLevelSections: number;
  sectionsWithBodyWords: number;
  ideasCount: number;
  quotesCount: number;
  skimVersion: string;
  skimOutdated: boolean;
  skimStale: boolean;
  ideasStale: boolean;
  ideasOutdated: boolean;
  rows: DepthRow[];
  quotesPerSection: { title: string; quotes: number; bodyWords: number }[];
  sectionsWithNoQuote: number;
}

async function measure(slug: string): Promise<ArticleReport> {
  const article = await pgArticleReader.loadArticle(slug);
  const ideasFound = await pgArticleReader.loadIdeas(slug);
  const quotesFound = await pgArticleReader.loadQuotes(slug);
  const skimFound = await pgArticleReader.loadSkim(slug);

  const idx = blockIndex(article.blocks);
  const sections = topLevelSections(article, idx);
  const sectionsWithWords = sections.filter((s) => s.bodyWords > 0);
  const totalBodyWords = bodyWordsTotal(article.blocks);

  const quoteBlockOf = new Map<string, string>(
    quotesFound.quotes.quotes.map((q: Quote) => [q.id, q.blockId]),
  );
  const wordsOfBlock = new Map<string, number>(article.blocks.map((b) => [b.id, b.words]));

  const quotesPerSection = sectionsWithWords.map((s) => {
    let count = 0;
    for (const q of quotesFound.quotes.quotes) {
      const at = idx.get(q.blockId);
      if (at !== undefined && at >= s.lo && at <= s.hi) count++;
    }
    return { title: s.node.title, quotes: count, bodyWords: s.bodyWords };
  });
  const sectionsWithNoQuote = quotesPerSection.filter((s) => s.quotes === 0).length;

  const rows: DepthRow[] = DEPTHS.map((depth) => {
    const { blockIds, unresolved } = stopBlocksAtDepth(skimFound.skim, quoteBlockOf, depth);
    const stopIdx = blockIds.map((id) => idx.get(id)).filter((n): n is number => n !== undefined);
    const words = blockIds.reduce((sum, id) => sum + (wordsOfBlock.get(id) ?? 0), 0);
    const coverage = ideaCoverage(ideasFound.ideas.ideas, stopIdx, idx);
    const sectionsWithStop = sectionsWithWords.filter(
      (s) => stopIdx.some((at) => at >= s.lo && at <= s.hi),
    ).length;
    return {
      depth,
      stops: blockIds.length,
      words,
      wordsPct: totalBodyWords === 0 ? 0 : (100 * words) / totalBodyWords,
      ideasIn: coverage.in,
      ideasInOrNext: coverage.inOrNext,
      ideasTotal: coverage.total,
      sectionsWithStop,
      sectionsWithBodyWords: sectionsWithWords.length,
      unresolvedStops: unresolved,
    };
  });

  return {
    slug,
    title: article.meta.title ?? null,
    bodyWords: totalBodyWords,
    topLevelSections: sections.length,
    sectionsWithBodyWords: sectionsWithWords.length,
    ideasCount: ideasFound.ideas.ideas.length,
    quotesCount: quotesFound.quotes.quotes.length,
    skimVersion: skimFound.skim.version,
    skimOutdated: skimFound.outdated,
    skimStale: skimFound.stale,
    ideasStale: ideasFound.stale,
    ideasOutdated: ideasFound.outdated,
    rows,
    quotesPerSection,
    sectionsWithNoQuote,
  };
}

function printReport(r: ArticleReport): void {
  console.log(`\n=== ${r.slug} — ${r.title ?? "(no title)"} ===`);
  console.log(
    `Body: ${r.bodyWords.toLocaleString("en-GB")} words, ${r.topLevelSections} top-level sections ` +
      `(${r.sectionsWithBodyWords} with body words)`,
  );
  console.log(
    `Ideas: ${r.ideasCount}${r.ideasStale ? " (STALE)" : ""}${r.ideasOutdated ? " (outdated)" : ""}   ` +
      `Quotes: ${r.quotesCount}   ` +
      `Skim: ${r.skimVersion} (current ${SKIM_PROMPT_VERSION})` +
      `${r.skimOutdated ? " (OUTDATED)" : ""}${r.skimStale ? " (STALE)" : ""}`,
  );
  console.log(
    "\nDepth | Stops | Words      | %Body  | Ideas in | Ideas in/next | Sections w/stop | of sections w/words",
  );
  console.log(
    "------|-------|------------|--------|----------|---------------|------------------|--------------------",
  );
  for (const row of r.rows) {
    const unresolved = row.unresolvedStops > 0 ? `  (${row.unresolvedStops} unresolved)` : "";
    console.log(
      `  ${String(row.depth).padStart(3)} | ${String(row.stops).padStart(5)} | ` +
        `${String(row.words).padStart(10)} | ${row.wordsPct.toFixed(1).padStart(5)}% | ` +
        `${String(row.ideasIn).padStart(3)}/${String(row.ideasTotal).padEnd(4)} | ` +
        `${String(row.ideasInOrNext).padStart(3)}/${String(row.ideasTotal).padEnd(9)} | ` +
        `${String(row.sectionsWithStop).padStart(3)} / ${String(row.sectionsWithBodyWords).padEnd(11)} | ` +
        `${pct(row.sectionsWithStop, row.sectionsWithBodyWords)}${unresolved}`,
    );
  }
  console.log(
    `\nQuotes per top-level section (the coverage ceiling) — ${r.sectionsWithNoQuote} of ` +
      `${r.quotesPerSection.length} sections with body words have NO quote at all:`,
  );
  for (const s of r.quotesPerSection) {
    console.log(`  ${String(s.quotes).padStart(3)}  ${s.title}  (${s.bodyWords.toLocaleString("en-GB")} words)`);
  }
}

/* ------------------------------------------------------------------ main -- */

const args = process.argv.slice(2);
const json = args.includes("--json");
const slugs = args.filter((a) => !a.startsWith("--"));

if (slugs.length === 0) {
  die(
    "Usage: npx tsx scripts/skim-coverage.ts <slug> [<slug>…] [--json]\n" +
      "  Reads Ideas, Quotes and Skim off the local database for each article\n" +
      "  and reports how much of it Skim's route covers at each depth. Writes nothing.",
  );
}

async function main(): Promise<void> {
  const owner = environmentOwnerId();
  const reports: ArticleReport[] = [];
  let hadError = false;

  await runAsOwner(owner, async () => {
    for (const slug of slugs) {
      try {
        reports.push(await measure(slug));
      } catch (err) {
        hadError = true;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n${slug}: ${message}`);
      }
    }
  });

  if (json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    for (const r of reports) printReport(r);
  }

  if (hadError) {
    console.error(
      "\nAt least one article could not be measured — see the message(s) above. " +
        "A missing Ideas or Skim artefact is not reported as zero coverage.",
    );
  }
  process.exitCode = hadError ? 1 : 0;
}

try {
  await main();
} finally {
  await closeDb();
}
