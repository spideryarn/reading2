/**
 * Eval — **the staged fourth level**: today's whole-document call untouched
 * (stage 1), then production's own stage 2 (src/structure-subsections.ts) on
 * the tree it made. Plan 261101d.
 *
 *   npx tsx evals/structure-fourth-level/staged-dump.ts      # once, local database only
 *   npx tsx evals/structure-fourth-level/staged-run.ts --label staged-1 --cap 15 [--docs a,b]
 *   npx tsx evals/structure-fourth-level/staged-run.ts --label staged-1b --from staged-1   # stage 2 again, same stage-1 trees
 *
 * Paired: each document's stage 1 is made once (production's request, parser,
 * builder and one re-ask, as run.ts does) and scored as the **control**; then
 * `addSubsections` runs on that very tree with the live executor, and the
 * result is scored as **staged**. So any difference between the two is stage
 * 2's alone. Both trees, and what stage 2 wrote, go to gitignored
 * `data/structure-fourth-level/staged/<label>/`; the committed results file is
 * numbers and slugs.
 *
 * The first smoke run of this harness drove September's deepening wave
 * instead; what it found is in the plan, and why stage 2 replaced it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { collectSpend, totalSpend, type AiCallRow } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { planBatches } from "../../src/labels.js";
import { PROMPT_VERSION, SYSTEM, buildTree, parseWholeDocumentAnswer, wholeDocumentRequest, type BuildReport } from "../../src/structure.js";
import { estimateStructureTokens, STRUCTURE_HEADROOM } from "../../src/structure.js";
import {
  SUBSECTIONS_PROMPT_VERSION,
  SUBSECTIONS_SYSTEM,
  addSubsections,
  liveSubsectionsExecutor,
  planSubsections,
  type SubsectionStats,
} from "../../src/structure-subsections.js";
import { assertTreeSound } from "../../src/tree-invariants.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import { ask, evalSpend, inPool, Ledger, POWER, type CallRecord } from "../long-structure/calls.js";
import { STAGED_DOCS } from "./staged-corpus.js";
import { scoreTree, type TreeScore } from "./score.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CORPUS = path.join(ROOT, "data/structure-fourth-level/corpus");
const RESULTS = path.join(ROOT, "evals/results/structure-fourth-level");
const RAW = path.join(ROOT, "data/structure-fourth-level/staged");

export interface StagedResult {
  slug: string;
  blocks: number;
  body: number;
  ok: boolean;
  failure?: string;
  wave1: { calls: CallRecord[]; ms: number; usd: number };
  control?: TreeScore;
  controlLabelBatches?: number;
  stage2?: { ms: number; usd: number; calls: number; failed?: string; stats?: SubsectionStats };
  staged?: TreeScore;
  stagedLabelBatches?: number;
  /** Gate 2 and 3 of the plan, checked mechanically. */
  checks?: Checks;
}

export interface Checks {
  /** Every stage-1 internal node is still there with every field the same. */
  stage1Kept: boolean;
  /** The leaves are the same blocks. */
  leavesKept: boolean;
  /** Every new internal node is depth 3, under a depth-2 node, with only leaves under it. */
  newNodesShaped: boolean;
  /** Every new node starts where the planner said a child starts. */
  startsAsPlanned: boolean;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const emptyReport = (): BuildReport => ({ repairs: [], droppedChildren: [], unresolvedStarts: [], rangelessChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] });

/** A node's identity that survives renumbering: its range and its ancestors' ranges. */
function pathOf(tree: Tree, n: TreeNode): string {
  const out: string[] = [];
  for (let at: TreeNode | undefined = n; at; at = at.parent == null ? undefined : tree.nodes[at.parent]) out.push(at.range.join("–"));
  return out.reverse().join(" > ");
}

