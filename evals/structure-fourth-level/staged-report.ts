/**
 * The verdict on stage 2 from two paired runs of staged-run.ts. Free: it reads
 * the results files and the saved trees. Plan 261101d § The measurement.
 *
 *   npx tsx evals/structure-fourth-level/staged-report.ts staged-1,staged-2 [--annotation <file>]
 *
 * Gates, quality before money:
 * 1. the paper: 2.4.1–2.4.6 under 2.4, nothing else in 2.4 — in every run where
 *    stage 1 kept 2.5 beside 2.4 (where it did not, 2.4 must be untouched);
 * 2. every new node depth 3 under a depth-2 section, only leaves under it,
 *    starting where the planner said;
 * 3. every stage-1 node kept with every field, the same leaves;
 * 4. sections lost to a bad answer at most 1 in 20 asked, and no call failed whole;
 * 5. recall against an independent annotation, boundary by boundary (when given);
 * 7. cost and time on the articles stage 2 touched: median structure-step cost
 *    under +40%, median added wall-clock under 20 s, the book under half its lease.
 * (6, the blind read of the gists, is a separate subagent pass.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { splitBlocks } from "../../src/supplement.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import { paperGate } from "./report.js";
import { BOOK, PAPER, STAGED_DOCS } from "./staged-corpus.js";
import type { StagedResult } from "./staged-run.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RESULTS = path.join(ROOT, "evals/results/structure-fourth-level");
const RAW = path.join(ROOT, "data/structure-fourth-level/staged");
const CORPUS = path.join(ROOT, "data/structure-fourth-level/corpus");
const STEP_BUDGET_MS = 700_000;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length === 0 ? NaN : s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`;

function bodyOf(slug: string): Block[] {
  const { blocks } = JSON.parse(readFileSync(path.join(CORPUS, `${slug}.json`), "utf8")) as { blocks: Block[] };
  return splitBlocks(blocks).body;
}
function treeOf(label: string, slug: string, arm: "control" | "staged"): Tree {
  return JSON.parse(readFileSync(path.join(RAW, label, `${slug}.${arm}.json`), "utf8")) as Tree;
}

/** 2.5 is a section, the sibling of 2.4, in this tree. */
function kept25(tree: Tree, body: Block[]): boolean {
  return !paperGate(tree, body).some((f) => f.startsWith("2.5") || f.startsWith("2.4 does not"));
}

/** Sub-section starts (block ids) the staged tree added, by section start. */
export function addedStarts(control: Tree, staged: Tree): Map<string, string[]> {
  const old = new Set(Object.values(control.nodes).filter((n) => n.children.length > 0).map((n) => `${n.range.join()}@${n.depth}`));
  const out = new Map<string, string[]>();
  for (const n of Object.values(staged.nodes)) {
    if (n.children.length === 0 || old.has(`${n.range.join()}@${n.depth}`)) continue;
    const parent: TreeNode = staged.nodes[n.parent!]!;
    out.set(parent.range[0], [...(out.get(parent.range[0]) ?? []), n.range[0]]);
  }
  return out;
}

