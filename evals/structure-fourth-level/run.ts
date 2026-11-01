/**
 * Eval — **does `toc/14`'s optional fourth level cost what it may, and does it
 * go where it should?** Plan 261029a § Stage 2.
 *
 *   npx tsx evals/structure-fourth-level/run.ts --label before-1 --cap 6
 *   npx tsx evals/structure-fourth-level/run.ts --label after-1 --cap 6 [--docs a,b]
 *
 * Calls production's own request (`wholeDocumentRequest`), parser and builder
 * on each document's body, once, with production's one re-ask for an answer
 * that came back whole and did not build (evals/long-structure/calls.ts § `ask`,
 * reused rather than copied). Arms are separated in time, not in code: run
 * `before-*` on the commit before the prompt change and `after-*` on the one
 * with it. A label is never overwritten.
 *
 * **The corpus is the administrator's own production articles**, read once,
 * read-only, into `data/prodread/corpus/<slug>.json` (gitignored; the read
 * script is deleted after use, docs/project/database.md § Delete such a
 * script). What is committed is numbers and slugs only, under
 * `evals/results/structure-fourth-level/`; the raw answers, which quote the
 * articles' headings, stay in `data/structure-fourth-level/`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnvLocal } from "../../src/env.js";
import { PROMPT_VERSION, SYSTEM, buildTree, parseWholeDocumentAnswer, wholeDocumentRequest, type BuildReport } from "../../src/structure.js";
import { estimateStructureTokens, STRUCTURE_HEADROOM } from "../../src/structure.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block, Tree } from "../../src/types.js";
import { ask, inPool, Ledger, type CallRecord } from "../long-structure/calls.js";
import { scoreTree, type TreeScore } from "./score.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CORPUS = path.join(ROOT, "data/prodread/corpus");
const RESULTS = path.join(ROOT, "evals/results/structure-fourth-level");
const RAW = path.join(ROOT, "data/structure-fourth-level");

/**
 * The paper Greg was reading, one book, and twelve of his articles: six whose
 * sections the author divides with sub-headings, six with none (where any
 * fourth level is a join the model invented).
 */
export const DOCS: readonly { slug: string; why: string }[] = [
  { slug: "arxiv-2308-08708-spya-xax6v4", why: "the report's paper: 2.4's six h4s" },
  { slug: "rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug", why: "a book, 1,123 blocks, h1/h2 only" },
  { slug: "arxiv-2602-11988-spya-sudvzx", why: "sub-headed: 42 h4s" },
  { slug: "arxiv-2609-16247-spya-y0kw0z", why: "sub-headed: 31 h4s" },
  { slug: "s41593-022-01026-4-spya-bh0g5s", why: "sub-headed: 37 h3, 17 h4" },
  { slug: "constitution", why: "sub-headed: 20 h3, 8 h4, long" },
  { slug: "pmc13013618-spya-uekgh6", why: "sub-headed: 7 h3, 6 h4" },
  { slug: "2607-22753v1-spya-nfrmw5", why: "sub-headed: 24 h3, 7 h4" },
  { slug: "noema-mythology-of-conscious-ai", why: "no sub-headings, long sections" },
  { slug: "towards-a-theory-of-bugs-the-ruliology-of-the-unexpected", why: "h2 only, 244 blocks" },
  { slug: "dhp-intro-than-spya-v5mdhd", why: "h2 only, 364 blocks, long sections" },
  { slug: "tinbergen1963onethology-spya-ks84se", why: "h2 only, 96 blocks" },
  { slug: "arxiv-2212-spya-u5293w", why: "h1/h2/h3, 334 blocks" },
  { slug: "what-if-we-had-bigger-brains-imagining-minds-beyond-ours", why: "h2 only, 172 blocks" },
];

interface DocResult {
  slug: string;
  blocks: number;
  body: number;
  calls: CallRecord[];
  ok: boolean;
  failure?: string;
  score?: TreeScore;
  repairs?: number;
  droppedChildren?: number;
  droppedHeadings?: number;
  collapsedRungs?: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const label = arg("label");
  if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error("--label <before-1|after-1|…> is required");
  const cap = Number(arg("cap") ?? "6");
  const wanted = arg("docs")?.split(",") ?? DOCS.map((d) => d.slug);
  const out = path.join(RESULTS, `${label}.json`);
  if (existsSync(out)) throw new Error(`${out} exists; a label is never overwritten`);
  mkdirSync(path.join(RAW, label), { recursive: true });
  const ledger = new Ledger(path.join(RAW, label, "ledger.jsonl"), cap, false);
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"], { cwd: ROOT }).toString().trim() !== "";

  const results = await inPool(
    4,
    wanted.map((slug) => async (): Promise<DocResult> => {
      const { blocks } = JSON.parse(readFileSync(path.join(CORPUS, `${slug}.json`), "utf8")) as { blocks: Block[] };
      const { body } = splitBlocks(blocks);
      const calls: CallRecord[] = [];
      const base = { slug, blocks: blocks.length, body: body.length, calls };
      let request: ReturnType<typeof wholeDocumentRequest>;
      try {
        request = wholeDocumentRequest(body);
      } catch (err) {
        return { ...base, ok: false, failure: `too long for one call: ${(err as Error).message.slice(0, 120)}` };
      }
      let report: BuildReport | undefined;
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
            report = { repairs: [], droppedChildren: [], unresolvedStarts: [], rangelessChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] };
            const { root } = parseWholeDocumentAnswer(text, body, report);
            return buildTree(root, {}, body, slug, report);
          },
        },
      );
      if (answerText) writeFileSync(path.join(RAW, label, `${slug}.txt`), answerText);
      if (!asked.ok) return { ...base, ok: false, failure: asked.reason };
      const r = report!;
      console.log(`${label} ${slug}: ${calls.map((c) => `${(c.ms / 1000).toFixed(0)}s $${c.usd.toFixed(3)} ${c.outcome}`).join(" + ")}`);
      return {
        ...base,
        ok: true,
        score: scoreTree(asked.value, body),
        repairs: r.repairs.length,
        droppedChildren: r.droppedChildren.length,
        droppedHeadings: r.droppedHeadings.length,
        collapsedRungs: r.collapsedRungs.length,
      };
    }),
  );

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
