/**
 * Pipeline stage 4 — build the deeply-nested table of contents / granularity
 * tree over a block sequence. See docs/project/table-of-contents.md.
 *
 *   npm run toc -- output/noema-mythology-of-conscious-ai.blocks.json
 *
 * The model proposes INTERNAL nodes only. Leaves are generated here,
 * mechanically, one per block — which removes the whole class of partition
 * errors that come from asking a model to tile a document exactly. Validate the
 * result with:
 *
 *   npm run validate-tree -- <dir with blocks.json + tree.json>
 *
 * NOTE: this also asks for a one-sentence `gist` per internal node, which
 * architecture.md draws as stage 5. A tree without gists has nothing to render
 * at its coarse levels and fails validation, and both stages write the same
 * artefact, so splitting them into two model passes buys nothing today.
 *
 * **The nav labels are NOT in this call.** They are one per gistable block, so
 * they were the only output in the pipeline that grew with the article without a
 * bound — 73% of this stage's answer on a 360-block article — and they took the
 * whole stage over the 128,000-token ceiling on a single response. They now live
 * in src/labels.ts, batched along this tree's own section boundaries and run in
 * parallel. `generateToc` still drives both and still writes one set of
 * artefacts, so the pipeline sees one step. docs/plans/toc-scaling.md.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL } from "./models.js";
import { loadEnvLocal } from "./env.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { blocksArtefact } from "./blocks.js";
import { isBodyEvidence, isStructural } from "./block-policy.js";
import { isSpideryarnId } from "./ids.js";
import { generateLabels, mergeLabels } from "./labels.js";
import { appendSupplement, splitBlocks } from "./supplement.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type { Block, Tree, TreeNode, NodeId } from "./types.js";
import { parseJsonFrom } from "./parse-json.js";
import { withLedger } from "./cli-ledger.js";

/* Bumped to 2 when the nav labels moved out to src/labels.ts: this prompt no
   longer asks for them, and a tree written by toc/1 is a different artefact. */
const PROMPT_VERSION = "toc/2";

/**
 * How hard the model thinks before it starts writing.
 *
 * **Back to `"high"`, and getting it back is the point of the split.**
 *
 * The history is worth keeping, because this setting has been wrong in both
 * directions. It was `"high"` originally, by default rather than by decision.
 * The max_tokens postmortem forced it down to `"medium"`: the first attempt at
 * fixing the budget raised `max_tokens` from 32,000 to 77,100 and failed again,
 * having spent roughly 64,000 tokens on thinking, because at `"high"` adaptive
 * thinking **expands into whatever room it is given**. `max_tokens` is a
 * ceiling, not a leash; `effort` is the leash.
 *
 * That was a real quality concession and it was made under duress — the reasoning
 * this stage needs is finding topic shifts and balancing the levels, which is
 * exactly the part worth thinking about. It was affordable only because the
 * other 73% of the answer was one mechanical label per paragraph, which does not
 * improve for being brooded over.
 *
 * Those labels now live in src/labels.ts, generated in batches at `"low"`. What
 * is left here is ~7,000 tokens of structure on a 360-block article, with room
 * to think about it properly. See docs/plans/toc-scaling.md and
 * docs/postmortems/toc-max-tokens.md.
 */
const EFFORT = "high" as const;

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

OUTPUT

JSON only, no prose, no code fence:

{"root": {"title": "...", "gist": "...", "range": ["<firstBlockId>", "<lastBlockId>"],
          "sourceHeading": "...", "children": [ ... ]}}

