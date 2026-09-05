/**
 * **The hierarchy cascade's arithmetic** — when a node still needs splitting,
 * how many parents one call may carry, and how one answer's starts become
 * ranges. No model, no network, no I/O: everything here is a pure function of
 * an article and a recipe.
 *
 * ## Why this is its own file, and why it is pure
 *
 * Stage 4's structure call is one whole-document model call: 163–320 seconds
 * and about 88% of the ingest wait, a hard refusal past 1,976 blocks, and
 * exactly three internal levels whatever the article's length. The cascade
 * replaces it with a breadth-first wave of smaller calls —
 * docs/plans/260904c-hierarchy-structure-in-waves.md.
 *
 * Everything that can go quietly wrong with that design goes wrong in here.
 * A batch that splits a sibling set still produces a valid tree, whose
 * boundaries were decided by two calls that could not see each other. A node
 * that stopped one wave early still tiles, still has a gist on every internal
 * node, still passes `assertTreeSound` — it is byte-identical *in kind* to a
 * tree whose governor legitimately stopped there. None of that throws
 * anywhere. So the rules live in one dependency-free file with a test per rule
 * (tests/hierarchy-cascade.test.ts), the way `planBatches` does in
 * src/labels.ts and for the same reason. docs/reusable/silent-success.md.
 *
 * ## What is deliberately NOT here
 *
 * The executor, the request builder, the retries, the checkpoints and the
 * conversion into a `Tree` are stage 2's, and none of them belongs in a pure
 * module. Two consequences worth stating out loud rather than discovering:
 *
 * - **The depth cap is the executor's, not `shouldExpand`'s.** This file
 *   answers *"does this node still need expanding?"*, and it answers it the
 *   same way at depth 1 and at depth 5. A node still over the terminal size at
 *   `maxDepth` is a node whose label sibling set will be oversized — the very
 *   defect the plan exists to fix, reappearing at the bottom — so the executor
 *   records it in `CascadeState.capReached`. Making `shouldExpand` return
 *   `false` at the cap would turn that into the one thing the plan says is not
 *   available: a silently terminal node, invisible in every mechanical measure.
 * - **The final `buildTree` must be given a fresh `BuildReport`, or none.**
 *   `normaliseExpansion` derives exactly the tiling `planChildRanges` would, so
 *   by the time the assembled tree reaches `buildTree` there is nothing left
 *   for it to mend — but a shared report would still carry this file's entries
 *   into stage 4's totals a second time. The repairs recorded here *are* the
 *   run's repairs.
 */
import { isBodyEvidence, isStructural } from "./block-policy.js";
import { type KeptChild, snapStartsToHeadings } from "./heading-snap.js";
import type { BuildReport, ModelNode } from "./hierarchy.js";
import { nameValue } from "./ids.js";
import type { Block, Tree, TreeNode } from "./types.js";

/**
 * **The constants the cascade is shaped by — and none of them is
 * evidence-backed yet.**
 *
 * The plan says so in as many words: the only wave arm that has ever run makes
 * one call per parent and therefore validates none of the packing numbers.
 * They are a starting heuristic. What makes that acceptable rather than
 * reckless is that `ExpansionBatch.predictedChildren` is recorded against the
 * actual child count every call, so a single run tunes them from evidence
 * instead of the next agent re-guessing
 * (docs/plans/260904c-hierarchy-structure-in-waves.md § "The shape").
 *
 * An interface rather than five module constants because the eval needs to
 * vary them per arm, and a recipe that can be varied is a recipe whose effect
 * can be measured.
 */
export interface CascadeRecipe {
  /**
   * The terminal span: a node holding this many **structural** blocks or fewer
   * is small enough to be a section, and grows leaves rather than children.
   *
   * It is also the divisor in `predictedChildren`, because "how many blocks a
   * child should end up with" and "how many blocks a section holds" are the
   * same statement seen from two ends. Two numbers that have to agree and are
   * written down separately are two numbers that will disagree.
   */
  terminalBlocks: number;
  /**
   * **The forced-open ceiling**: a node holding more body words than this is
   * expanded even when the model called it finished, and the run counts it.
   *
   * The bound exists because the two failure modes are not symmetrical. A model
   * that says "deeper" too often costs money, which the floor and the cap
   * already bound. A model that says "finished" about four thousand words costs
   * the reader the level this whole plan is for, and nothing downstream can see
   * it — the tree tiles, has a gist on every node, and passes every invariant.
   *
   * Measured on Origin of Species, 2026-09-04: **41% of the body's words sit in
   * sections that are both over 2,000 words and above the divisibility floor**,
   * so this is doing substantial work rather than tidying an artefact
   * (docs/plans/260904d-deepen-fat-sections.md § "Where I checked Fable").
   *
   * In the recipe rather than a module constant for the reason the others are:
   * the eval varies it per arm, and a number nobody can vary is a number nobody
   * can measure the effect of.
   */
  forcedOpenWords: number;
  /** Predicted child nodes one call may be asked for, across all its parents. */
  maxPredictedChildrenPerBatch: number;
  /** Parents one call may carry, however small they are. */
  maxParentsPerBatch: number;
  /**
   * **Soft.** How much *evidence* — the parents' own prose plus their context
   * blocks — one call should carry, estimated rather than counted (see
   * `estimateEvidenceTokens`). Four parents of nine predicted children each can
   * still carry far more prose than one request should, which is why the child
   * count alone is not enough.
   *
   * A preference. Being 15% out moves a batch boundary by one parent and
   * changes nothing about the tree, which is why a cheap estimate is the right
   * instrument for it.
   */
  maxEvidenceTokensPerBatch: number;
  /**
   * **Hard.** The largest whole request this recipe may send: prefix, target
   * metadata and evidence together.
   *
   * **This is a different kind of number from every other one here, and
   * conflating the two was the bug.** The field above used to be called
   * `maxInputTokensPerBatch` while measuring only the parents' slices, and a
   * lone parent was allowed to breach it — which is right for a packing
   * preference and catastrophic for a feasibility bound. A batch 15% over a
   * preference is fine; a request past the model's real limit is a call that
   * cannot succeed, made anyway, after the wave in front of it has been paid
   * for. ⟨GPT Sol, 2026-09-04⟩
   *
   * Unlike the others this one **has a discoverable right answer** — the
   * model's context window less the output budget — and 120,000 is a
   * placeholder until stage 2 reads it off src/models.ts. Nothing breaches it:
   * a single target that would is returned as an `OversizedTarget` for the
   * caller to bound, chunk or refuse.
   */
  maxRequestTokensPerBatch: number;
  /**
   * How deep the cascade may go. Not "UI sanity": it is the point at which a
   * node that still wants expanding has to be **recorded** rather than
   * quietly accepted. See this file's header, and `CascadeState.capReached`.
   */
  maxDepth: number;
}

/**
 * The starting recipe.
 *
 * `maxEvidenceTokensPerBatch` is the one number with any measurement behind it
 * at all, and it is thin: the incumbent's single whole-article call spent
 * 11,114 input tokens on the real corpus, so 24,000 is about two ordinary
 * articles' worth of prose in front of one call — inside the range where a
 * scoped call demonstrably thought less (the plan's § "The measurement that
 * decided it"). It is still a guess.
 *
 * `maxRequestTokensPerBatch` is a placeholder with a real answer waiting for
 * it; see its own comment.
 */
export const CASCADE_RECIPE: CascadeRecipe = {
  terminalBlocks: 9,
  forcedOpenWords: 2_000,
  maxPredictedChildrenPerBatch: 36,
  maxParentsPerBatch: 4,
  maxEvidenceTokensPerBatch: 24_000,
  maxRequestTokensPerBatch: 120_000,
  maxDepth: 5,
};

/**
 * The fan-out the structure prompt asks for, and the range `predictedChildren`
 * clamps into. **Not in `CascadeRecipe`**: these are a property of SYSTEM in
 * src/hierarchy.ts — "5–9 parts" — not a packing preference, so an arm that
 * varies the packing must not silently vary what the prompt asks for. The
 * floor is 2 because a node with one child is a level with no information in
 * it, and the prediction should never plan for one.
 */
const MIN_PREDICTED_CHILDREN = 2;
const MAX_PREDICTED_CHILDREN = 9;

/**
 * **The fewest children an answer may keep and still be an expansion.**
 *
 * Two, and it is the same two as `MIN_PREDICTED_CHILDREN` for the same reason:
 * a node with one child is a level that divides nothing. Written separately
 * because they are separate statements — one is what we *plan* for, the other
 * is what we *accept* — and the day one moves, whoever moves it should have to
 * decide about the other.
 */
const MIN_EXPANSION_CHILDREN = 2;

/**
 * **How many more times a refused expansion call may be drawn**, and it is
 * two — three draws in all.
 *
 * ## It is not the job layer's budget, and conflating them would be a bug
 *
 * `REQUEUE_BUDGET` in [`jobs.ts`](jobs.ts) is also 2 and means something else
 * entirely: how many times a *job* may be handed back to the queue when its
 * lease window runs out. That one is about wall-clock, it is spent by the
 * platform rather than by the model, and a fake executor cannot exhaust it. This
 * one is about a single call whose *answer* was refused —
 * `ExpansionRefused` — and it is spent within one attempt, several times over if
 * several calls each need a redraw. A cascade that reinvented the lease budget
 * here would silently cap the whole article's redraws at two, which is the
 * number for one call. ⟨docs/plans/260904d-deepen-fat-sections.md § stage 4.⟩
 *
 * ## Two, and why that is the number
 *
 * Every `ExpansionRefused` is a fault in what the model said rather than in what
 * it was asked — a missing verdict, a truncated answer, three starts that
 * collapse to one child — so the same request drawn again is a genuinely
 * different question, and the spike's two runs over one 382-block section came
 * back with 10 children and then 20, which is how much draw-to-draw variance
 * there is on this path. One redraw would leave a single unlucky draw failing a
 * whole wave. Beyond three the shape changes: a request the model refuses three
 * times is not unlucky, it is a request this recipe cannot ask, and going on
 * paying to find that out is exactly the failure `OversizedTarget` exists to
 * make visible rather than expensive. Three draws also bounds the worst case at
 * 3× the wave's bill, which is affordable where 6× is not.
 *
 * The plan calls this a **per-target** cap, to name the sense it is *not*. In
 * practice it is counted per call, and the two coincide: a refusal fails the
 * whole answer rather than one section of it, and `planExpansionBatches` never
 * splits a parent across two calls, so a target is only ever redrawn as part of
 * one call.
 *
 * It is a module constant rather than a `CascadeRecipe` field on purpose — the
 * recipe's fields are the ones an eval arm varies to measure the *tree* it
 * produces, and this one cannot change the tree, only how many draws it took to
 * get there.
 */
