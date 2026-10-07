/**
 * SPIKE (throwaway), second paid pass for plan 261005a stage E. Three small
 * experiments the first run (spike-parts.ts run) asked for:
 *
 *  A. "refill": a depth-1 chapter that came back with NO sections and more
 *     than 60 blocks is put through the ordinary call on its own, and its
 *     depth-1 children replace it. (The first run had one: 183 blocks titled
 *     "Afterword", holding two whole stories.)
 *  B. "hint": slices 2 and 3 again, with two plain sentences in front of the
 *     blocks saying this is one stretch of a longer book and depth 1 is for
 *     whole stories or chapters. SYSTEM is untouched; only the user turn grows.
 *  C. the root prompt, second draft (the first ran to 26 words and counted
 *     parts as stories).
 *
 *   npx tsx evals/long-documents/spike-followups.ts
 *
 * Same rules as spike-parts.ts: the local database is read, and its only
 * write is one `ai_calls` row per paid call; spend is also in the results file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { allOrStop } from "../../src/concurrency.js";
import { loadEnvLocal } from "../../src/env.js";
import { unaskableBatches } from "../../src/labels.js";
import { finishedText, streamMessage, type MessagesBody } from "../../src/messages-stream.js";
import { withMessagesJsonSchema } from "../../src/messages-structured-output.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { environmentOwnerId } from "../../src/owner.js";
import { plainWords } from "../../src/plain-words.js";
import {
  buildTree,
  estimateStructureTokens,
  parseWholeDocumentAnswer,
  STRUCTURE_HEADROOM,
  wholeDocumentRequest,
  type BuildReport,
  type ModelNode,
} from "../../src/structure.js";
import { costStore } from "../../src/store/ai-calls.js";
import { isSupplementNode } from "../../src/supplement.js";
import { checkTree } from "../../src/tree-invariants.js";
import type { Block, Tree } from "../../src/types.js";

const SLUG = "s3-doctorow-250p-spya-jg872v";
const OUT = path.resolve("evals/results/long-documents-2026-10-05");
const POWER = "standard" as const;
const FAT = 60;

const emptyReport = (): BuildReport => ({ repairs: [], droppedChildren: [], rangelessChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] });
const save = (name: string, value: unknown) => writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 1)}\n`);

loadEnvLocal();
if (new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname !== "127.0.0.1") throw new Error("not the local database; refusing");
const { loadArticle } = await import("../../src/store/index.js");
const article = (await loadArticle(SLUG)) as unknown as { blocks: Block[]; tree: Tree };
const body = article.blocks;
const title = article.tree.nodes[article.tree.rootId]!.title;
const at = new Map(body.map((b, i) => [b.id, i]));
const slices = (JSON.parse(readFileSync(path.join(OUT, "plan.json"), "utf8")).plans[0].slices as { lo: number; hi: number }[]);
const baseline = slices.map((s, i) => parseWholeDocumentAnswer(readFileSync(path.join(OUT, `slice-${i}-answer.json`), "utf8"), body.slice(s.lo, s.hi + 1)).root);

const HINT = (lo: number, hi: number) =>
  `This is one stretch of a longer book: blocks ${lo + 1} to ${hi + 1} of ${body.length}. ` +
  `Its table of contents will be joined to the other stretches' under one root, so your root is a placeholder ` +
  `and your depth-1 nodes become the BOOK's chapters. Make each depth-1 node one whole story, chapter or ` +
  `other piece the author set apart, however long or short, even if that leaves fewer than 5; ` +
  `a piece's afterword belongs inside its own node. Put the scenes inside a story at depth 2.\n\n`;

const ROOT_SYSTEM_2 = `You are writing the top line of a book's table of contents.

The book was too long to read in one go, so its parts were summarised
separately. You receive the book's title and, for each part in order, the
part's title and its one-sentence gist. You have not seen the book itself:
work only from these lines, and claim nothing they do not support.

One piece of the book is often spread over several parts in a row, so the
number of parts is NOT the number of stories, chapters or essays. Never give a
count of them.

Write two things about the WHOLE book.

GIST

- Exactly ONE sentence of AT MOST 18 words. Count them. It is the blurb a
  reader sees on a shelf, and it is shorter than any part's gist.
- THE ONE claim the book makes. A collection of separate pieces has no single
  claim: say what its pieces have in common, in one clause, and stop.
- No list of topics, no list of parts, no author's name, no dashes.
- Do not narrate: not "the book opens by", "this collection explores".
- At most ONE term of art; everything else in ordinary words.

QUESTION

- Exactly ONE question: the one the whole book exists to answer.
- Shape: "<topic> — <question>? (<shape hint>)". The topic first, in the
  book's own words; then the question, ending in "?"; then an optional hint
  in brackets that says the KIND of answer ("short stories", "an argument and
  a case study"), never its content and never a number.
- "Why", "how" or "what follows if": never yes/no, never something one fact
  settles, never the gist with a question mark on it.
- Under 20 words in all.

OUTPUT

JSON only, no prose, no code fence: {"gist": "...", "question": "..."}

${plainWords("explain", "ask")}`;

const ROOT_SCHEMA = { type: "object", properties: { gist: { type: "string" }, question: { type: "string" } }, required: ["gist", "question"], additionalProperties: false } as const;

interface Asked { name: string; lo: number; hi: number; ms: number; inputTokens: number; outputTokens: number; ok: boolean; error?: string; root?: ModelNode; repairs?: number; droppedChildren?: number }

async function ask(name: string, lo: number, hi: number, hint: boolean): Promise<Asked> {
  const part = body.slice(lo, hi + 1);
  const req = wholeDocumentRequest(part);
  const params: MessagesBody = hint
    ? { ...req.params, messages: [{ role: "user", content: HINT(lo, hi) + req.user }] }
    : req.params;
  const t0 = Date.now();
  let message: Anthropic.Message;
  try {
    message = await streamMessage("structure", params, { power: POWER, signal: AbortSignal.timeout(700_000) }).finalMessage();
  } catch (err) {
    return { name, lo, hi, ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, ok: false, error: (err as Error).name };
  }
  const base = { name, lo, hi, ms: Date.now() - t0, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
  try {
    const answer = finishedText(message, "table of contents", req.maxTokens, estimateStructureTokens(part), STRUCTURE_HEADROOM);
    writeFileSync(path.join(OUT, `${name}-answer.json`), answer);
    const built = emptyReport();
    const { root } = parseWholeDocumentAnswer(answer, part, built);
    const problems = checkTree(part, buildTree(root, {}, part, SLUG, built)).problems;
    if (problems.length) throw new Error(`checkTree: ${problems.length}`);
    return { ...base, ok: true, root, repairs: built.repairs.length, droppedChildren: built.droppedChildren.length };
  } catch (err) {
    return { ...base, ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

function stitched(name: string, parts: ModelNode[], root: { gist: string; question: string }) {
  const built = emptyReport();
  const tree = buildTree({ title, ...root, range: [body[0]!.id, body.at(-1)!.id], children: parts }, {}, body, SLUG, built);
  const check = checkTree(body, tree);
  const leaf: Record<number, number> = {};
  for (const n of Object.values(tree.nodes)) if (n.children.length === 0) leaf[n.depth] = (leaf[n.depth] ?? 0) + 1;
  const d1 = tree.nodes[tree.rootId]!.children.map((id) => tree.nodes[id]!).filter((n) => !isSupplementNode(n));
  const size = (n: { range: [string, string] }) => at.get(n.range[1])! - at.get(n.range[0])! + 1;
  save(`${name}-tree.json`, tree);
  return {
    name,
    checkTreeProblems: check.problems,
    leafDepths: leaf,
    parts: d1.length,
    sections: Object.values(tree.nodes).filter((n) => n.depth === 2 && n.children.length > 0).length,
    largestSectionlessPart: Math.max(0, ...d1.filter((n) => tree.nodes[n.children[0]!]!.children.length === 0).map(size)),
    unaskableLabelBatches: unaskableBatches(tree, body).length,
    stitchRepairs: built.repairs.length,
    root: { gist: tree.nodes[tree.rootId]!.gist, question: tree.nodes[tree.rootId]!.question },
    depth1: d1.map((n) => ({ from: at.get(n.range[0]), blocks: size(n), sections: n.children.filter((id) => tree.nodes[id]!.children.length > 0).length, title: n.title, gist: n.gist })),
  };
}

const fat = baseline.flatMap((r) => r.children ?? []).filter((c) => !c.children?.length && at.get(c.range[1])! - at.get(c.range[0])! + 1 > FAT);
console.log(`fat sectionless chapters to refill: ${fat.map((c) => `${at.get(c.range[0])}-${at.get(c.range[1])}`).join(", ") || "none"}`);

const began = Date.now();
const { result, report } = await collectSpend(
  async () => {
    // Drain all paid siblings before the collector closes, including across the two groups.
    const answers = await allOrStop([
      ...fat.map((c, i) => ask(`refill-${i}`, at.get(c.range[0])!, at.get(c.range[1])!, false)),
      ...[2, 3].map((i) => ask(`hint-slice-${i}`, slices[i]!.lo, slices[i]!.hi, true)),
    ], () => {});
    const refills = answers.slice(0, fat.length);
    const hinted = answers.slice(fat.length);
    const refilled = baseline.flatMap((r) => r.children ?? []).flatMap((c) => {
      const i = fat.indexOf(c);
      const got = i >= 0 ? refills[i] : undefined;
      return got?.ok && got.root?.children?.length ? got.root.children : [c];
    });
    const user = [`BOOK TITLE: ${title}`, "", "PARTS, in order:", ...refilled.map((p, i) => `${i + 1}. ${p.title} — ${p.gist ?? "(no gist)"}`)].join("\n");
    const t0 = Date.now();
    const message = await streamMessage(
      "structure",
      withMessagesJsonSchema({ max_tokens: 6000, thinking: { type: "adaptive" }, output_config: { effort: "low" }, system: ROOT_SYSTEM_2, messages: [{ role: "user", content: user }] }, ROOT_SCHEMA),
      { power: POWER },
    ).finalMessage();
    const root = parseJsonAnswer<{ gist: string; question: string }>(finishedText(message, "book root", 6000, 200), "the book root response");
    return { refills, hinted, refilled, root, rootMs: Date.now() - t0 };
  },
  { attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: SLUG }, sink: (row) => costStore.record(row) },
);

const hintedParts = [
  ...(baseline[0]!.children ?? []),
  ...(baseline[1]!.children ?? []),
  ...result.hinted.flatMap((h, i) => (h.ok ? h.root!.children ?? [] : baseline[2 + i]!.children ?? [])),
];
const out = {
  wallMs: Date.now() - began,
  dollars: totalSpend(report.calls).nanos / 1e9,
  calls: report.calls.map((c) => ({ ms: c.ms, inputTokens: c.inputTokens, outputTokens: c.outputTokens, dollars: totalSpend([c]).nanos / 1e9, outcome: c.outcome })),
  refills: result.refills.map(({ root: r, ...rest }) => ({ ...rest, depth1: r?.children?.length ?? 0 })),
  hinted: result.hinted.map(({ root: r, ...rest }) => ({ ...rest, depth1: r?.children?.length ?? 0 })),
  root2: result.root,
  root2GistWords: result.root.gist.trim().split(/\s+/).length,
  rootMs: result.rootMs,
  stitchedRefilled: stitched("stitched-refilled", result.refilled, result.root),
  stitchedHinted: stitched("stitched-hinted", hintedParts, result.root),
};
save("followups.json", out);
console.log(JSON.stringify({ ...out, stitchedRefilled: { ...out.stitchedRefilled, depth1: undefined }, stitchedHinted: { ...out.stitchedHinted, depth1: undefined } }, null, 1));
for (const s of [out.stitchedRefilled, out.stitchedHinted]) {
  console.log(`\n${s.name}`);
  for (const p of s.depth1) console.log(`${String(p.from).padStart(5)} ${String(p.blocks).padStart(5)} ${String(p.sections).padStart(3)} ${p.title}`);
}
process.exit(0);
