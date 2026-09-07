/**
 * **The generation half: each arm's wording, over a tree that does not move.**
 *
 * One call per (document, arm). The model is shown the article exactly as
 * production shows it — `renderBlocks` over the body blocks, the same function
 * `structureRequest` uses — plus the **fixed** outline of the tree that is
 * already on disk, and is asked for a gist and (at depth <= `MAX_QUESTION_DEPTH`)
 * a question per node. It is not asked for structure, ranges, titles or
 * `sourceHeading`, because none of those is what any variant changes.
 *
 * That is the cheap design the plan chose and the honesty cost is on the arm
 * rather than buried: see [`arms.ts`](arms.ts) § *Every arm here is a bakeoff*.
 *
 * ## The seam, and why there is no declared bypass
 *
 * Every call goes through [`streamMessage`](../../src/messages-stream.ts) with
 * task `"hierarchy"`, so it is production's model, production's routing and
 * production's cache pin, and it is **metered in-band** — `withLedger("eval", …)`
 * in [`run.ts`](run.ts) opens the collector.
 * `evals/hierarchy-structure` needs a declared bypass because its arms vary
 * model and effort per call and `streamMessage` owns both on purpose; this eval
 * varies neither, so it has nothing to declare and adds no row to
 * `src/spend-declarations.ts`.
 *
 * ## What a lost call must not be allowed to look like
 *
 * An arm whose call fails writes a cell with an `error` and **no lines**, and the
 * arithmetic downstream counts what came back against what was sent. It does
 * not infer success from an absence of complaints —
 * [`evals/dictation/coverage.ts`](../dictation/coverage.ts) does that counting,
 * and this file's job is only to make sure the two numbers are honest: the
 * denominator is the node list built before the call, and the numerator is the
 * lines actually parsed out of the answer.
 */

import { MAX_QUESTION_DEPTH } from "../../src/hierarchy.js";
import { PRODUCTION_EFFORT, renderBlocks } from "../../src/hierarchy-prompt.js";
import { streamMessage } from "../../src/messages-stream.js";
import { parseJsonAnswer } from "../../src/parse-json.js";
import { splitBlocks, supplementIndex } from "../../src/supplement.js";
import type { Block, TreeNode } from "../../src/types.js";
import { type ArmSpec, promptBlocksFor, questionRuleFor } from "./arms.js";
import type { LoadedDocument } from "./corpus.js";

/** A node the arm is asked to write for, with everything the prompt needs about it. */
export interface RequestedNode {
  id: string;
  depth: number;
  /** Fixed: the arm is not asked to change it, and it anchors the reader's sense of the row. */
  title: string;
  /** Index into the BODY blocks, inclusive. */
  from: number;
  to: number;
  /** Whether this node is asked for a question — production's own depth rule. */
  wantsQuestion: boolean;
  /** What is on disk today, for the report's before-and-after. Never shown to the arm. */
  storedGist?: string | undefined;
  storedQuestion?: string | undefined;
}

/**
 * The nodes a run writes for: internal, non-supplement, down to `maxDepth`.
 *
 * **Default depth 1, which is `MAX_QUESTION_DEPTH`.** Deeper is available
 * (`--depth 2`) because the GISTS block's no-meta-narration rule applies at
 * every depth, but it is not the default: the plan defers longer depth-2 gists,
 * and every extra depth multiplies the output tokens of every arm.
 */
export function requestedNodes(doc: LoadedDocument, maxDepth: number = MAX_QUESTION_DEPTH): RequestedNode[] {
  return outlineNodes(doc, maxDepth);
}

/**
 * **Every internal node down to `maxDepth`** — used twice, for two jobs.
 *
 * With the request depth it is the list of nodes an arm must answer for; with
 * `CONTEXT_DEPTH` it is the outline the arm is *shown*. The two differ, and that
 * is GPT Sol's P1-10: both GISTS blocks say *"write a parent's gist from its
 * children"*, and a depth-1 node's children are at depth 2, which the request
 * list does not contain. Rendering only the requested nodes therefore instructed
 * the model to do something the prompt made impossible, and it would have worked
 * from the raw prose instead — quietly, and differently from production, which
 * has the whole tree in front of it because it just wrote it.
 */
function outlineNodes(doc: LoadedDocument, maxDepth: number): RequestedNode[] {
  const { body } = splitBlocks(doc.blocks);
  const index = new Map(body.map((b, i) => [b.id, i]));
  const supplement = supplementIndex(doc.tree);
  const out: RequestedNode[] = [];
  for (const node of Object.values(doc.tree.nodes) as TreeNode[]) {
    if (node.depth > maxDepth) continue;
    if (node.children.length === 0) continue;
    if (supplement.has(node.id)) continue;
    const from = index.get(node.range[0]);
    const to = index.get(node.range[1]);
    /* A node whose range does not land in the body is skipped rather than
       clamped: it would be an apparatus node the supplement index missed, and
       writing a gist for one is the mistake `splitBlocks` exists to prevent. */
    if (from === undefined || to === undefined) continue;
    out.push({
      id: node.id,
      depth: node.depth,
      title: node.title,
      from,
      to,
      wantsQuestion: node.depth <= MAX_QUESTION_DEPTH,
      storedGist: node.gist,
      storedQuestion: node.question,
    });
  }
  return out.sort((a, b) => a.from - b.from || a.depth - b.depth);
}

