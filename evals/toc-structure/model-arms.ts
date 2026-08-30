/**
 * The phase-2 executor for the arms that spend money — built, deliberately not
 * yet armed. Everything deterministic is real and tested: rendering the seed
 * proposal, turning a model's answer into a validated Tree, the per-arm
 * dispatch. The two places a request would actually leave the machine throw
 * `PENDING`, each naming exactly what has to happen first, because both need
 * things this eval may not take for itself:
 *
 * 1. **Two rows in `DECLARATIONS`** (src/spend-declarations.ts) — one for the
 *    Messages wire through OpenRouter, one for chat/completions — naming this
 *    file. That table lives under src/, and tests/no-undeclared-spend.test.ts
 *    fails any file that gains spend capability (an endpoint literal, a client
 *    construction, `declaredFetch`) without a row. This file therefore carries
 *    NO capability yet: no endpoint, no credential name, no client import.
 * 2. **`SYSTEM` and `renderBlocks` exported from src/toc.ts.** The incumbent
 *    arm must send byte-identical bytes to what ships, and a copied prompt
 *    drifts silently — the first re-word of the shipping prompt would turn
 *    "incumbent" into a label for a recipe nothing runs. Export keyword only,
 *    no behaviour change; held for approval rather than reached for.
 *
 * The `waves` and `cheap-then-revise` strategies also need prompts that do not
 * exist yet — new design, not plumbing — and those wait for GPT Sol's review
 * of this design before they are written once rather than twice.
 */

import { isStructural } from "../../src/block-policy.js";
import { parseJsonFrom, stripFence } from "../../src/parse-json.js";
import { appendSupplement, splitBlocks } from "../../src/supplement.js";
import { buildTree, estimateTocTokens, type ModelNode } from "../../src/toc.js";
import { budgetFor } from "../../src/token-budget.js";
import { assertTreeSound } from "../../src/tree-invariants.js";
import type { Block, Tree, TreeNode } from "../../src/types.js";
import type { ArmSpec, CallSpec } from "./arms.js";
import { buildHeadingTree } from "./heading-tree.js";

/** What one paid call reports back, for the results file and the noise floor. */
export interface CallStats {
  ms: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
}

export interface ModelArmRun {
  tree: Tree;
  calls: CallStats[];
}

/* ------------------------------------------------------------- the seams -- */

/**
 * Thrown by the two functions below. `run.ts` lets it propagate — a runner
 * that caught it and moved on would write a results file in which these arms
 * scored nothing, which reads identically to these arms being worthless.
 */
export class PendingError extends Error {}

/** The one Messages-wire request this eval makes. Body is Anthropic's Messages shape. */
export type MessagesSend = (req: {
  call: CallSpec;
  system: string;
  user: string;
  maxTokens: number;
}) => Promise<{ raw: string; stats: CallStats }>;

/** The one chat/completions request this eval makes. */
export type ChatSend = MessagesSend;

export const sendMessages: MessagesSend = () => {
  throw new PendingError(
    "The Messages-wire transport is not armed: it needs a DECLARATIONS row in " +
      "src/spend-declarations.ts naming this file (account openrouter, wire messages), " +
      "which is under src/ and held for team-lead approval. See the header of " +
      "evals/toc-structure/model-arms.ts.",
  );
};

export const sendChat: ChatSend = () => {
  throw new PendingError(
    "The chat-wire transport is not armed: it needs a DECLARATIONS row in " +
      "src/spend-declarations.ts naming this file (account openrouter, wire chat), " +
      "held for team-lead approval. See the header of evals/toc-structure/model-arms.ts.",
  );
};

/** The prompt the pipeline ships — src/toc.ts's SYSTEM plus its renderBlocks. */
export function shippingPrompt(_body: Block[]): { system: string; user: string } {
  throw new PendingError(
    "The shipping prompt is not wired: it needs `SYSTEM` and `renderBlocks` exported " +
      "from src/toc.ts (export keyword only), held for team-lead approval rather than " +
      "copied — a copy would drift from what ships and quietly relabel the incumbent arm.",
  );
}

/* --------------------------------------------------- the deterministic half */

/**
 * The author's headings as an explicit list — the `headings-listed` arm's
 * seed. A different intervention from the seeded tree below, on purpose:
 * production already shows the model every heading block and calls headings
 * hard boundaries, so what this arm isolates is *salience* — the same facts,
 * gathered in one place — with no proposal attached (REVIEW-SOL.md, 8).
 */
