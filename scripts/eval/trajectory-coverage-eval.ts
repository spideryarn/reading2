/**
 * **Does the stage-6 route prompt (`trajectory/7`, which sees the Ideas and the
 * outline) cover more of an article's key points than the old one
 * (`trajectory/6`, quotes only), beyond the old one's own run-to-run noise?**
 * An offline eval — plan 260928a § "Stage 6 as it will be built", item 3, and
 * Sol's F65.
 *
 *     npx tsx scripts/eval/trajectory-coverage-eval.ts [--runs=2] [--old=<module>] [--new-only] [slug …]
 *
 * Results: docs/plans/260928a-trajectory-mode-stage6-coverage-after.md.
 *
 * ## The two arms
 *
 * - **NEW** — production's `generateTrajectory` (src/trajectory.ts), given
 *   `trajectoryInput` over the stored Quotes, blocks, tree and Ideas, exactly as
 *   src/pipeline.ts's `trajectory` step builds it.
 * - **OLD** — `generateTrajectory` from the `trajectory/6` module as of commit
 *   faa44576, which the operator writes to a throwaway file first:
 *
 *       git show faa44576:src/trajectory.ts > src/trajectory-v6-eval-tmp.ts
 *
 *   (inside src/ so its relative imports resolve) and deletes afterwards.
 *   Called the way faa44576's pipeline called it: `usableQuotes`, the whole
 *   list for the hash, the blocks and tree for section paths.
 *
 * Each arm's own `generateTrajectory` renders its own prompt, makes its own
 * call through `streamMessage` (the AI gateway, same model and effort),
 * parses, maps labels back and validates with its own `buildTrajectory`. Both
 * get `profile: null`, so the profile is not a variable.
 *
 * ## What it writes
 *
 * **Nothing to the database.** Reads through `pgArticleReader`; the spend
 * collector has no sink, so no `ai_calls` row. Files only:
 * `evals/results/trajectory-coverage-<ts>.json`.
 *
 * ## The metrics, per depth (Gist ≤1, More ≤2, Most ≤3)
 *
 * Those of scripts/trajectory-coverage.ts, with one change to adjacency:
 *
 * - **Ideas "in"** (primary) — a stop on the same block as one of the Idea's
 *   occurrences.
 * - **Ideas "in or beside"** — also a stop whose nearest body, non-heading
 *   block either side, never leaving its top-level section, holds one (F65;
 *   the same walk as `trajectoryInput`'s `neighbour`). The coverage script's
 *   "in or next to" is ±1 in the blocks array, across headings and section
 *   boundaries; it is recorded too (`ideasInOrNextPm1`) but not headlined.
 * - **Content sections with a stop** — top-level sections with body words.
 * - **Words, % body words** — the stop blocks' words over non-supplement words.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const args = process.argv.slice(2);
const runsArg = args.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? Number(runsArg.slice("--runs=".length)) : 2;
const oldArg = args.find((a) => a.startsWith("--old="));
const OLD_MODULE = oldArg ? oldArg.slice("--old=".length) : "src/trajectory-v6-eval-tmp.ts";
/* `--new-only`: the NEW arm alone, with no old module to write first — for
   measuring a change to `trajectory/7` against the stage-6 NEW numbers. */
const NEW_ONLY = args.includes("--new-only");
const ARMS = NEW_ONLY ? (["new"] as const) : (["old", "new"] as const);
const slugArgs = args.filter((a) => !a.startsWith("--"));
const SLUGS = slugArgs.length > 0 ? slugArgs : ["vb-spya-vu3xen", "entropy-24-00930-spya-pywwkq", "source-spya-furjgs"];

