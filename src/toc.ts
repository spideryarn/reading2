/**
 * Pipeline stage 4 — build the deeply-nested table of contents / granularity
 * tree over a block sequence. See docs/project/table-of-contents.md.
 *
 *   npm run toc -- output/noema-mythology-of-conscious-ai.blocks.json
 *
 * The model proposes INTERNAL nodes only, and writes a navLabel for each
 * gistable block. Leaves are generated here, mechanically, one per block —
 * which removes the whole class of partition errors that come from asking a
 * model to tile a document exactly. Validate the result with:
 *
 *   npm run validate-tree -- <dir with blocks.json + tree.json>
 *
 * NOTE: this also asks for a one-sentence `gist` per internal node, which
 * architecture.md draws as stage 5. A tree without gists has nothing to render
 * at its coarse levels and fails validation, and both stages write the same
 * artefact, so splitting them into two model passes buys nothing today.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Block, Tree, TreeNode, NodeId } from "./types.js";

const MODEL = "claude-opus-5";
const PROMPT_VERSION = "toc/1";

const SYSTEM = `You are building a nested table of contents for an article. It goes all the
way down to individual paragraphs, and it will be rendered as a navigation sidebar.

You receive the article as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, and its text. Some are marked NOT-GISTABLE.

STRUCTURE

Produce a tree of INTERNAL nodes only. Every node covers a contiguous range of
blocks, and a node's children exactly partition its range — no gaps, no
overlaps, no reordering. The first child starts where its parent starts; the
last child ends where its parent ends.

- The article's own headings are HARD boundaries. A node must begin at a
  heading block wherever one exists. Never merge across a heading.
- Where a run between headings is longer than ~9 blocks, propose your own
  boundaries inside it at genuine topic shifts, and title those nodes.
- Aim for 5-9 children per node so each level is an even stride.
- Go 3 levels deep: root (depth 0), chapters (depth 1), sections (depth 2).
- Do NOT emit leaf nodes for individual blocks. Stop at the section level.

TITLES (internal nodes)

- 2-6 words. A title is a landmark, scanned at a glance.
- Where the author gave the section a heading, use that heading's text
  UNCHANGED and repeat it in "sourceHeading". Rewrite it ONLY if it shares no
  content word with its section body, or is a stock label ("Introduction",
  "Background", "Part Two"). Rewriting should be rare.
- No trailing punctuation.

GISTS (internal nodes)

- Exactly ONE sentence. This is what the reader sees at the zoom level above.
- It must be a CLAIM or a MOVE, not a topic label.
- Write a parent's gist from its children, not from the raw text.

NAV LABELS (one per gistable block)

- 6-20 words. Longer than a title on purpose: a paragraph has no name of its
  own, and its neighbours are numerous and similar, so it needs enough words to
  tell itself apart from them.
- A navLabel must be a CLAIM or a MOVE, not a topic label.
    good: "Seth rejects substrate independence because feeling is metabolic"
    bad:  "Discusses substrate independence"
- Reuse the author's distinctive vocabulary verbatim. Those words are the
  reader's handholds when they arrive at the passage.
- For a heading block, the navLabel is just the heading's own text.
- Emit NOTHING for a block marked NOT-GISTABLE.
- Never introduce a fact that is not in the block.
- No meta-narration. Never write "this section explores", "the author then
  turns to", "we are told that".

OUTPUT

JSON only, no prose, no code fence:

{"root": {"title": "...", "gist": "...", "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]},
 "navLabels": {"<blockId>": "...", ...}}

Use only block ids that appear in the input. Do not invent ids.`;

export interface ModelNode {
  title: string;
  gist?: string;
  range: [string, string];
  sourceHeading?: string;
  children?: ModelNode[];
}

function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      const mark = b.gistable ? "" : " NOT-GISTABLE";
      return `[${i}] ${b.id} <${b.tag}>${mark}: ${b.text}`;
    })
    .join("\n\n");
}

/** Strip a stray code fence if the model wraps its JSON despite instructions. */
function parseJson(raw: string): { root: ModelNode; navLabels: Record<string, string> } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(text);
}