export function renderHeadingList(blocks: Block[]): string {
  const { body } = splitBlocks(blocks);
  const lines = body.flatMap((b, i) =>
    b.kind === "heading" ? [`[${i}] h${b.level ?? "?"}: ${b.text}`] : [],
  );
  return [
    "For reference, the article's own headings, in order, with their block",
    "numbers and levels. They are already hard boundaries; this list adds",
    "nothing new — it only gathers them in one place.",
    "",
    ...lines,
  ].join("\n");
}

/**
 * The heading tree, rendered as the proposal the `headings-seeded` arm hands
 * the model. Nested JSON in the same shape the model is asked to emit, so
 * "modify or replace" needs no second format — the model can echo it, edit it,
 * or ignore it.
 */
export function renderSeedProposal(blocks: Block[], slug: string): string {
  const built = buildHeadingTree(blocks, slug);
  const tree = built.tree;
  const toModelNode = (id: string): ModelNode | null => {
    const node = tree.nodes[id];
    if (!node || node.children.length === 0 || node.treatment === "supplement") return null;
    const children = node.children
      .map(toModelNode)
      .filter((c): c is ModelNode => c !== null);
    return {
      title: node.title,
      range: node.range,
      ...(node.sourceHeading ? { sourceHeading: node.sourceHeading } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };
  const root = toModelNode(tree.rootId);
  return [
    "A deterministic pass over the article's own headings produced this proposed",
    "structure. Treat it as a starting point: keep it, adjust its boundaries, add",
    "levels beneath it, or replace it entirely where the headings mislead — the",
    "article's actual topic structure wins. It carries no gists; you write those",
    "either way.",
    "",
    JSON.stringify({ root }, null, 2),
  ].join("\n");
}

/**
 * A model's raw answer, turned into the same artefact the pipeline stores:
 * fence stripped, JSON parsed, leaves grown mechanically, supplement appended,
 * invariants asserted. Reusing `buildTree` is the point — an arm judged on a
 * tree assembled by different code is being judged partly on that code.
 */
export function parseStructureResponse(raw: string, blocks: Block[], slug: string): Tree {
  const { body, groups } = splitBlocks(blocks);
  const { root } = parseJsonFrom<{ root: ModelNode }>(
    stripFence(raw),
    "the structure-arm response",
  );
  const tree = appendSupplement(buildTree(root, {}, body, slug), groups);
  /* The labels pass never runs here, so structural leaves have no navLabel and
     checkTree would advise about every one; that advice is scoreTree's to
     count. What must throw is structural damage, which is what
     `assertTreeSound` does — over a tree whose gists the model DID write, so
     the gist rule genuinely applies. */
  assertTreeSound(blocks, tree);
  return tree;
}

/**
 * True for the leaves the pipeline would label. Exported for run.ts's stats
 * only; kept beside the executor so nothing re-derives it differently.
 */
export function structuralLeaves(tree: Tree, blocks: Block[]): TreeNode[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return Object.values(tree.nodes).filter((n) => {
    if (n.children.length > 0) return false;
    const block = byId.get(n.range[0]);
    return !!block && isStructural(block);
  });
}

/* ------------------------------------------------------------ the dispatch */

export async function runModelArm(
  arm: ArmSpec,
  blocks: Block[],
  slug: string,
): Promise<ModelArmRun> {
  const { body } = splitBlocks(blocks);
  switch (arm.kind) {
    case "one-call": {
      const { system, user } = shippingPrompt(body);
      const seed =
        arm.seed === "heading-tree"
          ? `\n\n${renderSeedProposal(blocks, slug)}`
          : arm.seed === "heading-list"
            ? `\n\n${renderHeadingList(blocks)}`
            : "";
      const send = arm.call.model.startsWith("anthropic/") ? sendMessages : sendChat;
      const { raw, stats } = await send({
        call: arm.call,
        system,
        user: `${user}${seed}`,
        maxTokens: maxTokensFor(body),
      });
      return { tree: parseStructureResponse(raw, blocks, slug), calls: [stats] };
    }
    case "waves":
    case "revise":
      throw new PendingError(
        `Arm "${arm.name}" needs a prompt that does not exist yet — held for GPT Sol's ` +
          `review of the phase-2 design so it is written once, not twice.`,
      );
    default:
      throw new Error(`runModelArm was handed the free arm "${arm.name}" — run.ts owns those.`);
  }
}

/** The pipeline's own budget arithmetic, via its exports. */
function maxTokensFor(body: Block[]): number {
  return budgetFor("table of contents", estimateTocTokens(body));
}
