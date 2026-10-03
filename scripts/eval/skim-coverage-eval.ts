/**
 * **Does the stage-6 route prompt (`trajectory/7`, which sees the Ideas and the
 * outline) cover more of an article's key points than the old one
 * (`trajectory/6`, quotes only), beyond the old one's own run-to-run noise?**
 * An offline eval — plan 260928a § "Stage 6 as it will be built", item 3, and
 * Sol's F65.
 *
 *     npx tsx scripts/eval/skim-coverage-eval.ts [--runs=2] [--old=<module>] \
 *       [--old-version=trajectory/6] [--new-version=trajectory/7] [--new-only] [slug …]
 *
 * Results: docs/plans/260928a-trajectory-mode-stage6-coverage-after.md (6 vs
 * 7), docs/plans/260929b-trajectory-stage2-deeper-passes-eval.md (7 vs a
 * candidate 8, not kept).
 *
 * **Also used for `trajectory/7` vs a candidate `trajectory/8`** (plan 260929b
 * § Stage 2): write the /7 module to `src/skim-v7-eval-tmp.ts` the same
 * way as below, put the candidate in src/skim.ts, and pass
 * `--old=src/skim-v7-eval-tmp.ts --old-version=trajectory/7
 * --new-version=trajectory/8`. An OLD module at 7 or later has NEW's
 * signature, so it is called exactly as NEW is — its own `skimInput` and
 * `generateSkim`. Each stop's
 * full quote and paragraph are recorded (`quoteFull`, `paragraph`) so the
 * stops a deeper pass adds can be read blind (scripts/eval/skim-depth-blind.ts).
 *
 * ## The two arms
 *
 * - **NEW** — production's `generateSkim` (src/skim.ts), given
 *   `skimInput` over the stored Quotes, blocks, tree and Ideas, exactly as
 *   src/pipeline.ts's `skim` step builds it.
 * - **OLD** — `generateSkim` from the `trajectory/6` module as of commit
 *   faa44576, which the operator writes to a throwaway file first:
 *
 *       git show faa44576:src/trajectory.ts > src/skim-v6-eval-tmp.ts
 *
 *   (inside src/ so its relative imports resolve) and deletes afterwards.
 *   A module from before 2026-10-01, when Trajectory became Skim (plan
 *   261001r), spells its exports `generateTrajectory` / `trajectoryInput` and
 *   returns `{ trajectory }`; this script now expects the Skim names, so an
 *   old module needs those respelled in the throwaway copy first.
 *   Called the way faa44576's pipeline called it: `usableQuotes`, the whole
 *   list for the hash, the blocks and tree for section paths.
 *
 * Each arm's own `generateSkim` renders its own prompt, makes its own
 * call through `streamMessage` (the AI gateway, same model and effort),
 * parses, maps labels back and validates with its own `buildSkim`. Both
 * get `profile: null`, so the profile is not a variable.
 *
 * ## What it writes
 *
 * **Nothing to the database.** Reads through `pgArticleReader`; the spend
 * collector has no sink, so no `ai_calls` row. Files only:
 * `evals/results/skim-coverage-<ts>.json`.
 *
 * ## The metrics, per depth (Gist ≤1, More ≤2, Most ≤3)
 *
 * Those of scripts/skim-coverage.ts, with one change to adjacency:
 *
 * - **Ideas "in"** (primary) — a stop on the same block as one of the Idea's
 *   occurrences.
 * - **Ideas "in or beside"** — also a stop whose nearest body, non-heading
 *   block either side, never leaving its top-level section, holds one (F65;
 *   the same walk as `skimInput`'s `neighbour`). The coverage script's
 *   "in or next to" is ±1 in the blocks array, across headings and section
 *   boundaries; it is recorded too (`ideasInOrNextPm1`) but not headlined.
 * - **Content sections with a stop** — top-level sections with body words.
 * - **Words, % body words** — the stop blocks' words over non-supplement words.
 *
 * ## Also used for `skim/8` vs `skim/9` (plan 261003l § Stage 2)
 *
 * `skim/9` gave each stop `again`, the deeper passes it is also walked in. So
 * each run also records, beside the metrics above (which count a stop once, at
 * its `depth`, and are unchanged): every stop's `again`; `walks`, each pass as
 * the reader walks it (`depth === d` or `again` includes d) with how many of
 * its stops are carried; the route's `dropped` counts; and what the gateway
 * said about the call (`model`, `reasoningTokens`). A run that throws (a
 * failed route, a truncation) is written to `failures` with its message
 * rather than only to stderr. `--allow-outdated-ideas` lets an article whose
 * stored Ideas are from an older Ideas prompt in: both arms are given the same
 * Ideas, so their age is not a variable; the snapshot names their version.
 * scripts/eval/skim-again-pairs.ts turns the results into the tables and the
 * blind pairs.
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
const OLD_MODULE = oldArg ? oldArg.slice("--old=".length) : "src/skim-v6-eval-tmp.ts";
const oldVersionArg = args.find((a) => a.startsWith("--old-version="));
const OLD_VERSION = oldVersionArg ? oldVersionArg.slice("--old-version=".length) : "trajectory/6";
const newVersionArg = args.find((a) => a.startsWith("--new-version="));
const NEW_VERSION = newVersionArg ? newVersionArg.slice("--new-version=".length) : "trajectory/7";
/* `--new-only`: the NEW arm alone, with no old module to write first — for
   measuring a change against an earlier run's NEW numbers. */