Use only block ids that appear in the input. Do not invent ids.`;

export interface ModelNode {
  title: string;
  gist?: string;
  range: [string, string];
  sourceHeading?: string;
  children?: ModelNode[];
}

/**
 * The article, as the structure model sees it.
 *
 * **A supplement's prose is withheld, and its id is not.** On the ordinary path
 * `generateToc` hands this only the body, so the branch never fires — but the
 * split falls back to the whole article whenever the apparatus is not one
 * trailing run (src/supplement.ts), and on that path this function is the only
 * thing between a bibliography and the largest prompt the pipeline sends. A
 * marker alone was the shape of the original bug: `NOT-GISTABLE` is written from
 * `gistable`, and a prose footnote *is* gistable, so a note went out unmarked
 * and in full. Marking it would not have been a fix either — the text is what
 * must not travel. GPT Sol's review of stage 3, 2026-08-28.
 *
 * The **id stays**, because the model's ranges have to tile the whole article
 * and a block it cannot name is a block no node can cover. `NOT-GISTABLE` is
 * reused rather than a new marker invented: SYSTEM above already explains it,
 * and a word the prompt never defines is a word the model gets to interpret.
 */
function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      if (!isBodyEvidence(b)) return `[${i}] ${b.id} <${b.tag}> NOT-GISTABLE: (withheld)`;
      const mark = b.gistable ? "" : " NOT-GISTABLE";
      return `[${i}] ${b.id} <${b.tag}>${mark}: ${b.text}`;
    })
    .join("\n\n");
}

/**
 * How many tokens of JSON this stage is asking the model for.
 *
 * **This used to be the unbounded one.** It charged for a nav label per gistable
 * block on top of the tree, so the estimate — and the answer — grew at N, and
 * an article long enough could not be described in one response at all. The
 * labels moved to src/labels.ts; what is left grows at roughly N/7, because
 * that is how many blocks a section holds.
 *
 * **The constants are measured, not guessed** — and the first draft of them was
 * guessed, and was wrong in both directions. Rebuilding three finished trees
 * back into the JSON the model emits and counting gives, for the structure half
 * alone:
 *
 * | tree | blocks | internal nodes | tokens | per block |
 * |---|---|---|---|---|
 * | a short post | 19 | 10 | 944 | 49.7 |
 * | the test article | 141 | 33 | 3,556 | 25.2 |
 * | the constitution | 360 | 52 | 6,370 | 17.7 |
 *
 * Per-block cost *falls* with length, because a long article's sections hold
 * more blocks each. The short post's 49.7 is fixed overhead, not a trend — which
 * is why the estimate is built from a node count and a flat constant rather than
 * from a rate per block.
 *
 * A node costs 120–175 tokens: a title, a gist, a range and often a
 * `sourceHeading`. 175 is the worst case observed. The node count is the guess:
 * the three real trees came out at blocks/2.9, blocks/3.1 and blocks/6.9, and
 * `blocks/4 + 6` covers both ends — the constant keeps a 20-block article
 * honest, the divisor keeps a 2,000-block one from being refused for a tree it
 * would never have grown.
 *
 * Every real tree comes out 1.5x–2.3x under the estimate, which is the margin we
 * want: an underestimate costs a multi-minute call and a failed ingest, an
 * overestimate costs nothing at all, because `max_tokens` is a ceiling and
 * allowance the model doesn't spend is not billed.
 * tests/token-budget.test.ts holds this to the committed fixture.
 */
export function estimateTocTokens(blocks: Block[]): number {
  const internal = Math.ceil(blocks.length / 4) + 6;
  return 500 + internal * 175;
}

/**
 * How much of the article the labels have to reach. **All of it.**
 *
 * This was 0.95 when one model call wrote the whole tree, and the missing 5%
 * was an escape hatch: the model was allowed to skip a trivial transition
 * sentence, and an unlabelled gistable leaf is still only a *warning* in
 * [validate-tree.ts](./validate-tree.ts) for that reason
 * (docs/project/table-of-contents.md). The floor existed to tell a used escape
 * hatch apart from an answer that had quietly stopped early.
 *
 * The split removes the ambiguity. src/labels.ts asks for an exact set of
 * numbered paragraphs per call and refuses a response returning any other set,
 * so a batch is complete or it throws; and `planBatches` puts every gistable
 * block in exactly one batch. There is no longer a path by which a block is
 * legitimately unlabelled, so anything under 100% is a bug in the batching
 * rather than a judgement by the model — and a floor that tolerated it would be
 * hiding the one failure this design can have.
 *
 * Every real tree came back at 100% under the old rule anyway: 29 of 29, 117 of
 * 117, 18 of 18. The escape hatch was never once used.
 */
const COVERAGE_FLOOR = 1;

/**
 * How to name a value from the model in an error message — and when not to.
 *
 * **An error thrown in this file is a value that travels.** A step that throws
 * is logged by src/jobs.ts through `errorFields`, and src/log.ts's serialiser
 * keeps the error's `message` *and* its `stack`, which contains the message
 * again. So anything interpolated here is written into the log twice, from a
 * file that never calls the logger at all, and `redact` matches paths in the
 * object rather than text in a string, so it reaches neither copy. See
 * docs/project/logging.md § An error is not a safe thing to log whole.
 *
 * What makes stage 4 the awkward case is that its inputs are `JSON.parse` of
 * the model's response with a TypeScript cast in front of them, and **the cast
 * proves nothing at runtime**. Nothing stops the model writing
 * `"range": ["Feeling is metabolic, not computational", "spya-k3m9qt"]`, and
 * that is precisely the input that reaches the branches below — a sentence of
 * the article is never in `blocks.json`, so the lookup misses and we throw. The
 * message would then carry the article's own prose into the log exactly when
 * the model misbehaves.
 *
 * The one value that is safe to quote is one that has passed `isSpideryarnId`:
 * `spya-` plus six characters drawn from a fixed 32-character alphabet
 * (src/ids.ts, docs/project/block-ids.md), which cannot spell a word of
 * anybody's article. Everything else is described by its shape and withheld —
 * a length and a type are enough to tell a truncated id from a paragraph.
 */
function nameValue(value: unknown): string {
  if (typeof value === "string" && isSpideryarnId(value)) return `"${value}"`;
  if (value === null) return "not a block id (null)";
  if (typeof value !== "string") return `not a block id (a ${typeof value})`;
  return `not a block id (a ${value.length}-character string, withheld)`;
}

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
  /* `isStructural`, not `gistable`: since footnotes, the blocks a row is owed
     for are the body's, and a ratio taken over a set that includes the
     bibliography would report a third of gwern missing on a tree that is
     complete. src/block-policy.ts. */
  const structural = blocks.filter((b) => isStructural(b));
  /* Blocks, not leaf nodes. Counting nodes was a real bug: an overlap in the
     model's ranges grows two leaves for one paragraph while a gap elsewhere
     grows none, so the node count comes out right while the article comes out
     short — and the ratio hit exactly 1.0 with two paragraphs unlabelled.
     `buildTree` now refuses a tree that does not tile, so this can no longer
     happen; a set is what should have been compared either way. */
  const labelledBlocks = new Set(
    Object.values(tree.nodes)
      .filter((n) => n.navLabel && n.children.length === 0)
      .map((n) => n.range[0]),
  );

  const invented = Object.keys(navLabels).filter((id) => !known.has(id));
  if (invented.length > 0) {
    /* Naming only the keys that are well-formed ids. `navLabels` is a
       `JSON.parse` result cast to `Record<string, string>` and nothing has
       checked that its keys are block ids, so a key that fails `isSpideryarnId`
       may be a phrase from the article — see `nameValue` for why that must not
       reach the message. The count is what tells you the scale and it is
       reported in full either way. */
    const named = invented.filter((id) => isSpideryarnId(id));
    const withheld = invented.length - named.length;
    const detail = [
      ...(named.length > 0 ? [named.slice(0, 3).join(", ")] : []),
      ...(withheld > 0 ? [`${withheld} of them not block ids at all, withheld`] : []),
    ].join("; ");
    throw new Error(
      `The table of contents labelled ${invented.length} block(s) that are not in this article ` +
        `(${detail}). The model was not working from the input it was given.`,
    );
  }

  if (structural.length === 0) return;
  const missing = structural.filter((b) => !labelledBlocks.has(b.id));
  const covered = (structural.length - missing.length) / structural.length;
  if (covered < COVERAGE_FLOOR) {
    throw new Error(
      `The table of contents covers ${structural.length - missing.length} of ${structural.length} ` +
        `paragraphs — ${missing.length} have no row (${missing.slice(0, 3).map((b) => b.id).join(", ")}). ` +
        `Every nav label is asked for by number and every batch is checked against the exact set ` +
        `it was given, so this is not a model that stopped early. Look at planBatches in ` +
        `src/labels.ts, and at whether the tree tiles the article. Nothing has been written.`,
    );
  }
}

/**
 * Strip a stray code fence if the model wraps its JSON despite instructions.
 *
 * The parse goes through src/parse-json.ts, and the reason is that **nothing in
 * this file logs**. A step that throws is logged by src/jobs.ts with
 * `errorFields`, which keeps `message` *and* `stack` — and V8's own parse error
 * quotes the first characters of whatever it was handed. So a plain
 * `JSON.parse` here writes part of the model's writing about the article into
 * the log, from a file that never calls the logger at all. An error is a value
 * that travels, and where it is thrown is not where it is written down.
 */
function parseJson(raw: string): { root: ModelNode } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return parseJsonFrom(text, "the table-of-contents response");
}

/**
 * A node's children must exactly tile it: in order, no gaps, no overlaps.
 *
 * **This is the invariant the prompt asks for, and until now nothing enforced
 * it at the point of parsing.** [`validate-tree.ts`](./validate-tree.ts) checks
 * it, but that is a CLI somebody runs by hand — the ingest queue never does. So
 * a model that overlapped two sections produced a tree in which some blocks grew
 * *two* leaves and others grew none, and every downstream check was happy: the
 * partition was never tested, and `checkCoverage` counted labelled leaves rather
 * than labelled blocks, so a duplicate on one side cancelled a gap on the other
 * and the ratio came out at exactly 1.0.
 *
 * Found by an adversarial review of the label split, 2026-08-26, with a worked
 * example: twelve blocks, children `[0..6]` and `[5..9]`, coverage reported
 * complete, two paragraphs with no sidebar row and two rendered twice.
 *
 * Checking here rather than further down is the difference between a fault and
 * a symptom. `planBatches` in src/labels.ts catches the consequence and says so
 * loudly, but by then the cause is three files away and its error has to guess
 * which of several things went wrong. This one knows.
 */
function assertChildrenPartition(
  node: TreeNode,
  nodes: Record<NodeId, TreeNode>,
  index: Map<string, number>,
  where: string,
): void {
  const span = (id: NodeId): [number, number] | null => {
    const child = nodes[id];
    if (!child) return null;
    const lo = index.get(child.range[0]);
    const hi = index.get(child.range[1]);
    return lo === undefined || hi === undefined ? null : [lo, hi];
  };

  const parent = span(node.id);
  if (!parent) {
    /* An internal node with an endpoint that is not a block id. The leaf-growing
       branch below reports this for a *lowest-level* node, and only for one —
       an internal node never reaches it, so returning here on the grounds that
       "something else will catch it" was false, and an invented endpoint with
       valid descendants survived into the stored tree. Caught by GPT-5.6-sol,
       2026-08-26. `nameValue` is what keeps the message from quoting a phrase of
       the article back into a log. */
    throw new Error(
      `The node at ${where} has a range not in blocks.json: ` +
        `start ${nameValue(node.range[0])}; end ${nameValue(node.range[1])}`,
    );
  }

  let cursor = parent[0];
  for (const [i, childId] of node.children.entries()) {
    const child = span(childId);
    if (!child) {
      const bad = nodes[childId];
      throw new Error(
        `Child ${i + 1} of the node at ${where} has a range not in blocks.json: ` +
          `start ${nameValue(bad?.range[0])}; end ${nameValue(bad?.range[1])}`,
      );
    }
    if (child[0] !== cursor) {
      const what = child[0] > cursor ? "leaves a gap of" : "overlaps the one before it by";
      const size = Math.abs(child[0] - cursor);
      throw new Error(
        `The children of the node at ${where} do not tile it: child ${i + 1} ${what} ` +
          `${size} block(s). Children must cover their parent in order, with no gaps and no ` +
          `overlaps — an overlap grows two leaves for one paragraph, and a gap grows none.`,
      );
    }
    cursor = child[1] + 1;
  }
  if (cursor !== parent[1] + 1) {
    const short = parent[1] + 1 - cursor;
    throw new Error(
      `The children of the node at ${where} stop ${short} block(s) before it ends. Those ` +
        `paragraphs would appear nowhere in the table of contents.`,
    );
  }
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

  /* `where` is the node's position in the model's own proposal — "root",
     "root > child 2 > child 4". It is derived from the shape of the answer
     rather than from anything in it, so it is always safe to put in a message,
     and it is what tells you which node to go and look at. */
  const visit = (mn: ModelNode, parent: NodeId | null, depth: number, where: string): NodeId => {
    const id = nextId();
    /* Shape before anything indexes it. `mn.range` is model output behind a
       cast, so it need not be a pair at all: `"range": "spya-a…spya-b"` used to
       reach the lookup below with `range[0] === "s"`, miss, and then fail
       inside `mn.range.join` with "mn.range.join is not a function" — an error
       that named the bug in our code rather than the fault in the answer. */
    const raw: unknown = mn.range;
    const pair = Array.isArray(raw) && raw.length === 2 ? (raw as unknown[]) : [];
    const [start, end] = pair;
    if (typeof start !== "string" || typeof end !== "string") {
      throw new Error(`The node at ${where} has no [start, end] block range.`);
    }
    const range: [string, string] = [start, end];
    const node: TreeNode = {
      id,
      depth,
      parent,
      children: [],
      range,
      title: mn.title,
      ...(mn.gist ? { gist: mn.gist } : {}),
      ...(mn.sourceHeading ? { sourceHeading: mn.sourceHeading } : {}),
    };
    nodes[id] = node;

    const lo = index.get(range[0]);
    const hi = index.get(range[1]);
    if (lo !== undefined && hi !== undefined && lo > hi) {
      /* A range that runs backwards. Both ends are real block ids, so every
         lookup succeeds and nothing below objects — the leaf loop simply runs
         zero times and the node becomes an internal node with no children,
         holding a stretch of the article that then exists in no leaf at all.
         The article comes out short and the tree looks well-formed. */
      throw new Error(
        `The node at ${where} has a range that runs backwards — its start block ` +
          `comes ${lo - hi} block(s) after its end block in the article.`,
      );
    }

    if (mn.children?.length) {
      node.children = mn.children.map((c, i) => visit(c, id, depth + 1, `${where} > child ${i + 1}`));
      assertChildrenPartition(node, nodes, index, where);
      return id;
    }

    // Deepest internal node — grow its leaves.
    if (lo === undefined || hi === undefined) {
      /* Position and shape, never the value itself unless it proved to be an
         id. `mn.title` is out for the obvious reason — it is a sentence the
         model wrote about a section of the article — but so is the range,
         which is why the first version of this fix was only half of one: both
         ends are model output behind a cast, and an end that is a phrase of the
         article is exactly what lands here, since a phrase is never a key in
         `index`. `nameValue` is where the rule lives. */
      const bad = [
        ...(lo === undefined ? [`start ${nameValue(range[0])}`] : []),
        ...(hi === undefined ? [`end ${nameValue(range[1])}`] : []),
      ];
      throw new Error(`Node range not in blocks.json — at ${where}: ${bad.join("; ")}`);
    }
    for (let i = lo; i <= hi; i++) {
      // In range: lo and hi both came out of `index`, which is built over
      // `blocks`, and the undefined case threw two lines up.
      const block = blocks[i]!;
      const leafId = nextId();
      /* Every block still gets a leaf — the tree tiles the article, notes
         included. What `isStructural` decides is which leaves carry a
         *navigable row*. src/block-policy.ts. */
      const label = isStructural(block) ? navLabels[block.id] : undefined;
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

  const rootId = visit(root, null, 0, "root");

  /* The root has to span the whole article, and nothing else checks it.
     `assertChildrenPartition` verifies that a node's children tile *it*, which
     says nothing about whether the root itself starts at the first block and
     ends at the last; and `checkCoverage` further down counts only *gistable*
     blocks, so a root that drops a leading image or a trailing rule passes
     everything while breaking the contract that every block gets exactly one
     leaf (docs/project/table-of-contents.md). Every id resolver in the reading
     view then finds no leaf for those blocks. Caught by GPT-5.6-sol,
     2026-08-26. */
  const rootNode = nodes[rootId]!;
  if (rootNode.range[0] !== blocks[0]?.id || rootNode.range[1] !== blocks.at(-1)?.id) {
    const missingStart = index.get(rootNode.range[0]) ?? 0;
    const missingEnd = blocks.length - 1 - (index.get(rootNode.range[1]) ?? blocks.length - 1);
    throw new Error(
      `The tree does not cover the whole article: it skips ${missingStart} block(s) at the ` +
        `start and ${missingEnd} at the end. Every block gets exactly one leaf, so a block ` +
        `outside the root's range has no row anywhere and nothing can resolve its id.`,
    );
  }

  return { version: PROMPT_VERSION, generator: CAPABLE_MODEL, slug, rootId, nodes };
}