function main(): void {
  const labels = process.argv[2]?.split(",") ?? [];
  if (labels.length !== 2) throw new Error("give two run labels: staged-1,staged-2");
  const runs = labels.map((l) => JSON.parse(readFileSync(path.join(RESULTS, `${l}.json`), "utf8")) as { label: string; srcDirty: boolean; subsectionsSha256: string; results: StagedResult[] });
  if (runs.some((r) => r.srcDirty)) console.log("WARNING: a run was made with dirty src");
  if (new Set(runs.map((r) => r.subsectionsSha256)).size !== 1) throw new Error("the runs used different stage-2 prompts");
  const verdict: string[] = [];

  /* Gate 1. */
  const body = bodyOf(PAPER);
  for (const run of runs) {
    const control = treeOf(run.label, PAPER, "control");
    const staged = treeOf(run.label, PAPER, "staged");
    const faults = paperGate(staged, body);
    if (kept25(control, body)) {
      const inside = (() => {
        const s24 = Object.values(staged.nodes).find((n) => n.depth === 2 && n.title.startsWith("2.4"));
        return s24 ? s24.children.map((c) => staged.nodes[c]!).filter((c) => c.children.length > 0).map((c) => c.title) : [];
      })();
      const extra = inside.filter((t) => !/^2\.4\.[1-6] /.test(t)).length;
      console.log(`gate 1, ${run.label}: ${faults.length ? faults.join("; ") : "pass"}; ${inside.length} children of 2.4, ${extra} not a 2.4.k (the opening)`);
      if (faults.length || extra > 1) verdict.push(`paper gate failed in ${run.label}`);
    } else {
      const untouched = addedStarts(control, staged).size === 0 || ![...addedStarts(control, staged).keys()].some((k) => body.findIndex((b) => b.id === k) <= body.findIndex((b) => b.text.startsWith("2.4 Other")));
      console.log(`gate 1, ${run.label}: stage 1 swallowed 2.5; 2.4 ${untouched ? "untouched (pass)" : "DIVIDED (fail)"}`);
      if (!untouched) verdict.push(`paper: 2.4 divided though 2.5 was swallowed, ${run.label}`);
    }
  }

  /* Gates 2–4. */
  let asked = 0;
  let lost = 0;
  let failedCalls = 0;
  for (const run of runs) {
    for (const r of run.results) {
      if (!r.ok) {
        console.log(`  ${run.label} ${r.slug}: stage 1 failed (${r.failure}) — not stage 2's`);
        continue;
      }
      const c = r.checks!;
      if (!c.stage1Kept || !c.leavesKept || !c.newNodesShaped || !c.startsAsPlanned) {
        verdict.push(`gate 2/3 ${run.label} ${r.slug}: ${JSON.stringify(c)}`);
      }
      if (r.stage2?.failed) verdict.push(`stage 2 threw on ${run.label} ${r.slug}: ${r.stage2.failed}`);
      const s = r.stage2?.stats;
      if (s) {
        asked += s.eligible;
        lost += s.failedSections;
        failedCalls += s.failedCalls;
      }
    }
  }
  console.log(`gate 4: ${lost} of ${asked} sections lost to a bad answer; ${failedCalls} calls failed whole`);
  if (lost * 20 > asked || failedCalls > 0) verdict.push("gate 4 failed");

  /* Skips, by reason. */
  const skipped: Record<string, number> = {};
  for (const run of runs) for (const r of run.results) for (const [k, v] of Object.entries(r.stage2?.stats?.skipped ?? {})) skipped[k] = (skipped[k] ?? 0) + v;
  console.log(`skips over both runs: ${JSON.stringify(skipped)}`);

  /* Gate 7, per article as the mean of its two runs. */
  const touched: { slug: string; cost: number; added: number; usd: number }[] = [];
  for (const { slug } of STAGED_DOCS) {
    const rs = runs.map((run) => run.results.find((r) => r.slug === slug)).filter((r): r is StagedResult => r?.ok === true);
    if (rs.length === 0 || rs.every((r) => (r.stage2?.stats?.made ?? 0) === 0)) continue;
    const s1 = rs.reduce((a, r) => a + r.wave1.usd, 0) / rs.length;
    const s2 = rs.reduce((a, r) => a + (r.stage2?.usd ?? 0), 0) / rs.length;
    const ms = rs.reduce((a, r) => a + (r.stage2?.ms ?? 0), 0) / rs.length;
    touched.push({ slug, cost: s2 / s1, added: ms / 1000, usd: s2 });
    console.log(`  ${slug.slice(0, 44).padEnd(44)} stage 2 ${pct(s2 / s1)} cost ($${s2.toFixed(3)}), +${(ms / 1000).toFixed(0)} s`);
  }
  const mc = median(touched.map((t) => t.cost));
  const mt = median(touched.map((t) => t.added));
  console.log(`gate 7: ${touched.length} articles touched; median cost ${pct(mc)}, median added ${mt.toFixed(0)} s, worst ${pct(Math.max(...touched.map((t) => t.cost)))}`);
  if (!(mc < 0.4)) verdict.push(`median cost ${pct(mc)} is over +40%`);
  if (!(mt < 20)) verdict.push(`median added time ${mt.toFixed(0)} s is over 20 s`);
  for (const run of runs) {
    const b = run.results.find((r) => r.slug === BOOK);
    if (b?.ok) {
      const total = b.wave1.ms + (b.stage2?.ms ?? 0);
      console.log(`  book, ${run.label}: ${(total / 1000).toFixed(0)} s of a ${STEP_BUDGET_MS / 1000} s step`);
      if (total > STEP_BUDGET_MS / 2) verdict.push(`the book took ${(total / 1000).toFixed(0)} s in ${run.label}`);
    }
  }

  /* Gate 5, against an independent annotation: { "<slug>": { "<sectionStartIndex>": [childStartIndex, ...] } }. */
  const ai = process.argv.indexOf("--annotation");
  if (ai > 0) {
    /* `--annotation staged-1=<file>`: an annotation is of one run's stage-1 trees, so it is read against that run only. */
    const [forLabel, file] = process.argv[ai + 1]!.split("=") as [string, string];
    const want = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, number[]>>;
    for (const run of runs.filter((r) => r.label === forLabel)) {
      let expected = 0;
      let hit = 0;
      let made = 0;
      let right = 0;
      for (const [slug, sections] of Object.entries(want)) {
        const b = bodyOf(slug);
        const added = addedStarts(treeOf(run.label, slug, "control"), treeOf(run.label, slug, "staged"));
        const got = new Map([...added].map(([k, v]) => [b.findIndex((x) => x.id === k), new Set(v.map((id) => b.findIndex((x) => x.id === id)))]));
        for (const [lo, starts] of Object.entries(sections)) {
          const boundaries = starts.filter((s) => s !== Number(lo));
          expected += boundaries.length;
          const g = got.get(Number(lo));
          hit += boundaries.filter((s) => g?.has(s)).length;
        }
        for (const [lo, g] of got) {
          for (const s of g) {
            if (s === lo) continue;
            made += 1;
            if (sections[String(lo)]?.includes(s)) right += 1;
            else console.log(`  ${run.label} ${slug}: a boundary at [${s}] in section [${lo}] the annotation does not have`);
          }
        }
      }
      console.log(`gate 5, ${run.label}: recall ${hit}/${expected} = ${pct(hit / expected - 0).replace("+", "")}, precision ${right}/${made}`);
      if (hit < 0.9 * expected) verdict.push(`recall under 90% in ${run.label}`);
      if (right < made) verdict.push(`precision under 100% in ${run.label}`);
    }
  }

  console.log(verdict.length ? `\nVERDICT: FAIL\n- ${verdict.join("\n- ")}` : "\nVERDICT: every gate here passes");
}

main();