export const MAX_EXPANSION_REDRAWS = 2;

/**
 * **An expansion answer this module will not build a subtree from.**
 *
 * One class for every refusal, so stage 2's retry policy is written once and a
 * new refusal cannot arrive wearing a shape nobody catches. Every one of them
 * is a fault in what the *model* said, so every one of them is worth another
 * draw — which is why there is no `retryable` flag: the class is the claim.
 *
 * `planned` is what the refused answer would have cost, had it stood up. It is
 * deliberately **not** merged into the run's report (see `normaliseExpansion` §
 * "The caller's `report`"), and it travels here so that a retry can be logged
 * with the drops that provoked it rather than with nothing.
 *
 * ## Four of the reasons belong to the schema, not to this file
 *
 * `bad-verdict`, `malformed-answer`, `missing-verdict` and `target-mismatch`
 * are raised by `parseExpansionAnswer` (src/hierarchy-expand.ts) **before**
 * anything here has seen the answer, and they carry an empty `planned` because
 * nothing was planned: an answer whose shape is wrong never reached the
 * derivation. They live in this union rather than in a second error class for
 * the reason the paragraph above gives — the retry policy is written once, and
 * a refusal wearing a shape nobody catches is a scoped call silently becoming a
 * stage failure. The split between the two files is deliberate and is stated in
 * `normaliseExpansion`: the schema check is about the answer's *shape* and the
 * normalisation is about its *ranges*.
 */
export class ExpansionRefused extends Error {
  constructor(
    readonly reason:
      | "bad-verdict"
      | "invented-start"
      | "malformed-answer"
      | "missing-verdict"
      | "not-an-expansion"
      | "outside-parent"
      | "target-mismatch",
    message: string,
    readonly planned: BuildReport,
  ) {
    super(message);
    this.name = "ExpansionRefused";
  }
}

/* -------------------------------------------------------------- the state */

/**
 * **Where a node is in the cascade** — and the reason it is explicit state
 * rather than "has children yet".
 *
 * `ModelNode` already has a way of saying a node is a leaf: no `children`. In
 * a cascade that spelling is ambiguous at exactly the wrong moment — a node
 * awaiting its expansion call and a node the governor decided is terminal look
 * identical, and the difference between them is a wave of paid calls. So it is
 * a field, and `assertCascadeComplete` reads it.
 */
export type CascadeStatus = "pending" | "terminal" | "expanded";

/** What every cascade node carries, whatever its status. Mirrors `ModelNode`. */
interface CascadeNodeCommon {
  title: string;
  gist?: string;
  range: [string, string];
  sourceHeading?: string;
}

/** Awaiting expansion. A tree may not be built while any node is this. */
export interface PendingNode extends CascadeNodeCommon {
  status: "pending";
  children?: never;
}

/** Small enough, holding no unresolved body heading. `buildTree` grows its leaves. */
export interface TerminalNode extends CascadeNodeCommon {
  status: "terminal";
  children?: never;
}

/** Its children have been produced, normalised and attached. */
export interface ExpandedNode extends CascadeNodeCommon {
  status: "expanded";
  /**
   * **At least two, in the type.** One child inherits its parent's whole range,
   * so the governor asks the identical question one level down and the cascade
   * only stops when `maxDepth` runs out — see `normaliseExpansion` §
   * "Fewer than two kept children is not an expansion".
   */
  children: [CascadeNode, CascadeNode, ...CascadeNode[]];
}

/**
 * **Status and shape are one fact, not two.**
 *
 * This was three fields on one interface — `status` beside an optional
 * `children` — and every combination typechecked. GPT Sol reproduced what that
 * bought: a ten-structural-block root marked `"expanded"` with no children.
 * `assertCascadeComplete` accepted it, because it only looked for `"pending"`;
 * `shouldExpand` said it still needed splitting; and `buildTree` quietly grew
 * ten leaves under it. A whole wave of the article missing, and nothing in the
 * pipeline with anything to say. That is docs/reusable/silent-success.md with
 * this module's own guard as the casualty.
 *
 * A union makes three of those combinations a compile error instead. The
 * runtime check in `assertCascadeComplete` is the other half, because a
 * resumed cascade arrives as JSON off a checkpoint and a cast proves nothing.
 *
 * A `CascadeNode` is still structurally assignable to `ModelNode`, so it can be
 * handed to `buildTree` — **and `finaliseCascade` is the way to do that**, so
 * that skipping the guard is deliberate rather than the shorter path.
 */
export type CascadeNode = PendingNode | TerminalNode | ExpandedNode;

/**
 * A node that still wanted expanding when `maxDepth` was reached.
 *
 * Recorded with its span so the run can say which stretch of which article hit
 * it — Moby-Dick at 2,569 blocks is the article that will. Whether the answer
 * is to fail loudly or to raise the cap is a decision for the first run that
 * produces one, and it cannot be taken from a number nobody wrote down.
 *
 * The node's title is deliberately not here: it is a sentence the model wrote
 * about the article, and this travels into a log line. Block ids cannot spell
 * a word of anybody's prose. src/ids.ts § `nameValue`.
 */
export interface CapReached {
  /** Its position in the cascade's own proposal — "root > child 2 > child 4". */
  where: string;
  range: readonly [string, string];
  structuralBlocks: number;
}

/**
 * The cascade, mid-flight or finished.
 *
 * `capReached` is a required field rather than an optional one on purpose: an
 * executor that reaches the cap has to put the node somewhere, and a type that
 * offers nowhere is a type that invites `status: "terminal"` and a shrug.
 */
export interface CascadeState {
  root: CascadeNode;
  capReached: CapReached[];
}

/**
 * What the stopping rule and the packer actually need of a node: its range,
 * and — if it has been expanded already — where its children begin.
 *
 * Looser than `CascadeNode` so a test, an eval arm or a bare `ModelNode` can be
 * asked the question without first inventing a status and a title it has no
 * opinion about.
 */
export interface RangedNode {
  range: readonly [string, string];
  children?: readonly RangedNode[] | undefined;
}

/* ------------------------------------------------------------ the indices */

/** Block id to document position. */
export type BlockIndex = ReadonlyMap<string, number>;

/**
 * **Build it once per wave, not once per node.**
 *
 * Every function below takes this as an optional last argument and builds one
 * when it is not given. The default is for a single call and for the tests; a
 * wave asking `shouldExpand` of a few hundred frontier nodes should hand the
 * same map in, or the cascade spends O(blocks × nodes) rebuilding it — 1.5M
 * map insertions on Moby-Dick, which is nothing against a model call and is
 * still a silly thing to do on purpose.
 */
export function indexBlocks(blocks: readonly Block[]): BlockIndex {
  return new Map(blocks.map((b, i) => [b.id, i]));
}

/**
 * A node's range as `[lo, hi]` positions.
 *
 * Throws rather than returning null, and the message says whose fault it is.
 * **Every range this file is handed was derived by this file**, from ids that
 * resolved at the time — the parent's own range in `normaliseExpansion` is
 * explicitly not the model's to redefine, and a cascade node's range was
 * written by an earlier `normaliseExpansion`. So an unresolvable range here is
 * a bug in the cascade or a node from a different article, not a bad answer,
 * and it must not be absorbed by the machinery that absorbs bad answers.
 */
function positions(node: RangedNode, index: BlockIndex, what: string): [number, number] {
  const lo = index.get(node.range[0]);
  const hi = index.get(node.range[1]);
  if (lo === undefined || hi === undefined || lo > hi) {
    throw new Error(
      `${what} has a range this article cannot resolve: start ${nameValue(node.range[0])}, ` +
        `end ${nameValue(node.range[1])}. Cascade ranges are derived from ids that resolved, ` +
        `so this is a node from somewhere else rather than a bad answer.`,
    );
  }
  return [lo, hi];
}

/* ---------------------------------------------------------- the stop rule */

/**
 * **How many blocks in this node a reader could navigate to** — `isStructural`,
 * not a raw count.
 *
 * Counting raw blocks counts the wrong things, and the article that proved it
 * is `openai-huggingface`: it ends on an empty paragraph, a stranded footnote
 * the structure prompt renders as `NOT-GISTABLE: (withheld)`, and a blog footer
 * whose entire text is "No posts". Three blocks, no navigation. A size rule
 * reading nine of those as a section worth splitting buys a level of the tree
 * the reader gets nothing from, and pays for it with a model call.
 *
 * `isStructural` is the predicate the label pass already uses for exactly this
 * question — *may the tree write a navigable row about this block* — so the
 * cascade's stopping size and the label pass's batching agree by construction
 * rather than by coincidence. src/block-policy.ts.
 */