export function check(control: Tree, staged: Tree, plannedStarts: ReadonlySet<string>): Checks {
  const internal = (t: Tree) => Object.values(t.nodes).filter((n) => n.children.length > 0);
  const fields = (_t: Tree, n: TreeNode) => JSON.stringify([n.depth, n.title, n.gist, n.question, n.sourceHeading, n.treatment]);
  const after = new Map(internal(staged).map((n) => [n.range.join("–") + "@" + n.depth, n]));
  const stage1Kept = internal(control).every((n) => {
    const m = after.get(n.range.join("–") + "@" + n.depth);
    return m !== undefined && fields(control, n) === fields(staged, m) && pathOf(control, n) === pathOf(staged, m);
  });
  const leaves = (t: Tree) => Object.values(t.nodes).filter((n) => n.children.length === 0).map((n) => n.range.join("–")).sort().join(",");
  const old = new Set(internal(control).map((n) => n.range.join("–") + "@" + n.depth));
  const added = internal(staged).filter((n) => !old.has(n.range.join("–") + "@" + n.depth));
  const newNodesShaped = added.every(
    (n) => n.depth === 3 && n.parent != null && staged.nodes[n.parent]!.depth === 2 && n.children.every((c) => staged.nodes[c]!.children.length === 0),
  );
  const startsAsPlanned = added.every((n) => plannedStarts.has(n.range[0]));
  return { stage1Kept, leavesKept: leaves(control) === leaves(staged), newNodesShaped, startsAsPlanned };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const label = arg("label");
  if (!label || !/^staged-[a-z0-9-]+$/.test(label)) throw new Error("--label staged-<n> is required");
  const cap = Number(arg("cap") ?? "15");
  const wanted = arg("docs")?.split(",") ?? STAGED_DOCS.map((d) => d.slug);
  const out = path.join(RESULTS, `${label}.json`);
  if (existsSync(out)) throw new Error(`${out} exists; a label is never overwritten`);
  const raw = path.join(RAW, label);
  mkdirSync(raw, { recursive: true });
  const ledger = new Ledger(path.join(raw, "ledger.jsonl"), cap, false);
  const from = arg("from");
  const fromRun = from === undefined ? undefined : (JSON.parse(readFileSync(path.join(RESULTS, `${from}.json`), "utf8")) as { results: StagedResult[] });
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"], { cwd: ROOT }).toString().trim() !== "";

  const results = await inPool(
    4,
    wanted.map((slug) => async (): Promise<StagedResult> => {
      const { blocks } = JSON.parse(readFileSync(path.join(CORPUS, `${slug}.json`), "utf8")) as { blocks: Block[] };
      const { body } = splitBlocks(blocks);
      const calls: CallRecord[] = [];
      const base = { slug, blocks: blocks.length, body: body.length };
      const wave1 = () => ({ calls, ms: calls.reduce((a, c) => a + c.ms, 0), usd: calls.reduce((a, c) => a + c.usd, 0) });
      /* `--from <label>`: stage 1 is that run's saved tree and its recorded cost,
         so a change to stage 2 alone is measured on the very same trees. */
      if (from !== undefined) {
        const prior = fromRun!.results.find((r) => r.slug === slug);
        if (!prior?.ok) return { ...base, ok: false, wave1: prior?.wave1 ?? wave1(), failure: prior?.failure ?? "not in the prior run" };
        calls.push(...prior.wave1.calls);
        return stage2(slug, body, base, JSON.parse(readFileSync(path.join(RAW, from, `${slug}.control.json`), "utf8")) as Tree, wave1);
      }
      let request: ReturnType<typeof wholeDocumentRequest>;
      try {
        request = wholeDocumentRequest(body);
      } catch (err) {
        return { ...base, ok: false, wave1: wave1(), failure: `too long for one call: ${(err as Error).message.slice(0, 120)}` };
      }
      let answerText = "";
      const asked = await ask<Tree>(
        { cell: label, slug, ledger, calls },
        {
          purpose: "structure",
          params: request.params,
          maxTokens: request.maxTokens,
          answerTokens: estimateStructureTokens(body),
          headroom: STRUCTURE_HEADROOM,
          capMs: 600_000,
          accept: (text) => {
            answerText = text;
            const report = emptyReport();
            const { root } = parseWholeDocumentAnswer(text, body, report);
            return buildTree(root, {}, body, slug, report);
          },
        },
      );
      if (answerText) writeFileSync(path.join(raw, `${slug}.wave1.txt`), answerText);
      if (!asked.ok) return { ...base, ok: false, wave1: wave1(), failure: asked.reason };
      return stage2(slug, body, base, asked.value, wave1);
    }),
  );

  async function stage2(slug: string, body: Block[], base: { slug: string; blocks: number; body: number }, control: Tree, wave1: () => StagedResult["wave1"]): Promise<StagedResult> {
      writeFileSync(path.join(raw, `${slug}.control.json`), JSON.stringify(control));
      const { plans } = planSubsections(control, body);
      const plannedStarts = new Set(plans.flatMap((p) => p.children.map((c) => body[c.lo]!.id)));

      /* Stage 2, as generateStructure runs it: on the body tree, then rebuilt
         from scratch with buildTree and checked. */
      const rows: AiCallRow[] = [];
      const started = Date.now();
      let staged: Tree = control;
      let stats: SubsectionStats | undefined;
      let failed: string | undefined;
      const { report: spend } = await collectSpend(async () => {
        try {
          const added = await addSubsections({ tree: control, body, slug, execute: liveSubsectionsExecutor(POWER) });
          stats = added.stats;
          if (added.root !== null) {
            staged = buildTree(added.root, {}, body, slug, emptyReport());
            assertTreeSound(body, staged);
          }
        } catch (err) {
          failed = `${(err as Error).name}: ${(err as Error).message.slice(0, 200)}`;
        }
      }, evalSpend(ledger, slug, rows));
      for (const row of rows) ledger.write(label!, "structure-subsections", undefined, 1, row);
      const ms = Date.now() - started;
      const usd = totalSpend(spend.calls).nanos / 1e9;
      writeFileSync(path.join(raw, `${slug}.staged.json`), JSON.stringify(staged));
      const result: StagedResult = {
        ...base,
        ok: true,
        wave1: wave1(),
        control: scoreTree(control, body),
        controlLabelBatches: planBatches(control, body).length,
        stage2: { ms, usd, calls: rows.length, ...(failed ? { failed } : {}), ...(stats ? { stats } : {}) },
        staged: scoreTree(staged, body),
        stagedLabelBatches: planBatches(staged, body).length,
        checks: check(control, staged, plannedStarts),
      };
      console.log(
        `${label} ${slug}: stage1 ${(result.wave1.ms / 1000).toFixed(0)}s $${result.wave1.usd.toFixed(3)} · ` +
          `stage2 ${(ms / 1000).toFixed(0)}s $${usd.toFixed(3)} ${stats?.eligible ?? 0} eligible ${stats?.made ?? 0} made ${stats?.added ?? 0} added${failed ? ` FAILED ${failed}` : ""}`,
      );
      return result;
  }

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        label,
        at: new Date().toISOString(),
        commit,
        srcDirty: dirty,
        promptVersion: PROMPT_VERSION,
        systemSha256: createHash("sha256").update(SYSTEM).digest("hex").slice(0, 16),
        subsectionsPromptVersion: SUBSECTIONS_PROMPT_VERSION,
        subsectionsSha256: createHash("sha256").update(SUBSECTIONS_SYSTEM).digest("hex").slice(0, 16),
        spentUsd: Number(ledger.total().toFixed(4)),
        results,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`${label}: $${ledger.total().toFixed(3)} spent → ${path.relative(ROOT, out)}`);
}

await main();
process.exit(0);