/* ------------------------------------------------------------ the prompt -- */

/**
 * **The envelope is identical for every arm**, and that is the whole design of
 * the comparison: the only bytes that differ between two arms are the GISTS
 * block, the QUESTIONS block, or both. Anything else that varied would be a
 * third variable nobody declared.
 */
export function systemFor(arm: ArmSpec): string {
  const { gists, questions } = promptBlocksFor(arm);
  return `You are writing the summary lines for a nested table of contents that already exists.

You receive the article as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, and its text. Some are marked NOT-GISTABLE.

You then receive the table of contents. **It is fixed.** Its structure, its
ranges and its titles are already decided and are not yours to change. Your job
is the WORDING: one gist for every node listed, and one question for each node
marked ASK-QUESTION.

Every node names the range of blocks it covers. Write about that range and
nothing else.

${gists}

${questions}

OUTPUT

JSON only, no prose, no code fence. One entry per node in the list, keyed by its
node id, in the order given:

{"nodes": {"<nodeId>": {"gist": "...", "question": "..."},
           "<nodeId>": {"gist": "..."}}}

Include "question" only for nodes marked ASK-QUESTION, and include it for every
one of them. Use only node ids that appear in the list. Do not invent ids, do not
omit a node, and do not add any other field.`;
}

/**
 * How deep the outline the arm is *shown* goes, whatever depth it is asked to
 * write for. Two, because production's tree is three levels and a depth-1 node's
 * children — the things its gist is supposed to be written from — are at two.
 */
export const CONTEXT_DEPTH = 2;

/** The article, then the whole fixed outline, with the rows to be written marked. */
export function userFor(doc: LoadedDocument, requested: readonly RequestedNode[]): string {
  const { body } = splitBlocks(doc.blocks);
  const asked = new Set(requested.map((n) => n.id));
  const wantsQuestion = new Set(requested.filter((n) => n.wantsQuestion).map((n) => n.id));
  const outline = outlineNodes(doc, Math.max(CONTEXT_DEPTH, ...requested.map((n) => n.depth)))
    .map((n) => {
      const indent = "  ".repeat(n.depth);
      /* Three states, and the third is the one that matters: a node shown ONLY
         as context. Its title is there so a parent's gist can be written from
         its children, and no line is wanted for it. */
      const mark = !asked.has(n.id)
        ? "  (context only — do not write for this one)"
        : wantsQuestion.has(n.id)
          ? "  WRITE GIST + ASK-QUESTION"
          : "  WRITE GIST";
      return `${indent}${n.id}  depth ${n.depth}  blocks [${n.from}..${n.to}]  title: ${n.title}${mark}`;
    })
    .join("\n");
  return `${renderBlocks(body as Block[])}

---

TABLE OF CONTENTS (fixed)

Write a gist for every row marked WRITE GIST, and a question as well for every
row marked ASK-QUESTION. Rows marked "context only" are there so that a parent's
gist can be written from its children — do not write anything for them and do not
put them in your answer.

${outline}`;
}

/**
 * Output budget.
 *
 * A gist and a question, generously, is about 120 tokens; 200 is production's
 * own per-node figure rounded up for the JSON envelope round each entry
 * (`TOKENS_PER_NODE` is 175 for a node carrying a title, a range and often a
 * `sourceHeading` as well, none of which is asked for here). The floor exists so
 * a three-node smoke document still leaves the model room to think.
 */
export function budgetForNodes(count: number): number {
  return Math.max(4_000, 1_000 + count * 200);
}

/* ----------------------------------------------------------- the answer --- */

export interface GeneratedLine {
  nodeId: string;
  gist: string;
  /** The raw string the model wrote, before the `questionFor` rule. */
  questionRaw?: string | undefined;
  /** What a reader would actually see — the arm's `questionRule` applied. */
  question?: string | undefined;
  /** Set when the rule dropped the raw string, with which rule and why. */
  questionDropped?: string | undefined;
}

export interface ParsedAnswer {
  lines: GeneratedLine[];
  /** Requested nodes the answer said nothing usable about. */
  missing: string[];
  /** Ids the answer invented. */
  extra: string[];
  /** Nodes marked ASK-QUESTION whose entry carried no question at all. */
  questionless: string[];
}

interface RawEntry {
  gist?: unknown;
  question?: unknown;
}