export function structuralBlocksIn(
  node: RangedNode,
  blocks: readonly Block[],
  index: BlockIndex = indexBlocks(blocks),
): number {
  const [lo, hi] = positions(node, index, "This node");
  let n = 0;
  for (let i = lo; i <= hi; i++) if (isStructural(blocks[i]!)) n++;
  return n;
}

/**
 * **How many words of this node the model is actually shown** — `isBodyEvidence`,
 * and `Block.words` rather than a re-count.
 *
 * The counterpart to `structuralBlocksIn`, and it deliberately uses a *different*
 * predicate, because it answers a different question. The block count asks how
 * many rows a reader could navigate to, so it counts `isStructural`. The word
 * count asks how much prose the call has to hold in its head before it can say
 * whether the node divides — so it counts what `renderBlocks` (src/hierarchy.ts)
 * actually sends, which is every body block including the `gistable: false` ones
 * it marks `NOT-GISTABLE` and prints in full. A withheld supplement costs the
 * marker and is not prose, so it is excluded; `estimateEvidenceTokens` makes the
 * same split for the same reason.
 *
 * Words rather than tokens because the ceiling is a statement about reading, not
 * about a request: the plan's tables, the 800-word pre-filter and the 2,000-word
 * ceiling are all counted this way, and a bound measured in one unit and
 * enforced in another is a bound nobody can check.
 */
export function bodyWordsIn(
  node: RangedNode,
  blocks: readonly Block[],
  index: BlockIndex = indexBlocks(blocks),
): number {
  const [lo, hi] = positions(node, index, "This node");
  let words = 0;
  for (let i = lo; i <= hi; i++) {
    const block = blocks[i]!;
    if (isBodyEvidence(block)) words += block.words;
  }
  return words;
}

/**
 * **An authored heading inside this node that no boundary has honoured.**
 *
 * Resolved means *a boundary already starts there*: the node's own first block,
 * or the first block of one of its children. Everything else is a heading the
 * finished tree would run a section straight across.
 *
 * The node's own start counts as resolved, and it has to: a node created *from*
 * a heading begins on one, and calling that unresolved would make every
 * heading-started node expand for ever. That is the cascade failing to
 * terminate, not the cascade respecting a boundary.
 *
 * **A heading the model cannot read is not a boundary it can honour.** The
 * clause counted supplement headings, and `renderBlocks` withholds a
 * supplement's text — so a "Notes" heading inside the range would force an
 * expansion, and the call would then be asked to split on a boundary shown to
 * it as `NOT-GISTABLE: (withheld)`. It is not a corner: `splitBlocks` normally
 * peels the trailing apparatus off before stage 4 sees it, but its
 * stranded-supplement fallback hands over the whole article, and stage 0b made
 * that path *more* visible today rather than less. ⟨GPT Sol, 2026-09-04⟩
 *
 * `isBodyEvidence` and not `isStructural`, and the difference is real: a body
 * heading that is `gistable: false` still has its text rendered, marked
 * `NOT-GISTABLE` — so the model can see it and can honour it, and excluding it
 * would drop a boundary that is genuinely there. The question this clause asks
 * is *can the model read this heading*, and that is the predicate whose name
 * says so (src/block-policy.ts).
 *
 * `kind === "heading"` otherwise, deliberately — the same test `buildTree` uses
 * to back a `sourceHeading` claim and `checkTree` uses to enforce it
 * (src/tree-invariants.ts). A third opinion about what counts as a heading is a
 * third thing to drift.
 */
function hasUnresolvedHeading(
  node: RangedNode,
  blocks: readonly Block[],
  index: BlockIndex,
): boolean {
  const [lo, hi] = positions(node, index, "This node");
  const resolved = new Set<number>([lo]);
  for (const child of node.children ?? []) {
    const at = index.get(child.range[0]);
    if (at !== undefined) resolved.add(at);
  }
  for (let i = lo; i <= hi; i++) {
    if (isAuthoredBoundary(blocks[i]!) && !resolved.has(i)) return true;
  }
  return false;
}

/**
 * **A heading the model is shown, and therefore one it can be held to.**
 *
 * Extracted so the clause above and the count below cannot drift into two
 * opinions about what a heading is — the same argument the comment above makes
 * for using `kind === "heading"` rather than inventing a third test.
 */
function isAuthoredBoundary(block: Block): boolean {
  return block.kind === "heading" && isBodyEvidence(block);
}

/**
 * **How many of the author's own headings are inside this node's range**, the
 * node's own first block included.
 *
 * Not a bound and not a decision: it is the number the *request builder* needs,
 * because the expansion prompt's settled precedence is that an authored heading
 * always begins a child and `predictedChildren` caps at nine
 * (docs/plans/260904d-deepen-fat-sections.md § "Where the author's headings and
 * the fan-out target collide"). A twenty-heading parent therefore answers with
 * twenty children whatever the fan-out target says, and a `max_tokens` sized
 * from `predictedChildren` alone would truncate it — the one failure on this
 * path that costs a whole paid call and returns nothing usable.
 *
 * It counts *every* authored body heading in range where `hasUnresolvedHeading`
 * asks only whether one is unaccounted for, and the difference is deliberate:
 * one is a stopping rule, this is an arithmetic upper bound on the answer's
 * size. They share `isAuthoredBoundary` so they cannot disagree about what
 * they are counting.
 */
export function bodyHeadingsIn(
  node: RangedNode,
  blocks: readonly Block[],
  index: BlockIndex = indexBlocks(blocks),
): number {
  const [lo, hi] = positions(node, index, "This node");
  let found = 0;
  for (let i = lo; i <= hi; i++) if (isAuthoredBoundary(blocks[i]!)) found++;
  return found;
}

/**
 * **Does this node still need splitting?** The governor, and the whole of it.
 *
 * Expand iff **either** the node holds more than `terminalBlocks` structural
 * blocks, **or** it still contains an unresolved authored *body* heading. Depth then
 * falls out of the article rather than out of a constant in a prompt: a short
 * post gets one internal level, a paper three, a book five.
 *
 * Both clauses are corrections to a rule that was almost right, and the plan
 * records why:
 *
 * - The draft said *"split above ~12, stop at ≤~9"* and left 10–12 undefined.
 *   A rule that becomes a checkpoint fingerprint cannot have an undefined band,
 *   so the boundary is exact: nine stops, ten expands.
 * - **A size rule alone can break the hard-heading rule.** A node of eight
 *   blocks containing two of the author's own headings would stop, and its
 *   leaves would then span a heading — which the prompt calls a hard boundary
 *   everywhere else. Silently, in the finished tree, for every reader of that
 *   article. The heading clause is what stops the terminal level merging
 *   across one.
 *
 * Read the header before making this consult `maxDepth`: it deliberately does
 * not, and that is what keeps a capped node visible.
 */
export function shouldExpand(
  node: RangedNode,
  blocks: readonly Block[],
  recipe: CascadeRecipe,
  index: BlockIndex = indexBlocks(blocks),
): boolean {
  if (structuralBlocksIn(node, blocks, index) > recipe.terminalBlocks) return true;
  return hasUnresolvedHeading(node, blocks, index);
}

/* ------------------------------------------------------- the precedence */

/**
 * **What the call said about one child it proposed**: is this finished, or does
 * it want a level of its own?
 *
 * A two-member union rather than a boolean, and that is the whole point. A
 * boolean field that goes missing reads as `false`, and `false` here means
 * "finished" — *"a missing field silently reading as finished is the shape of
 * this plan's whole failure mode"*
 * (docs/plans/260904d-deepen-fat-sections.md § stage 4). Absent is a third
 * state, it is spelled `undefined`, and `decideExpansion` reports it under its
 * own name rather than folding it into either answer.
 *
 * Stage 4 owns the wire schema, where the field is **required**. This is only
 * the shape the governor reads.
 */
export type ModelVerdict = "needs-deeper" | "finished";

/**
 * **The governor's verdict on one node, and which bound produced it.**
 *
 * A discriminated union rather than a boolean, because "expand" and "expand
 * because the author put two headings in it" are different facts and only the
 * second one can be measured. Every number the plan asks the eval to report —
 * the raw yes rate, the effective yes rate, how often a bound overrode the
 * model — is a tally of `because`, and none of them can be recovered from a
 * boolean after the fact.
 *
 * The pairings are in the type: `"authored-heading"` can only ever expand,
 * `"depth-cap"` can only ever stop. A switch on `because` is exhaustive, and
 * tests/hierarchy-cascade.test.ts holds the `never` check that keeps it so.
 */
export type ExpansionDecision =
  | {
      decision: "expand";
      because: "authored-heading" | "forced-open" | "unassessed-ceiling" | "verdict";
    }
  | { decision: "stop"; because: "depth-cap" | "divisibility-floor" | "verdict" | "no-verdict" };

