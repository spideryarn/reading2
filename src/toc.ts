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
import { fileURLToPath } from "node:url";
import { MODEL } from "./models.js";
import { budgetFor, truncatedMessage } from "./token-budget.js";
import type { Block, Tree, TreeNode, NodeId } from "./types.js";

const PROMPT_VERSION = "toc/1";

/**
 * How hard the model thinks before it starts writing.
 *
 * **`"medium"`, and this is the one setting in the file with a run behind it.**
 * The first attempt at fixing this stage's budget raised `max_tokens` from
 * 32,000 to 77,100 and the call failed again — having emitted 40,000 characters
 * of JSON, about 13,000 tokens of answer, which leaves roughly 64,000 tokens of
 * thinking inside a budget that had reserved 40,000 for it.
 *
 * That is the lesson the first fix missed: at `"high"`, adaptive thinking
 * **expands into whatever room it is given**. Raising the ceiling raises the
 * thinking with it, so the two never converge and no headroom constant is safe
 * on its own. The dial has to move too.
 *
 * `"medium"` is where it moves to, and stage 4 is the stage that can most afford
 * it: the reasoning it needs is finding topic shifts and balancing the levels —
 * real work, but done once — while the bulk of what it writes is one mechanical
 * label per paragraph, which does not get better for being brooded over. The
 * sibling stages keep `"high"`, because their answers are short enough that
 * their reasoning is nearly all of what they do. See src/token-budget.ts and
 * docs/postmortems/toc-max-tokens.md.
 */
const EFFORT = "medium" as const;

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

/**
 * How many tokens of JSON this stage is asking the model for.
 *
 * Stage 4 is the one stage whose answer grows with the article without bound:
 * it writes a nav label for **every** gistable block, so a piece with three
 * times the paragraphs wants three times the answer. That is why `max_tokens`
 * here is computed rather than typed — see src/token-budget.ts for the other
 * half of the arithmetic, and why the number it produces is mostly headroom.
 *
 * **The constants are measured, not guessed** — and the first draft of them
 * was guessed, and was wrong in both directions. Rebuilding three finished
 * trees back into the JSON the model emits and running each through
 * `count_tokens` gives:
 *
 * | tree | labels | tokens/label | internal nodes | tokens/node |
 * |---|---|---|---|---|
 * | `example/` (34 blocks) | 29 | 42.5 | 11 | 167.5 |
 * | the test article (141 blocks) | 117 | 39.5 | 33 | 116.6 |
 * | a short post (29 blocks) | 18 | 35.9 | 10 | 106.1 |
 *
 * So a label costs about 40 tokens — the label itself is only a dozen words,
 * and the rest is the block id and JSON punctuation around it — and an internal
 * node costs three to four times that, because it carries a title, a gist, a
 * range and often a `sourceHeading`. The 55 and 175 below are those worst cases
 * with half again on top. Every real tree above comes out between 1.5x and 2.3x
 * under the estimate, which is the margin we want: an underestimate costs a
 * six-minute call and a failed ingest, an overestimate costs nothing at all,
 * because `max_tokens` is a ceiling and allowance the model doesn't spend is
 * not billed. tests/token-budget.test.ts holds the `example/` figure to this.
 *
 * The node count is a guess about a tree that does not exist yet. The prompt
 * asks for 5–9 children per node over three levels, which works out near
 * blocks/6; the three real trees came out at blocks/2.9, blocks/3.1 and
 * blocks/4.3, denser than that because a short article's sections hold only a
 * few blocks each. `blocks/4 + 6` covers both ends — the constant is what keeps
 * a 30-block article honest, the divisor is what keeps a 400-block one from
 * being refused for a tree it would never have grown.
 */
export function estimateTocTokens(blocks: Block[]): number {
  const labelled = blocks.filter((b) => b.gistable).length;
  const internal = Math.ceil(blocks.length / 4) + 6;
  return 500 + labelled * 55 + internal * 175;
}

/**
 * The floor on how much of the article the labels have to reach.
 *
 * Not 100%, because the design allows the model to skip a genuinely trivial
 * block — an unlabelled gistable leaf is a *warning* in
 * [validate-tree.ts](./validate-tree.ts), deliberately, as the escape hatch for
 * a transition sentence that would only clutter the sidebar
 * (docs/project/table-of-contents.md).
 *
 * 95% is where that escape hatch stops being a plausible reading. Every real
 * tree we have — `example/`, the test article, a short post — came back at
 * 100%: 29 of 29, 117 of 117, 18 of 18. The model has never once used the
 * escape hatch, so a run that leaves a twentieth of the article unlabelled is
 * not exercising editorial judgement, it is an answer that stopped early.
 */
const COVERAGE_FLOOR = 0.95;

/**
 * Did the answer actually cover the article?
 *
 * `stop_reason: "max_tokens"` catches a response cut off mid-token, and it is
 * not the only way to get an incomplete one. A model that senses it is running
 * out of room can close its JSON early — valid syntax, a tree that builds, and
 * a hundred paragraphs with no row in the sidebar. `buildTree` cannot object,
 * because a missing label is indistinguishable there from a label the model
 * chose not to write.
 *
 * So the completeness check lives out here, where the two are distinguishable
 * by how many. This is the guard between a loud failure and the quiet one that
 * would replace it — see docs/reusable/silent-success.md, and the postmortem in
 * docs/postmortems/toc-max-tokens.md for why this stage in particular attracts
 * partial answers.
 *
 * A label naming a block that isn't in the article fails it too. That is not a
 * matter of degree: the model was working from something other than the input.
 * It has to be read off the model's own `navLabels` map rather than off the
 * tree, because `buildTree` walks the blocks and looks each one's label up —
 * an id the model invented is never asked for, and so leaves no trace in the
 * tree at all.
 */
