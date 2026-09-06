/**
 * **The shape corpus** — the gates' cases, as an executable matrix rather than
 * as string literals buried in a test.
 *
 *     npx tsx evals/extraction/shapes.mts            # the matrix, in full
 *     npx tsx evals/extraction/shapes.mts --failures # only what is red
 *
 * ## Why this exists, and what was wrong with what it replaces
 *
 * § B's own diagnosis of the fifteen-fixture corpus: **the hand-built cases were
 * written by whoever was fixing the bug, so they demonstrate a fix rather than
 * sample a space.** A test called *"GPT Sol's ninth review"* tells the next
 * person which review it came from and nothing about which shapes exist beside
 * it. A page called `wrapper-with-a-dropped-child` invites them to ask what else
 * a wrapper can do to its children.
 *
 * So the unit here is the reviewer's:
 * **source shape × candidate transformation × expected gate outcome × expected
 * resolution path**, and every case is named for **the shape**, never for the bug
 * or the review that produced it.
 *
 * ## The part that matters: a green may not be reached by abstention
 *
 * Twice in this harness's history a gate was green because the thing it was meant
 * to judge had been silently dropped — a text run omitted from the alignment, an
 * arm no fixture could exercise — and from outside a skipped run and a placed one
 * look exactly the same. So a case here does not assert `passed`. It asserts:
 *
 * - **which form answered** — a case that fell back to the weak text form has not
 *   exercised what it claims, whatever colour it came out;
 * - **every output node that carried text, by how its stamp resolved**
 *   (`direct` / `ancestor` / `descendant` / `none`), summing to the attribution
 *   gate's own exposure count;
 * - **every text run, by the branch that placed it** (`owner`, `subtreeOnly`,
 *   `page`, `behind`, `unplaceable`, …), summing to the order gate's;
 * - and, where the case is about one, **the mutation that makes it come apart**.
 *
 * An omitted count is a pinned zero, not an unstated one. A case cannot go green
 * by doing nothing, because doing nothing is a number it would have missed.
 *
 * ## Three of these are holes rather than checks
 *
 * `borrowing-under-a-text-free-wrapper`, `a-cell-moved-across-a-row-boundary`
 * and `a-stamped-inline-moved-across-a-list-item-boundary` assert the instrument
 * as it **is**, and all three are things it cannot see. They are here so each
 * hole has a name, a measurement and a witness rather than a sentence in a plan.
 * `hole` marks them and the runner prints them apart from the rest; whether to
 * close any of them is a product decision, not this file's.
 *
 * ## No grammar
 *
 * Both reviewers rejected generating shapes from a grammar first: Readability's
 * transformations are non-local, and most generated DOM would not resemble
 * anything a browser produced. These are explicit, and the argument for a bounded
 * generator afterwards is in the plan.
 *
 * @see [scorecard.mts](scorecard.mts) § `provenanceForm` — what each branch means
 * @see [../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md](../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md) § C0
 */
import { isMain } from "../../src/is-main.js";
import { RESERVED_ATTRS } from "../../src/reserved.js";
import {
  RUN_PLACEMENTS,
  type ProvenanceTally,
  type RunPlacement,
  type Scorecard,
  currentPlacementFloor,
  score,
  withPlacementFloor,
} from "./scorecard.mjs";

const S = RESERVED_ATTRS.sourceRef;

/* ---------------------------------------------------------------- shapes ---- */

/**
 * **What one candidate did to the source** — the matrix's second axis.
 *
 * Named for the operation, because the bounded pairwise generator the plan
 * argues for afterwards is a generator over exactly these: the plan's eight
 * (*wrap, hoist, flatten, split, duplicate, reorder, remove, invent*) plus
 * `verbatim`, which is the control every damaged candidate is read against, and
 * `rewrite`, which is what a model repair pass does and no other name covers.
 */
export type Transformation =
  | "verbatim"
  | "wrap"
  | "hoist"
  | "flatten"
  | "split"
  | "duplicate"
  | "reorder"
  | "remove"
  | "invent"
  | "rewrite";

export interface ShapePage {
  /** Named for the shape of the SOURCE. */
  name: string;
  /** One line: what makes this page's shape worth having. */
  is: string;
  /** The stamped source, as `prepareDocument` would have left it. */
  html: string;
}

/** Omitted keys are pinned zeros, and the totals are checked against the gates. */
type Carriers = Partial<Record<"direct" | "descendant" | "ancestor" | "none", number>>;
type Runs = Partial<Record<RunPlacement, number>>;

export interface ShapeCase {
  /** Named for the SHAPE, never for the bug or the review that produced it. */
  name: string;
  /** Which `ShapePage` this is a candidate for. */
  page: string;
  transformation: Transformation;
  /** The stamped candidate output. */
  candidate: string;
  /** What the two gates must say. `null` is an abstention and must be declared. */
  gates: { attribution: boolean | null; sourceOrder: boolean | null };
  /** A phrase the gate detail must carry, so a red for the wrong reason is red. */
  says?: { attribution?: string; sourceOrder?: string };
  /** Output nodes carrying own text, by resolution. Sums to attribution exposure. */
  carriers: Carriers;
  /** Text runs, by the branch that placed them. Sums to source-order exposure. */
  runs: Runs;
  /** Why the shape is here and what it would cost to lose it. */
  why: string;
  /**
   * **What this case does under a mutation of the instrument**, for the one
   * branch nothing else distinguishes. See `withPlacementFloor`.
   *
   * A **list**, because one entry only proves the shipped constant is not that
   * one value. Entries either side of the boundary pin where the boundary is,
   * and at least one of them has to disagree with the shipped card or the case
   * has stopped distinguishing anything.
   */
  underFloor?: {
    floor: number;
    gates: { attribution: boolean | null; sourceOrder: boolean | null };
    runs: Runs;
  }[];
  /**
   * **Set when the expectation above is a hole rather than a check** — the
   * instrument as it is, not as it should be. The text says what it cannot see.
   */
  hole?: string;
}

/* ------------------------------------------------------------- the pages ---- */

const TAIL = `<p ${S}="s90">Tail tail tail tail</p>`;