/** The slug a blocks.json path implies — `foo.blocks.json` and `foo.json` both give `foo`. */
export function slugForBlocksPath(blocksPath: string): string {
  return path.basename(blocksPath).replace(/\.blocks\.json$/, "").replace(/\.json$/, "");
}

export interface TocRun {
  tree: Tree;
  outDir: string;
  /** Which model wrote it. `CAPABLE_MODEL` is private here, and the queue logs what a tree cost. */
  model: string;
  blocks: number;
  /**
   * How many blocks are owed a navigable row — `isStructural`, which is
   * `gistable` **and** body. It was `gistable` alone until footnotes; on a
   * heavily cited piece the two differ by a third. src/block-policy.ts.
   */
  structural: number;
  /**
   * How many supplement nodes were appended — one per run of apparatus, and in
   * v1 that is one or none. src/supplement.ts.
   */
  supplementNodes: number;
  /** Blocks under those nodes: the endnotes and the bibliography. */
  supplementBlocks: number;
  /**
   * **Supplement blocks the split refused to place**, which is the number that
   * must be looked at rather than assumed zero. Non-zero means the apparatus is
   * not one trailing run, so no node was built at all and the tree is exactly
   * what it would have been before this stage — a correct article with the
   * feature silently absent, which is precisely the shape a run stat exists to
   * make visible (docs/reusable/silent-success.md).
   */
  strandedSupplement: number;
  labelled: number;
  internal: number;
  /**
   * How many batches the labels were cut into. **Not the same as calls** once a
   * run can resume: a batch taken from a checkpoint is one of these and cost
   * nothing. `labelCalls` is the one that answers "what did we pay for", and
   * the two are reported separately because the first version reported only
   * this one under a comment saying "model calls" — which would have said three
   * calls after making two. GPT-5.6-sol, 2026-08-26.
   */
  labelBatches: number;
  /** Batches this run actually asked the model for. */
  labelCalls: number;
  /** Batches taken from a checkpoint left by an earlier, failed run. */
  labelsResumed: number;
  inputTokens: number;
  outputTokens: number;
  /* From the label pass only — the structure call is one call per article and
     is deliberately not cached, so there is nothing for it to read. See
     docs/plans/prompt-caching.md on why a prefix used once is worth 1.25× and
     no more. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

/**
 * Write JSON so that it is either wholly there or not there at all.
 *
 * `writeFile` truncates its target before it writes, so a process killed at the
 * wrong moment leaves a file that exists and is not valid JSON — and existence
 * is exactly what src/pipeline.ts uses to decide a step is done. Writing beside
 * the target and renaming closes that window: `rename` within a directory is
 * atomic, so no reader ever sees a partial file.
 *
 * The temp name carries the process id so two runs over one directory cannot
 * write to the same scratch file. That should not happen — the queue serialises
 * jobs per slug — but a `.tmp` collision would corrupt both, silently, and the
 * pid costs nothing.
 */
async function writeAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tmp, file);
}

