/**
 * Pipeline stage 4 — build the deeply-nested table of contents / granularity
 * tree over a block sequence. See docs/project/hierarchy.md.
 *
 *   npm run hierarchy -- output/noema-mythology-of-conscious-ai.blocks.json
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
 * parallel. `generateHierarchy` still drives both and still returns one set of
 * artefacts, so the pipeline sees one step. docs/plans/260826h-toc-scaling.md.
 *
 * **The stage reads no path and writes no file.** It is handed the blocks and
 * hands back the three artefacts in one object; the caller stores them. The
 * pipeline gives that object to the artefact store as a single `parts` map, and
 * `main()` below is the only thing left that turns them into files.
 * docs/plans/260831b-finish-the-database-move.md § Stage 2.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, type Effort } from "./models.js";
import { loadEnvLocal } from "./env.js";
import { MODEL_REFUSED } from "./messages.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { blocksArtefact } from "./blocks.js";
import { isBodyEvidence, isStructural } from "./block-policy.js";
import { isSpideryarnId } from "./ids.js";
import { COVERAGE_FLOOR, generateLabels, mergeLabels, type LabelsFile } from "./labels.js";
import { hashBlocks } from "./source-hash.js";
import { nullCheckpointStore, type CheckpointStore } from "./store/checkpoints.js";
import { appendSupplement, splitBlocks } from "./supplement.js";
import { assertTreeSound, sameHeading } from "./tree-invariants.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import type { Block, Tree, TreeNode, NodeId } from "./types.js";
import { parseJsonFrom, stripFence } from "./parse-json.js";
import { withLedger } from "./cli-ledger.js";

/* Bumped to 2 when the nav labels moved out to src/labels.ts: this prompt no
   longer asks for them, and a tree written by toc/1 is a different artefact. */
const PROMPT_VERSION = "toc/2";

/**
 * How hard the model thinks before it starts writing.
 *
 * **`"medium"`, and this setting has now been wrong in both directions twice.**
 *
 * The history, because it is the argument. It was `"high"` originally, by
 * default rather than by decision. The max_tokens postmortem forced it down to
 * `"medium"`: raising `max_tokens` from 32,000 to 77,100 failed again, having
 * spent roughly 64,000 tokens on thinking, because at `"high"` adaptive thinking
 * **expands into whatever room it is given**. `max_tokens` is a ceiling, not a
 * leash; `effort` is the leash. Moving the nav labels out to src/labels.ts then
 * bought enough room to put it back to `"high"`, and the comment here argued
 * that case well.
 *
 * It went wrong the same way a third time. On 2026-08-30 Stephen Wolfram's
 * "Towards a theory of bugs" was sized for a 52,225-token budget — 12,225 for
 * the answer, 40,000 of `THINKING_HEADROOM` — and came back truncated having
 * spent 2,825 on the answer and 49,400 on reasoning. Those two sum to 52,225
 * **exactly**. The reasoning did not overrun the reservation; it expanded to
 * fill the ceiling, which is what it does at `"high"` and what it will do at
 * any ceiling. So no value of `THINKING_HEADROOM` fixes this, and neither does
 * a better answer estimate: both make the room bigger and the thinking takes
 * the room. Greg's call, the same day.
 *
 * **What this costs, said plainly, because a quality setting is being lowered.**
 * The reasoning this stage needs — finding topic shifts, balancing the levels —
 * is exactly the part worth thinking about, and nobody has measured `high`
 * against `medium` *for this stage*. That comparison exists for arc, thread and
 * glossary and was never run for the tree. So this is a decision taken on a
 * failure mode rather than on a quality measurement, and the measurement is
 * still owed.
 *
 * **If you run that comparison, read `repairedBlocks` and `largestRepair`
 * alongside the score.** Since `0062f74` a tree that does not tile is snapped
 * shut and repaired rather than thrown away, so an arm can score `ok` having
 * been repaired into shape — and a boundary one paragraph out and a section
 * handed forty of its neighbour's blocks would otherwise look identical.
 * `evals/hierarchy-structure/run.ts` records both.
 *
 * See docs/plans/260826h-toc-scaling.md and docs/postmortems/260826a-toc-max-tokens.md.
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
 * `generateHierarchy` hands this only the body, so the branch never fires — but the
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
export function estimateHierarchyTokens(blocks: Block[]): number {
  const internal = Math.ceil(blocks.length / 4) + 6;
  return 500 + internal * 175;
}

/**
 * The structure call's request, assembled in the one place `generateHierarchy`
 * itself uses.
 *
 * Exported for the structure eval (evals/hierarchy-structure/model-arms.ts), whose
 * incumbent arm must send byte-identical bytes to what ships — a copied
 * prompt drifts silently, and an executor one byte adrift is measuring a
 * recipe the pipeline does not run. Because this is the single assembly
 * point, parity is by construction rather than by assertion; the pin that
 * proves it — and was seen red under two perturbations (a space in SYSTEM, a
 * flipped effort) before being trusted — is
 * tests/hierarchy-structure-request-parity.test.ts.
 *
 * Takes the BODY, after `splitBlocks`, exactly as `generateHierarchy` sends it:
 * the apparatus is never shown to the structure model. `budgetFor` throws
 * here for an article whose answer cannot fit one response, which is the
 * same moment it threw before the extraction — before the call, not six
 * minutes into it.
 */
export function structureRequest(body: Block[]): {
  system: string;
  user: string;
  maxTokens: number;
  effort: Effort;
} {
  return {
    system: SYSTEM,
    user: renderBlocks(body),
    maxTokens: budgetFor("table of contents", estimateHierarchyTokens(body)),
    effort: EFFORT,
  };
}

/**
 * How much of the article the labels have to reach — **and it lives in
 * src/labels.ts now.**
 *
 * Moved on 2026-08-31, and re-exported here so that nothing which already
 * imported it from this module had to change. The same move `structureHash` made
 * out of this file, for the same reason: the check it feeds has to happen on
 * both ways into stage 4, and a second copy of the number in the other file
 * could only ever drift. `generateHierarchy` still applies it through `checkCoverage`
 * below, over the tree's own leaves — a different measurement of the same floor,
 * and the one that would catch a merge that lost labels rather than a run that
 * dropped them.
 */
export { COVERAGE_FLOOR };

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
 * docs/postmortems/260826a-toc-max-tokens.md for why this stage in particular attracts
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
        `A batch may leave a paragraph or two of itself bare when the model will not label them ` +
        `(src/labels.ts, droppedBudget), and that is what the ${Math.round(
          (1 - COVERAGE_FLOOR) * 100,
        )}% here is for; this is past it. ` +
        `Look at the run's dropped count, at planBatches in src/labels.ts, and at whether the ` +
        `tree tiles the article. Nothing has been written.`,
    );
  }
}

/**
 * Read the model's answer, fence and all.
 *
 * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` — src/parse-json.ts
 * § `stripFence` has the reasoning, and this file is where it was learned the
 * hard way.
 */
function parseJson(raw: string): { root: ModelNode } {
  return parseJsonFrom(stripFence(raw), "the table-of-contents response");
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
    /* Both directions, because the children can also run *past* the parent —
       and the single-sentence version of this said they stopped "-1 block(s)
       before it ends", which is a message that sends whoever reads it looking
       for the wrong thing. GPT Sol, 2026-08-30. */
    throw new Error(
      short > 0
        ? `The children of the node at ${where} stop ${short} block(s) before it ends. Those ` +
            `paragraphs would appear nowhere in the table of contents.`
        : `The children of the node at ${where} run ${-short} block(s) past its end, so they ` +
            `cover blocks their parent does not.`,
    );
  }
}

