/**
 * The verdict on `toc/14`'s fourth level, from two `before` and two `after`
 * runs of run.ts. Free: it reads the results files and rebuilds each tree from
 * its saved raw answer with production's parser and builder.
 *
 *   npx tsx evals/structure-fourth-level/report.ts before-1,before-2 after-1,after-2
 *
 * **Quality first, then money** (GPT Sol, plan review, 4): a prompt that never
 * made the level would pass a cost rule. So the gates, in order:
 *
 * 1. the report's paper: 2.4.1–2.4.6 are sub-sections of 2.4; 2.5 is a section,
 *    a sibling of 2.4; 2.4.5(a)–(c), tagged h2 by the extractor, start no
 *    section or part;
 * 2. no invented split in a section under 10 blocks;
 * 3. no more failed answers, re-asks or dropped children than the control
 *    (collapsed rungs are printed only: they moved 2 → 4 between two controls);
 * 4. per article, the mean of its two runs in each arm, paired; the median
 *    article's cost and time each grow by at most 20%, reported for the whole
 *    corpus and by group, with the worst article beside it.
 *
 * Every invented split is printed with its title for reading by hand. Titles
 * are printed, never written to a committed file.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildTree, parseWholeDocumentAnswer } from "../../src/structure.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import { DOCS } from "./corpus.js";
import { scoreTree } from "./score.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RESULTS = path.join(ROOT, "evals/results/structure-fourth-level");
const RAW = path.join(ROOT, "data/structure-fourth-level");
const CORPUS = path.join(ROOT, "data/prodread/corpus");
const PAPER = "arxiv-2308-08708-spya-xax6v4";
const BOOK = "rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug";
const SUBHEADED = new Set(DOCS.slice(2, 8).map((d) => d.slug));

interface Call { ms: number; usd: number; outputTokens: number | null; outcome: string }
interface Result {
  slug: string;
  ok: boolean;
  calls: Call[];
  score?: Record<string, unknown> & { subsections: number; swallowedHeadings: number; shortInventedSplits: number; inventedSplits: number; demotedHeadings: number; subheadings: { expected: number; hit: number } };
  droppedChildren?: number;
  collapsedRungs?: number;
}
interface RunFile { label: string; promptVersion: string; systemSha256: string; results: Result[] }

/** A run's results, re-scored from its rebuilt trees by today's scorer, so both arms are counted alike. */
function load(label: string): RunFile {
  const run = JSON.parse(readFileSync(path.join(RESULTS, `${label}.json`), "utf8")) as RunFile;
  for (const r of run.results) {
    const built = r.ok ? treeOf(label, r.slug) : null;
    if (built) r.score = scoreTree(built.tree, built.body) as unknown as NonNullable<Result["score"]>;
    else delete r.score;
  }
  return run;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

function treeOf(label: string, slug: string): { tree: Tree; body: Block[] } | null {
  let raw: string;
  try {
    raw = readFileSync(path.join(RAW, label, `${slug}.txt`), "utf8");
  } catch {
    return null;
  }
  const { blocks } = JSON.parse(readFileSync(path.join(CORPUS, `${slug}.json`), "utf8")) as { blocks: Block[] };
  const { body } = splitBlocks(blocks);
  const { root } = parseWholeDocumentAnswer(raw, body);
  return { tree: buildTree(root, {}, body, slug), body };
}

/** Gate 1, by the author's heading text — the paper's own, public. */
function paperGate(tree: Tree, body: Block[]): string[] {
  const start = (n: TreeNode) => body.findIndex((b) => b.id === n.range[0]);
  const startsAt = (text: string): TreeNode[] => {
    const i = body.findIndex((b) => b.kind === "heading" && b.text.startsWith(text));
    if (i < 0) throw new Error(`the paper has no heading "${text}"`);
    return Object.values(tree.nodes).filter((n) => n.children.length > 0 && start(n) === i);
  };
  const faults: string[] = [];
  const s24 = startsAt("2.4 Other").find((n) => n.depth === 2);
  if (!s24) faults.push("2.4 does not start a section");
  for (const k of [1, 2, 3, 4, 5, 6]) {
    const sub = startsAt(`2.4.${k} `).find((n) => n.depth === 3);
    if (!sub) faults.push(`2.4.${k} does not start a sub-section`);
    else if (s24 && sub.parent !== s24.id) faults.push(`2.4.${k} is not under 2.4`);
  }
  const s25 = startsAt("2.5 Indicators").find((n) => n.depth === 2);
  if (!s25) faults.push("2.5 does not start a section");
  else if (s24 && s25.parent !== s24.parent) faults.push("2.5 is not 2.4's sibling");
  for (const x of ["a", "b", "c"]) {
    if (startsAt(`2.4.5(${x})`).some((n) => n.depth <= 2)) faults.push(`2.4.5(${x}) starts a section or part`);
  }
  return faults;
}

function inventedSplits(tree: Tree, body: Block[]): string[] {
  const out: string[] = [];
  for (const n of Object.values(tree.nodes)) {
    if (n.depth !== 3 || n.children.length === 0) continue;
    const parent = tree.nodes[n.parent!]!;
    if (parent.children[0] === n.id) continue;
    const at = body.findIndex((b) => b.id === n.range[0]);
    if (body[at]!.kind !== "heading") out.push(`${parent.title} › ${n.title}`);
  }
  return out;
}

function main(): void {
  const [beforeArg, afterArg] = process.argv.slice(2);
  if (!beforeArg || !afterArg) throw new Error("usage: report.ts before-1,before-2 after-1,after-2");
  const arms = { before: beforeArg.split(",").map(load), after: afterArg.split(",").map(load) };
  for (const [arm, runs] of Object.entries(arms)) {
    console.log(`${arm}: ${runs.map((r) => `${r.label} ${r.promptVersion} ${r.systemSha256}`).join(" · ")}`);
  }

  const verdict: string[] = [];
  /* Gate 1 */
  for (const run of arms.after) {
    const built = treeOf(run.label, PAPER);
    const faults = built ? paperGate(built.tree, built.body) : ["no answer"];
    console.log(`paper gate, ${run.label}: ${faults.length === 0 ? "pass" : faults.join("; ")}`);
    if (faults.length) verdict.push(`paper gate failed in ${run.label}`);
  }
  for (const run of arms.before) {
    const built = treeOf(run.label, PAPER);
    console.log(`paper gate, ${run.label} (control): ${built ? paperGate(built.tree, built.body).length : "no answer"} faults`);
  }

  /* Gates 2 and 3, and the invented splits to read */
  const sum = (runs: RunFile[], f: (r: Result) => number) => runs.flatMap((r) => r.results).reduce((a, r) => a + f(r), 0);
  const tally = (runs: RunFile[]) => ({
    failed: sum(runs, (r) => (r.ok ? 0 : 1)),
    reasked: sum(runs, (r) => Math.max(0, r.calls.length - 1)),
    droppedChildren: sum(runs, (r) => r.droppedChildren ?? 0),
    collapsedRungs: sum(runs, (r) => r.collapsedRungs ?? 0),
    shortInventedSplits: sum(runs, (r) => r.score?.shortInventedSplits ?? 0),
    inventedSplits: sum(runs, (r) => r.score?.inventedSplits ?? 0),
    demotedHeadings: sum(runs, (r) => r.score?.demotedHeadings ?? 0),
    swallowedHeadings: sum(runs, (r) => r.score?.swallowedHeadings ?? 0),
    subsections: sum(runs, (r) => r.score?.subsections ?? 0),
    subheadingsHit: sum(runs, (r) => r.score?.subheadings.hit ?? 0),
    subheadingsExpected: sum(runs, (r) => r.score?.subheadings.expected ?? 0),
  });
  const b = tally(arms.before);
  const a = tally(arms.after);
  console.log("\n              before   after   (both runs summed)");
  for (const k of Object.keys(b) as (keyof typeof b)[]) console.log(`${k.padEnd(20)} ${String(b[k]).padStart(6)} ${String(a[k]).padStart(7)}`);
  if (a.shortInventedSplits > 0) verdict.push(`${a.shortInventedSplits} invented splits in short sections`);
  /* collapsedRungs is printed, not gated: it moved 2 → 4 between two runs of the same prompt. */
  for (const k of ["failed", "reasked", "droppedChildren"] as const) {
    if (a[k] > b[k]) verdict.push(`${k} rose ${b[k]} → ${a[k]}`);
  }
  console.log("\ninvented sub-section starts, to read:");
  for (const run of arms.after) {
    for (const d of DOCS) {
      const built = treeOf(run.label, d.slug);
      if (built) for (const line of inventedSplits(built.tree, built.body)) console.log(`  ${run.label} ${d.slug.slice(0, 28)}: ${line}`);
    }
  }

  /* Gate 4 */
  const perDoc = (runs: RunFile[], slug: string, f: (c: Call[]) => number) =>
    mean(runs.map((r) => r.results.find((x) => x.slug === slug)).filter((x): x is Result => x?.ok === true).map((x) => f(x.calls)));
  const usd = (c: Call[]) => c.reduce((s, x) => s + x.usd, 0);
  const ms = (c: Call[]) => c.reduce((s, x) => s + x.ms, 0);
  const out = (c: Call[]) => c.reduce((s, x) => s + (x.outputTokens ?? 0), 0);
  console.log("\nper article, mean of two runs   cost before→after   time before→after   output tokens   sub-sections");
  const rows = DOCS.map((d) => {
    const row = {
      slug: d.slug,
      usd: [perDoc(arms.before, d.slug, usd), perDoc(arms.after, d.slug, usd)] as const,
      ms: [perDoc(arms.before, d.slug, ms), perDoc(arms.after, d.slug, ms)] as const,
      out: [perDoc(arms.before, d.slug, out), perDoc(arms.after, d.slug, out)] as const,
      subs: mean(arms.after.map((r) => r.results.find((x) => x.slug === d.slug)?.score?.subsections ?? 0)),
    };
    console.log(
      `${d.slug.slice(0, 30).padEnd(31)} $${row.usd[0].toFixed(3)}→$${row.usd[1].toFixed(3)} ${pct(row.usd[1] / row.usd[0] - 1).padStart(5)}` +
        `   ${(row.ms[0] / 1000).toFixed(0)}s→${(row.ms[1] / 1000).toFixed(0)}s ${pct(row.ms[1] / row.ms[0] - 1).padStart(5)}` +
        `   ${row.out[0].toFixed(0)}→${row.out[1].toFixed(0)}   ${row.subs}`,
    );
    return row;
  });
  const groups: [string, (s: string) => boolean][] = [
    ["all articles (not the book)", (s) => s !== BOOK],
    ["sub-headed (paper + six)", (s) => s === PAPER || SUBHEADED.has(s)],
    ["no sub-headings (six)", (s) => s !== PAPER && s !== BOOK && !SUBHEADED.has(s)],
    ["the book", (s) => s === BOOK],
  ];
  console.log("\nmedian growth          cost    time   (worst article: cost, time)");
  for (const [name, f] of groups) {
    const g = rows.filter((r) => f(r.slug));
    const cost = g.map((r) => r.usd[1] / r.usd[0] - 1);
    const time = g.map((r) => r.ms[1] / r.ms[0] - 1);
    console.log(`${name.padEnd(28)} ${pct(median(cost)).padStart(5)} ${pct(median(time)).padStart(6)}   (${pct(Math.max(...cost))}, ${pct(Math.max(...time))})`);
    if (name.startsWith("all") && (median(cost) > 0.2 || median(time) > 0.2)) verdict.push(`median article grew ${pct(median(cost))} cost, ${pct(median(time))} time`);
  }
  /* The control's own spread: before-1 against before-2, the same way. */
  if (arms.before.length === 2) {
    const [b1, b2] = arms.before as [RunFile, RunFile];
    const spread = (f: (c: Call[]) => number) =>
      median(DOCS.filter((d) => d.slug !== BOOK).map((d) => {
        const x = b1.results.find((r) => r.slug === d.slug);
        const y = b2.results.find((r) => r.slug === d.slug);
        return x?.ok && y?.ok ? Math.abs(f(y.calls) / f(x.calls) - 1) : 0;
      }));
    console.log(`control spread (median |before-2 / before-1 − 1|): cost ${pct(spread(usd))}, time ${pct(spread(ms))}`);
  }
  console.log(`\nverdict: ${verdict.length === 0 ? "SHIP" : `DO NOT SHIP — ${verdict.join("; ")}`}`);
}

main();
