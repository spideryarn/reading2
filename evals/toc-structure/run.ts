/**
 * Eval — how good is the ToC *structure* pass, and against what?
 *
 *   npm run eval:toc-structure -- --arm headings
 *   npm run eval:toc-structure -- --arm headings --arm incumbent-disk data/constitution
 *
 * The structure call in src/toc.ts is 163–320 seconds and 88% of the ingest
 * wait (labels run concurrently, the arc is deferred — the measured breakdown
 * is in the research doc), and the decisions queued against it (waves, seeding
 * the author's headings, changing model or effort — see
 * docs/research/opening-an-article-before-the-toc.md) need a number to decide
 * against. This is the harness for that number. evals/README.md
 * § toc-structure says what each measure is a proxy for.
 *
 * **The free arms run today; the model arms are declared but refuse to run**
 * until the phase-2 executor lands — loudly, so a run that produced nothing
 * cannot be read as an arm that scored nothing. `headings` (arm zero, the
 * denominator) and `incumbent-disk` (the already-paid-for trees on disk) cost
 * nothing and are the baseline every paid arm must beat to justify its bill.
 *
 * Scoring lives in score.ts and is unit-tested in
 * tests/toc-structure-eval.test.ts; this file only chooses what to score and
 * writes the result — the same split as evals/extraction/.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../../src/is-main.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import type { Block, Tree } from "../../src/types.js";
import { ARMS, armByName, type ArmSpec, type Comparison } from "./arms.js";
import { defaultCorpus, entryForDir } from "./corpus.js";
import { buildHeadingTree } from "./heading-tree.js";
import { runModelArm, type CallStats } from "./model-arms.js";
import { compareTrees, scoreTree, type StructureScore, type TreeAgreement } from "./score.js";

interface Article {
  slug: string;
  dir: string;
  blocks: Block[];
  title?: string;
  /** The incumbent's tree as it sits on disk, when there is one. */
  diskTree: Tree | null;
  /** sha256 of blocks.json as read for THIS run. */
  measuredSha256: string;
  /** The manifest's hash for it, or null for a dir named outside the manifest. */
  manifestSha256: string | null;
}

interface ArmResult {
  arm: string;
  /** What kind of claim this arm's numbers can support — from arms.ts. */
  comparison: Comparison;
  slug: string;
  /**
   * What was actually measured. `data/` is gitignored and regenerates, so a
   * results file that only named a slug would name bytes nothing can recover;
   * a mismatch against the manifest is printed at run time and recorded here.
   */
  blocksSha256: { measured: string; manifest: string | null; matchesManifest: boolean | null };
  score: StructureScore;
  /** What this arm chose, where that is a fact worth keeping (headings arm). */
  sectionLevel?: number | null;
  flat?: boolean;
  /** What the paid calls cost, one entry per call (model arms only). */
  calls?: CallStats[];
  /** How differently this arm cut the article from the tree on disk. Descriptive, not a verdict. */
  vsDisk?: TreeAgreement;
}

/** The whole run's artefact — rewritten after every result, so a failure after N articles keeps N. */
interface RunFile {
  startedAt: string;
  /** HEAD when the run started, so a March result can name the scorer that made it. */
  commit: string;
  arms: ArmSpec[];
  results: ArmResult[];
}

async function readJson<T>(file: string): Promise<T> {
  return parseJsonFrom<T>(await readFile(file, "utf-8"), file);
}