/**
 * **What `buildTree` mended on the way past, and what it refused to.**
 *
 * Both fields are filled in by `buildTree` when it is given one, and both are
 * counted into `HierarchyRun`, printed by the CLI every run including when they are
 * zero, and logged by src/pipeline.ts. That is deliberate and it follows
 * `strandedSupplement`: a repair nobody is told about is the same shape as the
 * bug it repaired (docs/reusable/silent-success.md). If these numbers start
 * climbing, the prompt is drifting and the repairs are hiding it.
 */
export interface BuildReport {
  /**
   * Partitions that missed and were snapped shut rather than refused — **by
   * however much they missed.**
   *
   * This said "off-by-one" until 2026-08-31, and it was left behind when the
   * one-block bound went (see `planChildRanges`, and Greg's ruling that we
   * should allow gaps). A repair can now move a section's boundary by forty
   * blocks, and a field description promising off-by-one is the kind of thing a
   * reader believes instead of reading the code. `size` is the number that says
   * how far, and `repairedBlockCount` is how to add them up.
   */
  repairs: PartitionRepair[];
  /**
   * **Children that were not built at all**, by position in the model's
   * proposal — the one thing `planChildRanges` does that loses something the
   * model asked for.
   *
   * A child whose start is not strictly after the previous kept child's start
   * marks no split point: two sections were proposed as beginning in the same
   * place, so one of them is dropped along with its whole subtree. It is
   * counted separately from `repairs` rather than as another `kind` of one,
   * because it is a different kind of loss — a boundary that moved still leaves
   * every section the model named, and this does not. A run with a non-zero
   * figure here stored fewer sections than the model proposed, and that is
   * exactly the sort of thing nobody notices unless it is printed.
   */
  droppedChildren: string[];
  /**
   * Nodes whose `sourceHeading` claim no heading block in their range backed
   * up, by position in the model's proposal. The node keeps its title; it
   * loses only the mark saying the author wrote it.
   */
  droppedHeadings: string[];
}

export interface PartitionRepair {
  /**
   * The node's position in the model's own proposal — "root > child 2". Derived
   * from the shape of the answer rather than anything in it, so it is always
   * safe to log; see `where` in `buildTree`.
   */
  where: string;
  /**
   * Which way the model's two claims about this boundary disagreed: the next
   * section started late (`gap`) or early (`overlap`), or the last child stopped
   * before its parent ended (`short`) or ran past it (`over`).
   */
  kind: "gap" | "overlap" | "short" | "over";
  /**
   * **The boundary's coordinate: the index of the first block after it.** A
   * node's own start, a child's start, and one past the parent's last block are
   * all boundaries, and all are named this way — so `at` identifies a boundary
   * and nothing else.
   *
   * That is what lets `repairedBlockCount` tell a cascade from two faults: a
   * repaired node and its first child are one boundary seen at two depths and
   * share a coordinate, while two faults in one node cannot, because the
   * interior boundaries are strictly increasing starts and the closing one is
   * `parentEnd + 1`, which is past all of them. It was `parentEnd` until the
   * coordinates were made uniform, and a last child that both started and ended
   * in the wrong place reported two faults at one coordinate — counted as one,
   * understating the only figure anyone watches.
   */
  at: number;
  /**
   * **How many blocks changed hands at this boundary** — which is both how far
   * apart the model's two claims about it were, and how much of the article
   * ended up in a different section than the answer asked for. They are the
   * same number: the model said one child ends at `E` and the next starts at
   * `S`, and `|S - (E + 1)|` is the stretch that has to go to one side or the
   * other.
   *
   * **This is the number that used to be a bound, and is now the whole of what
   * replaced it.**
   *
   * While a repair could only ever be one block, its size was not worth
   * recording: every repair was the same size and the count said everything.
   * Since the bound was lifted (see `planChildRanges`) the count no longer
   * distinguishes a boundary a paragraph out from a section handed forty blocks
   * that belonged to its neighbour, and those are not the same event. A repair
   * nobody is told the size of is now the shape of the bug it repaired, which is
   * the argument this file already made about the count.
   *
   * A cascade reports the same size at each depth, because it is one boundary
   * moving the same distance; `at` is what tells the two apart.
   */
  size: number;
}

/**
 * **How many blocks the repairs actually moved** — one entry per boundary, not
 * one per level.
 *
 * A cascade emits a `PartitionRepair` at every depth the same boundary appears
 * at, deliberately: moving a node's start moves its first child's start too, and
 * each of those is a real edit to a real range. But they are one physical
 * movement of one set of blocks, so adding their sizes up counts the same blocks
 * two, three or four times over. The sum was `repairs.reduce((n, r) => n +
 * r.size, 0)`, so one 40-block movement through three levels reported 120 — and
 * this is the number the CLI prints, src/pipeline.ts logs, and the eval scores
 * arms on. A count that inflates with the tree's depth cannot be compared
 * between articles at all, which is the whole of what it is for. GPT Sol's
 * review of stage 1, 2026-08-31, finding 6.
 *
 * The maximum per boundary rather than the first or last: a repair that cascades
 * can widen on the way down (the parent's start moves two, the child's start was
 * further out still), and what the reader wants to know is how much of the
 * article ended up somewhere else.
 *
 * `largestRepair` needs no such treatment — a maximum over duplicates is the
 * same maximum — and is deliberately left as it is rather than routed through
 * here for symmetry.
 */
export function repairedBlockCount(repairs: PartitionRepair[]): number {
  const byBoundary = new Map<number, PartitionRepair[]>();
  for (const r of repairs) byBoundary.set(r.at, [...(byBoundary.get(r.at) ?? []), r]);

  let total = 0;
  for (const group of byBoundary.values()) {
    /* **A shared coordinate is not enough to make two faults one.** Grouping by
       `at` alone was wrong, and GPT Sol found the case: a node's last child
       stopping short and its *next sibling's* first child starting late are two
       independent faults about two different blocks, and they meet at the
       coordinate between the siblings. Deduplicating them reported one block
       moved where two had.

       A cascade is a boundary seen at several *depths*, so its entries are
       nested: "P > child 1" and "P > child 1 > child 1" and so on down. Shortest
       `where` first, so a chain's outermost entry is the one that starts it. */
    const chains: PartitionRepair[][] = [];
    for (const r of [...group].sort((a, b) => a.where.length - b.where.length)) {
      const chain = chains.find((c) => r.where.startsWith(`${c[0]!.where} > `));
      if (chain) chain.push(r);
      else chains.push([r]);
    }
    /* Within a chain, the maximum: one physical movement of one set of blocks,
       recorded once per level it passes through, and it can widen on the way
       down. Across chains, the sum: different blocks. */
    for (const chain of chains) total += Math.max(...chain.map((r) => r.size));
  }
  return total;
}

/**
 * **What to do with each of the model's proposed children**: build it over this
 * range, or drop it.
 *
 * A plan is produced for *every* child, always with an explicit range, because
 * `planChildRanges` derives all of them rather than accepting some and mending
 * others. There is no "use what the model wrote" case left: the model's ends
 * are not used at all (see `planChildRanges`), so a child whose range comes
 * back unchanged is one whose proposal happened to agree with the plan.
 */
type ChildPlan = { keep: true; range: readonly [string, string] } | { keep: false };

