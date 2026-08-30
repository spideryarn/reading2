/**
 * Eval — how good is the ToC *structure* pass, and against what?
 *
 *   npm run eval:toc-structure -- --arm headings
 *   npm run eval:toc-structure -- --arm headings --arm incumbent-disk data/constitution
 *
 * The structure call in src/toc.ts is 163–320 seconds and ~70% of the whole
 * ingest wait, and the decisions queued against it (progressive waves, seeding
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

import { access, readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMain } from "../../src/is-main.js";
import { parseJsonFrom } from "../../src/parse-json.js";
import type { Block, Tree } from "../../src/types.js";
import { ARMS, armByName, type ArmSpec } from "./arms.js";
import { buildHeadingTree } from "./heading-tree.js";
import { compareTrees, scoreTree, type StructureScore, type TreeAgreement } from "./score.js";

interface Article {
  slug: string;
  dir: string;
  blocks: Block[];
  title?: string;
  /** The incumbent's tree as it sits on disk, when there is one. */
  diskTree: Tree | null;
}

interface ArmResult {
  arm: string;
  slug: string;
  score: StructureScore;
  /** What this arm chose, where that is a fact worth keeping (headings arm). */
  sectionLevel?: number | null;
  flat?: boolean;
  /** How differently this arm cut the article from the tree on disk. Descriptive, not a verdict. */
  vsDisk?: TreeAgreement;
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

/** Every dir under data/ with a blocks.json, plus the example fixture. */
async function defaultDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const entry of (await readdir("data", { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const dir = path.join("data", entry.name);
    try {
      await access(path.join(dir, "blocks.json"));
      dirs.push(dir);
    } catch {
      // No blocks.json — not an article directory.
    }
  }
  dirs.push("example");
  return dirs;
}

async function loadArticle(dir: string): Promise<Article> {
  const { blocks } = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
  const meta = await readJsonIfPresent<{ title?: string }>(path.join(dir, "meta.json"));
  return {
    slug: path.basename(dir),
    dir,
    blocks,
    ...(meta?.title ? { title: meta.title } : {}),
    diskTree: await readJsonIfPresent<Tree>(path.join(dir, "tree.json")),
  };
}

/** Produce this arm's tree for one article, or explain why it cannot yet. */
function treeFor(arm: ArmSpec, article: Article): { tree: Tree; sectionLevel?: number | null; flat?: boolean } {
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
    default:
      /* Loud on purpose. A runner that silently skipped the arms it cannot run
         would produce a results file that reads exactly like those arms
         scoring nothing — docs/reusable/silent-success.md. */
      throw new Error(
        `Arm "${arm.name}" (${arm.kind}) spends money and its executor is phase 2 of ` +
          `the plan — not yet built. The free arms are: headings, incumbent-disk.`,
      );
  }
}

const pct = (x: number | null): string => (x === null ? "   —" : `${(x * 100).toFixed(0).padStart(3)}%`);
const num = (x: number, dp = 2): string => x.toFixed(dp);

function print(r: ArmResult): void {
  const s = r.score;
  console.log(`\n${r.slug}  [${r.arm}]`);
  console.log("─".repeat(Math.max(8, r.slug.length + r.arm.length + 4)));
  const validity =
    s.validity.otherProblems > 0
      ? `INVALID — ${s.validity.otherProblems} structural problem(s)`
      : s.validity.gistProblems > 0
        ? `structurally sound; ${s.validity.gistProblems} node(s) missing a gist (expected for the free arm)`
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
    console.log(`  gists         none (this arm cannot write them)`);
  }
  if (r.vsDisk) {
    console.log(
      `  vs disk tree  parts ${r.vsDisk.partCountA} vs ${r.vsDisk.partCountB}, ` +
        `L1 boundary agreement ${pct(r.vsDisk.l1Boundaries)}, all boundaries ${pct(r.vsDisk.allBoundaries)}`,
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
      for (const a of ARMS) console.log(`${a.name}  (${a.kind})`);
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
        "With no dirs, every data/<slug> with a blocks.json plus example/ is scored.",
    );
    process.exit(1);
  }
  const arms = armNames.map(armByName);
  const articleDirs = dirs.length > 0 ? dirs : await defaultDirs();

  const results: ArmResult[] = [];
  for (const dir of articleDirs) {
    const article = await loadArticle(dir);
    for (const arm of arms) {
      const { tree, ...chose } = treeFor(arm, article);
      const result: ArmResult = {
        arm: arm.name,
        slug: article.slug,
        score: scoreTree(article.blocks, tree),
        ...chose,
        /* Only when the tree being scored is not itself the disk tree —
           comparing a tree with itself would print a row of 100%s that reads
           like a finding. */
        ...(arm.kind !== "disk" && article.diskTree
          ? { vsDisk: compareTrees(article.blocks, tree, article.diskTree) }
          : {}),
      };
      results.push(result);
      print(result);
    }
  }

  /* Seconds, not just the date — the same collision evals/toc-labels.ts
     documents losing two runs to. */
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const outDir = path.join(import.meta.dirname, "..", "results");
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `toc-structure-${armNames.join("+")}-${stamp}.json`);
  await writeFile(out, `${JSON.stringify(results, null, 2)}\n`, "utf-8");
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

if (isMain(import.meta.url)) {
  await main();
}