async function readJsonIfPresent<T>(file: string): Promise<T | null> {
  try {
    return await readJson<T>(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Load one article, hashing what was actually read. The corpus itself is a
 * committed manifest (corpus.ts) rather than a directory listing — a future
 * `data/` directory must be a decision, not a side effect, and `example`,
 * `source` and `source-2` are named there as out of every default run. A dir
 * given explicitly on the command line is loaded whether or not the manifest
 * knows it, with `manifestSha256: null` saying so in the results.
 */
async function loadArticle(dir: string): Promise<Article> {
  const rawBlocks = await readFile(path.join(dir, "blocks.json"), "utf-8");
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(rawBlocks, "blocks.json");
  const meta = await readJsonIfPresent<{ title?: string }>(path.join(dir, "meta.json"));
  return {
    slug: path.basename(dir),
    dir,
    blocks,
    ...(meta?.title ? { title: meta.title } : {}),
    diskTree: await readJsonIfPresent<Tree>(path.join(dir, "tree.json")),
    measuredSha256: createHash("sha256").update(rawBlocks).digest("hex"),
    manifestSha256: entryForDir(dir)?.sha256 ?? null,
  };
}

/** Produce this arm's tree for one article, or explain why it cannot yet. */
async function treeFor(
  arm: ArmSpec,
  article: Article,
): Promise<{ tree: Tree; sectionLevel?: number | null; flat?: boolean; calls?: CallStats[] }> {
  switch (arm.kind) {
    case "headings": {
      const built = buildHeadingTree(article.blocks, article.slug, article.title);
      return { tree: built.tree, sectionLevel: built.sectionLevel, flat: built.flat };
    }
    case "disk": {
      if (!article.diskTree) {
        throw new Error(`${article.dir} has no tree.json — nothing on disk to score`);
      }
      return { tree: article.diskTree };
    }
    default: {
      /* The executor's own PendingError propagates from here while the
         transports are unarmed — loud on purpose. A runner that skipped the
         arms it cannot run would produce a results file that reads exactly
         like those arms scoring nothing — docs/reusable/silent-success.md. */
      const run = await runModelArm(arm, article.blocks, article.slug);
      return { tree: run.tree, calls: run.calls };
    }
  }
}

const pct = (x: number | null): string => (x === null ? "   —" : `${(x * 100).toFixed(0).padStart(3)}%`);
const num = (x: number, dp = 2): string => x.toFixed(dp);

function print(r: ArmResult): void {
  const s = r.score;
  /* **Arm-aware, and the first version was not.** It said "expected for the
     free arm" about any gistless tree, whoever built it — so a paid arm that
     omitted its gists would have been consoled rather than failed. Only the
     headings arm is structurally unable to write gists; for every other arm a
     missing gist is damage. GPT Sol, 2026-08-30. */
  const gistless = armByName(r.arm).kind === "headings";
  console.log(`\n${r.slug}  [${r.arm}]  (${r.comparison})`);
  console.log("─".repeat(Math.max(8, r.slug.length + r.arm.length + 4)));
  if (r.blocksSha256.matchesManifest === false) {
    console.log(
      `  STALE INPUT   blocks.json does not match the corpus manifest — the document was ` +
        `re-extracted since corpus.ts was written; update the manifest deliberately`,
    );
  }
  const validity =
    s.validity.otherProblems > 0
      ? `INVALID — ${s.validity.otherProblems} structural problem(s)`
      : s.validity.gistProblems > 0
        ? gistless
          ? `structurally sound; ${s.validity.gistProblems} node(s) missing a gist (the free arm cannot write them)`
          : `INVALID — ${s.validity.gistProblems} internal node(s) missing a gist, from an arm that was asked for them`
        : "valid";
  console.log(`  validity      ${validity}   (${s.validity.advice} advice)`);
  if (r.sectionLevel !== undefined) {
    const chose = r.flat
      ? r.sectionLevel === null
        ? "no section level — flat root+leaves"
        : `h${r.sectionLevel}, but its sections held no prose — flat root+leaves`
      : `h${r.sectionLevel}`;
    console.log(`  rule chose    ${chose}`);
  }
  console.log(
    `  parts         ${s.parts.count}, words [${s.parts.words.join(", ")}], balance cv ${num(s.parts.balanceCv)}`,
  );
  console.log(
    `  depth         internal ${s.depth.maxInternal} deep, leaves ${s.depth.minLeaf}–${s.depth.maxLeaf}, ` +
      `${pct(s.depth.modalLeafDepthShare)} of blocks at the modal depth`,
  );
  console.log(
    `  fanout        mean ${num(s.fanout.mean, 1)}, max ${s.fanout.max}, ${pct(s.fanout.within5to9)} within 5–9`,
  );
  console.log(
    `  headings      ${s.headingBlocks} in article; boundaries on headings ${pct(s.headings.boundariesOnHeadings)}, ` +
      `headings cut ${pct(s.headings.headingsCut)}, L1 on headings ${pct(s.headings.l1OnHeadings)}` +
      `   (two-sided — neither end is "better")`,
  );
  console.log(
    `  no-heading    longest run ${s.headings.longestHeadinglessRun.blocks} blocks ` +
      `(${s.headings.longestHeadinglessRun.words} words) — the article's fact, not the tree's`,
  );
  console.log(
    `  titles        ${s.titles.count} (${s.titles.copiedHeadings} copied headings), ` +
      `${pct(s.titles.within2to6)} within 2–6 words, retention ${pct(s.titles.retention)}`,
  );
  if (s.gists.count > 0) {
    console.log(
      `  gists         ${pct(s.gists.coverage)} coverage, mean ${num(s.gists.meanWords, 1)} words, ` +
        `multi-sentence ${pct(s.gists.multiSentence)}, template ${pct(s.gists.templateRepetition)}, ` +
        `retention ${pct(s.gists.retention)}`,
    );
  } else {
    console.log(
      gistless
        ? `  gists         none (this arm cannot write them)`
        : `  gists         NONE — a tree without gists from this arm is broken, not economical`,
    );
  }
  if (r.calls?.length) {
    const sum = (f: (c: CallStats) => number | null) =>
      r.calls!.reduce((n, c) => n + (f(c) ?? 0), 0);
    console.log(
      `  paid calls    ${r.calls.length}, ${(sum((c) => c.ms) / 1000).toFixed(1)}s total, ` +
        `${sum((c) => c.inputTokens).toLocaleString()} in, ` +
        `${sum((c) => c.outputTokens).toLocaleString()} out ` +
        `(${sum((c) => c.reasoningTokens).toLocaleString()} reasoning)`,
    );
  }
  if (r.vsDisk) {
    const bd = r.vsDisk.boundaryDistance;
    console.log(
      `  vs disk tree  parts ${r.vsDisk.partCountA} vs ${r.vsDisk.partCountB}, ` +
        `L1 boundary agreement ${pct(r.vsDisk.l1Boundaries)}, all boundaries ${pct(r.vsDisk.allBoundaries)}` +
        (bd ? `, nearest-cut mean ${num(bd.mean, 1)} blocks (${pct(bd.within1Block)} within 1)` : ""),
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const armNames: string[] = [];
  const dirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--arm") {
      const name = args[++i];
      if (!name) throw new Error("--arm needs a name");
      armNames.push(name);
    } else if (args[i] === "--list") {
      for (const a of ARMS) console.log(`${a.name}  (${a.kind}, ${a.comparison})`);
      return;
    } else if (args[i]!.startsWith("--")) {
      throw new Error(`Unknown flag ${args[i]}`);
    } else {
      dirs.push(args[i]!);
    }
  }
  if (armNames.length === 0) {
    console.error(
      "Usage: npm run eval:toc-structure -- --arm <name> [--arm <name>…] [dir…]\n" +
        `Arms: ${ARMS.map((a) => a.name).join(", ")}   (--list to see kinds)\n` +
        "With no dirs, the committed corpus manifest (corpus.ts) decides what is scored.",
    );
    process.exit(1);
  }
  const arms = armNames.map(armByName);
  const articleDirs = dirs.length > 0 ? dirs : defaultCorpus().map((e) => e.dir);
  for (const dir of dirs) {
    const entry = entryForDir(dir);
    if (entry && (entry.role === "duplicate" || entry.role === "fixture")) {
      console.error(`note: ${dir} is role "${entry.role}" in the manifest — scored because named, in no aggregate`);
    }
    if (!entry) console.error(`note: ${dir} is not in the corpus manifest (corpus.ts)`);
  }

  /* One directory per run, written INCREMENTALLY — run.json is rewritten after
     every article × arm, and each produced tree is saved beside it. A paid run
     that dies after six calls then leaves six results and six trees, not a
     spend-ledger entry with nothing to show for it; and the trees are what a
     later blinded judgment reads, since data/ regenerates under old results
     (REVIEW-SOL.md, 9). Stamped to the second — the same collision
     evals/toc-labels.ts documents losing two runs to. */
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const runDir = path.join(
    import.meta.dirname,
    "..",
    "results",
    "toc-structure",
    `${stamp}-${armNames.join("+")}`,
  );
  await mkdir(path.join(runDir, "trees"), { recursive: true });

  const runFile: RunFile = {
    startedAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim(),
    arms: [...arms],
    results: [],
  };
  const checkpoint = async () =>
    writeFile(path.join(runDir, "run.json"), `${JSON.stringify(runFile, null, 2)}\n`, "utf-8");

  for (const dir of articleDirs) {
    const article = await loadArticle(dir);
    for (const arm of arms) {
      const { tree, ...chose } = await treeFor(arm, article);
      const result: ArmResult = {
        arm: arm.name,
        comparison: arm.comparison,
        slug: article.slug,
        blocksSha256: {
          measured: article.measuredSha256,
          manifest: article.manifestSha256,
          matchesManifest: article.manifestSha256
            ? article.manifestSha256 === article.measuredSha256
            : null,
        },
        score: scoreTree(article.blocks, tree),
        ...chose,
        /* Only when the tree being scored is not itself the disk tree —
           comparing a tree with itself would print a row of 100%s that reads
           like a finding. */
        ...(arm.kind !== "disk" && article.diskTree
          ? { vsDisk: compareTrees(article.blocks, tree, article.diskTree) }
          : {}),
      };
      /* Every arm's tree is preserved, the disk arm's included — data/ is
         gitignored and regenerates, so the copy here is the only one a later
         reader can rely on existing. */
      await writeFile(
        path.join(runDir, "trees", `${arm.name}.${article.slug}.json`),
        `${JSON.stringify(tree, null, 2)}\n`,
        "utf-8",
      );
      runFile.results.push(result);
      await checkpoint();
      print(result);
    }
  }

  console.log(`\nWrote ${path.relative(process.cwd(), runDir)}/`);
}

if (isMain(import.meta.url)) {
  await main();
}
