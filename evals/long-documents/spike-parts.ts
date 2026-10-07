/**
 * SPIKE (throwaway) for plan 261005a stage E: "slices, stitched".
 *
 * Cut a too-long body into consecutive slices on the bounded tree's part (else
 * section) boundaries, run the ordinary whole-document structure call on each,
 * and stitch the slices' depth-1 children under one book root.
 *
 *   npx tsx evals/long-documents/spike-parts.ts plan            # free
 *   npx tsx evals/long-documents/spike-parts.ts run             # paid: slices + root call
 *   npx tsx evals/long-documents/spike-parts.ts stitch          # free, from saved answers
 *
 * Reads the local database, and writes one `ai_calls` row per paid call and
 * nothing else to it. It was first told to leave the database alone and kept
 * its spend only in the results file; since 2026-10-07 an eval's spend is
 * refused without a ledger (src/ai-spend.ts § UnrecordedSpendRefused).
 * Results hold ids, titles and gists; never block prose.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { collectSpend, totalSpend, type AiCallRow, type SpendRecord } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { buildBoundedHeadingTree } from "../../src/heading-tree.js";
import { unaskableBatches } from "../../src/labels.js";
import { finishedText, streamMessage } from "../../src/messages-stream.js";
import { withMessagesJsonSchema } from "../../src/messages-structured-output.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { environmentOwnerId } from "../../src/owner.js";
import { plainWords } from "../../src/plain-words.js";
import {
  buildTree,
  estimateStructureTokens,
  MAX_QUESTION_DEPTH,
  parseWholeDocumentAnswer,
  STRUCTURE_HEADROOM,
  wholeDocumentRequest,
  type BuildReport,
  type ModelNode,
} from "../../src/structure.js";
import { costStore } from "../../src/store/ai-calls.js";
import { appendSupplement, isSupplementNode, splitBlocks } from "../../src/supplement.js";
import { checkTree } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import { DENSITIES, plainBlocks } from "../../tests/helpers/synthetic-blocks.js";

const SLUG = "s3-doctorow-250p-spya-jg872v";
const OUT = path.resolve("evals/results/long-documents-2026-10-05");
const TARGET = 1000;
const STEP_BUDGET_MS = 700_000;
const POWER = "standard" as const;

const emptyReport = (): BuildReport => ({
  repairs: [],
  droppedChildren: [],
  rangelessChildren: [],
  droppedHeadings: [],
  collapsedRungs: [],
  droppedQuestions: [],
});

const save = (name: string, value: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 1)}\n`);
};

/* ------------------------------------------------------------ planning -- */

interface Slice {
  lo: number;
  hi: number;
  /** What kind of boundary this slice STARTS on. */
  startsOn: "body-start" | "part" | "authored-section" | "section";
}

/** Body-only nodes of the bounded tree at one depth, as [lo, hi] over `body`. */
function boundaries(blocks: Block[], slug: string, title: string | undefined) {
  const { body } = splitBlocks(blocks);
  const bounded = buildBoundedHeadingTree(blocks, slug, title);
  const index = new Map(body.map((b, i) => [b.id, i]));
  const at = (depth: number) =>
    Object.values(bounded.tree.nodes)
      .filter((n) => n.depth === depth && !isSupplementNode(n) && index.has(n.range[0]) && n.children.length > 0)
      .map((n) => index.get(n.range[0])!)
      .sort((a, b) => a - b);
  /* Supplement branches hang off the root at depth 1 too; `index` is body-only
     so their starts are not in it. */
  /* Sections the AUTHOR headed, as against windows cut by count: a cut on one
     of these still falls between two things the author named. */
  const authoredStarts = Object.values(bounded.tree.nodes)
    .filter((n) => n.depth === 2 && n.sourceHeading !== undefined && index.has(n.range[0]))
    .map((n) => index.get(n.range[0])!)
    .sort((a, b) => a - b);
  return { body, bounded, partStarts: at(1), authoredStarts, sectionStarts: at(2) };
}