const { closeDb } = await import("../../src/db/client.js");
const { pgArticleReader } = await import("../../src/store/pg.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { blockIndex } = await import("../../src/section-path.js");
const { isBody } = await import("../../src/block-policy.js");
const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
const NEW = await import("../../src/trajectory.js");
/* The old module, loaded by path so nothing in the repo imports a file that
   exists only for the length of one eval. */
type OldModule = {
  PROMPT_VERSION: string;
  usableQuotes: (q: Quotes | null, b: readonly Block[]) => Quote[];
  generateTrajectory: (opts: {
    slug: string;
    quotes: readonly Quote[];
    blocks: readonly Block[];
    tree: Article["tree"];
    allQuotes: readonly Quote[];
    profile: string | null;
  }) => Promise<{ trajectory: Trajectory; offered: number; inputTokens: number; outputTokens: number; elapsedMs: number }>;
};
const OLD: OldModule | null = NEW_ONLY
  ? null
  : ((await import(pathToFileURL(resolve(OLD_MODULE)).href)) as OldModule);
if (OLD && OLD.PROMPT_VERSION !== "trajectory/6") throw new Error(`old module is ${OLD.PROMPT_VERSION}, expected trajectory/6`);
if (NEW.PROMPT_VERSION !== "trajectory/7") throw new Error(`new module is ${NEW.PROMPT_VERSION}, expected trajectory/7`);

import type { Article, Block, Idea, Ideas, Quote, Quotes, Trajectory, TrajectoryDepth } from "../../src/types.js";

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

interface DepthRow {
  depth: TrajectoryDepth;
  stops: number;
  words: number;
  wordsPct: number;
  ideasIn: number;
  ideasInOrBeside: number;
  ideasInOrNextPm1: number;
  ideasTotal: number;
  inLabels: string[];
  sectionsWithStop: number;
  contentSections: number;
}

function measure(article: Article, stopBlocks: { blockId: string; depth: TrajectoryDepth }[], ideas: readonly Idea[]): DepthRow[] {
  const blocks = article.blocks;
  const idx = blockIndex(blocks);
  const sections = sectionsOf(article, idx);
  const content = sections.filter((s) => s.bodyWords > 0);
  const bodyTotal = blocks.reduce((n, b) => (b.treatment === "supplement" ? n : n + b.words), 0);
  const sectionOf = (at: number) => sections.findIndex((s) => s.lo <= at && at <= s.hi);
  const neighbour = (at: number, dir: -1 | 1): number | null => {
    const home = sectionOf(at);
    for (let i = at + dir; i >= 0 && i < blocks.length; i += dir) {
      if (sectionOf(i) !== home) return null;
      const b = blocks[i]!;
      if (isBody(b) && b.kind !== "heading") return i;
    }
    return null;
  };
  return ([1, 2, 3] as const).map((depth) => {
    const at = [...new Set(stopBlocks.filter((s) => s.depth <= depth).map((s) => s.blockId))].map((id) => {
      const i = idx.get(id);
      if (i === undefined) throw new Error(`stop block ${id} not in article`);
      return i;
    });
    const inSet = new Set(at);
    const beside = new Set(at);
    for (const a of at) for (const n of [neighbour(a, -1), neighbour(a, 1)]) if (n !== null) beside.add(n);
    let ideasIn = 0;
    let ideasInOrBeside = 0;
    let ideasInOrNextPm1 = 0;
    const inLabels: string[] = [];
    ideas.forEach((idea, k) => {
      const occ = idea.occurrences.map((o) => idx.get(o.blockId)).filter((n): n is number => n !== undefined);
      if (occ.some((o) => inSet.has(o))) {
        ideasIn++;
        inLabels.push(`I${k + 1}`);
      }
      if (occ.some((o) => beside.has(o))) ideasInOrBeside++;
      if (occ.some((o) => at.some((s) => Math.abs(s - o) <= 1))) ideasInOrNextPm1++;
    });
    const words = at.reduce((n, i) => n + blocks[i]!.words, 0);
    return {
      depth,
      stops: at.length,
      words,
      wordsPct: bodyTotal === 0 ? 0 : (100 * words) / bodyTotal,
      ideasIn,
      ideasInOrBeside,
      ideasInOrNextPm1,
      ideasTotal: ideas.length,
      inLabels,
      sectionsWithStop: content.filter((s) => at.some((i) => i >= s.lo && i <= s.hi)).length,
      contentSections: content.length,
    };
  });
}

/* ------------------------------------------------------------------- runs -- */

type Arm = "old" | "new";

interface Input {
  slug: string;
  article: Article;
  quotes: Quotes;
  ideas: Ideas;
}

interface RunResult {
  slug: string;
  arm: Arm;
  run: number;
  version: string;
  offered: number;
  rows: DepthRow[];
  costNanos: number;
  unpriced: number;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  stops: { depth: TrajectoryDepth; quote: string; cue: string | null; section: string; ideasIn: string[] }[];
  /** Stored quotes under an abstract heading (`NEW.inAbstract`), whichever arm — the NEW arm does not offer them. */
  abstractQuotes: number;
  /** Stops visible at depth ≤ 1, ≤ 2, ≤ 3 that sit under an abstract heading. */
  abstractStops: [number, number, number];
}

async function runOne(inp: Input, arm: Arm, run: number): Promise<RunResult> {
  const { slug, article, quotes, ideas } = inp;
  const { result, report } = await collectSpend(
    async () => {
      if (arm === "new") {
        const input = NEW.trajectoryInput({ quotes, blocks: article.blocks, tree: article.tree, ideas });
        return NEW.generateTrajectory({ slug, input, profile: null });
      }
      if (!OLD) throw new Error("the old arm needs the old module (drop --new-only)");
      return OLD.generateTrajectory({
        slug,
        quotes: OLD.usableQuotes(quotes, article.blocks),
        blocks: article.blocks,
        tree: article.tree,
        allQuotes: quotes.quotes,
        profile: null,
      });
    },
    { attribution: { scopeKind: "eval", articleSlug: slug } },
  );
  const traj = result.trajectory;
  const byId = new Map(quotes.quotes.map((q) => [q.id, q]));
  const idx = blockIndex(article.blocks);
  const sections = sectionsOf(article, idx);
  const occBlocks = ideas.ideas.map((i) => new Set(i.occurrences.map((o) => o.blockId)));
  const stopBlocks = traj.stops.map((s) => {
    const q = byId.get(s.quoteId);
    if (!q) throw new Error(`${slug} ${arm}: stop names unknown quote ${s.quoteId}`);
    return { blockId: q.blockId, depth: s.depth, quote: q, cue: s.cue ?? null };
  });
  const spent = totalSpend(report.calls);
  const isAbs = (blockId: string) => NEW.inAbstract(blockId, idx, article.tree);
  const abstractStops = ([1, 2, 3] as const).map(
    (d) => stopBlocks.filter((s) => s.depth <= d && isAbs(s.blockId)).length,
  ) as [number, number, number];
  return {
    abstractQuotes: quotes.quotes.filter((q) => idx.has(q.blockId) && isAbs(q.blockId)).length,
    abstractStops,
    slug,
    arm,
    run,
    version: traj.version,
    offered: result.offered,
    rows: measure(article, stopBlocks, ideas.ideas),
    costNanos: spent.nanos,
    unpriced: spent.unpriced,
    elapsedMs: result.elapsedMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    stops: stopBlocks.map((s) => {
      const at = idx.get(s.blockId) ?? -1;
      return {
        depth: s.depth,
        quote: s.quote.text.replace(/\s+/g, " ").slice(0, 240),
        cue: s.cue,
        section: sections.find((x) => x.lo <= at && at <= x.hi)?.title ?? "(none)",
        ideasIn: occBlocks.flatMap((set, k) => (set.has(s.blockId) ? [`I${k + 1}`] : [])),
      };
    }),
  };
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  mkdirSync("evals/results", { recursive: true });
  const out = `evals/results/trajectory-coverage-${stamp}.json`;
  const results: RunResult[] = [];
  const snapshot: Record<string, unknown> = {};

  await runAsOwner(environmentOwnerId(), async () => {
    const inputs: Input[] = [];
    for (const slug of SLUGS) {
      const article = await pgArticleReader.loadArticle(slug);
      const ideasFound = await pgArticleReader.loadIdeas(slug);
      if (ideasFound.stale || ideasFound.outdated) {
        throw new Error(`${slug}: stored Ideas are ${ideasFound.stale ? "stale" : "outdated"} — regenerate first (F65)`);
      }
      if (ideasFound.ideas.ideas.length === 0) throw new Error(`${slug}: no stored Ideas`);
      const quotesFound = await pgArticleReader.loadQuotes(slug);
      const idx = blockIndex(article.blocks);
      inputs.push({ slug, article, quotes: quotesFound.quotes, ideas: ideasFound.ideas });
      snapshot[slug] = {
        ideasVersion: ideasFound.ideas.version,
        quotesVersion: quotesFound.quotes.version,
        quotesStale: quotesFound.stale,
        quotes: quotesFound.quotes.quotes.length,
        ideas: ideasFound.ideas.ideas.map((i, k) => ({
          label: `I${k + 1}`,
          id: i.id,
          name: i.name,
          statement: i.statement,
          blocks: i.occurrences.map((o) => ({ blockId: o.blockId, at: idx.get(o.blockId) ?? null })),
        })),
      };
      console.log(`${slug}: ${ideasFound.ideas.ideas.length} ideas (${ideasFound.ideas.version}), ${quotesFound.quotes.quotes.length} quotes`);
    }

    for (let run = 1; run <= RUNS; run++) {
      const batch = await Promise.all(
        inputs.flatMap((inp) =>
          ARMS.map((arm) =>
            runOne(inp, arm, run).catch((err: unknown) => {
              console.error(`${inp.slug} ${arm}#${run}: ${err instanceof Error ? err.message : String(err)}`);
              return null;
            }),
          ),
        ),
      );
      for (const r of batch) {
        if (!r) continue;
        results.push(r);
        const cells = r.rows
          .map((w) => `d${w.depth}: ${w.stops} stops, in ${w.ideasIn}/${w.ideasTotal}, beside ${w.ideasInOrBeside}, sec ${w.sectionsWithStop}/${w.contentSections}, ${w.wordsPct.toFixed(1)}%`)
          .join(" | ");
        console.log(`${r.slug} ${r.arm}#${r.run} (${r.version}): ${cells} — $${(r.costNanos / 1e9).toFixed(4)}, ${(r.elapsedMs / 1000).toFixed(1)}s, ${r.inputTokens} in`);
        console.log(`  offered ${r.offered}; ${r.abstractQuotes} stored quotes in the abstract; abstract stops at d1/d2/d3: ${r.abstractStops.join("/")}`);
      }
      writeFileSync(out, JSON.stringify({ oldVersion: OLD?.PROMPT_VERSION ?? null, newVersion: NEW.PROMPT_VERSION, profile: null, snapshot, results }, null, 2));
    }
  });

  const total = results.reduce((s, r) => s + r.costNanos, 0);
  console.log(`\n${results.length} calls, total $${(total / 1e9).toFixed(4)}; wrote ${out}`);
  if (results.length !== SLUGS.length * RUNS * ARMS.length) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closeDb();
}