/**
 * Flatten the model's nested proposal into the stored map, and grow the leaf
 * layer underneath it. Every block gets exactly one leaf; a leaf carries a
 * navLabel only if its block is gistable and the model wrote one.
 */
export function buildTree(
  root: ModelNode,
  navLabels: Record<string, string>,
  blocks: Block[],
  slug: string,
): Tree {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const nodes: Record<NodeId, TreeNode> = {};
  let counter = 0;
  const nextId = () => `n${String(++counter).padStart(4, "0")}`;

  const visit = (mn: ModelNode, parent: NodeId | null, depth: number): NodeId => {
    const id = nextId();
    const node: TreeNode = {
      id,
      depth,
      parent,
      children: [],
      range: mn.range,
      title: mn.title,
      ...(mn.gist ? { gist: mn.gist } : {}),
      ...(mn.sourceHeading ? { sourceHeading: mn.sourceHeading } : {}),
    };
    nodes[id] = node;

    if (mn.children?.length) {
      node.children = mn.children.map((c) => visit(c, id, depth + 1));
      return id;
    }

    // Deepest internal node — grow its leaves.
    const lo = index.get(mn.range[0]);
    const hi = index.get(mn.range[1]);
    if (lo === undefined || hi === undefined) {
      throw new Error(`Node "${mn.title}" has a range not in blocks.json: ${mn.range.join("…")}`);
    }
    for (let i = lo; i <= hi; i++) {
      // In range: lo and hi both came out of `index`, which is built over
      // `blocks`, and the undefined case threw two lines up.
      const block = blocks[i]!;
      const leafId = nextId();
      const label = block.gistable ? navLabels[block.id] : undefined;
      nodes[leafId] = {
        id: leafId,
        depth: depth + 1,
        parent: id,
        children: [],
        range: [block.id, block.id],
        title: "",
        ...(label ? { navLabel: label } : {}),
      };
      node.children.push(leafId);
    }
    return id;
  };

  const rootId = visit(root, null, 0);
  return { version: PROMPT_VERSION, generator: MODEL, slug, rootId, nodes };
}

async function main(): Promise<void> {
  const blocksPath = process.argv[2];
  if (!blocksPath) {
    console.error("Usage: tsx src/toc.ts <blocks.json> [outDir]");
    process.exit(1);
  }
  const { blocks } = JSON.parse(await readFile(blocksPath, "utf-8")) as { blocks: Block[] };
  const slug = path.basename(blocksPath).replace(/\.blocks\.json$/, "").replace(/\.json$/, "");
  const outDir = process.argv[3] ?? path.join("data", slug);

  const gistable = blocks.filter((b) => b.gistable).length;
  console.log(`${blocks.length} blocks (${gistable} gistable) → ${MODEL}`);

  const client = new Anthropic();
  const started = Date.now();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM,
    messages: [{ role: "user", content: renderBlocks(blocks) }],
  });

  const message = await stream.finalMessage();
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (message.stop_reason === "refusal") {
    throw new Error(`Model refused: ${JSON.stringify(message.stop_details)}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Hit max_tokens — the JSON is truncated. Raise it and retry.");
  }

  const { root, navLabels } = parseJson(raw);
  const tree = buildTree(root, navLabels, blocks, slug);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "tree.json"), JSON.stringify(tree, null, 2), "utf-8");
  await writeFile(path.join(outDir, "blocks.json"), JSON.stringify({ blocks }, null, 2), "utf-8");

  const internal = Object.values(tree.nodes).filter((n) => n.children.length > 0).length;
  const labelled = Object.values(tree.nodes).filter((n) => n.navLabel).length;
  const u = message.usage;

  console.log(`\nNodes:     ${Object.keys(tree.nodes).length} (${internal} internal)`);
  console.log(`Labelled:  ${labelled} / ${gistable} gistable blocks`);
  console.log(`Tokens:    ${u.input_tokens} in, ${u.output_tokens} out`);
  console.log(`Elapsed:   ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`\nWrote:     ${path.resolve(outDir)}/tree.json`);
  console.log(`Validate:  npm run validate-tree -- ${outDir}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) void main();