/**
 * Read one arm's answer, and say what is missing **by name**.
 *
 * `missing` is computed from the request rather than from the response: the
 * denominator is the node list, so an answer that returned three of eleven
 * entries cannot be read as three of three.
 */
export function parseAnswer(raw: string, requested: readonly RequestedNode[]): ParsedAnswer {
  const parsed = parseJsonAnswer<{ nodes?: Record<string, RawEntry> }>(raw, "the summaries eval's answer");
  const nodes = parsed.nodes ?? {};
  const lines: GeneratedLine[] = [];
  const missing: string[] = [];
  const questionless: string[] = [];
  for (const node of requested) {
    const entry = nodes[node.id];
    const gist = typeof entry?.gist === "string" ? entry.gist.trim() : "";
    if (gist === "") {
      missing.push(node.id);
      continue;
    }
    const line: GeneratedLine = { nodeId: node.id, gist };
    if (node.wantsQuestion) {
      const q = typeof entry?.question === "string" ? entry.question.trim() : "";
      if (q === "") questionless.push(node.id);
      else line.questionRaw = q;
    }
    lines.push(line);
  }
  const asked = new Set(requested.map((n) => n.id));
  const extra = Object.keys(nodes).filter((id) => !asked.has(id));
  return { lines, missing, extra, questionless };
}

/**
 * Put every question through production's `questionFor`.
 *
 * It used to say *"for six of the seven arms, V4's trailing-hint patch for V4"*,
 * and there is no longer any such patch: V4 won, production took it as `toc/7`,
 * and the reimplementation that let its cost stay visible was deleted the same
 * day. `arms.ts` § `QuestionRule` is the slot the next one goes in.
 *
 * **A dropped question is recorded, not quietly absent.** Production counts the
 * same event into `droppedQuestions` for the same reason: a line that silently
 * fails to appear looks exactly like a model that chose not to write one
 * (`docs/reusable/silent-success.md`), and here it is worse, because a variant
 * whose lines are all dropped by the rule would otherwise be judged on its gists
 * and score as "not very Socratic".
 */
export function applyQuestionRule(arm: ArmSpec, answer: ParsedAnswer, requested: readonly RequestedNode[]): void {
  const rule = questionRuleFor(arm);
  const depth = new Map(requested.map((n) => [n.id, n.depth]));
  for (const line of answer.lines) {
    if (line.questionRaw === undefined) continue;
    const kept = rule({ gist: line.gist, question: line.questionRaw }, depth.get(line.nodeId) ?? 0);
    if (kept === undefined) {
      line.questionDropped = `dropped by the ${arm.questionRule} rule (the gist asked again, or an empty string)`;
    } else {
      line.question = kept;
    }
  }
}

/* ------------------------------------------------------------- the call --- */

export interface Cell {
  arm: string;
  slug: string;
  /** Nodes sent. The denominator, fixed before the call. */
  requested: string[];
  lines: GeneratedLine[];
  missing: string[];
  extra: string[];
  questionless: string[];
  /** Present only when the call failed. The cell then has no lines at all. */
  error?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  latencyMs?: number | undefined;
  /** The model that answered, by the name it gave itself. */
  answeredBy?: string | undefined;
}

/** What a run uses to buy one cell — a seam, so a stub can stand in for the network. */
export type Generator = (req: {
  system: string;
  user: string;
  maxTokens: number;
}) => Promise<{ text: string; inputTokens?: number; outputTokens?: number; answeredBy?: string }>;

/** The real one: production's model, production's routing, metered in-band. */
export const liveGenerator: Generator = async ({ system, user, maxTokens }) => {
  const call = streamMessage("hierarchy", {
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: PRODUCTION_EFFORT },
    system,
    messages: [{ role: "user", content: user }],
  });
  const message = await call.finalMessage();
  const text = message.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  return {
    text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    answeredBy: message.model,
  };
};

/** Buy (or stub) one arm's wording for one document. Never throws: a failure is a cell. */
export async function generateCell(
  arm: ArmSpec,
  doc: LoadedDocument,
  requested: readonly RequestedNode[],
  generate: Generator,
): Promise<Cell> {
  const base: Cell = {
    arm: arm.name,
    slug: doc.entry.slug,
    requested: requested.map((n) => n.id),
    lines: [],
    missing: requested.map((n) => n.id),
    extra: [],
    questionless: [],
  };
  const startedAt = Date.now();
  try {
    const { text, inputTokens, outputTokens, answeredBy } = await generate({
      system: systemFor(arm),
      user: userFor(doc, requested),
      maxTokens: budgetForNodes(requested.length),
    });
    const answer = parseAnswer(text, requested);
    applyQuestionRule(arm, answer, requested);
    return {
      ...base,
      lines: answer.lines,
      missing: answer.missing,
      extra: answer.extra,
      questionless: answer.questionless,
      inputTokens,
      outputTokens,
      answeredBy,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - startedAt };
  }
}