/**
 * k = ceil(N / target) near-equal slices. Each cut goes to the part boundary
 * nearest its ideal position when one lies within a quarter of a slice of it,
 * otherwise to the nearest section boundary. If any slice is refused by
 * `wholeDocumentRequest`, try again with one more slice.
 */
function planSlices(body: Block[], partStarts: number[], authoredStarts: number[], sectionStarts: number[], target = TARGET): Slice[] {
  const n = body.length;
  for (let k = Math.max(1, Math.ceil(n / target)); k <= n; k++) {
    const ideal = n / k;
    const cuts: { at: number; on: Slice["startsOn"] }[] = [];
    let ok = true;
    for (let j = 1; j < k; j++) {
      const want = j * ideal;
      const floor = (cuts.at(-1)?.at ?? 0) + 1;
      const nearest = (xs: number[]) =>
        xs.filter((x) => x >= floor && x < n).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
      const part = nearest(partStarts);
      const authored = nearest(authoredStarts);
      const section = nearest(sectionStarts);
      if (part !== undefined && Math.abs(part - want) <= ideal / 4) cuts.push({ at: part, on: "part" });
      else if (authored !== undefined && Math.abs(authored - want) <= ideal / 4) cuts.push({ at: authored, on: "authored-section" });
      else if (section !== undefined) cuts.push({ at: section, on: "section" });
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const slices: Slice[] = [];
    let lo = 0;
    let on: Slice["startsOn"] = "body-start";
    for (const c of [...cuts, { at: n, on: "part" as const }]) {
      slices.push({ lo, hi: c.at - 1, startsOn: on });
      lo = c.at;
      on = c.on;
    }
    const fits = slices.every((s) => {
      try {
        wholeDocumentRequest(body.slice(s.lo, s.hi + 1));
        return true;
      } catch {
        return false;
      }
    });
    if (fits) return slices;
  }
  throw new Error("no slicing fits");
}

function describePlan(name: string, blocks: Block[], slug: string, title?: string) {
  const { body, bounded, partStarts, authoredStarts, sectionStarts } = boundaries(blocks, slug, title);
  let wholeFits = true;
  try {
    wholeDocumentRequest(body);
  } catch {
    wholeFits = false;
  }
  const slices = planSlices(body, partStarts, authoredStarts, sectionStarts);
  return {
    name,
    blocks: blocks.length,
    body: body.length,
    wholeDocumentFitsOneCall: wholeFits,
    bounded: { flat: bounded.flat, parts: bounded.parts, sections: bounded.sections },
    slices: slices.map((s) => {
      const part = body.slice(s.lo, s.hi + 1);
      const req = wholeDocumentRequest(part);
      return {
        lo: s.lo,
        hi: s.hi,
        size: part.length,
        startsOn: s.startsOn,
        maxTokens: req.maxTokens,
        answerEstimate: estimateStructureTokens(part),
        userChars: req.user.length,
      };
    }),
  };
}

/* ---------------------------------------------------------- the stitch -- */

function leafDepths(tree: Tree): Record<number, number> {
  const supplement = new Set<string>();
  for (const n of Object.values(tree.nodes)) if (isSupplementNode(n)) supplement.add(n.id);
  const inSupplement = (n: TreeNode): boolean => {
    for (let at: TreeNode | undefined = n; at; at = at.parent ? tree.nodes[at.parent] : undefined) {
      if (supplement.has(at.id)) return true;
    }
    return false;
  };
  const hist: Record<number, number> = {};
  for (const n of Object.values(tree.nodes)) {
    if (n.children.length > 0 || inSupplement(n)) continue;
    hist[n.depth] = (hist[n.depth] ?? 0) + 1;
  }
  return hist;
}

/**
 * One book root over the slices' depth-1 children, built ONCE over the whole
 * body. `buildTree`'s "covers the whole article" guard is satisfied because
 * the root's range is the body's first and last block, and each slice's first
 * child was already clamped to its slice's first block by the starts kernel.
 */
function stitch(
  blocks: Block[],
  slug: string,
  sliceRoots: ModelNode[],
  root: { title: string; gist: string; question?: string },
) {
  const { body, groups } = splitBlocks(blocks);
  const proposal: ModelNode = {
    title: root.title,
    gist: root.gist,
    ...(root.question !== undefined ? { question: root.question } : {}),
    range: [body[0]!.id, body.at(-1)!.id],
    children: sliceRoots.flatMap((r) => r.children ?? []),
  };
  const built = emptyReport();
  const bodyTree = buildTree(proposal, {}, body, slug, built);
  const tree = appendSupplement(bodyTree, groups);
  const check = checkTree(blocks, tree);
  return { tree, built, check, unaskable: unaskableBatches(tree, blocks).length };
}

/* ------------------------------------------------------- the root call -- */

const ROOT_SYSTEM = `You are writing the top line of a book's table of contents.

The book was too long to read in one go, so its parts were summarised
separately. You receive the book's title and, for each part in order, the
part's title and its one-sentence gist. You have not seen the book itself:
work only from these lines, and claim nothing they do not support.

Write two things about the WHOLE book.

GIST

- Exactly ONE sentence, AT MOST 18 words. It is the blurb a reader sees on a
  shelf.
- THE ONE claim the book makes, or its one governing move if it makes no
  single claim. A collection of separate pieces has no single claim: say what
  kind of collection it is and what its pieces have in common, and stop.
- A claim or a move, not a topic label, and not a list of the parts.
- Do not narrate: not "the book opens by", "this collection explores".
- At most ONE term of art; everything else in ordinary words.

QUESTION

- Exactly ONE question: the one the whole book exists to answer.
- Shape: "<topic> — <question>? (<shape hint>)". The topic first, in the
  book's own term; then the question, ending in "?"; then an optional hint in
  brackets that says the SHAPE of the answer ("12 stories", "an argument and
  a case study"), never its content. Leave the hint out when there is no
  honest shape.
- "Why", "how" or "what follows if": never yes/no, never something one fact
  settles, never the gist with a question mark on it.
- Under 20 words in all. Digits for counts.

OUTPUT

JSON only, no prose, no code fence: {"gist": "...", "question": "..."}

${plainWords("explain", "ask")}`;

const ROOT_SCHEMA = {
  type: "object",
  properties: { gist: { type: "string" }, question: { type: "string" } },
  required: ["gist", "question"],
  additionalProperties: false,
} as const;

function rootUser(title: string, parts: ModelNode[]): string {
  return [
    `BOOK TITLE: ${title}`,
    "",
    "PARTS, in order:",
    ...parts.map((p, i) => `${i + 1}. ${p.title} — ${p.gist ?? "(no gist)"}`),
  ].join("\n");
}

/* --------------------------------------------------------------- modes -- */

async function loadBook() {
  loadEnvLocal();
  const host = new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname;
  if (host !== "127.0.0.1") throw new Error(`DATABASE_URL host is ${host}, not 127.0.0.1; refusing.`);
  const { loadArticle } = await import("../../src/store/index.js");
  const article = (await loadArticle(SLUG)) as unknown as {
    blocks: Block[];
    tree: Tree;
    meta?: { title?: string };
  };
  const title = article.tree.nodes[article.tree.rootId]!.title;
  return { blocks: article.blocks, title, storedTree: article.tree };
}

async function modePlan() {
  const book = await loadBook();
  const dense = DENSITIES.find((d) => d.name === "dense paper")!;
  const bare = DENSITIES.find((d) => d.name === "headingless prose")!;
  const plans = [
    describePlan("real book", book.blocks, SLUG, book.title),
    describePlan("synthetic dense paper, 250 pages", plainBlocks(Math.round(250 * dense.blocksPerPage), dense).blocks, "synthetic-dense", "Synthetic dense paper"),
    describePlan("synthetic headingless, 6000 blocks", plainBlocks(6000, bare).blocks, "synthetic-bare", "Synthetic headingless"),
  ];
  save("plan.json", { target: TARGET, plans });
  for (const p of plans) {
    console.log(`\n${p.name}: ${p.body} body blocks, whole fits one call: ${p.wholeDocumentFitsOneCall}, bounded ${JSON.stringify(p.bounded)}`);
    for (const s of p.slices) console.log(`  ${s.lo}-${s.hi} size ${s.size} startsOn ${s.startsOn} max_tokens ${s.maxTokens} est ${s.answerEstimate} chars ${s.userChars}`);
  }

  /* A stitched proposal with NO model: each slice's "answer" is the bounded
     tree's own parts inside it. Proves the stitch + one buildTree mechanics. */
  for (const [name, blocks, slug, title] of [
    ["real book", book.blocks, SLUG, book.title],
  ] as const) {
    const { body, bounded, partStarts, authoredStarts, sectionStarts } = boundaries(blocks, slug, title);
    const slices = planSlices(body, partStarts, authoredStarts, sectionStarts);
    const index = new Map(body.map((b, i) => [b.id, i]));
    const fake = slices.map((s): ModelNode => {
      const inside = Object.values(bounded.tree.nodes).filter(
        (n) => n.depth === 2 && index.has(n.range[0]) && index.get(n.range[0])! >= s.lo && index.get(n.range[0])! <= s.hi,
      );
      return {
        title: "slice",
        gist: "g",
        range: [body[s.lo]!.id, body[s.hi]!.id],
        children: [
          {
            title: "chapter",
            gist: "A chapter gist that is long enough to be a sentence.",
            question: "Topic — why?",
            range: [body[s.lo]!.id, body[s.hi]!.id],
            children: inside.map((n) => ({ title: n.title || "t", gist: "A section gist that is long enough to be a sentence.", range: n.range })),
          },
        ],
      };
    });
    const out = stitch(blocks, slug, fake, { title, gist: "A root gist.", question: "Book — why?" });
    console.log(`\nno-model stitch on ${name}: problems ${out.check.problems.length}, leaf depths ${JSON.stringify(leafDepths(out.tree))}, repairs ${out.built.repairs.length}, unaskable ${out.unaskable}`);
    if (out.check.problems.length) console.log(out.check.problems.slice(0, 5));
  }
}

interface SliceResult {
  i: number;
  lo: number;
  hi: number;
  size: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
  parsedAndBuiltFirstTime: boolean;
  error?: string;
  depth1: number;
  depth2: number;
  repairs: number;
  repairedKinds: string[];
  droppedChildren: number;
  droppedHeadings: number;
  leafDepths: Record<number, number>;
  maxTokens: number;
}

async function modeRun() {
  const book = await loadBook();
  const { body, partStarts, authoredStarts, sectionStarts } = boundaries(book.blocks, SLUG, book.title);
  const slices = planSlices(body, partStarts, authoredStarts, sectionStarts);
  const rows: AiCallRow[] = [];
  const began = Date.now();
  const signal = AbortSignal.timeout(STEP_BUDGET_MS);

  const { result, report } = await collectSpend(
    async () => {
      const sliceResults = await Promise.all(
        slices.map(async (s, i): Promise<SliceResult & { answer?: string }> => {
          const part = body.slice(s.lo, s.hi + 1);
          const answerPath = path.join(OUT, `slice-${i}-answer.json`);
          const req = wholeDocumentRequest(part);
          const base = { i, lo: s.lo, hi: s.hi, size: part.length, maxTokens: req.maxTokens };
          const t0 = Date.now();
          let message: Anthropic.Message;
          try {
            message = await streamMessage("structure", req.params, { power: POWER, signal }).finalMessage();
          } catch (err) {
            return { ...base, ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, stopReason: null, parsedAndBuiltFirstTime: false, error: `call: ${(err as Error).name}`, depth1: 0, depth2: 0, repairs: 0, repairedKinds: [], droppedChildren: 0, droppedHeadings: 0, leafDepths: {} };
          }
          const ms = Date.now() - t0;
          const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, stopReason: message.stop_reason };
          console.log(`slice ${i}: ${Math.round(ms / 1000)}s in ${usage.inputTokens} out ${usage.outputTokens} stop ${usage.stopReason}`);
          try {
            const answer = finishedText(message, "table of contents", req.maxTokens, estimateStructureTokens(part), STRUCTURE_HEADROOM);
            mkdirSync(OUT, { recursive: true });
            writeFileSync(answerPath, answer);
            const built = emptyReport();
            const { root } = parseWholeDocumentAnswer(answer, part, built);
            const tree = buildTree(root, {}, part, SLUG, built);
            const check = checkTree(part, tree);
            if (check.problems.length) throw new Error(`checkTree: ${check.problems.length} problem(s)`);
            return {
              ...base, ms, ...usage, parsedAndBuiltFirstTime: true,
              depth1: root.children?.length ?? 0,
              depth2: (root.children ?? []).reduce((a, c) => a + (c.children?.length ?? 0), 0),
              repairs: built.repairs.length,
              repairedKinds: built.repairs.map((r) => `${r.where}:${r.kind}:${r.size}`),
              droppedChildren: built.droppedChildren.length,
              droppedHeadings: built.droppedHeadings.length,
              leafDepths: leafDepths(tree),
              answer,
            };
          } catch (err) {
            return { ...base, ms, ...usage, parsedAndBuiltFirstTime: false, error: (err as Error).message.slice(0, 300), depth1: 0, depth2: 0, repairs: 0, repairedKinds: [], droppedChildren: 0, droppedHeadings: 0, leafDepths: {} };
          }
        }),
      );
      const slicesWallMs = Date.now() - began;
      if (sliceResults.some((r) => !r.parsedAndBuiltFirstTime)) return { sliceResults, slicesWallMs, root: null, rootMs: 0, rootUsage: null };

      const roots = sliceResults.map((r, i) => parseWholeDocumentAnswer(r.answer!, body.slice(slices[i]!.lo, slices[i]!.hi + 1)).root);
      const parts = roots.flatMap((r) => r.children ?? []);
      const t1 = Date.now();
      const message = await streamMessage(
        "structure",
        withMessagesJsonSchema(
          {
            max_tokens: 6000,
            thinking: { type: "adaptive" },
            output_config: { effort: "low" },
            system: ROOT_SYSTEM,
            messages: [{ role: "user", content: rootUser(book.title, parts) }],
          },
          ROOT_SCHEMA,
        ),
        { power: POWER, signal },
      ).finalMessage();
      const rootMs = Date.now() - t1;
      const text = finishedText(message, "book root", 6000, 200);
      const root = parseJsonAnswer<{ gist: string; question: string }>(text, "the book root response");
      return { sliceResults, slicesWallMs, root, rootMs, rootUsage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
    },
    {
      attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: SLUG },
      sink: async (row) => {
        rows.push(row);
        await costStore.record(row);
      },
    },
  );

  const dollars = (calls: readonly SpendRecord[]) => totalSpend(calls).nanos / 1e9;
  const perCall = report.calls.map((c) => ({ job: c.job, model: c.model, answeredBy: c.answeredBy, ms: c.ms, inputTokens: c.inputTokens, outputTokens: c.outputTokens, reasoningTokens: c.reasoningTokens, outcome: c.outcome, dollars: dollars([c]), costSource: c.cost.source }));
  const run = {
    slug: SLUG,
    power: POWER,
    slices: result.sliceResults.map(({ answer: _a, ...r }) => ({ ...r, dollars: perCall.find((c) => c.inputTokens === r.inputTokens && c.outputTokens === r.outputTokens)?.dollars ?? null })),
    slicesWallMs: result.slicesWallMs,
    root: result.root,
    rootMs: result.rootMs,
    rootUsage: result.rootUsage,
    totalWallMs: Date.now() - began,
    totalDollars: dollars(report.calls),
    unpriced: totalSpend(report.calls).unpriced,
    calls: perCall,
    ledgerRows: rows.length,
  };
  save("run.json", run);
  console.log(JSON.stringify({ ...run, calls: undefined }, null, 1));
  if (result.root) await modeStitch();
}