/**
 * **The five bounds, in order.** The layer above `shouldExpand` that knows about
 * depth and about what the model said.
 *
 * | | bound | rule |
 * |---|---|---|
 * | 1 | depth cap | past it, nothing expands |
 * | 2 | heading rule | forces open, and **beats the floor** |
 * | 3 | divisibility floor | never expand a node under the terminal size |
 * | 4 | forced-open ceiling | over `forcedOpenWords`, above the floor, called finished → opened anyway |
 * | 5 | the model's verdict | decides everything the four leave open |
 *
 * **They are ordered, and the order is the part that had to be written down.**
 * The plan's first draft listed them as a set, and two of them contradict: an
 * eight-block node holding two authored headings is under the floor *and* over
 * the heading rule. `shouldExpand` had already settled that collision — *"a size
 * rule alone can break the hard-heading rule […] its leaves would then span a
 * heading, which the prompt calls a hard boundary"* — so bounds 2 and 3 are
 * asked here as the single question `shouldExpand` already answers, rather than
 * as two questions that could be ordered differently by accident.
 * ⟨GPT Sol, finding 4.⟩
 *
 * **The plan's table says bound 2 is "two or more authored heading blocks", and
 * the code's rule is broader.** `hasUnresolvedHeading` fires on *any* authored
 * body heading in range that no boundary starts on, which subsumes the
 * two-heading case and also handles the supplement heading and the
 * `gistable: false` heading, neither of which the table mentions. The table's
 * phrasing is how the 22-of-54 Moby-Dick figure was *measured*, not a second
 * rule; the code's is the rule.
 *
 * **This does not make `shouldExpand` consult `maxDepth`, and must not.** That
 * file-header ruling is what keeps a capped node *visible*: `shouldExpand` still
 * says the node wants splitting, this says the cap refused it, and the executor
 * writes a `capReached` record from the two together. A `shouldExpand` that
 * returned `false` at the cap would produce a silently terminal node —
 * indistinguishable, in every mechanical measure, from one the governor
 * legitimately stopped.
 *
 * ## What an absent verdict does
 *
 * It **stops** — unless a mechanical bound opens it — and it says so under its
 * own name either way: `because: "no-verdict"` rather than `"verdict"` when it
 * stops, and `"unassessed-ceiling"` rather than `"forced-open"` when the ceiling
 * opens it.
 * The decision coincides with what "finished" would have produced, and the
 * *reason* does not — which is the whole difference between a wave nobody has
 * asked yet (wave 1's tree, where no verdict exists for any node) and a call
 * that answered. The mechanical bounds above still force those nodes open, which
 * is exactly the "one additional scoped wave over mechanically selected targets"
 * stage 5 runs. Erring towards stopping is also the side that cannot spend
 * money it was never told to.
 */
export function decideExpansion(opts: {
  node: RangedNode;
  /** The node's own depth; the root is 0. Expanding it creates children at `depth + 1`. */
  depth: number;
  blocks: readonly Block[];
  recipe: CascadeRecipe;
  /** What the call that proposed this node said about it, if one has been made. */
  verdict?: ModelVerdict | undefined;
  index?: BlockIndex;
}): ExpansionDecision {
  const { node, depth, blocks, recipe, verdict } = opts;
  const index = opts.index ?? indexBlocks(blocks);

  /* 1. The cap. A node at `maxDepth` may not have children, because they would
     be one level deeper than the cascade is allowed to go. */
  if (depth >= recipe.maxDepth) return { decision: "stop", because: "depth-cap" };

  /* 2 and 3, in one question, because `shouldExpand` already orders them: it is
     true when the node is over the floor OR holds an unresolved authored
     heading, so a false here is the floor with nothing overruling it. */
  if (!shouldExpand(node, blocks, recipe, index)) {
    return { decision: "stop", because: "divisibility-floor" };
  }
  /* 2, named. Asked only to say which of the two clauses carried it — the
     decision was already taken above, so the two cannot disagree. */
  if (hasUnresolvedHeading(node, blocks, index)) {
    return { decision: "expand", because: "authored-heading" };
  }

  /* 5 before 4, where they agree. `forcedOpen` counts nodes opened *against* a
     finished verdict, so a node the model already wanted deeper belongs to the
     verdict, not to the ceiling. */
  if (verdict === "needs-deeper") return { decision: "expand", because: "verdict" };

  /* 4. Above the floor, no heading forcing it, and too big to be one section
     whatever it says about itself.

     **`forced-open` only when something was actually overruled.** The ceiling's
     whole reported number is *how often it overrode a model that said finished*,
     and a node nobody has asked yet overrides nothing — counting the two
     together would make that figure read high on exactly the wave where no
     verdict exists for any node, which is wave 1, which is every article's
     first pass. The decision is the same either way; the attribution is not,
     and the attribution is why this returns a union rather than a boolean.
     ⟨GPT Sol's review of stage 3, F2.⟩ */
  if (bodyWordsIn(node, blocks, index) > recipe.forcedOpenWords) {
    return {
      decision: "expand",
      because: verdict === undefined ? "unassessed-ceiling" : "forced-open",
    };
  }

  return verdict === undefined
    ? { decision: "stop", because: "no-verdict" }
    : { decision: "stop", because: "verdict" };
}

/**
 * **How many children this parent is expected to come back with** — the unit
 * the packer counts in.
 *
 * `clamp(2, 9, ceil(structural / terminalBlocks))`. Blocks are the wrong unit
 * for packing: the answer's size, the reasoning it takes and the risk of a
 * dropped section all scale with the *nodes* a call has to write, and a
 * heavily-illustrated parent of forty blocks is a smaller question than a dense
 * one of twenty.
 *
 * **Structural blocks, where the plan's own formula says `parentBlockCount`.**
 * Deliberate, and for the same reason the stopping rule gives: a node padded
 * with images and withheld apparatus would otherwise be predicted to fan out
 * into sections there is no prose to write. The two would then disagree — a
 * node `shouldExpand` calls terminal could still be predicted four children —
 * and a prediction the governor contradicts is not a prediction worth
 * recording against the actual.
 *
 * The clamp is the prompt's own 5–9 fan-out widened at the bottom, not a
 * packing preference; see `MIN_PREDICTED_CHILDREN`.
 */
export function predictedChildren(
  node: RangedNode,
  blocks: readonly Block[],
  recipe: CascadeRecipe,
  index: BlockIndex = indexBlocks(blocks),
): number {
  const wanted = Math.ceil(structuralBlocksIn(node, blocks, index) / recipe.terminalBlocks);
  return Math.min(MAX_PREDICTED_CHILDREN, Math.max(MIN_PREDICTED_CHILDREN, wanted));
}

/* --------------------------------------------------------- the estimator */

/**
 * Characters per token. The usual rule of thumb for English prose; block ids
 * are denser and cost nearer three (src/token-budget.ts §
 * `truncatedMessage` uses that figure for JSON full of them).
 */
const CHARS_PER_TOKEN = 4;

/**
 * What a rendered block costs beyond its own text: `[123] spya-k3m9qt <p>: `
 * and the blank line after it, minus the id and tag, which are counted for
 * real.
 */
const RENDER_OVERHEAD_CHARS = 12;

/** What `renderBlocks` prints instead of a withheld supplement's prose. */
const WITHHELD_CHARS = "NOT-GISTABLE: (withheld)".length;

/** One block of the article either side of a target, for flow. src/labels.ts § `CONTEXT_BLOCKS`. */
const CONTEXT_BLOCKS = 1;

/**
 * **Roughly how many tokens of *evidence* one target costs** — its own rendered
 * slice, plus the context block either side. An estimate, on purpose.
 *
 * Four characters to a token, no tokenizer, no dependency. Two reasons that is
 * enough:
 *
 * - **The soft cap is a preference, not a correctness bound.** Nothing
 *   downstream is wrong if a batch comes out 15% over: the tree is identical
 *   either way, and the only consequence is that a batch boundary falls one
 *   parent earlier or later. The bound that *is* a correctness question is
 *   `maxRequestTokensPerBatch`, and it is enforced separately.
 * - **A real tokenizer is a dependency and a model-family coupling**, for a
 *   number whose job is to decide where to close a list. "Prefer boring."
 *
 * **The context blocks are counted, and they did not used to be.** The comment
 * here claimed they could be left out because they were effectively constant,
 * and that is simply false — a context block is a paragraph of the article and
 * its length varies by batch like any other. ⟨GPT Sol, 2026-09-04⟩ Two targets
 * that abut share a context block and it is counted twice; an estimate that
 * errs high closes batches slightly early, which is the harmless direction.
 *
 * **The shared prefix is still not counted here**, and that is a different
 * argument rather than the same one: the common rules and the frozen outline
 * are the same bytes in every batch of a wave, so folding them in shifts every
 * batch's evidence total by one constant — arithmetically identical to lowering
 * the soft cap. They belong to the *request*, and `estimateRequestTokens` is
 * where they are counted.
 *
 * It follows `renderBlocks` (src/hierarchy.ts) on withheld supplements, so the
 * estimate tracks what the request builder will actually send rather than what
 * the blocks happen to hold.
 */