export function checkCoverage(
  navLabels: Record<string, string>,
  tree: Tree,
  blocks: Block[],
): void {
  const known = new Set(blocks.map((b) => b.id));
  const gistable = blocks.filter((b) => b.gistable);
  const labelled = Object.values(tree.nodes).filter((n) => n.navLabel);

  const invented = Object.keys(navLabels).filter((id) => !known.has(id));
  if (invented.length > 0) {
    throw new Error(
      `The table of contents labelled ${invented.length} block(s) that are not in this article ` +
        `(${invented.slice(0, 3).join(", ")}). The model was not working from the input it was given.`,
    );
  }

  if (gistable.length === 0) return;
  const covered = labelled.length / gistable.length;
  if (covered < COVERAGE_FLOOR) {
    const missing = gistable.length - labelled.length;
    throw new Error(
      `The table of contents came back covering ${labelled.length} of ${gistable.length} ` +
        `paragraphs — ${missing} have no row. The response was not truncated, so the model ` +
        `stopped early on its own; nothing has been written. Retrying may well work.`,
    );
  }
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

/** The slug a blocks.json path implies — `foo.blocks.json` and `foo.json` both give `foo`. */
export function slugForBlocksPath(blocksPath: string): string {
  return path.basename(blocksPath).replace(/\.blocks\.json$/, "").replace(/\.json$/, "");
}

export interface TocRun {
  tree: Tree;
  outDir: string;
  /** Which model wrote it. `MODEL` is private here, and the queue logs what a tree cost. */
  model: string;
  blocks: number;
  gistable: number;
  labelled: number;
  internal: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
}

/**
 * Stage 4 over a blocks.json on disk: one model call, then `tree.json` and a
 * copy of `blocks.json` beside it.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 *
 * `onProgress` is called as the model streams. There is nothing useful to say
 * about *what* it has written — the JSON is unparseable until it is complete —
 * so what it reports is that something is still arriving, which is the question
 * a reader watching a two-minute step is actually asking.
 */
export async function generateToc(opts: {
  blocksPath: string;
  outDir?: string;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
}): Promise<TocRun> {
  const { blocks } = JSON.parse(await readFile(opts.blocksPath, "utf-8")) as { blocks: Block[] };
  const slug = slugForBlocksPath(opts.blocksPath);
  const outDir = opts.outDir ?? path.join("data", slug);
  const gistable = blocks.filter((b) => b.gistable).length;
  const started = Date.now();

  /* Before the call, and before a minute of anyone's time is spent: an article
     whose table of contents cannot fit in one response is refused here rather
     than discovered six minutes in. `budgetFor` throws for that case. */
  const answerTokens = estimateTocTokens(blocks);
  const maxTokens = budgetFor("table of contents", answerTokens);

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT },
    system: SYSTEM,
    messages: [{ role: "user", content: renderBlocks(blocks) }],
  }, { signal: opts.signal });

  if (opts.onProgress) {
    const report = opts.onProgress;
    let chars = 0;
    let last = 0;
    stream.on("text", (delta) => {
      chars += delta.length;
      // Throttled, because the model emits deltas far faster than anyone can
      // read them and every one of these is a write the poller may pick up.
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      report(`${Math.round(chars / 1000)}k characters of tree so far`);
    });
  }

  const message = await stream.finalMessage();
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (message.stop_reason === "refusal") {
    throw new Error(`Model refused: ${JSON.stringify(message.stop_details)}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      truncatedMessage("table of contents", maxTokens, answerTokens, {
        outputTokens: message.usage.output_tokens,
        answerChars: raw.length,
      }),
    );
  }

  const { root, navLabels } = parseJson(raw);
  const tree = buildTree(root, navLabels, blocks, slug);
  checkCoverage(navLabels, tree, blocks);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "tree.json"), JSON.stringify(tree, null, 2), "utf-8");
  await writeFile(path.join(outDir, "blocks.json"), JSON.stringify({ blocks }, null, 2), "utf-8");

  return {
    tree,
    outDir,
    model: MODEL,
    blocks: blocks.length,
    gistable,
    labelled: Object.values(tree.nodes).filter((n) => n.navLabel).length,
    internal: Object.values(tree.nodes).filter((n) => n.children.length > 0).length,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    elapsedMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const blocksPath = process.argv[2];
  if (!blocksPath) {
    console.error("Usage: tsx src/toc.ts <blocks.json> [outDir]");
    process.exit(1);
  }
  const argOutDir = process.argv[3];
  // Before the call, not after: this is the only thing on screen for the two
  // minutes the model takes.
  console.log(`Building the tree with ${MODEL}\u2026`);
  const run = await generateToc({
    blocksPath,
    ...(argOutDir ? { outDir: argOutDir } : {}),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  console.log(`\n${run.blocks} blocks (${run.gistable} gistable) → ${MODEL}`);
  console.log(`\nNodes:     ${Object.keys(run.tree.nodes).length} (${run.internal} internal)`);
  console.log(`Labelled:  ${run.labelled} / ${run.gistable} gistable blocks`);
  console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`\nWrote:     ${path.resolve(run.outDir)}/tree.json`);
  console.log(`Validate:  npm run validate-tree -- ${run.outDir}`);
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void main();