export const SHAPE_PAGES: ShapePage[] = [
  {
    name: "stamped-wrapper-with-own-text",
    is: "a stamped container whose own text sits on both sides of a stamped inline child",
    html:
      `<div ${S}="s1">Alpha alpha alpha<i ${S}="s2">Xray xray xray</i>Bravo bravo bravo</div>` +
      TAIL,
  },
  {
    name: "wrapper-with-loose-text-after-its-child",
    is: "a container whose child comes first and whose own loose text comes second",
    html:
      `<div ${S}="s1"><i ${S}="s2">child first</i>loose text second</div>` +
      `<p ${S}="s3">omega omega omega</p>`,
  },
  {
    name: "inline-child-between-two-runs-of-parent-text",
    is: "`See note <a>1</a> above.` — one element's own text in two pieces with a child between",
    html:
      `<p ${S}="s1">See note <a ${S}="s2">1</a> above and below the line.</p>` +
      `<p ${S}="s3">And a second paragraph after it.</p>`,
  },
  {
    name: "wrapper-with-a-child-worth-dropping",
    is: "a container holding prose, an inline child, and a `<button>` an extractor should drop",
    html:
      `<div ${S}="s1">Alpha alpha <i ${S}="s2">Xray xray</i> Bravo bravo ` +
      `<button ${S}="s3">Navigation navigation</button> Charlie charlie</div>` +
      `<p ${S}="s4">Tail tail tail</p><p ${S}="s5">Zulu zulu zulu</p>`,
  },
  {
    name: "wrapper-whose-children-are-all-worth-keeping",
    is: "the same container with nothing in it to drop — the whole-subtree counterpart",
    html:
      `<div ${S}="s1">Alpha alpha <i ${S}="s2">Xray xray</i> Bravo bravo</div>` +
      `<p ${S}="s3">Tail tail tail</p><p ${S}="s4">Zulu zulu zulu</p>`,
  },
  {
    name: "container-that-repeats-its-childs-phrase",
    is: "`<div s1><i s2>Alpha</i>Alpha</div>` — the same words twice, once owned and once not",
    html:
      `<div ${S}="s1"><i ${S}="s2">Alpha alpha alpha</i>Alpha alpha alpha</div>` +
      `<p ${S}="s3">Tail tail tail</p>`,
  },
  {
    name: "container-whose-own-text-repeats-across-a-child",
    is:
      "a container whose own text says the same phrase twice, with three children and its " +
      "own runs interleaved between them",
    html:
      `<div ${S}="s1">Alpha alpha alpha<i ${S}="s2">Xray xray xray</i>` +
      `Bravo bravo bravo<span ${S}="s3">Yankee yankee yankee</span>` +
      `Alpha alpha alpha<em ${S}="s4">Zulu zulu zulu</em></div>`,
  },
  {
    name: "container-whose-own-text-follows-its-child",
    is: "`<div s2><p s3>Alpha first.</p>Middle second.</div>` — position, not membership",
    html:
      `<div ${S}="s2"><p ${S}="s3">Alpha first.</p>Middle second.</div>` +
      `<p ${S}="s4">Omega third.</p>`,
  },
  {
    name: "wrapper-around-two-stamped-children",
    is: "a bare wrapper with no own text and two stamped paragraphs under it",
    html: `<div ${S}="s2"><p ${S}="s3">Alpha.</p><p ${S}="s4">Beta.</p></div>`,
  },
  {
    name: "one-element-holding-two-sentences",
    is: "a single stamped paragraph an extractor may legitimately split in two",
    html:
      `<p ${S}="s1">Alpha alpha alpha Bravo bravo bravo</p>` +
      `<p ${S}="s2">Tail tail tail tail</p>`,
  },
  {
    name: "two-sections-under-own-text-free-wrappers",
    is: "two stamped sections, each of whose text belongs entirely to a stamped child",
    html:
      `<section ${S}="s1"><p ${S}="s2">Alpha alpha alpha alpha</p></section>` +
      `<section ${S}="s3"><p ${S}="s4">Bravo bravo bravo bravo</p></section>` +
      `<section ${S}="s5"><p ${S}="s6">Charlie charlie charlie</p></section>`,
  },
  {
    name: "a-table-with-three-cells-per-row",
    is: "two rows of three cells — the containment question a ruler of text and order cannot ask",
    html:
      `<table ${S}="s1"><tbody ${S}="s2">` +
      `<tr ${S}="s3"><td ${S}="s4">Hour hour hour</td>` +
      `<td ${S}="s5">Speed speed speed</td><td ${S}="s6">Depth depth depth</td></tr>` +
      `<tr ${S}="s7"><td ${S}="s8">Alpha alpha alpha</td>` +
      `<td ${S}="s9">Bravo bravo bravo</td><td ${S}="s10">Charlie charlie ch</td></tr>` +
      `</tbody></table>`,
  },
  {
    name: "a-list-whose-second-item-starts-with-a-stamped-inline",
    is: "two list items, the first ending in a stamped inline the second could steal",
    html:
      `<ul ${S}="s1"><li ${S}="s2">Alpha alpha alpha` +
      `<span ${S}="s3">Bravo bravo bravo</span></li>` +
      `<li ${S}="s4">Charlie charlie ch</li></ul>`,
  },
  {
    name: "text-free-wrapper-after-another-container",
    is:
      "`<div s1><p s2>…</p></div>` — a stamped wrapper with no own text, so `owners` " +
      "has no entry for it at all",
    html:
      `<div ${S}="s8"><p ${S}="s9">Yankee yankee zulu zulu whisky whisky victor</p></div>` +
      `<div ${S}="s1"><p ${S}="s2">Alpha alpha alpha bravo bravo bravo charlie</p></div>` +
      TAIL,
  },
  {
    name: "text-bearing-wrapper-after-another-container",
    is: "the same page with one word of own text on the wrapper — the whole difference",
    html:
      `<div ${S}="s8"><p ${S}="s9">Yankee yankee zulu zulu whisky whisky victor</p></div>` +
      `<div ${S}="s1">Preamble preamble<p ${S}="s2">Alpha alpha alpha bravo bravo charlie</p></div>` +
      TAIL,
  },
  {
    name: "long-container-and-a-phrase-from-elsewhere",
    is:
      "a container of ordinary prose whose letters happen to spell, in order, a phrase " +
      "that belongs to a different container",
    html:
      `<p ${S}="s8">Everything below concerns the clerk and his margins, and nothing else.</p>` +
      `<div ${S}="s1">The lantern makers of the old quarter kept a ledger of every wick they ` +
      `sold, and the ledger survives because a clerk with more patience than sense copied it ` +
      `twice, once in a hand nobody can read and once in a hand that everybody can. ` +
      `<em ${S}="s2">What the second copy shows is a trade in slow decline, priced in ` +
      `shillings, measured in evenings, and argued about in the margins by two men who ` +
      `plainly disliked each other a great deal.</em></div>` +
      TAIL,
  },
];