/**
 * **Derive a tiling from the model's proposal instead of checking one.**
 *
 * Read [docs/project/hierarchy.md § the partition is derived, not
 * checked](../docs/project/hierarchy.md#derived-partition) for the
 * reasoning; what follows is why the code looks like this.
 *
 * ## The rule
 *
 * **A child's start is believed; every end is computed.** For a parent
 * `[P0, P1]` with children whose proposed starts are `s1 … sn`:
 *
 * - the first kept child starts at `P0`, because children must cover their
 *   parent and nothing else can supply that block;
 * - every later child starts where the model said it starts, clamped into the
 *   parent and required to be strictly after the previous kept child's start;
 * - every child ends one block before the next kept child starts, and the last
 *   ends at `P1`.
 *
 * That is the whole algorithm. A gap, an overlap, a last child that stops short
 * and children that run past their parent are not four cases to detect and mend
 * — **they cannot be expressed**. A list of ordered split points tiles its
 * parent by construction, so there is nothing left to check and nothing left to
 * refuse. `assertChildrenPartition` still runs afterwards and should now never
 * fire on a planned node; it is the proof that this is total, not a second
 * chance to reject the answer.
 *
 * ## Why starts and not ends
 *
 * This replaced a cursor walk that did the opposite — it believed each child's
 * *end* and moved the next child's start up to meet it. Both are single rules;
 * they differ in which of the model's two claims about a boundary survives when
 * they disagree, and in which section an orphaned paragraph lands in.
 *
 * A start is a claim the model has a reason for: it is where the section
 * begins, where its heading is, and what `sourceHeading` names. An end is the
 * same boundary stated a second time from the other side — a redundant field,
 * and redundant fields are where inconsistency lives. When two claims about one
 * boundary disagree, believe the one carrying meaning.
 *
 * The visible consequence: a gap used to hand the orphaned block to the section
 * that *follows* it, and now hands it to the one *before*. That reads better on
 * the fixture in tests/hierarchy-repairs.test.ts, where the orphan is "Body of the
 * first part" — the old rule filed it under "Second" — and it is what the rule
 * implies rather than a case anyone wrote. A gap means the model stopped a
 * section early while knowing where the next one starts, so the loose blocks
 * are the tail of the section before them.
 *
 * ## What is still refused, and what is dropped
 *
 * **Refused, by returning `null` and letting the precise error fire.** A child
 * range that is not a resolvable, forward pair of ids — an invented id, a
 * phrase of the article, a range running backwards. Those are faults in what
 * the model *said*, not in how its sections line up, they have exact messages
 * of their own, and planning around a start that means nothing would replace a
 * precise error with a vague one.
 *
 * **Dropped, and counted.** A child whose start is not strictly after the
 * previous kept child's start. There is no split point there: the model
 * proposed two sections beginning in the same place, which is one section. The
 * old code refused this outright, on the argument that emptying a child deletes
 * a section the model asked for — true, and still the reason this is reported
 * as its own figure. What changed is the price: refusing costs the reader the
 * whole article, and the alternative of squeezing the child into one borrowed
 * block writes a boundary nobody proposed and cascades absurdly when a start is
 * badly out. Dropping is the honest reading of two starts in one place.
 *
 * ## What stands where the two bounds stood
 *
 * There were two, and both are gone: the per-repair size bound on 2026-08-30,
 * and the per-answer boundary count (`MAX_REPAIRED_BOUNDARIES`) here. What is
 * left is measurement. Every boundary the model got wrong is recorded with
 * `where`, `kind`, `at` and `size`, summed and maxed into `HierarchyRun`, printed by
 * the CLI at zero as well as above it, logged by src/pipeline.ts and scored per
 * result by evals/hierarchy-structure — because a repair nobody is told about is the
 * same shape as the bug it repaired (docs/reusable/silent-success.md).
 *
 * **A count that used to be a gate is now the trigger for the next stage.**
 * Greg, 2026-08-30, on allowing gaps rather than failing fatally:
 *
 * > Perhaps in future, it should trigger a re-run of the LLM, where we feed in
 * > the previous output, with information about the gaps and ask it to adjust.
 * > But that's for later.
 *
 * That re-ask is still the right long-term answer, and this is deliberately the
 * step toward it rather than a detour: it supplies the two things the re-ask
 * needs — a fallback that always yields a usable tree when the second call is
 * also wrong, and a number (`repairedBlocks` against `blocks`) to decide when a
 * second call is worth buying. See docs/plans/260831ai-hierarchy-tiling-normalisation.md
 * § What this is a step toward.
 *
 * Returns one plan per child in the model's own order, or `null` for "do not
 * plan this node".
 */
function planChildRanges(
  children: ModelNode[],
  parent: readonly [number, number],
  index: Map<string, number>,
  blocks: Block[],
  where: string,
  repairs: PartitionRepair[],
  droppedChildren: string[],
): ChildPlan[] | null {
  /** A child's range as block indices, or null if it is not a resolvable, forward pair. */
  const spanOf = (mn: ModelNode): [number, number] | null => {
    const raw: unknown = mn.range;
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const [a, b] = raw as unknown[];
    if (typeof a !== "string" || typeof b !== "string") return null;
    const lo = index.get(a);
    const hi = index.get(b);
    return lo === undefined || hi === undefined || lo > hi ? null : [lo, hi];
  };

  const spans: ([number, number] | null)[] = children.map(spanOf);
  /* One unresolvable child and the whole node is left alone. Not because the
     others cannot be planned around it, but because the message that names the
     invented id is more use than a tree built as though the child had never
     been proposed — and `visit` and `assertChildrenPartition` produce it. */
  if (spans.some((s) => s === null)) return null;

  const [p0, p1] = parent;

  const clamp = (v: number) => Math.min(Math.max(v, p0), p1);

  /**
   * The split points, in the model's order. The first kept child is pinned to
   * the parent's start; every later one is the model's own start, clamped into
   * the parent and required to be strictly after the previous kept start.
   *
   * **When a start says nothing, the previous child's end is the evidence that
   * is left.** A start that does not advance past the previous section's start
   * is not a split point, and taking it at face value would drop a section for
   * a fault that is not about that section at all. GPT Sol found the case, and
   * it is not a corner:
   *
   * ```text
   * child 1  [0,0]   "Preamble"
   * child 2  [0,4]   "Large middle"   ← starts where child 1 does
   * child 3  [5,5]   "Close"
   * ```
   *
   * One overlap of one block, and dropping on the start alone deletes the
   * article's largest section and its whole subtree. Falling back to child 1's
   * *end* gives child 2 a start of 1, and all three sections survive with the
   * ranges the answer plainly meant — which is what the cursor walk this
   * replaced would have done, and the one case where believing ends is better.
   *
   * So the rule is not "starts win"; it is **believe the start, and fall back to
   * the end when the start carries no information**. A child is dropped only
   * when *neither* claim yields a usable split point, which is a genuinely
   * degenerate answer rather than one boundary out of place.
   */
  const kept: KeptChild[] = [];
  for (const [i, span] of spans.entries()) {
    const previous = kept.at(-1);
    if (previous === undefined) {
      kept.push({ childIndex: i, start: p0 });
      continue;
    }
    const claimed = clamp(span![0]);
    const start =
      claimed > previous.start ? claimed : clamp(spans[previous.childIndex]![1] + 1);
    if (start <= previous.start) {
      droppedChildren.push(`${where} > child ${i + 1}`);
      continue;
    }
    kept.push({ childIndex: i, start });
  }

  const plans: ChildPlan[] = children.map(() => ({ keep: false }));
  for (const [k, child] of kept.entries()) {
    const next = kept[k + 1];
    const end = next === undefined ? p1 : next.start - 1;
    /* In range: `start` is clamped into [p0, p1] and `end` is either `p1` or one
       before a start that was, and both index `blocks` because the parent's own
       range came out of `index`. `end >= start` because the starts are strictly
       increasing, so no plan can describe a node covering nothing. */
    plans[child.childIndex] = {
      keep: true,
      range: [blocks[child.start]!.id, blocks[end]!.id] as const,
    };
  }

  recordBoundaryFaults(kept, spans, parent, where, repairs);
  return plans;
}

/** One kept child: where it sits in the model's proposal, and where it starts. */
type KeptChild = { childIndex: number; start: number };

