/**
 * **Does a one-instruction nudge spread Quotes across a paper's major sections
 * better than the current prompt's own run-to-run noise?** An offline eval —
 * plan 260928a § "Stage 6, widened", 6a, and Sol's F66 ("6a becomes an offline
 * evaluation arm first; the version is bumped only if it wins").
 *
 *     npx tsx scripts/eval/quotes-spread-eval.ts [--runs=2] [slug …]
 *
 * Results: docs/plans/260928a-trajectory-mode-stage6a-quotes-spread-eval.md.
 *
 * ## What it runs, and how the nudge gets in without editing src/
 *
 * Every call is **production's own `generateQuotes`** (src/quotes.ts), called
 * the way src/pipeline.ts's `quotes` step calls it, with `previous: null` (a
 * first list, not a Find more), `profile: null` and no cache breakpoint.
 *
 * `SYSTEM` is a module constant that `generateQuotes` reads directly, so the
 * prompt cannot be varied through its arguments. The nudge arm therefore
 * patches **the Anthropic SDK's `Messages.prototype.stream`** for the duration
 * of its calls: it finds the system block whose text is exactly `SYSTEM`,
 * and inserts `NUDGE` right after the one paragraph `ANCHOR` names. Everything
 * else — article block, user prompt, model, effort, token budget, parsing,
 * placement, dedupe — is production's, byte for byte. The patch **throws** if
 * the block or the anchor is not found, and counts its applications, so a nudge
 * that silently did not apply cannot pass for a nudge that did nothing
 * (docs/reusable/silent-success.md). The control arm runs with the patch off.
 *
 * ## What it writes
 *
 * **One `ai_calls` row per model call, and nothing else to the database.** It
 * reads the article and its stored Ideas through `pgArticleReader`; the spend
 * collector writes to the ledger (an eval's spend is refused without one,
 * src/ai-spend.ts § UnrecordedSpendRefused). Files: `evals/results/quotes-spread-<ts>.json`
 * (every run's quotes and metrics), `…-pairs.md` (control-run-1 vs
 * nudge-run-1 per article, sides shuffled by `crypto.randomInt`, for a blind
 * read) and `…-key.json` (which side was which — open it only after judging).
 *
 * ## The metrics
 *
 * - **Quotes per top-level section** — the root's children, each spanning the
 *   blocks its `range` covers. "Content-bearing" = has body words (blocks not
 *   `treatment === "supplement"`), the rule scripts/skim-coverage.ts uses.
 * - **Idea ceiling, "in"** — share of stored Ideas with a quote on the same block
 *   as one of their occurrences.
 * - **Idea ceiling, "in or beside"** — also counting a quote whose nearest body,
 *   non-heading paragraph either side (never leaving its top-level section) holds
 *   an occurrence. The same walk as `skimInput`'s `neighbour`
 *   (src/skim.ts), re-implemented here rather than imported because that
 *   file is being edited concurrently.
 */
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { closeDb } = await import("../../src/db/client.js");
const { pgArticleReader } = await import("../../src/store/pg.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { blockIndex } = await import("../../src/section-path.js");
const { generateQuotes, SYSTEM, PROMPT_VERSION, inputFingerprint } = await import("../../src/quotes.js");
const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
const { costStore } = await import("../../src/store/ai-calls.js");

import type { Article as PipelineArticle } from "../../src/article-input.js";
import type { Article, Block, Idea, Quote } from "../../src/types.js";

/* ------------------------------------------------------------------ nudge -- */

/** The paragraph the nudge goes after — the existing spread instruction. */
const ANCHOR = `Take them from across the whole piece. Three quotes from one paragraph and none
from the second half is a list about the opening, not about the article.`;

/** The one instruction under test. */
export const NUDGE = `Cover its main parts, too. Look at the parts listed under ITS SHAPE: where a
part that carries the argument — not front matter, notes or references — has a
passage worth keeping, take at least one from it. Do not lower the bar to do
it: a part with nothing worth keeping gets nothing.`;

if (!SYSTEM.includes(ANCHOR)) throw new Error("ANCHOR not found in SYSTEM — the prompt has moved");
const NUDGED_SYSTEM = SYSTEM.replace(ANCHOR, `${ANCHOR}\n\n${NUDGE}`);

let nudgeOn = false;
let nudgeApplied = 0;
const messagesProto = Object.getPrototypeOf(new Anthropic({ apiKey: "x" }).messages) as {
  stream: (body: { system?: unknown }, options?: unknown) => unknown;
};
const originalStream = messagesProto.stream;
messagesProto.stream = function patched(this: unknown, body, options) {
  if (nudgeOn) {
    const system = body.system;
    if (!Array.isArray(system)) throw new Error("nudge: system is not an array of blocks");
    const i = system.findIndex((b: { text?: unknown }) => b?.text === SYSTEM);
    if (i < 0) throw new Error("nudge: no system block equal to SYSTEM — patch did not apply");
    const copy = system.slice();
    copy[i] = { ...copy[i], text: NUDGED_SYSTEM };
    nudgeApplied++;
    return originalStream.call(this, { ...body, system: copy }, options);
  }
  return originalStream.call(this, body, options);
};

/* ---------------------------------------------------------------- metrics -- */

interface Section {
  title: string;
  lo: number;
  hi: number;
  bodyWords: number;
}

function sectionsOf(article: Article, idx: ReadonlyMap<string, number>): Section[] {
  const { tree, blocks } = article;
  const root = tree.nodes[tree.rootId];
  if (!root) return [];
  const out: Section[] = [];
  for (const id of root.children) {
    const node = tree.nodes[id];
    if (!node) continue;
    const lo = idx.get(node.range[0]);
    const hi = idx.get(node.range[1]);
    if (lo === undefined || hi === undefined) continue;
    let bodyWords = 0;
    for (let i = lo; i <= hi; i++) {
      const b = blocks[i];
      if (b && b.treatment !== "supplement") bodyWords += b.words;
    }
    out.push({ title: node.title, lo, hi, bodyWords });
  }
  return out;
}

interface Metrics {
  quotes: number;
  perSection: { title: string; quotes: number; bodyWords: number }[];
  contentSections: number;
  contentSectionsWithNoQuote: number;
  ideasTotal: number;
  ideasIn: number;
  ideasInOrBeside: number;
}

function measure(article: Article, quotes: readonly Quote[], ideas: readonly Idea[]): Metrics {
  const blocks: readonly Block[] = article.blocks;
  const idx = blockIndex(blocks);
  const sections = sectionsOf(article, idx);
  const sectionOf = (at: number) => sections.findIndex((s) => s.lo <= at && at <= s.hi);
  const neighbour = (at: number, dir: -1 | 1): number | null => {
    const home = sectionOf(at);
    for (let i = at + dir; i >= 0 && i < blocks.length; i += dir) {
      if (sectionOf(i) !== home) return null;
      const b = blocks[i]!;
      if (b.treatment !== "supplement" && b.kind !== "heading") return i;
    }
    return null;
  };

  const quoteAt = quotes.map((q) => idx.get(q.blockId)).filter((n): n is number => n !== undefined);
  if (quoteAt.length !== quotes.length) throw new Error("a quote's block is not in the article");
  const inBlocks = new Set(quoteAt);
  const besideBlocks = new Set<number>(quoteAt);
  for (const at of quoteAt) {
    for (const n of [neighbour(at, -1), neighbour(at, 1)]) if (n !== null) besideBlocks.add(n);
  }

  let ideasIn = 0;
  let ideasInOrBeside = 0;
  for (const idea of ideas) {
    const occ = idea.occurrences.map((o) => idx.get(o.blockId)).filter((n): n is number => n !== undefined);
    if (occ.some((at) => inBlocks.has(at))) ideasIn++;
    if (occ.some((at) => besideBlocks.has(at))) ideasInOrBeside++;
  }

  const perSection = sections.map((s) => ({
    title: s.title,
    quotes: quoteAt.filter((at) => at >= s.lo && at <= s.hi).length,
    bodyWords: s.bodyWords,
  }));
  const content = perSection.filter((s) => s.bodyWords > 0);
  return {
    quotes: quotes.length,
    perSection,
    contentSections: content.length,
    contentSectionsWithNoQuote: content.filter((s) => s.quotes === 0).length,
    ideasTotal: ideas.length,
    ideasIn,
    ideasInOrBeside,
  };
}

/* ------------------------------------------------------------------- runs -- */

type Arm = "control" | "nudge";

interface RunResult {
  slug: string;
  arm: Arm;
  run: number;
  metrics: Metrics;
  costNanos: number;
  unpriced: number;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  dropped: unknown;
  quotes: { text: string; blockId: string; section: string; importance?: number; striking?: number }[];
}

const DEFAULT_SLUGS = ["vb-spya-vu3xen", "entropy-24-00930-spya-pywwkq", "source-spya-furjgs"];
const args = process.argv.slice(2);
const runsArg = args.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? Number(runsArg.slice("--runs=".length)) : 2;
const slugs = args.filter((a) => !a.startsWith("--"));
const SLUGS = slugs.length > 0 ? slugs : DEFAULT_SLUGS;

/* Nudge toggling is process-global, so arms never overlap: articles run
   concurrently only within one arm-phase. */
async function runOne(slug: string, article: Article, ideas: readonly Idea[], arm: Arm, run: number): Promise<RunResult> {
  const before = nudgeApplied;
  /* The pipeline's shape (src/article-input.ts): blocks and tree from
     the structure step, meta from extract. main() checks its fingerprint equals the
     stored list's sourceHash, i.e. that these are the bytes the pipeline used. */
  const input: PipelineArticle = { slug, blocks: article.blocks, tree: article.tree, meta: article.meta ?? null };
  const { result, report } = await collectSpend(
    () => generateQuotes({ power: "standard", article: input, previous: null, profile: null }),
    {
      attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: slug },
      sink: (row) => costStore.record(row),
    },
  );
  if (arm === "nudge" && nudgeApplied === before) throw new Error("nudge arm ran without the patch applying");
  const spent = totalSpend(report.calls);
  const idx = blockIndex(article.blocks);
  const sections = sectionsOf(article, idx);
  const quotes = result.quotes.quotes;
  return {
    slug,
    arm,
    run,
    metrics: measure(article, quotes, ideas),
    costNanos: spent.nanos,
    unpriced: spent.unpriced,
    elapsedMs: result.elapsedMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    dropped: result.dropped,
    quotes: quotes.map((q) => {
      const at = idx.get(q.blockId) ?? -1;
      return {
        text: q.text,
        blockId: q.blockId,
        section: sections.find((s) => s.lo <= at && at <= s.hi)?.title ?? "(none)",
        ...(q.importance !== undefined ? { importance: q.importance } : {}),
        ...(q.striking !== undefined ? { striking: q.striking } : {}),
      };
    }),
  };
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = "evals/results";
  mkdirSync(outDir, { recursive: true });
  const base = `${outDir}/quotes-spread-${stamp}`;

  const results: RunResult[] = [];
  const baselines: Record<string, Metrics & { storedQuotesVersion: string }> = {};

  await runAsOwner(environmentOwnerId(), async () => {
    const inputs: { slug: string; article: Article; ideas: Idea[] }[] = [];
    for (const slug of SLUGS) {
      const article = await pgArticleReader.loadArticle(slug);
      const ideasFound = await pgArticleReader.loadIdeas(slug);
      if (ideasFound.stale) throw new Error(`${slug}: stored Ideas are stale`);
      const ideas = ideasFound.ideas.ideas;
      if (ideas.length === 0) throw new Error(`${slug}: no stored Ideas`);
      inputs.push({ slug, article, ideas });
      const stored = await pgArticleReader.loadQuotes(slug);
      const fp = inputFingerprint(article.blocks, article.tree, article.meta ?? null);
      if (fp !== stored.quotes.sourceHash) {
        console.warn(`${slug}: input fingerprint differs from the stored Quotes' sourceHash (stale=${stored.stale})`);
      }
      baselines[slug] = {
        ...measure(article, stored.quotes.quotes, ideas),
        storedQuotesVersion: stored.quotes.version,
      };
      console.log(`${slug}: ${ideas.length} ideas (outdated=${ideasFound.outdated}), ${article.blocks.length} blocks`);
    }

    for (let run = 1; run <= RUNS; run++) {
      for (const arm of ["control", "nudge"] as const) {
        nudgeOn = arm === "nudge";
        const batch = await Promise.all(
          inputs.map(({ slug, article, ideas }) =>
            runOne(slug, article, ideas, arm, run).catch((err: unknown) => {
              console.error(`${slug} ${arm} ${run}: ${err instanceof Error ? err.message : String(err)}`);
              return null;
            }),
          ),
        );
        nudgeOn = false;
        for (const r of batch) {
          if (!r) continue;
          results.push(r);
          const m = r.metrics;
          console.log(
            `${r.slug} ${r.arm}#${r.run}: ${m.quotes} quotes, ${m.contentSectionsWithNoQuote}/${m.contentSections} content sections empty, ` +
              `ideas in ${m.ideasIn}/${m.ideasTotal}, in|beside ${m.ideasInOrBeside}/${m.ideasTotal}, ` +
              `$${(r.costNanos / 1e9).toFixed(4)}, ${(r.elapsedMs / 1000).toFixed(1)}s`,
          );
        }
        const attempted = SLUGS.length * RUNS * 2;
        writeFileSync(
          `${base}.json`,
          JSON.stringify({
            promptVersion: PROMPT_VERSION,
            nudge: NUDGE,
            anchor: ANCHOR,
            validity: { valid: results.length, attempted },
            baselines,
            results,
          }, null, 2),
        );
      }
    }
  });

  /* Blind pairs: control#1 vs nudge#1, sides by a real RNG. */
  const key: Record<string, { A: Arm; B: Arm }> = {};
  const lines: string[] = ["# Blind pairs — which list would a reader rather keep?", ""];
  for (const slug of SLUGS) {
    const c = results.find((r) => r.slug === slug && r.arm === "control" && r.run === 1);
    const n = results.find((r) => r.slug === slug && r.arm === "nudge" && r.run === 1);
    if (!c || !n) continue;
    const flip = randomInt(2) === 1;
    const [a, b] = flip ? [n, c] : [c, n];
    key[slug] = { A: a.arm, B: b.arm };
    lines.push(`## ${slug}`, "");
    for (const [label, r] of [["A", a], ["B", b]] as const) {
      lines.push(`### ${label} (${r.quotes.length} quotes)`, "");
      r.quotes.forEach((q, i) => {
        lines.push(`${i + 1}. ${q.text.replace(/\s+/g, " ")}`);
      });
      lines.push("");
    }
  }
  writeFileSync(`${base}-pairs.md`, lines.join("\n"));
  writeFileSync(`${base}-key.json`, JSON.stringify(key, null, 2));

  const total = results.reduce((s, r) => s + r.costNanos, 0);
  const attempted = SLUGS.length * RUNS * 2;
  console.log(`Validity: ${results.length}/${attempted} calls produced a valid Quotes artefact`);
  console.log(`\n${results.length} calls, nudge applied ${nudgeApplied}x, total $${(total / 1e9).toFixed(4)}`);
  console.log(`Wrote ${base}.json, ${base}-pairs.md, ${base}-key.json`);
  if (results.length !== attempted) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closeDb();
}