const NEW_ONLY = args.includes("--new-only");
const ALLOW_OUTDATED_IDEAS = args.includes("--allow-outdated-ideas");
const ARMS = NEW_ONLY ? (["new"] as const) : (["old", "new"] as const);
const slugArgs = args.filter((a) => !a.startsWith("--"));
const SLUGS = slugArgs.length > 0 ? slugArgs : ["vb-spya-vu3xen", "entropy-24-00930-spya-pywwkq", "source-spya-furjgs"];

const { closeDb } = await import("../../src/db/client.js");
const { pgArticleReader } = await import("../../src/store/pg.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { blockIndex } = await import("../../src/section-path.js");
const { isBody } = await import("../../src/block-policy.js");
const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
const NEW = await import("../../src/skim.js");
/* The old module, loaded by path so nothing in the repo imports a file that
   exists only for the length of one eval. */
type RunOut = Promise<{ skim: Skim; offered: number; inputTokens: number; outputTokens: number; elapsedMs: number }>;
/** `trajectory/6`'s signature: quotes only. */
type OldModuleV6 = {
  PROMPT_VERSION: string;
  usableQuotes: (q: Quotes | null, b: readonly Block[]) => Quote[];
  generateSkim: (opts: {
    slug: string;
    quotes: readonly Quote[];
    blocks: readonly Block[];
    tree: Article["tree"];
    allQuotes: readonly Quote[];
    profile: string | null;
  }) => RunOut;
};
/** `trajectory/7` and later: the same signature as NEW. */
type OldModuleV7 = Pick<typeof NEW, "PROMPT_VERSION" | "skimInput" | "generateSkim">;
type OldModule = OldModuleV6 | OldModuleV7;
const isV6 = (m: OldModule): m is OldModuleV6 => m.PROMPT_VERSION === "trajectory/6";
const OLD: OldModule | null = NEW_ONLY
  ? null
  : ((await import(pathToFileURL(resolve(OLD_MODULE)).href)) as OldModule);
if (OLD && OLD.PROMPT_VERSION !== OLD_VERSION) throw new Error(`old module is ${OLD.PROMPT_VERSION}, expected ${OLD_VERSION}`);
if (NEW.PROMPT_VERSION !== NEW_VERSION) throw new Error(`new module is ${NEW.PROMPT_VERSION}, expected ${NEW_VERSION}`);

import type { Article, Block, Idea, Ideas, Quote, Quotes, Skim, SkimDepth } from "../../src/types.js";

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
  depth: SkimDepth;
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

function measure(article: Article, stopBlocks: { blockId: string; depth: SkimDepth }[], ideas: readonly Idea[]): DepthRow[] {
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
  /** What validation dropped — `badAgain` is absent or 0 before `skim/9`. */
  dropped: Skim["dropped"];
  /**
   * Each pass as the reader walks it: its own stops (`depth === d`) plus the
   * earlier stops carried into it (`again` includes d). Before `skim/9` no
   * stop has `again`, so `carried` is 0 and `length` is the own stops.
   */
  walks: { depth: SkimDepth; length: number; own: number; carried: number }[];
  /** The gateway's record of the call: the model that answered and its thinking tokens (inside `outputTokens`). */
  model: string | null;
  reasoningTokens: number | null;
  /** The effort the module asks for is a private constant; this is only the env override, if any. */
  effortOverride: string | null;
  stops: {
    depth: SkimDepth;
    /** The deeper passes this stop is also walked in (`skim/9`); `[]` when none. */
    again: SkimDepth[];
    quote: string;
    /** The whole quote, and the whole paragraph it sits in — for the blind read. */
    quoteFull: string;
    paragraph: string;
    cue: string | null;
    section: string;
    ideasIn: string[];
  }[];
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
        const input = NEW.skimInput({ quotes, blocks: article.blocks, tree: article.tree, ideas });
        return NEW.generateSkim({ power: "standard", slug, input, profile: null });
      }
      if (!OLD) throw new Error("the old arm needs the old module (drop --new-only)");
      if (!isV6(OLD)) {
        const input = OLD.skimInput({ quotes, blocks: article.blocks, tree: article.tree, ideas });
        return OLD.generateSkim({ power: "standard", slug, input, profile: null });
      }
      return OLD.generateSkim({
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
  const skim = result.skim;
  const byId = new Map(quotes.quotes.map((q) => [q.id, q]));
  const idx = blockIndex(article.blocks);
  const sections = sectionsOf(article, idx);
  const occBlocks = ideas.ideas.map((i) => new Set(i.occurrences.map((o) => o.blockId)));
  const stopBlocks = skim.stops.map((s) => {
    const q = byId.get(s.quoteId);
    if (!q) throw new Error(`${slug} ${arm}: stop names unknown quote ${s.quoteId}`);
    return { blockId: q.blockId, depth: s.depth, again: s.again ?? [], quote: q, cue: s.cue ?? null };
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
    dropped: skim.dropped,
    walks: ([1, 2, 3] as const).map((depth) => {
      const own = stopBlocks.filter((s) => s.depth === depth).length;
      const carried = stopBlocks.filter((s) => s.again.includes(depth)).length;
      return { depth, length: own + carried, own, carried };
    }),
    model: report.calls[0]?.model ?? null,
    reasoningTokens: report.calls[0]?.reasoningTokens ?? null,
    effortOverride: process.env.SPIDERYARN_PIPELINE_EFFORT ?? null,
    version: skim.version,
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
        again: s.again,
        quote: s.quote.text.replace(/\s+/g, " ").slice(0, 240),
        quoteFull: s.quote.text.replace(/\s+/g, " "),
        paragraph: (article.blocks[at]?.text ?? "").replace(/\s+/g, " "),
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
  const out = `evals/results/skim-coverage-${stamp}.json`;
  const results: RunResult[] = [];
  const failures: { slug: string; arm: Arm; run: number; message: string }[] = [];
  const snapshot: Record<string, unknown> = {};

  await runAsOwner(environmentOwnerId(), async () => {
    const inputs: Input[] = [];
    for (const slug of SLUGS) {
      const article = await pgArticleReader.loadArticle(slug);
      const ideasFound = await pgArticleReader.loadIdeas(slug);
      if (ideasFound.stale || (ideasFound.outdated && !ALLOW_OUTDATED_IDEAS)) {
        throw new Error(`${slug}: stored Ideas are ${ideasFound.stale ? "stale" : "outdated"} — regenerate first (F65)`);
      }
      if (ideasFound.ideas.ideas.length === 0) throw new Error(`${slug}: no stored Ideas`);
      const quotesFound = await pgArticleReader.loadQuotes(slug);
      const idx = blockIndex(article.blocks);
      inputs.push({ slug, article, quotes: quotesFound.quotes, ideas: ideasFound.ideas });
      snapshot[slug] = {
        ideasVersion: ideasFound.ideas.version,
        ideasOutdated: ideasFound.outdated,
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
              const message = err instanceof Error ? err.message : String(err);
              console.error(`${inp.slug} ${arm}#${run}: ${message}`);
              failures.push({ slug: inp.slug, arm, run, message });
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
        console.log(
          `  walked: ${r.walks.map((w) => `d${w.depth} ${w.length} (${w.carried} carried)`).join(", ")}; badAgain ${r.dropped.badAgain ?? 0}; thinking tokens ${r.reasoningTokens ?? "?"} of ${r.outputTokens} out`,
        );
        console.log(`  offered ${r.offered}; ${r.abstractQuotes} stored quotes in the abstract; abstract stops at d1/d2/d3: ${r.abstractStops.join("/")}`);
      }
      writeFileSync(out, JSON.stringify({ oldVersion: OLD?.PROMPT_VERSION ?? null, newVersion: NEW.PROMPT_VERSION, profile: null, snapshot, results, failures }, null, 2));
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