/**
 * **What the model got wrong, measured against the tiling derived from it** —
 * separate from `planChildRanges` because the plan and the report on the plan
 * are different jobs. Nothing here changes what is built.
 *
 * **One entry per boundary, not one per child whose range moved.** Every child's
 * end moves whenever the boundary after it does, so counting children would
 * report one mistake twice and make `repairedBlocks` depend on which side of a
 * boundary you happened to look from.
 *
 * A node with `n` kept children has `n + 1` boundaries: its own start, the
 * `n - 1` between the children, and one past its end. The model states each
 * interior one **twice** — as a child's start, and as the previous child's end —
 * so this walks the three groups asking, of each, whether its claims agreed.
 * `size` is how far apart they were, which is the same number as how many blocks
 * changed hands (`PartitionRepair.size` has the arithmetic).
 */
function recordBoundaryFaults(
  kept: KeptChild[],
  spans: ([number, number] | null)[],
  parent: readonly [number, number],
  where: string,
  repairs: PartitionRepair[],
): void {
  const [p0, p1] = parent;
  /**
   * `size` is **the total distance from where the boundary ended up to each of
   * the model's claims about it** — one claim at the ends of a node, two in the
   * middle, where the model states the same boundary twice.
   *
   * **Measured against the raw proposal, never against a clamped or fallen-back
   * value.** GPT Sol caught this reporting less than happened: for an inner
   * parent `[0,3]` with children `[0,1]` and `[5,5]`, the model's two claims
   * about the interior boundary are 2 and 5, three apart — but the start is
   * clamped to 3 before the comparison, so it was reported as a gap of one. The
   * clamped value is right for building the tree and wrong for measuring the
   * answer, and this is the number a re-ask would be triggered by and told
   * about.
   *
   * A boundary the model got right and we did not move scores 0 and is not
   * recorded, which is why the guard lives here rather than at each call.
   */
  const fault = (child: KeptChild, kind: PartitionRepair["kind"], at: number, size: number) => {
    if (size > 0) repairs.push({ where: `${where} > child ${child.childIndex + 1}`, kind, at, size });
  };

  // The node's own start, against what its first child claimed. One claim.
  const head = kept[0];
  if (head !== undefined) {
    const claimed = spans[head.childIndex]![0];
    fault(head, claimed > p0 ? "gap" : "overlap", p0, Math.abs(p0 - claimed));
  }

  /* Each interior boundary, where the model states it twice: as the previous
     child's end, and as this child's start. They agree on a well-formed answer,
     and the distance between them is how many blocks change hands. */
  for (let k = 1; k < kept.length; k++) {
    const child = kept[k]!;
    const after = spans[kept[k - 1]!.childIndex]![1] + 1;
    const claimed = spans[child.childIndex]![0];
    const size = Math.abs(child.start - claimed) + Math.abs(child.start - after);
    /* Which way the answer was wrong: by its own two claims where they
       disagree, and otherwise by how far we had to move the boundary from the
       one place it did name. */
    const late = claimed === after ? child.start > claimed : claimed > after;
    fault(child, late ? "gap" : "overlap", child.start, size);
  }

  /* The closing boundary, at one *past* the parent's last block so it can never
     share a coordinate with a child's start — `PartitionRepair.at` has the
     undercount that caused.

     **"over" is the fault the old code refused outright**: children claiming
     blocks their parent does not have. Its two honest repairs — shrink the
     child, or grow the parent — used to be "two different readings with nothing
     to choose between them". There is something to choose between them now: the
     parent's range was itself derived one level up, so it is the claim with a
     tiling behind it, and the child's overrun gives way. */
  const tail = kept.at(-1);
  if (tail !== undefined) {
    const claimed = spans[tail.childIndex]![1];
    fault(tail, claimed < p1 ? "short" : "over", p1 + 1, Math.abs(p1 - claimed));
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
  /**
   * Filled in with what was mended on the way past. Optional so that the
   * callers who only want a tree — the tests, src/validate-tree.ts — stay one
   * argument long; `generateHierarchy` always passes one, because a repair nobody
   * counts is a repair nobody can notice going wrong.
   */
  report?: BuildReport,
): Tree {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const repairs = report?.repairs ?? [];
  const droppedChildren = report?.droppedChildren ?? [];
  const dropped = report?.droppedHeadings ?? [];
  const nodes: Record<NodeId, TreeNode> = {};
  let counter = 0;
  const nextId = () => `n${String(++counter).padStart(4, "0")}`;

  /* `where` is the node's position in the model's own proposal — "root",
     "root > child 2 > child 4". It is derived from the shape of the answer
     rather than from anything in it, so it is always safe to put in a message,
     and it is what tells you which node to go and look at. */
  const visit = (
    mn: ModelNode,
    parent: NodeId | null,
    depth: number,
    where: string,
    /* The range its parent mended for it, when one was mended. The model's own
       proposal is never mutated: two callers share the same literal in the
       tests and in the evals, and a repair written back into it would leak from
       one build into the next. */
    override?: readonly [string, string],
  ): NodeId => {
    const id = nextId();
    /* Shape before anything indexes it. `mn.range` is model output behind a
       cast, so it need not be a pair at all: `"range": "spya-a…spya-b"` used to
       reach the lookup below with `range[0] === "s"`, miss, and then fail
       inside `mn.range.join` with "mn.range.join is not a function" — an error
       that named the bug in our code rather than the fault in the answer. */
    const raw: unknown = override ?? mn.range;
    const pair = Array.isArray(raw) && raw.length === 2 ? (raw as unknown[]) : [];
    const [start, end] = pair;
    if (typeof start !== "string" || typeof end !== "string") {
      throw new Error(`The node at ${where} has no [start, end] block range.`);
    }
    const range: [string, string] = [start, end];
    const lo = index.get(range[0]);
    const hi = index.get(range[1]);

    /**
     * **An authored heading the node does not contain is dropped, not thrown on.**
     *
     * `sourceHeading` is provenance, not structure. Its only consumer is the
     * `§` badge that tells the reader the author wrote this heading and we did
     * not (src/web/TableView.tsx, ContextList.tsx, Spine.tsx) — so an unbacked
     * claim is a badge that would lie, and the whole cost of dropping it is
     * that one node stops claiming an authorship it never had. Throwing, by
     * contrast, costs the reader the article: four structure calls in four made
     * the same wrong claim on the same document, which makes a refusal not an
     * occasional loss but a guaranteed failure loop for it
     * (docs/research/260830a-opening-an-article-before-the-toc.md § 7b).
     *
     * **Read with `sameHeading`, over the same range, so this is a repair and
     * not a second opinion.** `checkTree` asks the identical question later,
     * against the full block array; this one asks it against `body`, which
     * within a node's range is a subset. So anything kept here is kept there,
     * and the invariant can no longer fail on a claim this line let past —
     * which is the property that makes the repair worth having rather than a
     * disagreement waiting to surface downstream (src/tree-invariants.ts).
     *
     * The `typeof` guard is not decoration: `mn` is model output behind a cast,
     * and a number here would reach `sameHeading` and throw inside a `.replace`
     * on a string that is not one.
     */
    const wrote = mn.sourceHeading !== undefined && mn.sourceHeading !== null;
    const claim =
      typeof mn.sourceHeading === "string" && mn.sourceHeading.trim() !== ""
        ? mn.sourceHeading
        : undefined;
    const backed =
      claim !== undefined &&
      lo !== undefined &&
      hi !== undefined &&
      lo <= hi &&
      blocks.slice(lo, hi + 1).some((b) => b.kind === "heading" && sameHeading(b.text, claim));
    /* `wrote`, not `claim`: a number, or a string of spaces, is a claim this
       stage threw away too, and counting only the well-formed ones would make
       "nothing is repaired quietly" false in exactly the case that says the
       model's output has gone strange. GPT Sol's review. */
    if (wrote && !backed) dropped.push(where);

    const node: TreeNode = {
      id,
      depth,
      parent,
      children: [],
      range,
      title: mn.title,
      ...(mn.gist ? { gist: mn.gist } : {}),
      ...(backed ? { sourceHeading: claim } : {}),
    };
    nodes[id] = node;
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
      /**
       * **Plan before descending, not after the walk.**
       *
       * By the time `assertChildrenPartition` runs, `visit` has already grown
       * every child's leaves, so changing a range there would mean growing a
       * leaf to match and splicing it into position — the tree repairing itself
       * after the fact, which is the shape that produces two leaves for one
       * block. Planning the *proposal* means nothing is built yet: the
       * recursion sees the derived range and grows exactly the leaves it
       * implies.
       *
       * It is also what makes the cascade fall out for free. A child's start
       * becomes its own children's `p0` one level down, so a boundary decided
       * here is the boundary every descendant inherits, and there is no way to
       * mend depth 1 into a break at depth 2.
       *
       * A parent whose own range does not resolve is left alone, and so is a
       * node with a child whose range does not (`planChildRanges` returns
       * `null`): `assertChildrenPartition` and the leaf branch have exact
       * messages for those, and planning around an endpoint that means nothing
       * would bury them.
       */
      const plans =
        lo !== undefined && hi !== undefined
          ? planChildRanges(mn.children, [lo, hi], index, blocks, where, repairs, droppedChildren)
          : null;
      /* `flatMap`, because a plan can say a child is not built at all. `where`
         still counts children by their position in the *model's* proposal, so
         a dropped child does not renumber its siblings in any message or
         report — the numbers a reader compares against the answer stay put. */
      node.children = mn.children.flatMap((c, i) => {
        const plan = plans?.[i];
        if (plan !== undefined && !plan.keep) return [];
        return [visit(c, id, depth + 1, `${where} > child ${i + 1}`, plan?.range)];
      });
      /* Kept, and it should now never fire on a planned node: a list of ordered
         split points tiles its parent by construction. That is the point of
         leaving it here — it is the standing proof that `planChildRanges` is
         total, and the day it fires is the day that stopped being true. It
         still does real work on the nodes that were not planned. */
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
     leaf (docs/project/hierarchy.md). Every id resolver in the reading
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

/**
 * **Stage 4's three artefacts, and all three are required.**
 *
 * They are one object because they are one write. `labels.json` and the tree
 * are two halves of the same answer — a tree with a third of its labels missing
 * is a valid-looking artefact that quietly describes part of an article — and
 * the blocks are the thing both of them address. A caller that stored the tree
 * and not the labels would publish exactly that, and the step that stored them
 * as three separate calls had a window in which it could.
 *
 * So the shape refuses it: **a `generateHierarchy` that returned the tree without the
 * labels would not compile**, which is a guarantee no test has to be remembered
 * for (docs/project/typechecking.md § Let the types catch it). What the type
 * cannot say is that the three are *about each other*, and that is why
 * `generateHierarchy` runs `assertTreeSound` and `checkCoverage` over this object
 * rather than over the locals it was built from.
 *
 * `blocks` is `ReturnType<typeof blocksArtefact>` rather than `{ blocks }`, so
 * the sanitiser stamp stage 3 puts in it cannot be dropped here by a tidier
 * declaration — an absent stamp reads as stale and costs every reader a
 * re-clean on every load (see the note at the write in `main` below).
 */
export interface HierarchyArtefacts {
  tree: Tree;
  labels: LabelsFile;
  blocks: ReturnType<typeof blocksArtefact>;
}

export interface HierarchyRun {
  /**
   * What this run produced, for the caller to store. Assignable to
   * `ArtifactParts` (src/store/artifacts.ts) as it stands, so the pipeline step
   * hands the whole object to one `write` and the three land together.
   */
  parts: HierarchyArtefacts;
  /**
   * **The hash the caller must record for this step**, read off `labels.json`
   * rather than computed beside it.
   *
   * `hierarchy` deliberately has no `PipelineStep.stamp` — src/pipeline.ts says why,
   * at length, and it is not an oversight. Recording *no input hash* is a
   * different thing: `reasonsNotToPublish` compares `hierarchy`'s `input_hash`
   * against the stored blocks and refuses the publication when they differ, so
   * a run left carrying `NO_INPUT_HASH` makes the article unpublishable
   * (src/store/pg-revisions.ts, src/store/artifacts-pg.ts § `writeArtefacts`).
   *
   * Taken from `parts.labels.sourceHash` because `STAMP_SOURCE.hierarchy` is
   * `"labels"`: whatever the caller passes as `inputHash` is compared against
   * that same field by `assertStampAgrees` on the way into either store, and a
   * second computation of "the blocks hash" is how the two come to disagree.
   * It is `hashBlocks` of the blocks in `parts.blocks` — checked at the seam
   * below rather than assumed, since the two are computed by different modules
   * over arguments only a convention keeps equal.
   *
   * **Only `inputHash`.** A caller that also declares a `promptVersion` gets a
   * throw: the labels file is stamped `labels/1` and the tree is `toc/2`, so a
   * stamp carrying the tree's version contradicts the artefact the stamp is
   * read from. Verified against a real artefact, not reasoned about.
   */
  inputHash: string;
  /* **There is no `clearCheckpoint` here any more.** It was passed out on this
     object rather than called inside, so that whoever *stored* the three
     artefacts closed the gap — a caller that died in between would otherwise
     have thrown away every batch it had just paid for. All of that existed
     because the unit of deletion was a whole file. One row per batch has
     nothing to delete on success; retention is the sweep's.
     src/store/checkpoints.ts § Retention. */
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
  /**
   * **Misaligned partitions this run snapped shut rather than refused**, and
   * `sourceHeading` claims it dropped because no heading in the node's range
   * backed them up. Both are repairs of a model's slip, both are bounded, and
   * both are reported for the same reason `strandedSupplement` is: a repair
   * that nobody counts is indistinguishable from the bug it repaired
   * (docs/reusable/silent-success.md). A run at zero is the normal case; a
   * number that climbs means the prompt has drifted and these are hiding it.
   */
  repairedRanges: number;
  /**
   * How far those repairs moved a boundary: blocks moved in total, and the
   * worst single one.
   *
   * **Two numbers because the count stopped being enough** when the size bound
   * was lifted (src/hierarchy.ts § `planChildRanges`). "One repair" now covers
   * both a boundary a paragraph out and a section handed forty blocks that
   * belonged to its neighbour, and those need opposite responses: the first is
   * the slip this stage was built to forgive, the second means the model could
   * not read the document and the reader is getting prose filed under a heading
   * that does not describe it.
   *
   * `largestRepair` is the one to watch, and it is not derivable from the sum —
   * six one-block snaps and one six-block snap add up the same.
   */
  repairedBlocks: number;
  largestRepair: number;
  /**
   * **Sections the model proposed that were not stored**, because two of its
   * children started in the same place and only one of them can.
   *
   * Normally 0, and reported at 0 for the reason `strandedSupplement` is. This
   * is the one figure in the group that means something was *lost* rather than
   * moved: a repaired boundary keeps every section the model named and changes
   * where one of them ends, while this stores fewer sections than the answer
   * proposed. src/hierarchy.ts § `BuildReport.droppedChildren`.
   */
  droppedChildren: number;
  droppedHeadings: number;
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
  /**
   * **Requests** this run actually made for labels, which is not the batch count
   * in either direction: a resumed batch costs none, and a batch that was
   * repaired or re-drawn costs two. It was the number of records until
   * 2026-08-31 and so said one after making two — see `LabelRun.calls` in
   * src/labels.ts for why that number in particular has to be right.
   */
  labelCalls: number;
  /** Batches taken from a checkpoint left by an earlier, failed run. */
  labelsResumed: number;
  /**
   * Paragraphs left with no nav label — **normally 0, and it is reported at 0
   * as well as above it.**
   *
   * A dropped label is invisible in the product: the leaf simply has no row.
   * The count is the only trace, so it is on the run, in the log line
   * (src/pipeline.ts), on the CLI, and in `labels.json`. The blocks themselves
   * are in that file's `dropped`. See `droppedBudget` in src/labels.ts for what
   * bounds it per batch and `COVERAGE_FLOOR` — which lives in that file too now
   * — for what refuses it across the article, on both ways into the stage.
   */
  labelsDropped: number;
  inputTokens: number;
  outputTokens: number;
  /* From the label pass only — the structure call is one call per article and
     is deliberately not cached, so there is nothing for it to read. See
     docs/plans/260826g-prompt-caching.md on why a prefix used once is worth 1.25× and
     no more. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

/**
 * Write JSON so that it is either wholly there or not there at all.
 *
 * **`main()`'s, and nothing else's.** The stage itself no longer writes: it
 * returns `HierarchyArtefacts` and the pipeline hands all three to the store in one
 * call. This is the command line's own writer, and the three files it produces
 * are the same three files in the same three places.
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
 * Stage 4 over a block sequence: the structure in one call, the nav labels in
 * parallel batches after it, then the tree, the labels file and this stage's
 * copy of the blocks — **returned, not written.**
 *
 * Exported because two callers run this stage and they must not drift —
 * `main()` below, and the ingest queue in the server process (src/pipeline.ts).
 *
 * **The blocks come in, the artefacts go out, and the stage knows nothing about
 * where either lives.** It used to open a path and write a directory, which
 * meant the pipeline hashed what the *store* held and generated from what the
 * *disk* held — the same defect src/article-input.ts was written to close for
 * the seven article-reading stages. docs/plans/260831b-finish-the-database-move.md.
 *
 * **Two model passes, one pipeline step, and nothing returned until both are
 * done.** The split exists so the unbounded half can be batched
 * (docs/plans/260826h-toc-scaling.md), not so it can be published separately — a tree
 * stored with a third of its labels missing is a valid-looking artefact that
 * quietly describes part of an article, which is
 * docs/reusable/silent-success.md exactly. `HierarchyArtefacts` is what now makes
 * that unsayable rather than merely undone. Deferring the labels so a reader
 * can start sooner is a real option and a deliberate later one; it needs a
 * state that says "still arriving" rather than an absence that says nothing.
 *
 * `onProgress` reports what is arriving. For the structure call there is nothing
 * useful to say about *what* has been written — the JSON is unparseable until it
 * is complete — so it reports that something is still coming. The label pass can
 * do better, and counts finished sections.
 */
export async function generateHierarchy(opts: {
  blocks: Block[];
  /** Stamped into the tree and the labels file; the article's own name. */
  slug: string;
  /**
   * Where each finished **label batch** goes as it lands — passed straight down
   * to `generateLabels`, which is the only thing here that checkpoints.
   *
   * It was a directory until 2026-09-01, and the store was not the seam this
   * call could go through because it is keyed on an `articleId` no stage was
   * ever handed. `StoreSession` hands one down now
   * (src/store/pg-session.ts), which was the last piece of plumbing the seam
   * was missing; the `delete` it does not have stopped mattering when the
   * whole-file format went and there was nothing left to delete.
   *
   * **Required, and the passing of it is the point.** A caller with no article
   * to key on says `nullCheckpointStore()` rather than saying nothing;
   * `HierarchyRun.labelsResumed` is how one that meant to checkpoint and did not
   * finds out.
   */
  checkpoints: CheckpointStore;
  onProgress?: (detail: string) => void;
  /** Cancel the call. The queue passes its job's signal — src/jobs.ts. */
  signal?: AbortSignal;
}): Promise<HierarchyRun> {
  const { blocks, slug } = opts;
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
     than discovered six minutes in. `budgetFor`, inside `structureRequest`,
     throws for that case. */
  const answerTokens = estimateHierarchyTokens(body);
  const { system, user, maxTokens, effort } = structureRequest(body);

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
    const call = streamMessage("hierarchy", {
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort },
      system,
      messages: [{ role: "user", content: user }],
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
  const built: BuildReport = { repairs: [], droppedChildren: [], droppedHeadings: [] };
  let structure: Tree;
  try {
    structure = appendSupplement(buildTree(root, {}, body, slug, built), groups);
  } catch (err) {
    /**
     * **A run that threw still says what it had mended on the way**, because the
     * success log at src/pipeline.ts never gets a report when `buildTree`
     * throws — a monitoring path that goes dark exactly when somebody would
     * look at it. GPT Sol, finding 7.
     *
     * No tiling fault reaches here any more (`planChildRanges` derives the
     * partition rather than checking it), so what throws now is a range that
     * runs backwards, an endpoint that is not a block id, or a root that misses
     * the article's ends. The repair figures are still worth attaching: a node
     * whose siblings were all mended and which then failed on an invented id
     * is a different story from one that failed on its own.
     *
     * `where`, `kind`, `at` and `size` are all derived from the shape of the
     * answer rather than from anything in it, so they are safe to put in a
     * message that will be logged and copied onto the job card — see `nameValue`
     * above for the rule and why this file has to keep restating it.
     */
    if (built.repairs.length === 0) throw err;
    const spent = [...new Set(built.repairs.map((r) => r.at))].length;
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}\n` +
        `  Before this it mended ${spent} boundary(ies), moving ` +
        `${repairedBlockCount(built.repairs)} block(s): ` +
        `${built.repairs.map((r) => `${r.where} (${r.kind}, ${r.size})`).join("; ")}. ` +
        `This line is the only place those numbers are visible on a run that failed.`,
    );
    /* No `cause`, for the reason the label stage gives at the same shape:
       src/log.ts follows cause chains and would write the original message into
       the log a second time under another key. It is already in the text. */
  }

  /* **Appended before `generateLabels`, not after.** `labels.json` records
     `structureHash(opts.tree)` (src/labels.ts), so a supplement added afterwards
     would make the labels stale at birth — a freshness stamp that is wrong the
     moment it is written, and nothing would ever say so. There is no later
     gist-composition pass to worry about: composition is an instruction to the
     model in SYSTEM above, and `buildTree` copies back what it returns.
     `planBatches` needs no supplement branch of its own — its `own` filter is
     `isStructural`, which is false for every supplement block, so the node
     contributes no sibling set and costs no call. */

  /* **The structural half of the invariants, before a label is paid for.**
     Everything `checkTree` can fail on here — the ranges, the tiling, the
     coverage, the gists, the titles, `sourceHeading`, the supplement rules — is
     decided by the structure call above and cannot change in `generateLabels`,
     because `mergeLabels` touches leaves only and only sets or deletes
     `navLabel`. So the answer is already known at this line, and the version of
     this file that only asked after the merge paid for a full batch run to
     learn something it could have been told for free. On job spya-v2f7b3 that
     happened three times in one ingest, each time discarding a label run that
     had *succeeded* — and stage 4 is the most expensive step in the pipeline.

     **This does not replace the call after `mergeLabels`, and must not.** One
     `fail` in `checkTree` reads `navLabel` — the phantom-row rule at
     tree-invariants.ts, a leaf that carries a label but anchors a block
     `isStructural` says may never have one. There are no labels yet at this
     line, so that check is vacuous here and only the later call can make it.
     Two calls, deliberately: this one is a cost guard, the one below is the
     guarantee about the file. `checkTree` is pure and takes microseconds.
     docs/postmortems/260830a-the-article-with-one-heading.md. */
  assertTreeSound(blocks, structure);

  /* Pass two. The tree has to exist first: the batches are cut along its own
     section boundaries, so that every label a reader compares with another was
     written in the same call. src/labels.ts says why that is the rule. */
  /* **And no `mkdir` before it.** There used to be one, because the first batch
     to land wrote into a directory that might not exist yet and a thrown ENOENT
     out of the checkpoint would have taken the whole step with it. There is no
     directory now, and a store that cannot be reached is a miss rather than a
     throw — src/labels.ts § `keepBatch`. */
  const labelRun = await generateLabels({
    tree: structure,
    blocks,
    slug,
    /* Each batch's labels are kept here as it lands, so a 429 or a 5xx eight
       batches into a book costs the one batch rather than the eight — and the
       retry the queue makes (src/jobs.ts) picks up where this one stopped, on
       whatever machine it lands on. src/labels.ts § `usableEntry` and
       `coversExactly` for what has to hold before one is reused. */
    checkpoints: opts.checkpoints,
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  /**
   * **The three artefacts, assembled once, and every check below asks about
   * this object rather than about the locals it was built from.**
   *
   * The distinction is the whole of what stops the set going out inconsistent.
   * A tree merged from one set of labels and returned beside another, or
   * checked against one block array and returned beside a second, is a set that
   * looks finished and describes two different articles — and no check written
   * over `tree`, `labels` and `blocks` as three separate variables can see the
   * difference, because it is a fact about what was *returned*.
   *
   * So the merge reads `labelRun.file.labels`, the labels this object carries,
   * rather than `labelRun.labels`, which is the same map by construction today
   * and would be the wrong thing to depend on tomorrow. Everything after this
   * line reads `parts.*`.
   *
   * `blocksArtefact`, not `{ blocks }`. Stage 3 stamps the sanitiser version
   * into `output/<slug>.blocks.json`; this is the copy the reading view
   * actually opens, and handing back the bare array dropped the stamp on every
   * article. Not unsafe — an absent stamp reads as stale, and stale means
   * re-sanitise — but it made the stamp worthless: every article paid the
   * re-clean on every load and fired the "predates the sanitiser" warn every
   * time, which is how a warning stops being read. Note the check anybody would
   * run, "is stage 3 writing the stamp?", answers yes. It is, into a different
   * file. See docs/project/security.md.
   */
  const parts: HierarchyArtefacts = {
    labels: labelRun.file,
    blocks: blocksArtefact(blocks),
    tree: mergeLabels(structure, labelRun.file.labels),
  };

  /* **The invariants, on the artefacts that are about to be handed back.** They
     ran in src/validate-tree.ts (a CLI a human invokes) and in the publish guard
     (src/store/pg-revisions.ts, which collects reasons rather than throwing),
     and nowhere on this path — so a stage-4 regression was invisible in exactly
     the workflow most of this repo's testing goes through. GPT Sol, F5.
     After `mergeLabels` rather than before `generateLabels`: what this
     guarantees is a property of the artefact, and checking `structure` instead
     would leave the merge unchecked while costing the same. It does mean a
     tree the model got wrong is found after a full label run has been paid
     for; that is the cheaper of the two mistakes.
     Over `parts.blocks.blocks`, which is the array the caller stores, not the
     `blocks` argument it was derived from — `blocksArtefact` maps one to one and
     touches only `html`, so the two agree, and asking the question about the
     wrong one of them is precisely the mistake this whole stage of the migration
     exists to stop. */
  assertTreeSound(parts.blocks.blocks, parts.tree);
  checkCoverage(parts.labels.labels, parts.tree, parts.blocks.blocks);

  /**
   * **The blocks that went in and the blocks that come out hash the same, and
   * that is asserted rather than assumed.**
   *
   * Three parties hash "the blocks this tree was built from" and none of them
   * talks to the other two. `generateLabels` hashes what it was handed and
   * stamps it into `labels.json`. The pipeline step records `hashBlocks` of the
   * array it read from the store and passed in here — that is the value
   * `reasonsNotToPublish` compares against the published blocks, and the value
   * `assertStampAgrees` compares against `labels.sourceHash` on the way into
   * either store. And this stage returns `blocksArtefact(blocks)`, which is
   * what actually gets stored.
   *
   * They agree today, and for a narrow reason: `hashBlocks` reads `id`, `text`,
   * `role` and `treatment`, and `blocksArtefact` maps one to one and rewrites
   * only `html`. Both halves of that could move — a label pass over the body
   * alone, a sanitiser that touched text — and the failure is silent at the
   * point it happens and loud somewhere useless: every article becomes
   * unpublishable with *"the tree was built from different blocks"*, from runs
   * that all reported success.
   *
   * So it is checked here, at the seam, where the answer is known and the
   * message can say what actually went wrong.
   */
  const storedHash = hashBlocks(parts.blocks.blocks);
  if (parts.labels.sourceHash !== storedHash) {
    throw new Error(
      `The labels were written against different blocks from the ones this stage is returning ` +
        `(${parts.labels.sourceHash} vs ${storedHash}). The step records a hash of the blocks it ` +
        `handed in, and the publish guard compares that against the blocks that were stored, so ` +
        `this would make the article unpublishable. Nothing has been written.`,
    );
  }

  /* **No write, and no ordering.** This function used to write `labels.json`,
     then `blocks.json`, then `tree.json`, and the tree went last on purpose: the
     queue decided a step was done by whether its output files existed
     (src/pipeline.ts) and `writeFile` truncates its target before it has
     anything to put in it, so a crash mid-sequence left a present-but-truncated
     tree that a retry skipped — or, on a forced regeneration, new labels beside
     last week's tree.
     Both halves of that justification are about three separate writes, and this
     function makes none: it hands all three to its caller in one `parts` map
     and the caller gives them to its store in one call.

     **What that map does and does not buy, because an earlier version of this
     comment said they "land together or not at all" and that is false on the
     filesystem.** `fsStoreSession` has no transaction and says so outright
     (src/store/session.ts); its writes are sequential, so a kill between them
     really does leave one artefact new and another old. Three separate things
     make the ordering unnecessary anyway:

     - **On the filesystem**, the `beginStep` marker. A step that did not finish
       leaves it behind, so the next run re-runs the step over whatever the
       partial write left rather than skipping it. That marker is the
       filesystem's whole answer to atomicity, and it is weaker than a
       transaction rather than an imitation of one.
     - **On Postgres**, the store's transaction, which does make the three
       atomic — the property the old sentence claimed, in the one store that has
       it.
     - **And the map itself** centralises ownership: one place that knows what
       this stage produces, so nothing can write two of the three and forget the
       third. That is worth having and it is not atomicity.

     The ordering survives in exactly one place — `main()` below, which really
     does write three files. GPT Sol, 2026-08-31. */

  return {
    parts,
    /* `parts.labels.sourceHash`, not `storedHash`, though the check above has
       just proved them equal. The caller's stamp is compared against the labels
       file by `assertStampAgrees`, so the value that travels has to be *read
       off the artefact* rather than computed alongside it — otherwise the two
       are equal by a convention rather than by construction, which is the
       arrangement this whole stage of the migration exists to remove. */
    inputHash: parts.labels.sourceHash,
    model: CAPABLE_MODEL,
    blocks: blocks.length,
    structural,
    supplementNodes: groups.length,
    supplementBlocks: blocks.length - body.length,
    strandedSupplement: stranded,
    repairedRanges: built.repairs.length,
    /* Deduplicated by boundary — see `repairedBlockCount`. A cascade is one
       movement recorded at every depth it passes through, so summing the entries
       counted the same blocks once per level. */
    repairedBlocks: repairedBlockCount(built.repairs),
    /* `Math.max` of an empty list is -Infinity, which would print and log as
       nonsense on the run where nothing was repaired — the common case. */
    largestRepair: built.repairs.reduce((n, r) => Math.max(n, r.size), 0),
    droppedChildren: built.droppedChildren.length,
    droppedHeadings: built.droppedHeadings.length,
    labelled: Object.values(parts.tree.nodes).filter((n) => n.navLabel).length,
    internal: Object.values(parts.tree.nodes).filter((n) => n.children.length > 0).length,
    labelBatches: labelRun.batches,
    labelCalls: labelRun.calls,
    labelsResumed: labelRun.resumed,
    labelsDropped: labelRun.dropped.length,
    /* Both passes together. What this number answers is "what did a tree cost",
       and a structure figure alone would now understate it by most of the bill. */
    inputTokens: message.usage.input_tokens + labelRun.inputTokens,
    outputTokens: message.usage.output_tokens + labelRun.outputTokens,
    cacheReadTokens: labelRun.cacheReadTokens,
    cacheWriteTokens: labelRun.cacheWriteTokens,
    elapsedMs: Date.now() - started,
  };
}

/**
 * `npm run hierarchy -- <blocks.json> [outDir]` — **the only caller that still turns
 * these artefacts into files.**
 *
 * It reads the blocks itself and writes the three files itself, which is what
 * "every stage stays runnable on its own" costs now that the stage neither
 * reads a path nor writes a directory. The files are the same three files, in
 * the same three places, with the same contents.
 */
async function main(): Promise<void> {
  const blocksPath = process.argv[2];
  if (!blocksPath) {
    console.error("Usage: tsx src/hierarchy.ts <blocks.json> [outDir]");
    process.exit(1);
  }
  const slug = slugForBlocksPath(blocksPath);
  const outDir = process.argv[3] ?? path.join("data", slug);
  /* At the program's edge, not inside the gateway — see `messagesClient` in
     src/messages-stream.ts for the test that proved the difference. Without it
     this command answers `[ai-not-set-up]` on a machine where the key is right
     there in `.env.local`.

     **Before the first `await`**, which is why it sits above the read rather
     than beside the call it is for: "the file is read before the work starts"
     is the property, and a rule that has to make an exception for which awaits
     are harmless is not a rule. src/labels.ts § `main` makes the same point,
     and tests/paid-cli-ledger.test.ts is what caught this one going below the
     blocks read when stage 4 stopped reading them itself. */
  loadEnvLocal();
  /* `parseJsonFrom`, not `JSON.parse`: blocks.json *is* the article, and V8's
     own parse error quotes the first characters of what it was handed. Nothing
     in this file logs, but a CLI's uncaught throw is printed, and the same text
     reaches the log when a stage throws (src/jobs.ts § `errorFields`).
     src/parse-json.ts. */
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(blocksPath, "utf-8"),
    "blocks.json",
  );
  // Before the call, not after: this is the only thing on screen for the two
  // minutes the model takes.
  console.log(`Building the tree with ${CAPABLE_MODEL}\u2026`);
  /* **Nothing is remembered between runs of this command**, and it used to be:
     the checkpoint landed in the output directory, so a run killed eight batches
     into a book resumed rather than paying again. The batches are rows keyed on
     an `articles` row now, and this command does not have one —
     src/store/checkpoints.ts § nullCheckpointStore. The queue, which is how an
     article really gets a tree, does have one and does resume. */
  const run = await generateHierarchy({
    blocks,
    slug,
    checkpoints: nullCheckpointStore(),
    onProgress: (detail) => process.stdout.write(`\r  ${detail}          `),
  });

  /* **Labels, blocks, then the tree — and here the ordering is still real.**
     These are three separate writes into a directory other things read, and the
     filesystem store answers "is this step done?" with "do its files exist?".
     Each is written beside its target and renamed, so it appears whole or not at
     all, and the tree — the file every reader starts from — appears only once the
     other two are already there.
     The stage itself no longer does any of this: it returns all three and the
     pipeline stores them in one call, where a partial set is not a state that
     exists. See the note at the end of `generateHierarchy`. */
  /* **Made here now.** `generateHierarchy` used to create this directory before
     the first label batch could checkpoint into it; the batches are rows and it
     does not, so the one caller that still writes files makes its own. Without
     it `npm run hierarchy -- blocks.json some/new/dir` fails on the first
     write. */
  await mkdir(outDir, { recursive: true });
  await writeAtomic(path.join(outDir, "labels.json"), run.parts.labels);
  await writeAtomic(path.join(outDir, "blocks.json"), run.parts.blocks);
  await writeAtomic(path.join(outDir, "tree.json"), run.parts.tree);

  console.log(`\n${run.blocks} blocks (${run.structural} to label) → ${CAPABLE_MODEL}`);
  console.log(
    `\nNodes:     ${Object.keys(run.parts.tree.nodes).length} (${run.internal} internal)`,
  );
  console.log(
    `Labelled:  ${run.labelled} / ${run.structural} blocks, in ${run.labelCalls} call(s)` +
      (run.labelsResumed > 0
        ? ` (${run.labelsResumed} of ${run.labelBatches} batches resumed from a checkpoint)`
        : ""),
  );
  /* Only when it happened, unlike the two lines below — the ratio above already
     says it every run, and this line is the *reason* for a ratio under one. A
     dropped label is a leaf that renders as nothing at all, so the run that
     produced it is the last moment anybody is looking. */
  if (run.labelsDropped > 0) {
    console.log(
      `Dropped:   ${run.labelsDropped} paragraph(s) came back unlabelled twice and were left ` +
        `bare — see "dropped" in labels.json`,
    );
  }
  /* **Said out loud, every run, including when it is zero.** `strandedSupplement`
     is the count of apparatus blocks the split refused to place — non-zero means
     no supplement node was built and the tree is exactly what it would have been
     without this stage: a correct article with the feature silently absent. A
     number computed and never printed is the same as no number
     (docs/reusable/silent-success.md). GPT Sol's review of stage 4, 2026-08-28. */
  console.log(
    run.strandedSupplement > 0
      ? `Notes:     NOT GROUPED — ${run.strandedSupplement} supplement block(s) are not one ` +
          `trailing run, so no Notes node was built`
      : `Notes:     ${run.supplementNodes} node(s) over ${run.supplementBlocks} block(s)`,
  );
  /* Printed every run, including at zero, for the reason the Notes line above
     is. These are the two places stage 4 now forgives the model, and a number
     computed and never shown is the same as no number. */
  /* The size goes on the same line as the count, because the count on its own
     stopped meaning anything the day the size bound was lifted: one repair can
     be a paragraph or it can be a section handed forty blocks that belonged to
     its neighbour. src/hierarchy.ts § `planChildRanges`.

     **These are now the only thing standing between a slipped boundary and a
     tree that is misaligned throughout**, since nothing about the tiling
     refuses an answer any more. `repairedBlocks` against `blocks` above is the
     fraction of the article that changed hands, and it is the number to read
     first. */
  console.log(
    `Repaired:  ${run.repairedRanges} misaligned boundary(ies)` +
      (run.repairedRanges > 0
        ? ` moving ${run.repairedBlocks} block(s), largest ${run.largestRepair}`
        : "") +
      `, ${run.droppedChildren} dropped section(s)` +
      `, ${run.droppedHeadings} unbacked heading claim(s)`,
  );
  console.log(`Tokens:    ${run.inputTokens} in, ${run.outputTokens} out`);
  console.log(`Elapsed:   ${(run.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`\nWrote:     ${path.resolve(outDir)}/tree.json`);
  console.log(`Validate:  npm run validate-tree -- ${outDir}`);
  console.log(`Eval:      npm run eval:hierarchy -- ${outDir}`);
}

/* Compared as resolved paths, not by suffix. `import.meta.url.endsWith(basename)`
   also matches when a *different* entry file with the same basename imports this
   module — `scripts/arc.ts` importing `src/arc.ts` would run the CLI as a side
   effect of the import, which is the one thing this guard exists to prevent. */
const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) void withLedger("cli", main);