async function modeStitch() {
  const book = await loadBook();
  const { body, partStarts, authoredStarts, sectionStarts } = boundaries(book.blocks, SLUG, book.title);
  const slices = planSlices(body, partStarts, authoredStarts, sectionStarts);
  const run = JSON.parse(readFileSync(path.join(OUT, "run.json"), "utf8")) as { root: { gist: string; question: string } };
  const roots = slices.map((s, i) => {
    const p = path.join(OUT, `slice-${i}-answer.json`);
    if (!existsSync(p)) throw new Error(`missing ${p}`);
    return parseWholeDocumentAnswer(readFileSync(p, "utf8"), body.slice(s.lo, s.hi + 1)).root;
  });
  const out = stitch(book.blocks, SLUG, roots, { title: book.title, ...run.root });
  const index = new Map(book.blocks.map((b, i) => [b.id, i]));
  const size = (n: TreeNode) => index.get(n.range[1])! - index.get(n.range[0])! + 1;
  const rootNode = out.tree.nodes[out.tree.rootId]!;
  const d1 = rootNode.children.map((id) => out.tree.nodes[id]!);
  const bodyD1 = d1.filter((n) => !isSupplementNode(n));
  const seamStarts = new Set(slices.slice(1).map((s) => body[s.lo]!.id));
  const summary = {
    checkTreeProblems: out.check.problems,
    advice: out.check.advice.length,
    provisional: (out.tree as { provisional?: string }).provisional ?? null,
    version: out.tree.version,
    leafDepths: leafDepths(out.tree),
    parts: bodyD1.length,
    sections: Object.values(out.tree.nodes).filter((n) => n.depth === 2 && n.children.length > 0 && !isSupplementNode(out.tree.nodes[n.parent!]!)).length,
    partsWithNoSections: bodyD1.filter((n) => out.tree.nodes[n.children[0]!]!.children.length === 0).length,
    internalWithoutGist: Object.values(out.tree.nodes).filter((n) => n.children.length > 0 && !n.gist && !isSupplementNode(n)).length,
    depth1WithoutQuestion: bodyD1.filter((n) => !n.question).length,
    maxQuestionDepth: MAX_QUESTION_DEPTH,
    stitchRepairs: out.built.repairs,
    droppedChildren: out.built.droppedChildren.length,
    droppedHeadings: out.built.droppedHeadings.length,
    collapsedRungs: out.built.collapsedRungs.length,
    droppedQuestions: out.built.droppedQuestions.length,
    unaskableLabelBatches: out.unaskable,
    root: { title: rootNode.title, gist: rootNode.gist, question: rootNode.question },
    depth1: bodyD1.map((n) => ({
      title: n.title,
      blocks: size(n),
      from: index.get(n.range[0]),
      sections: n.children.filter((id) => out.tree.nodes[id]!.children.length > 0).length,
      startsAtSeam: seamStarts.has(n.range[0]),
      sourceHeading: n.sourceHeading ?? null,
      gist: n.gist,
      question: n.question,
    })),
  };
  save("stitched-tree.json", out.tree);
  save("stitched-summary.json", summary);
  console.log(JSON.stringify({ ...summary, depth1: undefined }, null, 1));
  for (const p of summary.depth1) console.log(`${String(p.from).padStart(5)} ${String(p.blocks).padStart(5)} ${String(p.sections).padStart(3)} ${p.startsAtSeam ? "SEAM" : "    "} ${p.title}`);
}

const mode = process.argv[2];
if (mode === "plan") await modePlan();
else if (mode === "run") await modeRun();
else if (mode === "stitch") await modeStitch();
else throw new Error("usage: spike-parts.ts plan|run|stitch");
process.exit(0);