const pageNamed = (name: string): ShapePage => {
  const page = SHAPE_PAGES.find((p) => p.name === name);
  if (!page) throw new Error(`no shape page named ${JSON.stringify(name)}`);
  return page;
};

/** The source page, verbatim — the control every damaged candidate is read against. */
export const shapePage = (name: string): string => pageNamed(name).html;

/**
 * **One named candidate's HTML.** Exported so that a test asserting something
 * this matrix does not — how `detects` reads a pair, say — names the shape rather
 * than repeating its markup, and so each shape has exactly one definition.
 */
export const shapeCandidate = (name: string): string => {
  const c = SHAPE_CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no shape case named ${JSON.stringify(name)}`);
  return c.candidate;
};

/** Which page a named case is a candidate for. */
export const shapeCasePage = (name: string): string => {
  const c = SHAPE_CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no shape case named ${JSON.stringify(name)}`);
  return c.page;
};

/* ------------------------------------------------------------- the cases ---- */

export const SHAPE_CASES: ShapeCase[] = [
  /* -- 1. a generated node under a stamped wrapper -------------------------- */
  {
    name: "generated-node-carrying-its-wrappers-own-text",
    page: "stamped-wrapper-with-own-text",
    transformation: "wrap",
    candidate:
      `<div ${S}="s1"><p>Alpha alpha alpha</p><i ${S}="s2">Xray xray xray</i>` +
      `Bravo bravo bravo</div>${TAIL}`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3, ancestor: 1 },
    runs: { owner: 4 },
    why:
      "The baseline `ancestor` resolution: Readability wraps a container's leading own text " +
      "in a paragraph of its own. Nothing moved and nothing was dropped, so the run is placed " +
      "by its owner and both gates must be green — and the run must be IN the alignment, which " +
      "`runs.owner: 4` is what says.",
  },
  {
    name: "generated-node-moved-in-front-of-its-wrappers-child",
    page: "stamped-wrapper-with-own-text",
    transformation: "reorder",
    candidate:
      `<div ${S}="s1"><i ${S}="s2">Xray xray xray</i><p>Alpha alpha alpha</p>` +
      `Bravo bravo bravo</div>${TAIL}`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 3, ancestor: 1 },
    runs: { owner: 3, behind: 1 },
    why:
      "The same wrap, moved. Nothing is invented, so attribution cannot see it; the order gate " +
      "has to, and it has to see it on the GENERATED node rather than on the stamped ones — " +
      "`runs.behind: 1` is that node and no other.",
  },

  /* -- 2. a generated wrapper with loose own text AND a stamped descendant --- */
  {
    name: "generated-wrapper-with-loose-text-and-a-stamped-descendant",
    page: "wrapper-with-loose-text-after-its-child",
    transformation: "verbatim",
    candidate:
      `<div ${S}="s1"><i ${S}="s2">child first</i>loose text second</div>` +
      `<p ${S}="s3">omega omega omega</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    why:
      "The control the next case is read against. On the source itself every carrier resolves " +
      "`direct`; it is the transformation that mints the `descendant`.",
  },
  {
    name: "loose-wrapper-text-hoisted-in-front-of-its-child",
    page: "wrapper-with-loose-text-after-its-child",
    transformation: "hoist",
    candidate:
      `<p>loose text second<i ${S}="s2">child first</i></p>` +
      `<p ${S}="s3">omega omega omega</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 2, descendant: 1 },
    runs: { page: 1, behind: 1, owner: 1 },
    why:
      "A generated wrapper that contains a stamped child resolves `descendant`, and a " +
      "descendant has no owner — its loose text is matched against the whole page, which is " +
      "`runs.page: 1`. Until 2026-09-06 that run never entered the order coordinate at all and " +
      "this candidate produced a card IDENTICAL to the one above.",
  },

  /* -- 3. a retained inline child between two runs of parent-owned text ----- */
  {
    name: "inline-child-retained-between-two-runs-of-parent-text",
    page: "inline-child-between-two-runs-of-parent-text",
    transformation: "verbatim",
    candidate:
      `<p ${S}="s1">See note <a ${S}="s2">1</a> above and below the line.</p>` +
      `<p ${S}="s3">And a second paragraph after it.</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 4 },
    why:
      "The counterpart to the removal below, and the shape that cost 33 false reds on " +
      "`pg-greatwork` when it was got wrong. `s1`'s own text is TWO runs with the link's text " +
      "between them — `runs.owner: 4` for three elements is what says both were judged, and an " +
      "order rule that treats the paragraph as one position gets one of the two directions wrong.",
  },
  {
    name: "inline-child-removed-joining-its-neighbours-text",
    page: "inline-child-between-two-runs-of-parent-text",
    transformation: "remove",
    candidate:
      `<p ${S}="s1">See note  above and below the line.</p>` +
      `<p ${S}="s3">And a second paragraph after it.</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 2 },
    runs: { owner: 2 },
    why:
      "Removing an inline child joins its neighbours' text into one run, and that is a correct " +
      "extraction rather than a reordering. Without this case the two directions of the " +
      "retained shape both pass under a rule that condemns every legitimate inline removal on " +
      "the corpus.",
  },
  {
    name: "inline-child-moved-to-the-front-of-its-parent",
    page: "inline-child-between-two-runs-of-parent-text",
    transformation: "reorder",
    candidate:
      `<p ${S}="s1"><a ${S}="s2">1</a>See note  above and below the line.</p>` +
      `<p ${S}="s3">And a second paragraph after it.</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "out of order" },
    carriers: { direct: 3 },
    runs: { owner: 2, behind: 1 },
    why: "The other direction of the same shape: the child moved rather than removed.",
  },

  /* -- 4. partial flattening, against a wholly flattened subtree ------------ */
  {
    name: "partial-flattening-with-one-child-dropped",
    page: "wrapper-with-a-child-worth-dropping",
    transformation: "flatten",
    candidate:
      `<div ${S}="s1"><p>Alpha alpha Xray xray Bravo bravo Charlie charlie</p></div>` +
      `<p ${S}="s4">Tail tail tail</p><p ${S}="s5">Zulu zulu zulu</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 2, subtreeOnly: 1 },
    why:
      "**The `ancestor`-cannot-supply branch, fired.** The flattened run is neither `s1`'s own " +
      "text (no `Xray`) nor a substring of `s1`'s subtree (which still has `Navigation`), so " +
      "the owner cannot place it and the subtree cover must — `runs.subtreeOnly: 1`. That " +
      "branch fires ZERO times across the fifteen shipped extractions, which is why it needs a " +
      "shape rather than a fixture. Until 2026-09-06 this correct extraction was scored red.",
  },
  {
    name: "partially-flattened-run-moved-after-the-paragraph-that-followed-it",
    page: "wrapper-with-a-child-worth-dropping",
    transformation: "reorder",
    candidate:
      `<p ${S}="s4">Tail tail tail</p>` +
      `<div ${S}="s1"><p>Alpha alpha Xray xray Bravo bravo Charlie charlie</p></div>` +
      `<p ${S}="s5">Zulu zulu zulu</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 2, behindSubtree: 1 },
    why:
      "The loosening above is a loosening of the MATCH, not of the PLACE. Moved, the same run " +
      "must still be red, and by the subtree's own diagnosis — `runs.behindSubtree: 1`.",
  },
  {
    name: "retained-children-scrambled-inside-a-flattened-run",
    page: "wrapper-with-a-child-worth-dropping",
    transformation: "reorder",
    candidate:
      `<div ${S}="s1"><p>Bravo bravo Alpha alpha Xray xray Charlie charlie</p></div>` +
      `<p ${S}="s4">Tail tail tail</p><p ${S}="s5">Zulu zulu zulu</p>`,
    gates: { attribution: false, sourceOrder: false },
    says: { attribution: "nowhere on the page", sourceOrder: "could not be placed" },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 2, unplaceable: 1 },
    why:
      "A cover is a subsequence IN ORDER, so the placement permits deletion and never " +
      "rearrangement. Both gates redden, from their own ends, and that is deliberate rather " +
      "than duplicated: if a change ever leaves only one of them red, the other has stopped " +
      "asking.",
  },
  {
    name: "wholly-flattened-subtree",
    page: "wrapper-whose-children-are-all-worth-keeping",
    transformation: "flatten",
    candidate:
      `<div ${S}="s1"><p>Alpha alpha Xray xray Bravo bravo</p></div>` +
      `<p ${S}="s3">Tail tail tail</p><p ${S}="s4">Zulu zulu zulu</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 2, subtreeOnly: 1 },
    why:
      "The counterpart to the partial flattening: nothing dropped, so the run is the whole " +
      "subtree. It takes the same branch, which is the point of having both — a fix that " +
      "happened to work only for the whole-subtree case would pass here and fail above.",
  },
  {
    name: "wholly-flattened-subtree-moved",
    page: "wrapper-whose-children-are-all-worth-keeping",
    transformation: "reorder",
    candidate:
      `<p ${S}="s3">Tail tail tail</p>` +
      `<div ${S}="s1"><p>Alpha alpha Xray xray Bravo bravo</p></div>` +
      `<p ${S}="s4">Zulu zulu zulu</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 2, behindSubtree: 1 },
    why:
      "Moving a whole flattened subtree used to produce a card IDENTICAL to the correct one: " +
      "the run could be placed by neither the owner nor an exact subtree match, and the caller " +
      "dropped it in silence on the assumption attribution had rejected it. Attribution judges " +
      "a generated node against the whole page, so it had passed it.",
  },
  {
    name: "generated-node-borrowing-a-container-it-does-not-descend-from",
    page: "wrapper-whose-children-are-all-worth-keeping",
    transformation: "invent",
    candidate:
      `<div ${S}="s1"><p>Tail tail tail</p></div><p ${S}="s4">Zulu zulu zulu</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "the subtree of source element s1" },
    carriers: { direct: 1, ancestor: 1 },
    runs: { owner: 1, unplaceable: 1 },
    why:
      "The half of the old rule that stands: the subtree is the PLACE, and loosening the match " +
      "must not loosen it. The borrowed words are genuinely on the page, so attribution passes " +
      "and cannot be what catches this.",
  },

  {
    name: "generated-node-placed-at-the-earliest-of-two-identical-phrases",
    page: "container-that-repeats-its-childs-phrase",
    transformation: "wrap",
    candidate:
      `<div ${S}="s1"><p>Alpha alpha alpha</p>Alpha alpha alpha</div>` +
      `<p ${S}="s3">Tail tail tail</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 2, subtreeEarlier: 1 },
    why:
      "**The one case that fires `subtreeEarlier`**, and the reason the greedy rule is stated " +
      "over the END of a placement rather than its start. `s1`'s own text is the SECOND " +
      "`Alpha alpha alpha`; the first belongs to its child. Matching the generated node against " +
      "its owner first put it at the later occurrence and left the direct run behind it with " +
      "nowhere to go — a reordering reported on a page nobody had reordered.",
  },
  {
    name: "container-repeating-its-childs-phrase-moved",
    page: "container-that-repeats-its-childs-phrase",
    transformation: "reorder",
    candidate:
      `<p ${S}="s3">Tail tail tail</p>` +
      `<div ${S}="s1"><p>Alpha alpha alpha</p>Alpha alpha alpha</div>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 2, ancestor: 1 },
    runs: { owner: 1, behind: 2 },
    why: "The control's damaged twin, so the green above is not a page that is green whatever.",
  },
  {
    name: "container-repeating-a-phrase-across-a-child-extracted-whole",
    page: "container-whose-own-text-repeats-across-a-child",
    transformation: "verbatim",
    candidate: shapePage("container-whose-own-text-repeats-across-a-child"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 4 },
    runs: { owner: 6 },
    why:
      "The control for the restructuring below, and it is where the interleaving is visible: one " +
      "container contributes THREE of the six runs, which is the thing an order rule that treats " +
      "an element as one position cannot represent.",
  },
  {
    name: "generated-p-wrapping-a-child-and-the-text-either-side-of-it",
    page: "container-whose-own-text-repeats-across-a-child",
    transformation: "wrap",
    candidate:
      `<div ${S}="s1"><p>Alpha alpha alpha<i ${S}="s2">Xray xray xray</i>` +
      `Bravo bravo bravo</p><span ${S}="s3">Yankee yankee yankee</span>` +
      `Alpha alpha alpha<em ${S}="s4">Zulu zulu zulu</em></div>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 4, descendant: 1 },
    runs: { owner: 4, page: 2 },
    why:
      "A restructuring that reads identically — `Alpha… Xray… Bravo… Yankee… Alpha… Zulu` " +
      "either way — over a container that says `Alpha alpha alpha` twice. With the wrapper's " +
      "runs skipped, the final direct `Alpha` resolved to the FIRST identical one, behind the " +
      "already-consumed `Yankee`, and the gate failed a correct page. A monotone alignment lets " +
      "a retained second occurrence take the second occurrence, which is why the question is " +
      "asked globally rather than per element.",
  },
  {
    name: "container-own-text-moved-in-front-of-its-child",
    page: "container-whose-own-text-follows-its-child",
    transformation: "reorder",
    candidate:
      `<div ${S}="s2">Middle second.<p ${S}="s3">Alpha first.</p></div>` +
      `<p ${S}="s4">Omega third.</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 3 },
    runs: { owner: 2, behind: 1 },
    why:
      "`ownTextOf` concatenates an element's direct text nodes and throws away where they sit " +
      "among its children, so this changed the article from *Alpha, Middle, Omega* to " +
      "*Middle, Alpha, Omega* while every metric read 1.00 and both gates passed over four " +
      "nodes. The position was not in the representation at all.",
  },
  {
    name: "container-own-text-kept-after-its-child",
    page: "container-whose-own-text-follows-its-child",
    transformation: "verbatim",
    candidate: shapePage("container-whose-own-text-follows-its-child"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    why: "The control for the move above.",
  },
  {
    name: "wrapper-around-two-stamped-children-kept-whole",
    page: "wrapper-around-two-stamped-children",
    transformation: "verbatim",
    candidate: shapePage("wrapper-around-two-stamped-children"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 2 },
    runs: { owner: 2 },
    why: "The control for the hoist below.",
  },
  {
    name: "first-child-hoisted-out-of-its-wrapper",
    page: "wrapper-around-two-stamped-children",
    transformation: "hoist",
    candidate:
      `<p ${S}="s3">Alpha.</p><div ${S}="s2"><p ${S}="s4">Beta.</p></div>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 2 },
    runs: { owner: 2 },
    why:
      "**A hard gate used to accept stage C must not outlaw the restructuring stage C does.** " +
      "The rule this replaced compared the stamps of containers and called this a reordering, " +
      "on a transform that changes nothing a reader sees. Under a text-run coordinate the " +
      "wrapper contributes no run of its own, so it is not in the order at all.",
  },

  /* -- 5 and 6. one element split, against one element said twice ----------- */
  {
    name: "one-element-split-into-two-nodes-in-order",
    page: "one-element-holding-two-sentences",
    transformation: "split",
    candidate:
      `<p ${S}="s1">Alpha alpha alpha</p><p ${S}="s1">Bravo bravo bravo</p>` +
      `<p ${S}="s2">Tail tail tail tail</p>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    why:
      "A legitimate split: two output nodes wearing one stamp, each saying a different part of " +
      "what that element said, in the element's own order. The duplication rule keys on " +
      "`(id, own text)` precisely so this stays green while the next case does not.",
  },
  {
    name: "one-element-split-into-two-nodes-reversed",
    page: "one-element-holding-two-sentences",
    transformation: "reorder",
    candidate:
      `<p ${S}="s1">Bravo bravo bravo</p><p ${S}="s1">Alpha alpha alpha</p>` +
      `<p ${S}="s2">Tail tail tail tail</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 3 },
    runs: { owner: 2, behind: 1 },
    why:
      "The same split, emitted right before left. Every text measure ever written here calls " +
      "this unharmed — both halves are present, both are the element's own words, and neither " +
      "was invented. Only the cursor sees it.",
  },
  {
    name: "one-element-said-twice",
    page: "one-element-holding-two-sentences",
    transformation: "duplicate",
    candidate:
      `<p ${S}="s1">Alpha alpha alpha Bravo bravo bravo</p>` +
      `<p ${S}="s1">Alpha alpha alpha Bravo bravo bravo</p>` +
      `<p ${S}="s2">Tail tail tail tail</p>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "says the same thing twice" },
    carriers: { direct: 3 },
    runs: { owner: 2, behind: 1 },
    why:
      "Contrasted with the split above, and that contrast is the whole reason the duplication " +
      "rule cannot be `two nodes claimed one id`. A membership test cannot see a repeat at all; " +
      "a monotone alignment alone cannot either, because a second copy simply takes the next " +
      "occurrence where the source has one.",
  },

  /* -- 7. own-text-free wrappers reordered across source ids ---------------- */
  {
    name: "own-text-free-wrappers-reordered-across-source-ids",
    page: "two-sections-under-own-text-free-wrappers",
    transformation: "reorder",
    candidate:
      `<section ${S}="s5"><p ${S}="s6">Charlie charlie charlie</p></section>` +
      `<section ${S}="s3"><p ${S}="s4">Bravo bravo bravo bravo</p></section>` +
      `<section ${S}="s1"><p ${S}="s2">Alpha alpha alpha alpha</p></section>`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "a reordering" },
    carriers: { direct: 3 },
    runs: { owner: 1, behind: 2 },
    why:
      "Sections reversed, where the wrappers themselves carry no text — so nothing about the " +
      "wrapper is judged and the whole question falls on the stamped children. Reads as a " +
      "coherent article and scores perfectly on every text measure.",
  },
  {
    name: "own-text-free-wrappers-kept-in-order",
    page: "two-sections-under-own-text-free-wrappers",
    transformation: "verbatim",
    candidate: shapePage("two-sections-under-own-text-free-wrappers"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    why: "The control. Without it the red above could be a page that is red whatever you do.",
  },

  /* -- 8. a directly stamped node whose text was rewritten ------------------ */
  {
    name: "directly-stamped-node-whose-text-was-rewritten",
    page: "one-element-holding-two-sentences",
    transformation: "rewrite",
    candidate:
      `<p ${S}="s1">Alpha alpha alpha Kestrel kestrel kestrel</p>` +
      `<p ${S}="s2">Tail tail tail tail</p>`,
    gates: { attribution: false, sourceOrder: false },
    says: { attribution: "did not say", sourceOrder: "could not be placed" },
    carriers: { direct: 2 },
    runs: { owner: 1, unplaceable: 1 },
    why:
      "**The thing a model repair pass does**, and the thing the whole-page text form cannot " +
      "see: the node kept its identity and its words changed. Both gates redden, and the order " +
      "gate's message names invention as one of the two possibilities rather than asserting it.",
  },

  /* -- 9. entirely unstamped invented output -------------------------------- */
  {
    name: "entirely-unstamped-invented-output",
    page: "one-element-holding-two-sentences",
    transformation: "invent",
    candidate:
      "<p>Kestrel kestrel kestrel marram marram</p><p>Wolfram wolfram wolfram sedge sedge</p>",
    gates: { attribution: false, sourceOrder: false },
    says: { attribution: "this node was fabricated", sourceOrder: "could not be placed" },
    carriers: { none: 2 },
    runs: { unplaceable: 2 },
    why:
      "The floor of the matrix, and the one resolution nothing else here exercises: `none`. A " +
      "collage of real page text passes every text measure; text the page never had must not " +
      "pass the resolution check either, and `carriers.none: 2` is what says the check ran.",
  },

  {
    name: "unstamped-output-copied-verbatim-from-the-page",
    page: "one-element-holding-two-sentences",
    transformation: "invent",
    candidate:
      "<p>Alpha alpha alpha Bravo bravo bravo</p><p>Tail tail tail tail</p>",
    gates: { attribution: false, sourceOrder: true },
    says: { attribution: "this node was fabricated" },
    carriers: { none: 2 },
    runs: { page: 2 },
    why:
      "**Provenance failing on its own, with the order gate green beside it.** The case above " +
      "fails both gates, so it cannot show that the resolution check is doing the work rather " +
      "than the invention check — here the words are the page's own, in the page's own order, and " +
      "only the missing stamps are wrong. GPT Sol's fifth finding, and he is right that it is a " +
      "combination rather than a branch: `carriers.none: 2` with `runs.page: 2` is the pair.",
  },

  /* -- 10. text moved across a containment boundary ------------------------- */
  {
    name: "a-cell-moved-across-a-row-boundary",
    page: "a-table-with-three-cells-per-row",
    transformation: "reorder",
    candidate:
      `<table ${S}="s1"><tbody ${S}="s2">` +
      `<tr ${S}="s3"><td ${S}="s4">Hour hour hour</td>` +
      `<td ${S}="s5">Speed speed speed</td></tr>` +
      `<tr ${S}="s7"><td ${S}="s6">Depth depth depth</td>` +
      `<td ${S}="s8">Alpha alpha alpha</td>` +
      `<td ${S}="s9">Bravo bravo bravo</td><td ${S}="s10">Charlie charlie ch</td></tr>` +
      `</tbody></table>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 6 },
    runs: { owner: 6 },
    hole:
      "BOTH GATES PASS AND THE DATUM IS IN THE WRONG ROW. Global leaf order is unchanged and " +
      "every leaf is still its own source element's, so a ruler made of text and order has " +
      "nothing to say — row widths are 2 and 4 rather than 3 and 3. Recorded rather than " +
      "fixed: it wants a containment oracle over the ancestor path, which is stage C2.",
    why:
      "The blind spot, with a name and a witness. A green card on a table-bearing page may not " +
      "be quoted as evidence about that table, and this is the case that says why.",
  },

  {
    name: "a-stamped-inline-moved-across-a-list-item-boundary",
    page: "a-list-whose-second-item-starts-with-a-stamped-inline",
    transformation: "reorder",
    candidate:
      `<ul ${S}="s1"><li ${S}="s2">Alpha alpha alpha</li>` +
      `<li ${S}="s4"><span ${S}="s3">Bravo bravo bravo</span>Charlie charlie ch</li></ul>`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    hole:
      "THE SAME BLIND SPOT AS THE TABLE ROW, AND IT IS NOT ABOUT TABLES. `Bravo` now belongs to " +
      "the second list item; global text order is unchanged and every run is still its own " +
      "element's, so both gates pass. Two shapes rather than one, because a containment oracle " +
      "written for `<tr>`/`<td>` would leave this exactly where it is.",
    why:
      "The generalisation of the row case: the gates measure text and order, and neither is a " +
      "claim about which container a thing ended up in.",
  },
  {
    name: "a-list-extracted-with-its-items-intact",
    page: "a-list-whose-second-item-starts-with-a-stamped-inline",
    transformation: "verbatim",
    candidate: shapePage("a-list-whose-second-item-starts-with-a-stamped-inline"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    why:
      "The control, and here it is doing real work: the card for the correct list and the card " +
      "for the broken one are IDENTICAL, which is what the hole above means.",
  },

  {
    name: "a-table-extracted-with-its-rows-intact",
    page: "a-table-with-three-cells-per-row",
    transformation: "verbatim",
    candidate: shapePage("a-table-with-three-cells-per-row"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 6 },
    runs: { owner: 6 },
    why:
      "The control the row case needs, and it is the demonstration rather than a formality: this " +
      "card and the moved one agree on both gates AND on both exposure counts. The gates cannot " +
      "tell a correct table from a broken one.",
  },

  /* -- 11. the placement floor ---------------------------------------------- */
  {
    name: "borrowed-phrase-spelled-out-by-the-subtree",
    page: "long-container-and-a-phrase-from-elsewhere",
    transformation: "invent",
    candidate: `<div ${S}="s1"><p>the clerk and his margins</p></div>${TAIL}`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "the subtree of source element s1" },
    carriers: { direct: 1, ancestor: 1 },
    runs: { owner: 1, unplaceable: 1 },
    underFloor: [
      /* **Where the boundary actually is, measured 2026-09-06 at floors 1–12.**
         Green at 1 and 2, red at 3 and above — so this case rejects a floor of 1
         or 2 and says nothing about 3 through 8. GPT Sol's third finding: the
         first version of this comment claimed only "not 1", which understated
         what the case already proved. */
      { floor: 1, gates: { attribution: true, sourceOrder: true }, runs: { owner: 1, subtreeOnly: 1 } },
      { floor: 2, gates: { attribution: true, sourceOrder: true }, runs: { owner: 1, subtreeOnly: 1 } },
      { floor: 3, gates: { attribution: true, sourceOrder: false }, runs: { owner: 1, unplaceable: 1 } },
    ],
    why:
      "**The one shape that pins `placeInSpan`'s run floor**, which until 2026-09-06 was pinned " +
      "by nothing: dropping it from 8 to 1 left all 66 cases in the scorer test green while six " +
      "other mutations of the same branch were each caught.\n" +
      "\n" +
      "A generated node under `s1` says a phrase that belongs to `s8`. Attribution cannot see " +
      "it — the words are genuinely on the page — so the subtree boundary is the only thing " +
      "between this output and a green. At floor 8 `s1`'s subtree cannot cover the phrase in " +
      "runs of eight, and the gate reddens. At floor 1 the cover is a bare character " +
      "subsequence, and 342 characters of ordinary prose about lanterns and ledgers happen to " +
      "spell `theclerkandhismargins` letter by letter, in order — so the boundary evaporates " +
      "and the same borrowing goes green. **The floor is what makes the subtree a boundary " +
      "rather than an alphabet.**",
  },

  {
    name: "long-container-and-its-neighbour-extracted-whole",
    page: "long-container-and-a-phrase-from-elsewhere",
    transformation: "verbatim",
    candidate: shapePage("long-container-and-a-phrase-from-elsewhere"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 4 },
    runs: { owner: 4 },
    why:
      "The control for the floor case. A red proves nothing unless the same page has been seen " +
      "green: without this, `borrowed-phrase-spelled-out-by-the-subtree` could be red because " +
      "the page is red whatever you do to it.",
  },

  /* -- 12. the ownerless ancestor ------------------------------------------- */
  {
    name: "borrowing-under-a-text-bearing-wrapper",
    page: "text-bearing-wrapper-after-another-container",
    transformation: "invent",
    candidate:
      `<div ${S}="s1"><p>Yankee yankee zulu zulu whisky whisky victor</p></div>${TAIL}`,
    gates: { attribution: true, sourceOrder: false },
    says: { sourceOrder: "the subtree of source element s1" },
    carriers: { direct: 1, ancestor: 1 },
    runs: { owner: 1, unplaceable: 1 },
    why:
      "The half that works, and the control for the hole below. One word of own text on the " +
      "wrapper is the whole difference between this red and that green.",
  },
  {
    name: "text-bearing-wrapper-extracted-correctly",
    page: "text-bearing-wrapper-after-another-container",
    transformation: "verbatim",
    candidate: shapePage("text-bearing-wrapper-after-another-container"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 4 },
    runs: { owner: 4 },
    why:
      "The control for the caught borrowing, and the pair that makes the hole below legible: " +
      "these two pages differ by two words of own text on one wrapper, and nothing else.",
  },
  {
    name: "borrowing-under-a-text-free-wrapper",
    page: "text-free-wrapper-after-another-container",
    transformation: "invent",
    candidate:
      `<div ${S}="s1"><p>Yankee yankee zulu zulu whisky whisky victor</p></div>${TAIL}`,
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 1, ancestor: 1 },
    runs: { page: 1, owner: 1 },
    hole:
      "BOTH GATES PASS ON A GENERATED NODE SAYING WHAT A DIFFERENT CONTAINER SAID. `owners` is " +
      "populated only from text nodes, so a wrapper with no own text has no `Ownership` at all, " +
      "`placeRun` takes its ownerless branch, and the run is placed anywhere on the page — " +
      "`runs.page: 1` on a node that carries a stamp is the anomaly, and `ownerlessStamped` " +
      "counts it. Compare `borrowing-under-a-text-bearing-wrapper`, which is the SAME " +
      "borrowing and is caught. Tightening it to the subtree is a few lines and a behaviour " +
      "change with false-red risk, so it is measured rather than slipped in.",
    why:
      "A known hole, pinned as it stands so that closing it is a visible decision rather than " +
      "an accident, and so that nobody quotes a green order gate over a page whose wrappers " +
      "carry no text of their own.",
  },
  {
    name: "text-free-wrapper-extracted-correctly",
    page: "text-free-wrapper-after-another-container",
    transformation: "verbatim",
    candidate: shapePage("text-free-wrapper-after-another-container"),
    gates: { attribution: true, sourceOrder: true },
    carriers: { direct: 3 },
    runs: { owner: 3 },
    why:
      "The control for the hole: on a correct extraction of the same page every run is placed " +
      "by an owner and nothing is ownerless, so `runs.page: 0` — which is what makes the `1` " +
      "above mean something.",
  },
];

/* ------------------------------------------------------------- the runner ---- */

export interface ShapeVerdict {
  case: ShapeCase;
  ok: boolean;
  problems: string[];
  card: Scorecard;
}

/** The candidate with its stamps taken off — what stage 3 would be handed. */
const unstamped = (html: string): string =>
  html.replace(new RegExp(` ${S}="[^"]*"`, "g"), "");

export function cardFor(page: string, candidate: string, arm: string): Scorecard {
  return score({
    fixture: `shape:${page}`,
    arm,
    html: unstamped(candidate),
    stampedHtml: candidate,
    refused: false,
    title: null,
    byline: null,
    sourceHtml: `<body>${shapePage(page)}</body>`,
    manifest: null,
  });
}

function pinned<K extends string>(
  what: string,
  want: Partial<Record<K, number>>,
  got: Record<K, number>,
  keys: readonly K[],
  total: number,
  problems: string[],
): void {
  for (const k of keys) {
    const wanted = want[k] ?? 0;
    if (got[k] !== wanted) {
      problems.push(`${what}.${k}: ${got[k]}, and the case pins ${wanted}`);
    }
  }
  const sum = keys.reduce((n, k) => n + got[k], 0);
  if (sum !== total) {
    problems.push(
      `${what} sums to ${sum} but the gate's own exposure count is ${total} — the census and ` +
        "the gate disagree, which is an instrument bug rather than a bad case",
    );
  }
}

function checkGate(
  name: "attribution" | "sourceOrder",
  card: Scorecard,
  want: boolean | null,
  says: string | undefined,
  problems: string[],
): void {
  const got = card.gates[name];
  if (got.passed !== want) {
    problems.push(`${name}: ${got.passed}, and the case expects ${want} — ${got.detail}`);
  }
  if (says !== undefined && !got.detail.includes(says)) {
    problems.push(`${name} says ${JSON.stringify(got.detail)}, which does not carry ${JSON.stringify(says)}`);
  }
}

const CARRIER_KEYS = ["direct", "descendant", "ancestor", "none"] as const;

function checkTally(
  card: Scorecard,
  carriers: Carriers,
  runs: Runs,
  problems: string[],
): void {
  const t: ProvenanceTally = card.placements;
  /**
   * **A case that fell back to the weak text form has exercised nothing it
   * claims.** From outside that is a card with two verdicts on it, exactly like
   * a real one — which is the abstention-shaped green this corpus exists to
   * refuse.
   */
  if (t.form !== "provenance") {
    problems.push(`the ${t.form} form answered — this case never reached the provenance gates`);
    return;
  }
  pinned("carriers", carriers, t.carriers, CARRIER_KEYS, card.gates.attribution.exercised, problems);
  pinned("runs", runs, t.runs, RUN_PLACEMENTS, card.gates.sourceOrder.exercised, problems);
}

export function runShape(c: ShapeCase): ShapeVerdict {
  const problems: string[] = [];
  if (currentPlacementFloor() !== 8) {
    problems.push(
      `the placement floor is ${currentPlacementFloor()} before this case ran — something left ` +
        "`withPlacementFloor` mutated, and every verdict after it is about a different instrument",
    );
  }
  const card = cardFor(c.page, c.candidate, c.name);
  checkGate("attribution", card, c.gates.attribution, c.says?.attribution, problems);
  checkGate("sourceOrder", card, c.gates.sourceOrder, c.says?.sourceOrder, problems);
  checkTally(card, c.carriers, c.runs, problems);

  if (c.underFloor) {
    let anyDiffered = false;
    for (const at of c.underFloor) {
      const mutated = withPlacementFloor(at.floor, () =>
        cardFor(c.page, c.candidate, `${c.name}@floor${at.floor}`),
      );
      for (const g of ["attribution", "sourceOrder"] as const) {
        if (mutated.gates[g].passed !== at.gates[g]) {
          problems.push(
            `at floor ${at.floor} ${g} is ${mutated.gates[g].passed}, and the case ` +
              `expects ${at.gates[g]} — ${mutated.gates[g].detail}`,
          );
        }
      }
      if (mutated.placements.form === "provenance") {
        pinned(
          `runs@floor${at.floor}`, at.runs, mutated.placements.runs,
          RUN_PLACEMENTS, mutated.gates.sourceOrder.exercised, problems,
        );
      }
      if (
        mutated.gates.attribution.passed !== card.gates.attribution.passed ||
        mutated.gates.sourceOrder.passed !== card.gates.sourceOrder.passed
      ) {
        anyDiffered = true;
      }
      if (currentPlacementFloor() !== 8) {
        problems.push(`the placement floor was left at ${currentPlacementFloor()} after floor ${at.floor}`);
      }
    }
    /**
     * **A mutation that changes nothing has pinned nothing.** The whole reason
     * this case exists is that the shipped floor and floor 1 were
     * indistinguishable; a case whose cards all agree with the shipped one has
     * quietly gone back to being that.
     */
    if (!anyDiffered) {
      problems.push(
        `moving the placement floor to ${c.underFloor.map((f) => f.floor).join(", ")} changed ` +
          "neither gate at any of them — this case no longer distinguishes the floor it pins",
      );
    }
  }
  return { case: c, ok: problems.length === 0, problems, card };
}

export function runShapeCorpus(): ShapeVerdict[] {
  const seen = new Set<string>();
  for (const c of SHAPE_CASES) {
    if (seen.has(c.name)) throw new Error(`two shape cases named ${JSON.stringify(c.name)}`);
    seen.add(c.name);
    /* A case naming a page that does not exist would otherwise throw deep inside
       `score`, where it reads as a scorer bug. */
    shapePage(c.page);
  }
  /**
   * **A source shape no candidate exercises is this repository's signature
   * failure**, arriving one level up: 260827ab's "zero regressions across
   * fourteen pages" was an arm the corpus could not run, and `first-20-percent`
   * came back *not exercised on any fixture* for a year. A page here with no
   * case is the same claim about an empty set.
   */
  const unexercised = SHAPE_PAGES.filter((p) => !SHAPE_CASES.some((c) => c.page === p.name));
  if (unexercised.length) {
    throw new Error(
      `shape page(s) with no candidate: ${unexercised.map((p) => p.name).join(", ")} — a source ` +
        "shape nothing is a candidate for is a claim about an empty set",
    );
  }
  return SHAPE_CASES.map(runShape);
}

/* ---------------------------------------------------------------- report ---- */

function line(v: ShapeVerdict): string {
  const t = v.card.placements;
  const branches = RUN_PLACEMENTS.filter((k) => t.runs[k] > 0)
    .map((k) => `${k}:${t.runs[k]}`)
    .join(" ");
  const gate = (g: "attribution" | "sourceOrder"): string => {
    const p = v.card.gates[g].passed;
    return p === null ? "—" : p ? "ok" : "FAIL";
  };
  return (
    `  ${v.case.name.padEnd(66)}${v.case.transformation.padEnd(10)}` +
    `${gate("attribution")}/${gate("sourceOrder")}`.padEnd(10) +
    `${branches.padEnd(34)}${v.ok ? (v.case.hole ? "hole" : "ok") : "FAILED"}`
  );
}

export function reportShapes(verdicts: ShapeVerdict[], onlyFailures = false): void {
  if (!onlyFailures) {
    console.log("=== THE SOURCE SHAPES ===");
    for (const p of SHAPE_PAGES) {
      const n = verdicts.filter((v) => v.case.page === p.name).length;
      console.log(`  ${p.name.padEnd(52)}${String(n).padStart(2)} candidate(s)  ${p.is}`);
    }
  }
  console.log(
    `\n=== THE SHAPE CORPUS — ${SHAPE_PAGES.length} SOURCE SHAPES, ${verdicts.length} CANDIDATES ===\n` +
      "Each case pins the gate verdicts AND the branch every output node and text run took, so\n" +
      "a green cannot be reached by the gate quietly judging nothing. `hole` marks a case that\n" +
      "asserts what the instrument CANNOT see.",
  );
  for (const v of verdicts) {
    if (onlyFailures && v.ok) continue;
    console.log(line(v));
    for (const p of v.problems) console.log(`      ${p}`);
  }
  const holes = verdicts.filter((v) => v.case.hole);
  const failed = verdicts.filter((v) => !v.ok);
  const ownerless = verdicts.reduce((n, v) => n + v.card.placements.ownerlessStamped, 0);
  const subtreeOnly = verdicts.reduce((n, v) => n + v.card.placements.runs.subtreeOnly, 0);
  /* **The corpus's own counts, and not the corpus's opinion of the run's.** How
     often the fifteen shipped extractions take each branch is measured and
     printed by `score.mts`; repeating a number from there here is how a sentence
     in this repository goes stale without anything noticing. */
  console.log(
    `\n  ${verdicts.length - failed.length}/${verdicts.length} cases hold. ` +
      `The \`ancestor\`-cannot-supply branch fires ${subtreeOnly} time(s) here, and ` +
      `${ownerless} run(s) are placed page-wide under a stamp their owner has no entry for. ` +
      "What the fifteen shipped extractions do is printed by evals/extraction/score.mts.",
  );
  if (holes.length) {
    console.log(`\n  ${holes.length} case(s) pin a HOLE rather than a check:`);
    for (const v of holes) console.log(`    ${v.case.name}: ${v.case.hole}`);
  }
}

if (isMain(import.meta.url)) {
  const verdicts = runShapeCorpus();
  reportShapes(verdicts, process.argv.includes("--failures"));
  if (verdicts.some((v) => !v.ok)) process.exitCode = 1;
}