/**
 * Stage 4 over a blocks.json on disk: the structure in one call, the nav labels
 * in parallel batches after it, then `tree.json`, `labels.json` and a copy of
 * `blocks.json`.
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 *
 * **Two model passes, one pipeline step, and nothing written until both are
 * done.** The split exists so the unbounded half can be batched
 * (docs/plans/toc-scaling.md), not so it can be published separately — a tree on
 * disk with a third of its labels missing is a valid-looking artefact that quietly
 * describes part of an article, which is docs/reusable/silent-success.md exactly.
 * Deferring the labels so a reader can start sooner is a real option and a
 * deliberate later one; it needs a state that says "still arriving" rather than
 * an absence that says nothing.
 *
 * `onProgress` reports what is arriving. For the structure call there is nothing
 * useful to say about *what* has been written — the JSON is unparseable until it
 * is complete — so it reports that something is still coming. The label pass can
 * do better, and counts finished sections.
 */
export async function generateToc(opts: {
  blocksPath: string;
  outDir?: string;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
}): Promise<TocRun> {
  /* `parseJsonFrom`, not `JSON.parse`: blocks.json *is* the article, and V8's
     own parse error quotes the first characters of what it was handed. Nothing
     in this file logs, but a step that throws is logged by src/jobs.ts with
     `errorFields`, which keeps `message` and `stack`. src/parse-json.ts. */
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(opts.blocksPath, "utf-8"),
    "blocks.json",
  );
  const slug = slugForBlocksPath(opts.blocksPath);
  const outDir = opts.outDir ?? path.join("data", slug);
  const structural = blocks.filter((b) => isStructural(b)).length;
  const started = Date.now();

  /* **The tree is built from the body alone, and the apparatus is appended
     afterwards.** That ordering is what makes it impossible for a part gist or
     the root gist to summarise a footnote: the structure model is never shown
     one. Everything below this line therefore works over `body`, up to the
     append — including the token budget, which was being asked to pay for a
     tree over gwern's forty endnotes. src/supplement.ts. */
  const { body, groups, stranded } = splitBlocks(blocks);

  /* Before the call, and before a minute of anyone's time is spent: an article
     whose table of contents cannot fit in one response is refused here rather
     than discovered six minutes in. `budgetFor` throws for that case. */
  const answerTokens = estimateTocTokens(body);
  const maxTokens = budgetFor("table of contents", answerTokens);

  /* The request itself, wrapped: a 429/401/etc from the SDK is not caught
     anywhere upstream of here, and the installed SDK builds `Error.message`
     from the upstream error body — the one place it can echo back part of
     what we sent, which is the whole article. See src/anthropic-call.ts.

     The client is built by `streamMessage`, which also sets `logLevel: "off"`
     — a privacy setting rather than a preference. The SDK has a logger of its
     own that defaults to `console` and reads `ANTHROPIC_LOG` from the
     environment; at `debug` it prints the outgoing request — **which is the
     whole article** — and, for a non-JSON error response, the raw upstream
     body. Neither goes through Pino, so neither can be redacted, and
     `anthropicCallFailed` never sees them. See docs/project/logging.md. */
  let message: Anthropic.Message;
  try {
    const call = streamMessage("toc", {
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      system: SYSTEM,
      messages: [{ role: "user", content: renderBlocks(body) }],
    }, { ...(opts.signal ? { signal: opts.signal } : {}) });

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        // Throttled, because the model emits deltas far faster than anyone can
        // read them and every one of these is a write the poller may pick up.
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${Math.round(chars / 1000)}k characters of tree so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper is
       what records what this call cost. The stream's own method works and
       records nothing. See src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (wasRefused(message)) {
    /* `stop_details` is deliberately neither thrown nor logged — it is the
       provider's own words about a request that carried the whole article,
       and this error is copied onto the job and shown on the progress card.
       See MODEL_REFUSED in src/messages.ts. */
    throw new Error(MODEL_REFUSED.message);
  }
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("table of contents", maxTokens, answerTokens, {
      outputTokens: message.usage.output_tokens,
      answerChars: raw.length,
    });
  }

  const { root } = parseJson(raw);
  /* `body`, so the root's range ends at the last body block and every check in
     `buildTree` — the tiling, the "covers the whole article" guard — is asked
     about the argument the model was actually shown. */
  const structure = appendSupplement(buildTree(root, {}, body, slug), groups);

  /* **Appended before `generateLabels`, not after.** `labels.json` records
     `structureHash(opts.tree)` (src/labels.ts), so a supplement added afterwards
     would make the labels stale at birth — a freshness stamp that is wrong the
     moment it is written, and nothing would ever say so. There is no later
     gist-composition pass to worry about: composition is an instruction to the
     model in SYSTEM above, and `buildTree` copies back what it returns.
     `planBatches` needs no supplement branch of its own — its `own` filter is
     `isStructural`, which is false for every supplement block, so the node
     contributes no sibling set and costs no call. */

  /* Pass two. The tree has to exist first: the batches are cut along its own
     section boundaries, so that every label a reader compares with another was
     written in the same call. src/labels.ts says why that is the rule. */
  /* Before the labels, not after, because the checkpoint they write as they
     land goes in here — and a directory that does not exist yet would turn the
     first batch's saved work into a thrown ENOENT. */
  await mkdir(outDir, { recursive: true });

  const labelRun = await generateLabels({
    tree: structure,
    blocks,
    slug,
    /* Which turns checkpointing on. Each batch's labels are written here as it
       lands, so a 429 or a 5xx eight batches into a book costs the one batch
       rather than the eight — and the retry the queue makes (src/jobs.ts) picks
       up where this one stopped. src/labels.ts § `usableCheckpoint` for the
       four things that have to match before a single one is reused. */
    dir: outDir,
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const tree = mergeLabels(structure, labelRun.labels);
  checkCoverage(labelRun.labels, tree, blocks);

  /* Each file is written to a temporary name and renamed into place, and the
     tree goes last.
     **Ordering alone was not enough, and the first version of this claimed it
     was.** The queue decides a step is done by whether its output files exist
     (src/pipeline.ts), so "write the tree last" only helps if a half-written
     tree does not exist — and `writeFile` creates and truncates its target
     before it has anything to put in it. A process killed mid-write leaves a
     truncated `tree.json` that is very much present, the step reports itself
     finished, and a retry skips it. On a forced regeneration it is worse: the
     *old* tree is on disk throughout, so a crash can leave new labels and new
     blocks beside last week's tree, all three present and mutually
     inconsistent.
     `rename` within a directory is atomic on every filesystem this runs on, so
     each file appears whole or not at all, and the tree — the one every reader
     starts from — appears only after the other two are already whole. Raised by
     GPT-5.6-sol, 2026-08-26; see docs/plans/toc-scaling.md for what this still
     does not give us, which is a way to tell a *stale* complete set from a
     current one. */
  await writeAtomic(path.join(outDir, "labels.json"), labelRun.file);
  /* Through `blocksArtefact`, not `{ blocks }`. Stage 3 stamps the sanitiser
     version into `output/<slug>.blocks.json`; this line rewrites the copy the
     reading view actually opens, and writing the bare array here dropped the
     stamp on every article. Not unsafe — an absent stamp reads as stale, and
     stale means re-sanitise — but it made the stamp worthless: every article
     paid the re-clean on every load and fired the "predates the sanitiser"
     warn every time, which is how a warning stops being read. Note the check
     anybody would run, "is stage 3 writing the stamp?", answers yes. It is,
     into a different file. See docs/project/security.md. */
  await writeAtomic(path.join(outDir, "blocks.json"), blocksArtefact(blocks));
  await writeAtomic(path.join(outDir, "tree.json"), tree);
  /* The working state is only now safe to throw away — see
     src/labels.ts § `LabelRun.clearCheckpoint`. */
  await labelRun.clearCheckpoint();

  return {
    tree,
    outDir,
    model: CAPABLE_MODEL,
    blocks: blocks.length,
    structural,
    supplementNodes: groups.length,
    supplementBlocks: blocks.length - body.length,
    strandedSupplement: stranded,
    labelled: Object.values(tree.nodes).filter((n) => n.navLabel).length,
    internal: Object.values(tree.nodes).filter((n) => n.children.length > 0).length,
    labelBatches: labelRun.batches,
    labelCalls: labelRun.calls,
    labelsResumed: labelRun.resumed,
    /* Both passes together. What this number answers is "what did a tree cost",
       and a structure figure alone would now understate it by most of the bill. */
    inputTokens: message.usage.input_tokens + labelRun.inputTokens,
    outputTokens: message.usage.output_tokens + labelRun.outputTokens,
    cacheReadTokens: labelRun.cacheReadTokens,
    cacheWriteTokens: labelRun.cacheWriteTokens,
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
  /* At the program's edge, not inside the gateway — see `messagesClient` in
     src/messages-stream.ts for the test that proved the difference. Without it
     this command answers `[ai-not-set-up]` on a machine where the key is right
     there in `.env.local`. */
  loadEnvLocal();
  console.log(`Building the tree with ${CAPABLE_MODEL}\u2026`);
  const run = await generateToc({
    blocksPath,
    ...(argOutDir ? { outDir: argOutDir } : {}),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  console.log(`\n${run.blocks} blocks (${run.structural} to label) → ${CAPABLE_MODEL}`);
  console.log(`\nNodes:     ${Object.keys(run.tree.nodes).length} (${run.internal} internal)`);
  console.log(
    `Labelled:  ${run.labelled} / ${run.structural} blocks, in ${run.labelCalls} call(s)` +
      (run.labelsResumed > 0
        ? ` (${run.labelsResumed} of ${run.labelBatches} batches resumed from a checkpoint)`
        : ""),
  );
  console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`\nWrote:     ${path.resolve(run.outDir)}/tree.json`);
  console.log(`Validate:  npm run validate-tree -- ${run.outDir}`);
  console.log(`Eval:      npm run eval:toc -- ${run.outDir}`);
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void withLedger("cli", main);