export function estimateEvidenceTokens(
  node: RangedNode,
  blocks: readonly Block[],
  index: BlockIndex = indexBlocks(blocks),
): number {
  const [lo, hi] = positions(node, index, "This node");
  const from = Math.max(0, lo - CONTEXT_BLOCKS);
  const to = Math.min(blocks.length - 1, hi + CONTEXT_BLOCKS);
  let chars = 0;
  for (let i = from; i <= to; i++) {
    const block = blocks[i]!;
    chars +=
      block.id.length +
      block.tag.length +
      RENDER_OVERHEAD_CHARS +
      (isBodyEvidence(block) ? block.text.length : WITHHELD_CHARS);
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * **What a request costs beyond its targets' evidence** — supplied by whoever
 * builds the request, because this module cannot see it.
 *
 * Splitting it out is what lets a pure packer enforce a real feasibility bound
 * without knowing the prompt. The request builder measures these two numbers
 * once per wave and hands them in; the arithmetic below is then honest about
 * the whole request rather than about the part that happened to be easy to
 * measure.
 */
export interface RequestOverhead {
  /**
   * The shared prefix: the common rules plus the frozen outline. Constant
   * within a wave — that is the whole point of it, since a prefix that changes
   * at every barrier is a prefix that never pays for itself.
   */
  prefixTokens: number;
  /**
   * What one target costs beyond its evidence: its ordinal, its title, its gist
   * and its crumb. Per target, not per batch.
   */
  perTargetTokens: number;
}

/**
 * A whole request's size, to the same four-characters-a-token accuracy.
 *
 * Read against `maxRequestTokensPerBatch`, which is the one bound here that is
 * a statement about what the model will accept rather than about what makes a
 * good question.
 */
export function estimateRequestTokens(
  evidenceTokens: number,
  targetCount: number,
  overhead: RequestOverhead,
): number {
  return overhead.prefixTokens + targetCount * overhead.perTargetTokens + evidenceTokens;
}

/**
 * **The overhead of a request nobody has measured yet.**
 *
 * Zero is not a claim that a request costs nothing; it is the honest reading of
 * *"the builder has not told us"*, and it makes the feasibility bound degenerate
 * to the evidence total. Fine for a test that is asking about packing. **Not
 * fine in the pipeline** — a wave that plans with this is a wave whose hard cap
 * is measuring the wrong thing, so stage 2 passes the real figures.
 */
export const UNMEASURED_OVERHEAD: RequestOverhead = { prefixTokens: 0, perTargetTokens: 0 };

/* ---------------------------------------------------------- the batching */

/** One parent awaiting expansion, and where it sits in the cascade's proposal. */
export interface ExpansionTarget {
  /**
   * The node to expand. **Its range is fixed and an answer may not redefine
   * it** — the ordinal already identifies a parent whose range the code owns,
   * so a wave that answered about a different stretch than it was given is the
   * mistake, not a boundary to reconcile.
   */
  node: CascadeNode;
  /** "root > child 2". Derived from the shape of the tree, so safe to log. */
  where: string;
}

/** One expansion call, ready to send. */
export interface ExpansionBatch {
  kind: "batch";
  /** Whole parents, in document order. Never a fragment of one. */
  targets: ExpansionTarget[];
  /**
   * What `predictedChildren` said these parents would produce, summed.
   *
   * Carried on the batch rather than recomputed, because this is the half of
   * the pair the run compares against the actual child count — the measurement
   * that turns the guessed caps above into tuned numbers.
   */
  predictedChildren: number;
  /** `estimateEvidenceTokens` over the batch's targets. An estimate; see there. */
  estimatedEvidenceTokens: number;
  /** The whole request, prefix and metadata included. Read against the hard cap. */
  estimatedRequestTokens: number;
  /** Document-order position of the batch's first and last block. */
  span: [number, number];
}

/**
 * **A parent whose own request would not fit, alone.**
 *
 * Not an error and not a batch: it is a question this recipe cannot ask, and
 * the answer to it is stage 2's — bound the evidence, chunk it, or refuse the
 * article. What this module owes is to *say so* rather than emit a call that
 * cannot succeed.
 *
 * It is a separate member of `ExpansionCall` rather than a flag on
 * `ExpansionBatch` so that a caller cannot handle it by not looking. A boolean
 * is ignorable; a `switch` that does not mention this shape does not compile
 * under `noImplicitReturns`, and one that does mention it had to decide.
 */
export interface OversizedTarget {
  kind: "oversized";
  target: ExpansionTarget;
  estimatedRequestTokens: number;
  /** `recipe.maxRequestTokensPerBatch`, carried so the message can name both. */
  limit: number;
  span: [number, number];
}

/** What the planner produces, per call it would like to make. */
export type ExpansionCall = ExpansionBatch | OversizedTarget;

/**
 * **Cut the frontier into calls.**
 *
 * Whole parents in document order, closing a batch when the next parent would
 * take it past any of the four caps. This is the rule src/labels.ts §
 * `planBatches` already lives by — *generate siblings together; generate
 * disjoint sibling groups in parallel* — with predicted child nodes in place of
 * gistable blocks as the unit.
 *
 * **A parent's complete child set is indivisible.** Two calls given the same
 * parent would each decide where its children start, and the two answers would
 * disagree about a boundary neither could see the other propose. So an
 * oversized parent gets a call to itself rather than being cut: the caps are a
 * preference, the sibling rule is not, and `planBatches` makes the identical
 * trade for an oversized sibling set.
 *
 * **Packing is not an optimisation, it is what makes the cascade affordable.**
 * On the real corpus the unpacked arm made 7 and 8 calls and spent $0.39 and
 * $0.52 against the incumbent's single call at $0.23 and $0.29 — a 1.7×–1.8×
 * premium. A cascade that costs twice as much is not one we would ship whatever
 * it does for latency.
 *
 * There is deliberately **no minimum and no tail merge**, which is where this
 * differs from `planBatches`. That file's `MIN_BATCH` exists because
 * `detectShift` cannot vote on a short batch — a check this stage does not
 * have. A short final expansion call is simply a small question, and inventing
 * a floor for it would be a constant with nothing behind it in a file that
 * already has four.
 *
 * ## The soft caps and the hard one are enforced differently, on purpose
 *
 * The three packing caps are preferences: a single target may breach the child
 * count, the parent count or `maxEvidenceTokensPerBatch` and still get a call,
 * because the alternative is cutting a sibling set. `maxRequestTokensPerBatch`
 * is not a preference — a request past it is a call that cannot succeed — so a
 * target that breaches it *alone* comes back as an `OversizedTarget` instead.
 * The old code had one cap doing both jobs and let a lone parent breach it,
 * which is right for the first job and catastrophic for the second.
 * ⟨GPT Sol, 2026-09-04⟩
 *
 * **This does not cover every target, and the completeness guard is what
 * does.** A frontier that omitted a node would be packed perfectly, and only
 * `assertCascadeComplete` — which walks the tree rather than the list — can
 * notice that the node is still `pending`. The assertion below is about this
 * function keeping faith with the list it was handed, and nothing more.
 */
export function planExpansionBatches(
  targets: readonly ExpansionTarget[],
  blocks: readonly Block[],
  recipe: CascadeRecipe,
  overhead: RequestOverhead,
): ExpansionCall[] {
  const index = indexBlocks(blocks);
  assertInDocumentOrder(targets, index);
  const calls: ExpansionCall[] = [];

  let current: ExpansionTarget[] = [];
  let children = 0;
  let evidence = 0;

  const spanOf = (of: readonly ExpansionTarget[]): [number, number] => [
    positions(of[0]!.node, index, "A batch's first parent")[0],
    positions(of.at(-1)!.node, index, "A batch's last parent")[1],
  ];

  const close = (): void => {
    if (current.length === 0) return;
    calls.push({
      kind: "batch",
      targets: current,
      predictedChildren: children,
      estimatedEvidenceTokens: evidence,
      estimatedRequestTokens: estimateRequestTokens(evidence, current.length, overhead),
      span: spanOf(current),
    });
    current = [];
    children = 0;
    evidence = 0;
  };

  for (const target of targets) {
    const predicted = predictedChildren(target.node, blocks, recipe, index);
    const cost = estimateEvidenceTokens(target.node, blocks, index);
    /* **Close when the next parent would not fit, and never on an empty
       batch.** `current.length > 0` is what gives a parent over a *soft* cap a
       call of its own rather than an empty batch in front of it: it can never
       satisfy the condition alone, so it is pushed onto a fresh batch and the
       *following* parent closes it.

       Any of the four, because they bound different things and a batch that
       satisfies three of them can still be a bad request under the fourth. */
    const wouldExceed =
      children + predicted > recipe.maxPredictedChildrenPerBatch ||
      current.length + 1 > recipe.maxParentsPerBatch ||
      evidence + cost > recipe.maxEvidenceTokensPerBatch ||
      estimateRequestTokens(evidence + cost, current.length + 1, overhead) >
        recipe.maxRequestTokensPerBatch;
    if (current.length > 0 && wouldExceed) close();

    /* Alone, and still over the hard ceiling: there is no batch that can carry
       this and no cut that is allowed, so it is handed back as the one thing
       this planner cannot do. Checked after the close above, so the batch in
       front of it is emitted intact. */
    const alone = estimateRequestTokens(cost, 1, overhead);
    if (alone > recipe.maxRequestTokensPerBatch) {
      calls.push({
        kind: "oversized",
        target,
        estimatedRequestTokens: alone,
        limit: recipe.maxRequestTokensPerBatch,
        span: spanOf([target]),
      });
      continue;
    }

    current.push(target);
    children += predicted;
    evidence += cost;
  }
  close();

  assertCoversEveryTarget(calls, targets);
  return calls;
}

/**
 * Every target accounted for exactly once, in the order it was given — as a
 * member of a batch, or as an oversized call of its own.
 *
 * The two ways this goes wrong — a parent packed twice, a parent packed into no
 * call at all — both produce a tree. The first grows two subtrees over one
 * stretch of the article and the second leaves a node the executor never asks
 * about. `planBatches` has the same guard for the same reason.
 */
function assertCoversEveryTarget(
  calls: readonly ExpansionCall[],
  targets: readonly ExpansionTarget[],
): void {
  const packed = calls.flatMap((c) => (c.kind === "batch" ? c.targets : [c.target]));
  if (packed.length !== targets.length || packed.some((t, i) => t !== targets[i])) {
    throw new Error(
      `planExpansionBatches accounted for ${packed.length} of ${targets.length} parents, or ` +
        `reordered them. Every parent must appear in exactly one call, in document order.`,
    );
  }
}

/**
 * **The frontier has to arrive in document order**, and this says so rather
 * than assuming it.
 *
 * A breadth-first wave over a tiling tree produces one naturally, so the check
 * never fires — but an out-of-order frontier packs parents from opposite ends
 * of the article into one call and gives every batch a `span` that is a lie,
 * and neither of those throws anywhere downstream. A precondition nobody states
 * is a precondition somebody breaks.
 *
 * Disjoint as well as ordered: two overlapping parents in one wave means the
 * same prose is about to be expanded twice.
 */
function assertInDocumentOrder(targets: readonly ExpansionTarget[], index: BlockIndex): void {
  let previousEnd = -1;
  for (const target of targets) {
    const [lo, hi] = positions(target.node, index, `The parent at ${target.where}`);
    if (lo <= previousEnd) {
      throw new Error(
        `planExpansionBatches was given a frontier that is not in document order: the parent at ` +
          `${target.where} begins at or before the end of the one in front of it. Parents must ` +
          `arrive in the order their blocks do, and must not overlap.`,
      );
    }
    previousEnd = hi;
  }
}

/* ----------------------------------------------------- the normalisation */

/**
 * One child as a wave answers it: **a start, and no end.**
 *
 * `planChildRanges` discards the model's ends anyway — a start is a claim the
 * model has a reason for, an end is the same boundary stated a second time from
 * the other side — so the response schema simply does not offer one. Two
 * observed failures stop being expressible as a result: a range that runs
 * backwards, and a last child that stops short of its parent.
 *
 * `sourceHeading` is optional and is **in** the schema on purpose. It is how a
 * node records that the author wrote its title, it is what the `§` badge in the
 * reading view is drawn from, and a response format that omitted it would
 * silently strip the provenance from every node the cascade creates.
 */
export interface ProposedChild {
  start: string;
  title: string;
  gist?: string;
  sourceHeading?: string;
}

/**
 * **A child that survived, and the proposal it came from** — one object, made in
 * one place, so the two cannot be paired wrongly.
 *
 * ## The shape this replaced, and why it had to go
 *
 * `normaliseExpansion` used to hand back bare `ModelNode`s, and the wave carried
 * the model's own children beside them in a second array. The two are **different
 * lengths** — a start that marks no split point is dropped, and nothing said
 * which — so *"what did the model say about this child?"* was a question with no
 * answer. Stage 6 is the recursion, and the recursion is governed by exactly
 * that question, so it could not have been built on top of it; stage 5 records
 * verdicts it could not attribute. The obvious mend was a `childIndex` on the
 * node and a lookup every caller must remember to do, which is a parallel array
 * with an extra step — and *"a parallel array is a thing that can be one element
 * short"* is the rule this file already lives by
 * (`runExpansionWave`'s `ancestorsOf`).
 *
 * So the pairing is made where the drop is decided and is impossible to lose.
 * The proposal here is the **same object** the caller passed in, not a copy: a
 * field this file has never heard of — today `verdict` and `why`, tomorrow
 * whatever the prompt learns to ask for — arrives on the other side untouched.
 *
 * The node is still exactly what `buildTree` takes, so a caller that wants the
 * tree writes `children.map((c) => c.node)` and is done.
 * docs/plans/260904d-deepen-fat-sections.md § stage 5.
 */
export interface DerivedChild<C extends ProposedChild = ProposedChild> {
  /** As `buildTree` takes it: title, gist, `sourceHeading`, and a derived range. */
  node: ModelNode;
  /**
   * The proposal this node was built from — the caller's own object, by
   * identity.
   *
   * **Its `start` is not the node's range start**, and that is the point of
   * keeping it: the first child is pinned to its parent's own first block, and a
   * child whose start named a block one past its authored heading is snapped back
   * onto it. What the model claimed and what it got are both here, which is what
   * lets `recordBoundaryFaults` measure the difference at all.
   */
  proposed: C;
}

/**
 * **Turn one parent's answer into children with real ranges, immediately.**
 *
 * ## Why immediately
 *
 * The eval's existing `runWaves` slices each later call from the *raw* wave-1
 * ranges and only calls `buildTree` at the very end — but `planChildRanges` can
 * move those ranges when it derives the tiling. A subtree is therefore
 * generated from one slice of prose and finally attached to a different range.
 * `assertTreeSound` confirms the repaired tree tiles; **nothing can detect that
 * a title and a gist were written about the wrong paragraphs.** So no range
 * this file produces may become input to another call before it is fixed, and
 * the fixing happens here, one answer at a time.
 *
 * ## The rule, which is `planChildRanges`'s rule
 *
 * Read src/hierarchy.ts § `planChildRanges` for the reasoning; this is the
 * same algorithm with the ends deleted rather than a second one:
 *
 * - **every** claimed start is checked against the parent first, and one
 *   outside it is **refused** — the first child's included;
 * - the first kept child then starts at the parent's start, because children
 *   must cover their parent and nothing else can supply that block;
 * - every later child starts where the model said, dropped if that is not
 *   strictly after the previous kept child's start;
 * - a child that begins one block after the authored heading its own
 *   `sourceHeading` names is moved back onto it (src/heading-snap.ts — the one
 *   piece of the derivation the two files literally share, because it was the
 *   one piece they disagreed about);
 * - every child ends one block before the next kept child starts, and the last
 *   ends at the parent's end.
 *
 * A gap, an overlap, a child running past its parent: not four cases to mend,
 * they cannot be expressed. A list of ordered split points tiles its parent by
 * construction.
 *
 * ## The one thing the ends were still doing, and what replaces it
 *
 * `planChildRanges` falls back to the previous child's claimed *end* when two
 * starts collide, and that fallback recovers a real case — a child that claims
 * its sibling's start but plainly means the stretch after it. **A starts-only
 * answer has nothing to fall back to**, so the child is dropped and counted,
 * exactly as `planChildRanges` already drops one whose previous sibling's end
 * was backwards and therefore ineligible.
 *
 * That is a decision rather than an omission, and the alternative was
 * considered and refused: giving the colliding child the very next block writes
 * a boundary nobody proposed and cascades absurdly when a start is badly out —
 * `planChildRanges` says so in its own words. And the prose is not lost either
 * way, only the section's name: the blocks go to the child before it.
 *
 * ## What is refused — all of it as `ExpansionRefused`, all of it retryable
 *
 * **An invented start id.** The plainest fault left after stage 0c walked the
 * size bound, the count bound and the backwards range back, and it is the model
 * naming something that does not exist — a message that names it is more use
 * than a tree built as though the child had never been proposed.
 *
 * **A start outside the parent.** `planChildRanges` clamps one back inside, and
 * that is right for the incumbent: a whole-document call names a boundary in an
 * article it has all of, so a start past a node's edge is an ordinary
 * misplacement and the clamp is a repair. It is not right here. The whole
 * argument for the cascade is that *"a call shown thirty blocks cannot emit a
 * range that is wrong by 1,289 of them"*, and a clamp makes that sentence false
 * by quietly mending the one case that would have proved it — the answer is
 * about a stretch of the article this call was never shown, which is a
 * different fault from a boundary in the wrong place.
 *
 * **And the first child is not exempt from the check**, though it is still
 * pinned. The pin is right — children must cover their parent and nothing else
 * can supply that block — but exempting the *claim* from the range check is a
 * different thing entirely, and it was a hole: a first `start` naming a block in
 * a sibling section passed every gate, and the sibling's title, gist and verdict
 * were attached to this parent's prose. So the order is check, then pin, and
 * only an in-parent first start is ever pinned; how far *inside* the parent it
 * was is the head repair, and that pin is a rule rather than a clamp. ⟨GPT Sol's
 * review of stage 4, F2 — an error in the brief rather than in the build.⟩
 *
 * **Fewer than two kept children is not an expansion.** One child inherits its
 * parent's entire range, so `shouldExpand` asks the identical question one level
 * down, gets the identical answer, and the cascade grinds to `maxDepth` before
 * anything says a word — four wasted waves and a tree with four meaningless
 * levels in it. Refusing zero children and accepting one was the shape of that
 * bug, and **a proposal that collapses to one after drops is the same thing
 * arriving by a different road**: three starts, two of them non-increasing, is
 * a one-child answer wearing a disguise. GPT Sol reproduced both.
 *
 * So the count is taken **after** planning, not before. That ordering is
 * load-bearing twice over: it is the only way to see the collapse, and it means
 * the refusal carries the drops and repairs that caused it, which is what
 * whoever reads the retry wants to know.
 *
 * **Recognising it is this module's job; deciding what to do about it is stage
 * 2's.** So it throws rather than repairing, and it throws one catchable class
 * so that the retry policy is written once.
 *
 * **The caller's `report` is not touched by a refused answer.** Planning
 * happens into local arrays and is merged in only on success; a refusal carries
 * its own copy on the error. A retried batch that had already added its drops
 * to the run's totals would count them twice, which is the arithmetic
 * `repairedBlockCount` exists to get right.
 *
 * ## What it cannot report, and why that is honest
 *
 * `recordBoundaryFaults` measures three groups of boundary, and two of them
 * exist only because the model states an interior boundary **twice** — as one
 * child's start and the previous child's end. With ends withheld there is one
 * claim per boundary, so an answer cannot disagree with itself, and the
 * `"short"` and `"over"` repairs at the closing boundary become unreachable.
 * What is left is the head boundary, where the first child's ambition meets its
 * parent's fixed start — and, since the clamp became a refusal, that is now the
 * *only* boundary this can record, because every kept later start is believed
 * exactly as claimed. **And it can only ever record a `"gap"` there**, now that
 * the first child's claim is range-checked before it is pinned: a claim below
 * the parent's start is refused rather than pinned, so the pin can only ever
 * pull a boundary backwards. The snap's movements are recorded by the snap.
 * Fewer repairs here is a property of the response format and of what is
 * refused, not a quieter run.
 *
 * ## What comes back is a pair, and that is deliberate
 *
 * A kept child is handed back **beside the proposal it was built from**, not as
 * a bare `ModelNode`. The two are made together, in one `map`, so they cannot
 * come apart; and a caller that needs to know what the model *said* about a
 * child — its verdict, its `why` — reads it off `proposed` rather than trying to
 * line two arrays of different lengths up by position. There is nothing to line
 * up: this function drops a start that marks no split point, and it does not say
 * which. See `DerivedChild`.
 *
 * `C` is whatever shape the caller's proposal has. A scoped answer's child
 * carries a verdict (`ExpansionAnswerChild` in src/hierarchy-expand.ts); a
 * test's carries nothing but the four fields. Either way the object handed back
 * is the very object that went in, so nothing can be lost in the pairing.
 *
 * @returns the children that were kept, in the model's own order, each with a
 * derived range and its own proposal. Dropped children are absent and are named
 * in `report.droppedChildren`.
 */
export function normaliseExpansion<C extends ProposedChild>(opts: {
  /** The model's proposal, in its own order. */
  children: readonly C[];
  /** The parent's already-fixed range. Not the answer's to redefine. */
  parent: readonly [string, string];
  blocks: readonly Block[];
  /** The parent's position in the cascade's proposal — "root > child 2". */
  where: string;
  /** Filled in with what was derived past, and what was dropped. */
  report: BuildReport;
  index?: BlockIndex;
}): DerivedChild<C>[] {
  const { children, blocks, where, report } = opts;
  const index = opts.index ?? indexBlocks(blocks);
  const [p0, p1] = positions({ range: opts.parent }, index, `The parent at ${where}`);

  /* Planned into a report of its own and merged into the caller's only once the
     answer has survived every refusal below — see § "The caller's `report`". */
  const planned: BuildReport = { repairs: [], droppedChildren: [], droppedHeadings: [], collapsedRungs: [], droppedQuestions: [] };

  if (children.length === 0) {
    throw new ExpansionRefused(
      "not-an-expansion",
      `The expansion of ${where} proposed no children at all. A node is only expanded because ` +
        `it needed expanding, so an empty answer is a failed call, not a terminal node.`,
      planned,
    );
  }

  /* Resolve every start before planning any of them, so an invented id fails
     the whole answer rather than half of it. `planChildRanges` does the same,
     by returning null for the sibling set. */
  const claimed: number[] = children.map((child, i) => {
    const at = index.get(child.start);
    if (at === undefined) {
      throw new ExpansionRefused(
        "invented-start",
        `Node range not in blocks.json — at ${where} > child ${i + 1}: ` +
          `start ${nameValue(child.start)}`,
        planned,
      );
    }
    return at;
  });

  /** The split points, in the model's order: which children survive, and where. */
  const kept: KeptChild[] = [];
  for (const [i, at] of claimed.entries()) {
    /* **Every claim is range-checked, and the first one is not exempt.** The
       check used to sit below the pin, so the opening claim never reached it —
       and a first `start` naming a block in a *sibling* section therefore
       passed all four gates, with that sibling's title, gist and verdict
       attached to this parent's prose. Nothing distinguishes that from the
       fault this refusal exists for: an answer about a stretch of the article
       this call was never shown. The pin below is a rule about the parent's own
       first block, not a licence to believe a claim from outside it. */
    if (at < p0 || at > p1) {
      throw new ExpansionRefused(
        "outside-parent",
        `The expansion of ${where} > child ${i + 1} starts at ${nameValue(children[i]!.start)}, ` +
          `which is outside the parent's range — the parent runs from ` +
          `${nameValue(opts.parent[0])} to ${nameValue(opts.parent[1])}. A scoped call is shown ` +
          `its parent's blocks and nothing else, so a start outside them is an answer about a ` +
          `different stretch of the article.`,
        planned,
      );
    }
    const previous = kept.at(-1);
    if (previous === undefined) {
      /* **Pinned, not clamped.** The first kept child takes its parent's start
         whatever it claimed — having first been checked to have claimed
         *something inside the parent* — because children must cover their
         parent and nothing else can supply that block. How far in the claim
         was is not lost: it is the head repair, which `recordBoundaryFaults`
         measures. */
      kept.push({ childIndex: i, start: p0 });
      continue;
    }
    if (at <= previous.start) {
      planned.droppedChildren.push(`${where} > child ${i + 1}`);
      continue;
    }
    kept.push({ childIndex: i, start: at });
  }

  /* **After planning, because the collapse is only visible here.** A proposal
     of three starts that leaves one kept child is a one-child answer that
     nothing before this point could have seen. */
  if (kept.length < MIN_EXPANSION_CHILDREN) {
    throw new ExpansionRefused(
      "not-an-expansion",
      `The expansion of ${where} came back with ${kept.length} usable child from ` +
        `${children.length} proposed, and ${planned.droppedChildren.length} start(s) that marked ` +
        `no split point. One child covers its parent's whole range, so the same question would ` +
        `be asked again one level down and the cascade would run to its depth cap without ` +
        `dividing anything.`,
      planned,
    );
  }

  /* **Measure first, snap second, build third**, and that order is the whole of
     it — it is `planChildRanges`'s order, for its reason. `recordBoundaryFaults`
     compares the model's claims with where the boundary ended up, so running it
     after the snap would report a phantom fault against a section's own correct
     start and make the snap invisible in the telemetry that watches it. The snap
     records its own repair; nothing else measures it. */
  recordBoundaryFaults(kept, claimed, p0, where, planned);
  planned.repairs.push(...snapStartsToHeadings(children, kept, blocks, where));

  const built: DerivedChild<C>[] = kept.map((child, k) => {
    const next = kept[k + 1];
    const end = next === undefined ? p1 : next.start - 1;
    const proposed = children[child.childIndex]!;
    /* In range: `start` is `p0`, a claim checked to be inside [p0, p1], or a snap
       backwards floored at the previous kept start; `end` is either `p1` or one
       before a start that was in range. Both index `blocks` because the parent's
       own range came out of `index`. */
    /* **The pair is made here or it is not made at all.** `child.childIndex` is
       the only thing that knows which proposal survived as which node, it is
       local to this function, and it was thrown away at this line until
       2026-09-05. See `DerivedChild`. */
    const node: ModelNode = {
      title: proposed.title,
      range: [blocks[child.start]!.id, blocks[end]!.id] as [string, string],
      /* **Presence, not truthiness.** This said `proposed.gist ? … : …`, and a
         truthiness test on a string deletes `""` — so a field the model *sent*
         vanished between the answer and the tree, in the one place whose whole
         job is to carry an answer forward faithfully.

         It matters most on `sourceHeading`, and GPT Sol reproduced it:
         `buildTree` counts a heading claim it cannot back into
         `droppedHeadings` from `mn.sourceHeading !== undefined`, and it does
         that deliberately — "a number, or a string of spaces, is a claim this
         stage threw away too, and counting only the well-formed ones would make
         'nothing is repaired quietly' false in exactly the case that says the
         model's output has gone strange". Dropping `""` here made the cascade
         report fewer dropped headings than the incumbent would on identical
         output, silently.

         On `gist` it changes nothing observable today — `buildTree` applies its
         own truthiness a moment later, so an empty gist never reaches a `Tree`
         either way. It is fixed for the same reason regardless: the normaliser
         should not be a second place where a field can disappear, and the two
         behaving alike is what stops the next reader having to check which. */
      ...(proposed.gist !== undefined ? { gist: proposed.gist } : {}),
      /* Carried through unchecked. `buildTree` asks whether a heading block in
         the node's range backs the claim, drops it when nothing does, and
         counts that in `report.droppedHeadings` — asking the same question here
         would be a second opinion that could disagree with the one that ships. */
      ...(proposed.sourceHeading !== undefined
        ? { sourceHeading: proposed.sourceHeading }
        : {}),
    };
    return { node, proposed };
  });

  /* The answer stood up, so what it cost the run goes on the run's books.

     **`collapsedRungs` is deliberately not among them.** That figure counts a
     rung `buildTree` spliced away because its sole child covered the whole of
     it (src/hierarchy.ts § `collapseRestatedRungs`); this function *refuses*
     that answer instead, above, and the asymmetry is the point — a scoped call
     can be re-asked and a whole-document one cannot. So nothing here can ever
     put anything in it. */
  report.repairs.push(...planned.repairs);
  report.droppedChildren.push(...planned.droppedChildren);
  report.droppedHeadings.push(...planned.droppedHeadings);
  /* An expansion writes depth-2 and deeper nodes, where `questionFor` keeps
     none — so this is normally empty. It is carried anyway, because a count
     that is only summed on some paths is a count that means one thing here
     and another there. */
  report.droppedQuestions.push(...planned.droppedQuestions);
  return built;
}

/**
 * **What the answer got wrong, measured against the tiling derived from it.**
 * Separate from the derivation because the plan and the report on the plan are
 * different jobs; nothing here changes what is built.
 *
 * One entry per boundary, never one per child whose range moved — every child's
 * end moves whenever the boundary after it does, and counting children would
 * report one mistake twice.
 *
 * **Measured against the raw claim, never the clamped one.** The clamped value
 * is right for building the tree and wrong for measuring the answer, and this
 * is the number a re-ask would be triggered by and told about. GPT Sol caught
 * `planChildRanges` under-reporting for exactly this reason.
 *
 * The kinds keep their meanings from `PartitionRepair`: the model claimed a
 * boundary *later* than where it ended up, so it left blocks uncovered (`gap`);
 * or earlier, so it claimed blocks belonging to the section before
 * (`overlap`). A boundary the answer got right scores 0 and is not recorded,
 * which is why the guard lives here rather than at each call.
 */
function recordBoundaryFaults(
  kept: readonly { childIndex: number; start: number }[],
  claimed: readonly number[],
  p0: number,
  where: string,
  report: BuildReport,
): void {
  const fault = (childIndex: number, at: number, was: number): void => {
    const size = Math.abs(at - was);
    if (size === 0) return;
    report.repairs.push({
      where: `${where} > child ${childIndex + 1}`,
      kind: was > at ? "gap" : "overlap",
      at,
      size,
    });
  };

  /* The node's own start, against what its first child claimed. The first
     child is pinned here whatever it claimed *inside* the parent, so this is
     the boundary that absorbs an opening claim which began too late — and the
     size is how far. Always a `"gap"`, never an `"overlap"`: a claim below the
     parent's start is refused rather than pinned. */
  const head = kept[0];
  if (head !== undefined) fault(head.childIndex, p0, claimed[head.childIndex]!);

  /* Each interior boundary — **and this is structurally zero today**, kept as
     the standing proof of that rather than as live measurement. There is one
     claim per boundary, and since a start outside the parent is now refused
     rather than clamped, a kept later start is exactly what was claimed;
     everything else either advanced (and was believed) or did not (and was
     dropped). The day this records something is the day an adjustment crept in
     between the claim and the split point, which is the thing worth reporting. */
  for (const child of kept.slice(1)) {
    fault(child.childIndex, child.start, claimed[child.childIndex]!);
  }

  /* There is no closing boundary to check: with no end claims, the last child
     ends at its parent's end by construction, and `"short"` and `"over"` are
     unreachable. See `normaliseExpansion` § "What it cannot report". */
}

/* ------------------------------------------------- the tree, backwards */

/**
 * **A finished tree, back in the shape a proposal has.**
 *
 * Wave 2 plans from the tree wave 1 built: it needs each node's range to slice
 * the evidence, its title and gist to write the ancestor chain, and its
 * `sourceHeading` to know which boundaries the author gave. `Tree` is the stored
 * form — flat, id-keyed, with a leaf per block — and `ModelNode` is the shape
 * every function here and in `buildTree` speaks. This is the one conversion
 * between them, so there is one place for it to be wrong.
 *
 * **The leaf layer is dropped, and that is what makes it lossless rather than
 * lossy.** `buildTree` grows leaves under the deepest internal node from the
 * range alone, so a leaf carries no decision — re-running the build regrows
 * exactly the same ones. Its `navLabel` comes from the separate labels artefact
 * that `buildTree` is handed alongside the proposal, not from the tree, so the
 * labels survive a round trip through the same `navLabels` map. A node with no
 * children *is* a leaf and nothing else: `buildTree` gives every internal node at
 * least one child, whether it recursed or grew leaves.
 *
 * **Point it at the body tree, not at one `appendSupplement` has run over.**
 * A supplement node is an internal node whose children are all leaves, so it
 * comes back as an ordinary childless node with its `treatment: "supplement"`
 * gone — `ModelNode` has nowhere to put it, because the model never proposes
 * one. src/supplement.ts appends that node after the tree is built, and the
 * cascade works on the body, so the case does not arise; it would be a silent
 * loss if it did, which is why it is written down here.
 *
 * **`summary` is dropped too**, for the same reason and with less at stake: it
 * is written by a later stage over the finished tree, not proposed.
 *
 * What is preserved is what a range check cannot see: the internal shape, and
 * the `title`, `gist` and `sourceHeading` on every node. A round trip that kept
 * the ranges and mismatched the titles would produce a tree in which every
 * section is named after its neighbour, and `assertTreeSound` would pass it.
 * tests/hierarchy-cascade.test.ts asserts all four.
 */
export function proposalFromTree(tree: Tree): ModelNode {
  const root = tree.nodes[tree.rootId];
  if (root === undefined) {
    throw new Error(
      `This tree names ${nameValue(tree.rootId)} as its root, and holds no such node.`,
    );
  }
  const visit = (node: TreeNode): ModelNode => {
    const children = node.children
      .map((id) => {
        const child = tree.nodes[id];
        if (child === undefined) {
          throw new Error(
            `The node ${nameValue(node.id)} names a child ${nameValue(id)} this tree does not ` +
              `hold, so the proposal built from it would cover less of the article than the tree.`,
          );
        }
        return child;
      })
      /* Leaves are regrown from the range; see above. `length === 0` is the
         whole test, because `buildTree` never leaves an internal node empty. */
      .filter((child) => child.children.length > 0)
      .map(visit);
    return {
      title: node.title,
      range: [node.range[0], node.range[1]],
      /* **Presence, not truthiness**, the same rule `normaliseExpansion` follows:
         a field the tree carries must not vanish on the way back out, or the
         round trip is lossy in exactly the case that says something has gone
         strange upstream. */
      ...(node.gist !== undefined ? { gist: node.gist } : {}),
      /* **And the question, for exactly the reason above.** Left out of the
         first draft of SPIDERYARN-READING2-1V, and GPT Sol reproduced what that
         cost: four questions before `deepenTree`, zero after it. Deepening any
         one section rebuilds the whole tree through this function, so a field
         missing here is not degraded on the deepened branch — it is gone from
         the article. The rule this paragraph states is the rule; a new field on
         `TreeNode` belongs on this list the day it is added. */
      ...(node.question !== undefined ? { question: node.question } : {}),
      ...(node.sourceHeading !== undefined ? { sourceHeading: node.sourceHeading } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  };
  return visit(root);
}

/* --------------------------------------------------------- completeness */

/**
 * **Was every node the cascade created ever actually asked about?**
 *
 * A different question from `assertTreeSound`, which checks *representation* —
 * that the nodes tile, that ranges run forwards, that every block has a leaf.
 * A cascade that stopped one wave early passes all of that. It has a gist on
 * every internal node, it covers every block, and it is byte-identical in kind
 * to a tree whose governor legitimately stopped there. Publishing it as final
 * is silent success, and publication is all-or-nothing in v1 precisely because
 * there is no reader-facing way to say "this one stopped short".
 *
 * So: no `pending` node may reach `buildTree`. `capReached` nodes are `terminal`
 * and pass, which is the difference between *recorded* and *silent* — the run
 * says which nodes hit the depth cap and over what spans, and stage 1's eval
 * reports it.
 *
 * Names every offender rather than the first, because a cascade that lost a
 * whole wave and one that lost one batch want different next steps, and a
 * message naming one node cannot tell them apart. Positions and block ids only:
 * a title is a sentence the model wrote about the article, and this message
 * reaches the log (docs/project/logging.md § An error is not a safe thing to
 * log whole).
 */
export function assertCascadeComplete(
  state: CascadeState,
  blocks: readonly Block[],
  recipe: CascadeRecipe,
): void {
  const index = indexBlocks(blocks);
  const faults: string[] = [];
  /** Where each `capReached` record says the governor was overruled. */
  const recorded = new Map(state.capReached.map((c) => [c.where, c]));
  const claimedTerminal = new Set<string>();

  /* Positions and block ids only, and the ids through `nameValue`. This message
     reaches src/jobs.ts and is copied onto the job card, and `range` is model
     output behind a cast that need not hold block ids at all — GPT Sol
     reproduced an error carrying a sentence of the article verbatim from the
     version of this line that interpolated it raw. docs/project/logging.md. */
  const name = (where: string, node: CascadeNode): string =>
    `${where} [${nameValue(node.range[0])}…${nameValue(node.range[1])}]`;

  const walk = (node: CascadeNode, where: string): void => {
    /* **Shape as well as status**, because a resumed cascade arrives as JSON
       off a checkpoint and the union above proves nothing about it. Each of
       these was a state the old interface permitted and the old guard passed. */
    switch (node.status) {
      case "pending":
        faults.push(`${name(where, node)} is still awaiting expansion`);
        break;
      case "terminal":
        claimedTerminal.add(where);
        if (shouldExpand(node, blocks, recipe, index) && !recorded.has(where)) {
          /* The one the guard exists for. A node the governor would split,
             marked terminal, with nothing anywhere saying why — indistinguishable
             from a node that legitimately stopped, and worth a whole level of
             the reader's tree. */
          faults.push(
            `${name(where, node)} is marked terminal but holds ` +
              `${structuralBlocksIn(node, blocks, index)} structural block(s) or an unresolved ` +
              `heading, and no capReached record explains it`,
          );
        }
        break;
      case "expanded":
        if (node.children.length < MIN_EXPANSION_CHILDREN) {
          faults.push(
            `${name(where, node)} is marked expanded with ${node.children.length} child(ren); ` +
              `buildTree would grow leaves under it and lose the level`,
          );
        }
        break;
      default:
        faults.push(`${name(where, node)} has an unknown status`);
    }
    for (const [i, child] of (node.children ?? []).entries()) {
      walk(child, `${where} > child ${i + 1}`);
    }
  };
  walk(state.root, "root");

  /* A record naming no terminal node is a record that explains nothing —
     bookkeeping that has drifted from the tree it describes, which is the same
     class of fault as the missing record above and just as invisible. */
  for (const where of recorded.keys()) {
    if (!claimedTerminal.has(where)) {
      faults.push(`a capReached record names ${where}, which is not a terminal node in this tree`);
    }
  }

  if (faults.length > 0) {
    throw new Error(
      `The cascade is not finished: ${faults.length} node(s) were never resolved, so the ` +
        `granularity we asked for was not produced. A tree built now would tile, cover every ` +
        `block and pass every invariant while being short of what was asked. ${faults.join("; ")}.`,
    );
  }
}

/**
 * **The one way to get a buildable tree out of a cascade.**
 *
 * `CascadeNode` is structurally a `ModelNode`, so `buildTree(state.root, …)`
 * compiles and does something plausible — and skips every check above. GPT Sol
 * named that as the reason the guard was not load-bearing: a guard you have to
 * remember is a guard, and a guard on the only road is a contract.
 *
 * So this is the road. It runs the completeness check and hands back the root
 * as the thing `buildTree` wants, and nothing else in this module returns one.
 *
 * A brand on `CascadeNode` would make the shortcut a compile error rather than
 * merely the longer path, and it is not worth it: `normaliseExpansion` returns
 * plain `ModelNode` children by design, so branding would mean a cast at every
 * point where the executor attaches an answer, and a cast is exactly the thing
 * that proves nothing.
 */
export function finaliseCascade(
  state: CascadeState,
  blocks: readonly Block[],
  recipe: CascadeRecipe,
): ModelNode {
  assertCascadeComplete(state, blocks, recipe);
  return state.root;
}
