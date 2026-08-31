/**
 * **The article as a weighted graph**, rather than as a tree.
 *
 * Greg, 2026-08-27:
 *
 * > Ok, let's also try some D3 ones. Try a bunch, e.g. force-weighted graphs,
 * > creating a richer data structure to lay things out …
 *
 * The three original pictures (diagram.ts) all draw the same thing: the tree
 * stage 4 wrote, with sizes from block ranges. That is all a *tree* layout can
 * use, and it is why swapping in d3-hierarchy would have bought nothing — the
 * data was the limit, not the algorithm. A force layout with only parent edges
 * is a tidy tree drawn badly.
 *
 * So this file makes the data richer first. Three things the tree does not have:
 *
 *  1. **Words, not blocks.** A `Block` carries its own word count, so a section
 *     can be measured by how much there is to *read* rather than by how many
 *     paragraph-shaped things it contains. That closes the gap GPT Sol found in
 *     the first round — the `strata` picture, since cut, promised "how much of
 *     the piece" and delivered a count of blocks, so eight long paragraphs and
 *     eight one-line list items came out the same height
 *     (docs/project/diagram.md).
 *  2. **Sequence.** One section follows another, and that is a relation the tree
 *     records only implicitly, in the order of a `children` array.
 *  3. **Vocabulary.** Two sections that talk about the same things are related
 *     whether or not they are siblings — and *that* is the edge a tree cannot
 *     hold at all. It is what makes a graph layout worth running.
 *
 * ## Why the vocabulary edges are computed here rather than asked for
 *
 * The model could be asked which sections relate to which. It is not, for the
 * reason [glossary.md](../../docs/project/glossary.md) gives for finding
 * occurrences ourselves rather than asking: **a question with a checkable answer
 * should not be sent to something that can invent one.** Term overlap is
 * arithmetic. It is also free, and instant, and works on an article nobody has
 * paid a model call for — which is the property that makes `tree` the default
 * picture and is worth keeping.
 *
 * The measure is ordinary tf-idf over the sections of one article, which is the
 * least clever thing that works: a term is interesting in a section if that
 * section uses it often and the rest of the article does not. No stemming — this
 * has to run in a browser on every keystroke of a resize, and "model" / "models"
 * scoring separately costs less than a stemmer costs to carry and to be wrong
 * about. What it buys is worth being honest about: the edges are a *hint* about
 * shared subject matter, not a claim about argument structure.
 */
import { isBody } from "../block-policy.js";
import type { Block, BlockId, NodeId, SimilarPair } from "../types.js";

import type { SummaryNode } from "./tree.js";
import { type LinkKind, MAX_DRAWN_DEPTH, walk } from "./diagram.js";

/** One node of the graph: a part or a section, with what it is made of. */
export interface GraphNode {
  id: NodeId;
  blockId: BlockId;
  depth: number;
  number: string;
  title: string;
  gist?: string;
  /** Which L1 part this is inside, 0-based; -1 for the root. */
  part: number;
  startRow: number;
  endRow: number;
  /** How many blocks — the unit the summary panel's `¶` badge counts. */
  blocks: number;
  /** How many **words**. The honest measure of "how much of the piece". */
  words: number;
  /** Its most distinctive terms, best first. Empty if it has no prose. */
  terms: string[];
}

/**
 * What an edge means. Five kinds, and they are not interchangeable — a layout
 * chooses which to obey and which to draw, and says so.
 *
 * The union itself is declared in [diagram.ts](./diagram.ts) as `LinkKind`,
 * because a drawn link carries it and that file may not import this one. See
 * the comment there.
 *
 * They are not five versions of one claim. Ordered by how much they know:
 *
 *  - `parent` and `sequence` are **facts about the tree** — free, exact, and
 *    saying nothing a contents page could not.
 *  - `anchor` is a **fact about the document**: the author wrote a link from
 *    this passage to that one. It is the only edge here that somebody meant.
 *  - `vocabulary` is **arithmetic over the words** — checkable, cheap, and a
 *    hint rather than a claim.
 *  - `semantic` is **a model's opinion**, and the only one that costs money or
 *    can be wrong in a way no amount of reading the code would reveal.
 *
 * A picture that renders all five identically would be flattening that ladder,
 * which is why the stylesheet gives each its own weight and dash.
 */
export type EdgeKind = LinkKind;

export interface GraphEdge {
  source: NodeId;
  target: NodeId;
  kind: EdgeKind;
  /** 0–1. For `vocabulary` and `semantic`, how alike the two ends are. */
  weight: number;
  /** `vocabulary` only: the terms they share, best first. For the hover card. */
  shared?: string[];
  /**
   * `anchor` only: the author's own link text, e.g. *"how we think about
   * corrigibility"*.
   *
   * Shown rather than paraphrased. It is the writer's word for the
   * relationship, and nothing computed here is going to improve on it.
   */
  label?: string;
  /**
   * `semantic` only: the two blocks whose embeddings actually earned the edge.
   *
   * An edge between two *sections* rests on one pair of *passages*, and without
   * this the reader is shown a line and asked to take it on trust. Same rule as
   * `shared` above — a line you cannot interrogate looks exactly as
   * authoritative as one that is right.
   */
  passages?: [BlockId, BlockId];
}

export interface ArticleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byId: Map<NodeId, GraphNode>;
  totalWords: number;
  /**
   * Words before each row, plus a final total — a prefix sum over the article's
   * blocks, so any row range converts to a word range in constant time.
   *
   * Nothing draws a to-scale axis since `strata` was cut, so this has no reader
   * today; it stays because it is the one thing that would let a picture's
   * vertical axis mean words rather than blocks, and it costs one pass. Length
   * `blocks.length + 1`.
   */
  wordsBefore: number[];
}

/**
 * English function words, and the handful of article-writing words that are
 * distinctive of nothing.
 *
 * Deliberately short. A long stoplist starts deciding what an article is allowed
 * to be about — "important", "problem" and "system" are all on somebody's list,
 * and all three are the actual subject of some article we will ingest. tf-idf
 * already removes anything the *whole article* says a lot, which is the same job
 * done from the text rather than from a guess about English.
 */
const STOP = new Set(
  `a about above after again against all also am an and any are aren as at be because been before
   being below between both but by can cannot could couldn did didn do does doesn doing don down
   during each few for from further had hadn has hasn have haven having he her here hers herself him
   himself his how i if in into is isn it its itself just let me more most must mustn my myself no
   nor not now of off on once only or other ought our ours ourselves out over own same shan she
   should shouldn so some such than that the their theirs them themselves then there these they this
   those through to too under until up very was wasn we were weren what when where which while who
   whom why will with won would wouldn you your yours yourself yourselves
   one two three four five six seven eight nine ten
   thing things way ways make makes made get gets got kind sort lot lots much many
   like likely often rather quite even still yet perhaps maybe`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words worth counting: letters, at least four of them, not a function word. */
export function terms(text: string): string[] {
  const out: string[] = [];
  // Unicode letters plus the apostrophes that live inside words, then the
  // apostrophes are dropped — "doesn't" and "doesnt" should be one term.
  for (const raw of text.toLowerCase().split(/[^\p{L}'’]+/u)) {
    const w = raw.replace(/['’]/g, "");
    /* Four rather than three: three-letter words are almost all function words,
       and the ones that are not ("AGI", "art") survive as part of a phrase
       nobody is counting anyway. It halves the term space for nearly nothing. */
    if (w.length < 4 || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

/** How many of a node's most distinctive terms to keep **for the reader to see**. */
const TOP_TERMS = 10;

/**
 * How similar two sections must be before we will draw a line between them.
 *
 * **Swept against four real articles rather than picked**, because a threshold
 * on a similarity measure is exactly the kind of number that looks fine on the
 * one article you tried it on. Vocabulary edges per article, re-run 2026-08-27
 * after the idf smoothing above (which raised every score, so the first sweep's
 * numbers are not these):
 *
 * | floor | constitution (50 sections) | noema (21) | phrenology (40) | writes (12) |
 * |---|---|---|---|---|
 * | **0.12** | **56** | **11** | **8** | **3** |
 * | 0.15 | 31 | 6 | 2 | 3 |
 * | 0.18 | 18 | 3 | 1 | 2 |
 * | 0.20 | 12 | 2 | 0 | 1 |
 * | 0.22 | 8 | 1 | 0 | 1 |
 *
 * 0.12, because **the quality holds all the way down to it.** The weakest edges
 * kept there are still real ones: "Hard constraints ←→ Avoiding problematic
 * concentrations of power" via *power, harms, illegitimate*; "Some of our views
 * on Claude's nature ←→ Emotional expression" via *emotions, feelings, states*.
 * Nothing at that end reads as noise, so a higher floor throws findings away —
 * at 0.20 the phrenology lecture has **none at all** and its picture is a bare
 * spine.
 *
 * The cost of staying low is density rather than nonsense: the constitution gets
 * slightly more edges than it has sections. `MAX_EDGES_PER_NODE` is what keeps
 * that readable, and it is doing more work than the floor is.
 *
 * The phrenology column is not a failure. That article is a scanned Victorian
 * pamphlet whose first dozen "sections" are catalogue stubs, and
 * `MIN_TERMS_FOR_EDGE` below is *supposed* to refuse them.
 *
 * The spread across articles — 0.9 edges per section down to 0.1 — is the honest
 * caveat: an absolute threshold on cosine is not scale-free across documents of
 * different vocabulary breadth. An adaptive rule (keep the best *n* per article)
 * would be defensible. It is not here because the degree cap below already
 * bounds the worst case, and one fewer moving part is worth more than the last
 * few per cent.
 */
const EDGE_FLOOR = 0.12;

/**
 * A section with fewer distinctive terms than this cannot form an edge at all.
 *
 * **This exists because of a bibliography.** `fowler-phrenology` opens with a
 * run of catalogue stubs — "A Lecture,", "BY L. N. FOWLER, OF NEW YORK." — of
 * two or three words each. Under the first version's normalisation a section
 * with two terms that shared both scored a perfect 1.0, so the strongest links
 * in the whole article were between its title page and its half-title. A short
 * section is not evidence of a strong relationship; it is an absence of
 * evidence, and the two have to be told apart explicitly.
 */
const MIN_TERMS_FOR_EDGE = 6;
/**
 * The most vocabulary edges any one node may keep, best first.
 *
 * Without a cap every section links to every other with some tiny weight and the
 * picture is a hairball — the failure mode that makes people say force layouts
 * are useless, when what is useless is an uncapped one.
 */
const MAX_EDGES_PER_NODE = 4;

/**
 * **Cosine similarity over tf-idf vectors**, and why it is not set overlap.
 *
 * The first version scored a pair by how many of their top ten terms matched,
 * over the smaller of the two vocabularies. Run against real articles it failed
 * three ways at once, and each failure is worth keeping written down:
 *
 *  - **Too few edges, by construction.** tf-idf selects terms *for being unique
 *    to a section*, and the next step then looked for terms two sections had in
 *    common. Anthropic's constitution — fifty sections, 22,000 words — produced
 *    **nine** edges, and the Noema essay produced **one**. A relationship graph
 *    with one edge is not a sparse graph, it is a bug.
 *  - **Every shared term counted the same.** Two sections sharing "phrenology"
 *    scored exactly as two sharing "section". So the strongest links in the
 *    constitution joined passages whose common vocabulary was *"section,
 *    collapsed, readers, default"* — the words an article uses to talk about
 *    itself. Confident, precise, and about nothing.
 *  - **Short sections won.** Dividing by the smaller vocabulary means two terms
 *    out of two is a perfect score.
 *
 * Cosine over the **whole** tf-idf vector fixes all three: every term
 * participates rather than only the top ten, a shared term contributes in
 * proportion to how distinctive it is at *both* ends, and unit-normalising the
 * vectors removes length from the comparison entirely. It is also the textbook
 * answer, which is worth something — this is not a place to be inventive.
 */
const dot = (a: Map<string, number>, b: Map<string, number>): number => {
  // Walk the shorter map: the cost is the size of the smaller vocabulary rather
  // than of the pair, and this runs for every pair of sections.
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [t, v] of small) sum += v * (big.get(t) ?? 0);
  return sum;
};

/**
 * Build the graph from the tree and the article's blocks.
 *
 * `collapsed` is passed through to `walk` so the graph describes **what is
 * drawn**, not what exists: closing a part should remove its sections from the
 * force simulation, not leave them exerting charge from behind a closed node.
 */
/**
 * Words before each block, plus a final total — a prefix sum, length `n + 1`.
 *
 * Exported on its own so a picture can be measured in words without wanting
 * **anything else** from this file: it is one pass over an array the panel
 * already holds, where `buildGraph` builds a whole term index. A picture that
 * does not use the graph should not have to build one to be measured in words.
 * `strata`, the picture this was split out for, has since been cut.
 */
export function wordsBefore(blocks: readonly Block[]): number[] {
  const out: number[] = [0];
  /* **A note contributes no words**, so the running total this returns — and
     `ArticleGraph.totalWords`, which is its last entry — is the length of the
     *argument*. Force divides each node's position by that total
     (`layoutForce`, src/web/diagram-d3.ts), and every node it lays out is a
     body node now that the supplement is filtered out; counting the apparatus
     in the denominator and not in the numerator squeezed the whole argument
     into the top of the panel. Measured: 200 body words behind 1,800 words of
     endnotes put two body nodes at y≈35 and y≈54 of a 420px picture.
     GPT Sol, fourth review, 2026-08-29. */
  for (const b of blocks) out.push((out[out.length - 1] ?? 0) + (isBody(b) ? b.words : 0));
  return out;
}

export function buildGraph(
  root: SummaryNode,
  blocks: readonly Block[],
  collapsed: ReadonlySet<NodeId> = new Set(),
  /**
   * The embedding model's answer, if it has arrived — `POST /api/similar/:slug`
   * (src/similar.ts).
   *
   * Optional, and the picture is complete without it. The three cheap kinds of
   * edge are free and instant; this one costs a model call, so it arrives late
   * and is folded in on a second build rather than being waited for. A diagram
   * that showed a spinner while it was already able to draw four fifths of
   * itself would be lying about what was missing.
   */
  similar: readonly SimilarPair[] = [],
): ArticleGraph {
  const prefix = wordsBefore(blocks);

  /* **The apparatus is not in the argument's diagram at all.** A supplement
     node was walked like any other: drawn as a node, chained into reading
     order, and — the part that actually corrupts the picture — counted into the
     term vectors. Because the root's range spans the whole article, a word
     occurring *only* in the footnotes came out as the top term for the entire
     piece, so the diagram described a piece by its endnotes. Measured on a
     fixture whose notes contain one rare word, before this line existed.

     Filtered here rather than inside `walk`, because `walk` is the tree
     traversal three pictures share and the outline genuinely wants the
     supplement in it. Diagram mode is what does not. GPT Sol found this one
     last, after the other six projections were already dealt with;
     docs/plans/260828o-footnotes.md. */
  const entries = walk(root, collapsed, MAX_DRAWN_DEPTH).filter((e) => !e.node.supplement);

  /* Term counts per node, over the node's own blocks. A part's counts include
     its sections' — a part IS its sections — which is what makes a part's top
     terms the article's view of it rather than the leftovers. */
  const counts = new Map<NodeId, Map<string, number>>();
  const nodes: GraphNode[] = entries.map((e) => {
    const n = e.node;
    const tf = new Map<string, number>();
    for (let i = n.startRow; i <= n.endRow && i < blocks.length; i++) {
      const b = blocks[i];
      if (!b) continue;
      /* **And the blocks are the body's, not the range's.** Dropping the
         supplement's own node above is not enough: an ancestor's range still
         spans the apparatus — the root's always does — so its counts would go
         on including every note. `isBody` is the same predicate the anchor
         edges below already use. src/block-policy.ts. */
      if (!isBody(b)) continue;
      for (const t of terms(b.text)) tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    counts.set(n.node.id, tf);
    return {
      id: n.node.id,
      blockId: n.node.range[0],
      depth: n.node.depth,
      number: n.number,
      title: n.node.title,
      ...(n.gist !== undefined && { gist: n.gist }),
      part: e.part,
      startRow: n.startRow,
      endRow: n.endRow,
      blocks: n.blocks,
      words: Math.max(
        0,
        (prefix[Math.min(n.endRow + 1, blocks.length)] ?? 0) - (prefix[n.startRow] ?? 0),
      ),
      terms: [],
    };
  });

  /* Document frequency over the DEEPEST drawn nodes only. Counting parts as well
     would double-count every word — a term in section 2.3 is also a term in part
     2 — and idf computed over overlapping documents is not idf. */
  const leaves = nodes.filter((n) => n.depth === MAX_DRAWN_DEPTH || !hasChild(nodes, n));
  const df = new Map<string, number>();
  for (const n of leaves) {
    for (const t of counts.get(n.id)?.keys() ?? []) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, leaves.length);

  /** Each node's unit-length tf-idf vector, for the cosine below. */
  const vectors = new Map<NodeId, Map<string, number>>();

  for (const n of nodes) {
    const tf = counts.get(n.id);
    if (!tf) continue;
    /* Plain `log(N / df)`, which is the classic idf and the only form that
       actually does the job here: **a term in every section scores exactly
       zero** and drops out by itself, which is the whole point of doing this
       rather than extending the stoplist.

       An earlier draft wrote `log(1 + N / df)` to keep the value positive, and
       it is worth recording why that was wrong, because it looked harmless. It
       never reaches zero, so a word the article says constantly is merely
       *discounted* rather than removed — and discounting loses to a big `tf`.
       With two sections both mentioning "consciousness" four times and one
       distinctive word twice, `log(1+N/df)` ranked "consciousness" first in both
       and the distinctive word second, so the two sections' "most distinctive
       terms" were the same word. The picture still drew, and the edges it
       produced were confident and meaningless.

       **Smoothed, since GPT Sol found what plain `log(N/df)` does at N = 2.**
       With two sections, every shared term has `df === N` and therefore scores
       exactly zero — so two near-identical sections got no edge at all, and
       adding an unrelated *third* section made an edge appear at 0.52. An
       article of two sections is not a rare shape, and "no relationships" is the
       one answer that is certainly wrong there.

       `log((N + 1) / (df + 0.5))` keeps both ends. A term in every one of fifty
       sections scores log(51/50.5) ≈ 0.01, which is zero for every practical
       purpose; a term in one of fifty scores log(51/1.5) ≈ 3.5, three hundred
       times more. And at N = 2 with df = 2 it is 0.18 rather than 0 — small, but
       present, so two sections can still be compared with each other. */
    const scored = [...tf].map(
      ([t, f]) => [t, f * Math.log((N + 1) / ((df.get(t) ?? 1) + 0.5))] as const,
    );
    scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    /* Non-positive scores are dropped. With the smoothing above a ubiquitous
       term no longer reaches exactly zero, so this removes less than it did —
       but it costs nothing, and it still catches the degenerate case where a
       term is in more documents than there are documents, which a future change
       to how `df` is counted could produce. The near-zero weights that survive
       contribute near-nothing to the cosine, which is the correct outcome
       rather than a leak. */
    const positive = scored.filter(([, score]) => score > 0);
    n.terms = positive.slice(0, TOP_TERMS).map(([t]) => t);

    /* Unit-normalised here rather than at comparison time: it is one pass per
       node instead of one per pair, and it makes the dot product above *be* the
       cosine rather than the numerator of it. A node whose every term scored
       zero — a section of nothing but words the whole article uses — gets an
       empty vector and forms no edges, which is the right answer. */
    const norm = Math.sqrt(positive.reduce((acc, [, v]) => acc + v * v, 0));
    vectors.set(
      n.id,
      norm > 0 ? new Map(positive.map(([t, v]) => [t, v / norm])) : new Map(),
    );
  }

  const edges: GraphEdge[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Containment, straight off the tree.
  const visit = (s: SummaryNode) => {
    if (collapsed.has(s.node.id)) return;
    for (const c of s.children) {
      if (!byId.has(c.node.id)) continue;
      edges.push({ source: s.node.id, target: c.node.id, kind: "parent", weight: 1 });
      visit(c);
    }
  };
  visit(root);

  /* **Reading order, as one chain through the article.**
   *
   * Greg, 2026-08-27: *"Add thick links with an arrow on one end to show the
   * sequence, i.e. between each consecutive pair."*
   *
   * It used to be an edge between consecutive **siblings**, which meant a link
   * between 1.1 and 1.2 and between part 1 and part 2, and never one between
   * 1.4 and 2.1. So the article's actual reading order was the one relation
   * missing, and it was missing at every part boundary — which is precisely
   * where a reader wants to be told what follows what, because it is the only
   * place the answer is not obvious.
   *
   * The chain runs through the **deepest drawn** nodes, which is what makes it
   * survive collapse: a part with drawn children is not in the chain (its
   * children are, and the chain passes through them), and a part with none —
   * because it is a depth-1 leaf, or because the reader closed it — is itself a
   * link in the chain. Closing a part shortens the chain rather than breaking
   * it.
   *
   * Sorted by `startRow` rather than trusted from `walk`, and the tie-break is
   * the end row so a zero-length node sits before the section it opens. `walk`
   * is a pre-order traversal and does already return reading order; sorting is
   * one line and makes that a property of this function rather than an
   * assumption about another one.
   */
  const chain = leaves
    .filter((n) => n.depth > 0)
    .slice()
    .sort((a, b) => a.startRow - b.startRow || a.endRow - b.endRow);
  /** Every node pair the chain already joins, canonicalised. See `semanticEdges`. */
  const consecutive = new Set<string>();
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1];
    const to = chain[i];
    if (!from || !to) continue;
    // Source is always the earlier one, because the arrowhead goes on the
    // target and an arrow pointing backwards up the article would be a lie.
    edges.push({ source: from.id, target: to.id, kind: "sequence", weight: 1 });
    consecutive.add(pairKey(from.id, to.id));
  }

  for (const e of anchorEdges(blocks, nodes)) edges.push(e);
  for (const e of semanticEdges(blocks, nodes, similar, consecutive)) edges.push(e);

  for (const e of vocabularyEdges(leaves, vectors)) edges.push(e);

  return {
    nodes,
    edges,
    byId,
    totalWords: prefix[prefix.length - 1] ?? 0,
    wordsBefore: prefix,
  };
}

/** An anchor edge under construction, carrying how far apart its ends are. */
type AnchorPair = GraphEdge & { distance: number };

/**
 * Every internal link in the article, aggregated into one entry per node pair.
 *
 * Split out of `anchorEdges` so that the scanning and the capping are two
 * things rather than one forty-line function: the first is about HTML, the
 * second is about how many lines a picture can carry.
 */
function collectAnchorLinks(
  doc: Document,
  blocks: readonly Block[],
  nodes: readonly GraphNode[],
  rows: ReadonlyMap<string, number>,
  pairs: Map<string, AnchorPair>,
): void {
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    /* `#` alone is a real thing in the wild and means "the top of this page",
       which is not a block. Same refusal internal-links.ts makes. */
    if (href.length < 2 || !href.startsWith("#")) continue;
    /* **A footnote marker and its back-link are not cross-references**, and
       excluding them here is the point of this pair of lines. `MAX_ANCHOR_EDGES`
       below was written to cap exactly this starburst before footnotes existed
       — forty lines converging on the endnotes bubble, all of them true and none
       of them telling a reader anything they did not know. A cap turns that into
       twelve arbitrary ones; it does not make them mean anything. Now that
       stage 2 stamps the marker and the back-link, they can simply be refused.
       src/notes.ts holds the attribute names. */
    if (a.hasAttribute("data-spya-note-ref") || a.hasAttribute("data-spya-note-back")) continue;
    const row = rowOfElement(a);
    if (row === null) continue;

    const raw = href.slice(1);
    const targetRow = rows.get(decodeFragment(raw)) ?? rows.get(raw);
    /* A fragment nothing in this document answers to. Drawing a line to the
       nearest thing would be inventing a destination, which is worse than the
       dead link — internal-links.ts refuses the same case for the same reason,
       and reading a missing lookup as row 0 would put a confident line on the
       first section of the article. */
    if (targetRow === undefined) continue;
    /* The attribute check above is about *this* link; this is about where it
       starts and lands. A hand-written "see note 4" in the prose, or a note
       citing another note, is still apparatus pointing at apparatus — and a
       page whose stamps did not survive would otherwise be back to relying on
       the cap. Two clauses, because either one alone leaves a shape through.
       `isBody` in src/block-policy.ts. */
    if (!isBody(blocks[row] ?? {}) || !isBody(blocks[targetRow] ?? {})) continue;
    const from = nodeAtRow(nodes, row);
    const to = nodeAtRow(nodes, targetRow);
    if (!from || !to || from.id === to.id) continue;

    const key = pairKey(from.id, to.id);
    const existing = pairs.get(key);
    if (existing) {
      existing.weight += 1;
      continue;
    }
    /* The author's own words for the relationship. `textContent`, so entities
       arrive as the characters they stand for — a tag strip over the raw HTML
       showed a reader the literal string `A &amp; B`. Not truncated here: the
       card decides how much of it fits, because this file does not know how
       wide the card is. */
    const label = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    pairs.set(key, {
      source: from.id,
      target: to.id,
      kind: "anchor",
      weight: 1,
      ...(label ? { label } : {}),
      distance: Math.abs(targetRow - row),
    });
  }
}

/**
 * The most anchor edges to keep, and the most semantic ones.
 *
 * Two different worries behind one shape of constant.
 *
 * `MAX_ANCHOR_EDGES` is about **footnotes**. Nothing in this corpus had them
 * when it was written (see the table in docs/plans/260827d-force-diagram-links.md — five
 * internal links across seven articles, all of them in the constitution), but a
 * paper with forty back-links from its endnotes to their markers would draw
 * forty lines converging on one bubble and call it structure. The cap is what
 * stops the honest case being buried by the pathological one.
 *
 * **Since 2026-08-28 it is no longer what stops that**, and it stays anyway.
 * `collectAnchorLinks` now refuses note markers, back-links and anything
 * starting or landing in the apparatus outright, which is the difference
 * between excluding a thing and rationing it. The cap is back to being a
 * general bound on how many lines a picture can carry, which is what a cap is
 * good at — and it is the fallback if a shape we have not met gets past the
 * exclusion.
 *
 * `MAX_SEMANTIC_EDGES` is about **the question being asked**. Greg wanted to
 * see what embeddings do to the shape of the picture, and a hairball answers
 * nothing — the same reasoning as `MAX_EDGES_PER_NODE` above, which is the
 * constant doing most of the work in the vocabulary half.
 */
const MAX_ANCHOR_EDGES = 12;
/** …and no one section may account for more than this many of them. */
const MAX_ANCHOR_PER_NODE = 3;
const MAX_SEMANTIC_EDGES = 10;

/**
 * **Shared distinctive words**, between the deepest drawn nodes only.
 *
 * Between a part and its own section the score would be near 1 by construction
 * and would say nothing, which is why parts are not candidates.
 *
 * Its own function since 2026-08-27, so that it sits beside `anchorEdges` and
 * `semanticEdges` and the three read alike. Before that it was inline in
 * `buildGraph`, which by the time two more kinds of edge had been added was
 * doing five separate jobs in one scope.
 */
function vocabularyEdges(
  leaves: readonly GraphNode[],
  vectors: ReadonlyMap<NodeId, Map<string, number>>,
): GraphEdge[] {
  const candidates: GraphEdge[] = [];
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (!a || !b) continue;
      const va = vectors.get(a.id);
      const vb = vectors.get(b.id);
      // Too little to say. See MIN_TERMS_FOR_EDGE — this is the bibliography guard.
      if (!va || !vb || va.size < MIN_TERMS_FOR_EDGE || vb.size < MIN_TERMS_FOR_EDGE) continue;
      const weight = dot(va, vb);
      if (weight < EDGE_FLOOR) continue;
      /* What the reader is shown as the reason for the line: the terms that
         actually carried the score, biggest contribution first — NOT simply the
         terms in common. Those are different lists, and showing the second while
         the first decided the edge is the kind of explanation that is worse than
         none. */
      const shared = [...va]
        .map(([t, v]) => [t, v * (vb.get(t) ?? 0)] as const)
        .filter(([, c]) => c > 0)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 6)
        .map(([t]) => t);
      candidates.push({ source: a.id, target: b.id, kind: "vocabulary", weight, shared });
    }
  }

  /* Keep each node's best few, then dedupe — an edge kept from both ends is one
     edge. Sorted by weight, with the ids as the tie-break so the picture does
     not reshuffle between two runs on identical input. */
  candidates.sort((x, y) => y.weight - x.weight || `${x.source}${x.target}`.localeCompare(`${y.source}${y.target}`));
  const out: GraphEdge[] = [];
  const kept = new Set<string>();
  const degree = new Map<NodeId, number>();
  for (const e of candidates) {
    if ((degree.get(e.source) ?? 0) >= MAX_EDGES_PER_NODE) continue;
    if ((degree.get(e.target) ?? 0) >= MAX_EDGES_PER_NODE) continue;
    const key = `${e.source}|${e.target}`;
    if (kept.has(key)) continue;
    kept.add(key);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    out.push(e);
  }

  return out;
}

/** One key per unordered pair of nodes, so A–B and B–A are one thing. */
function pairKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Which drawn node contains this row — the deepest one, since they nest. */
function nodeAtRow(nodes: readonly GraphNode[], row: number): GraphNode | null {
  let best: GraphNode | null = null;
  for (const n of nodes) {
    if (row < n.startRow || row > n.endRow) continue;
    if (!best || n.depth > best.depth) best = n;
  }
  return best;
}

/**
 * The article's blocks, parsed once into one inert document, each wrapped in a
 * marker that says which row it came from.
 *
 * **`DOMParser`, not `innerHTML` on a detached element.** A parsed document is
 * inert — no scripts, and no image loads — where assigning `innerHTML` starts
 * fetching every `<img src>` in the article. Building a diagram must not
 * download the pictures.
 *
 * Returns null where there is no DOM at all. That is a degradation rather than
 * a second implementation — the anchor edges are simply absent — and it is
 * worth knowing how convincingly it lies.
 *
 * Running the graph over the real constitution in a plain Node script
 * immediately after this rewrite reported **0 anchor edges where the regex had
 * found 5**, and everything else in the output was identical. It read exactly
 * like the rewrite having broken the feature; it was `DOMParser` being absent
 * from Node. Six of seven articles in this corpus legitimately have no
 * cross-references at all, so "none" is the *expected* answer nearly
 * everywhere, which is what makes the wrong "none" so hard to see.
 *
 * This file is client code and only ever runs in a browser, where `DOMParser`
 * always exists. Anything that runs it elsewhere — a test, a script, a future
 * prerender — has to supply one, or it is measuring the fallback and calling it
 * a result.
 */
function parseBlocks(blocks: readonly Block[]): Document | null {
  if (typeof DOMParser === "undefined") return null;
  const html = blocks
    .map((b, row) => `<div data-diag-row="${row}">${b.html}</div>`)
    .join("");
  try {
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
}

/** Which row a parsed element came from, via its wrapper. */
function rowOfElement(el: Element): number | null {
  const wrapper = el.closest("[data-diag-row]");
  const raw = wrapper?.getAttribute("data-diag-row");
  const row = raw === null || raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(row) ? row : null;
}

/**
 * Every fragment this document answers to, mapped to the row that answers.
 *
 * Three sources, in the order the HTML spec resolves a fragment and the order
 * stage 3 renames them in (src/blocks.ts § WAS_ID): a block's own id, an `id=`
 * on anything inside a block, and an `<a name=>`. **First occurrence wins** —
 * duplicate ids are invalid HTML and common in the wild, and `querySelector`
 * would return the first, so this returns the first too. Agreeing with the
 * browser matters here: [internal-links.ts](./internal-links.ts) resolves the
 * same click through the real DOM, and a picture that draws a line to a
 * different place from where the click lands would be worse than no line.
 *
 * ## This was a regex, and the argument for that was wrong
 *
 * The first version scanned `block.html` with `matchAll`, reasoning that this
 * is not arbitrary web HTML — it is jsdom's own serialisation, written by stage
 * 3, so it is well-formed and double-quoted. That is true and it is not
 * enough. GPT Sol produced the counterexample: **`<a title="1 > 0"
 * href="#target">` is valid serialised HTML**, because the serialiser escapes
 * `&`, `<` and `"` inside an attribute value but has no reason to escape `>`.
 * A `[^>]*` pattern stops at that `>` and finds no link at all. And the tag
 * strip on the link text returned `A &amp; B` to be shown to a reader as those
 * literal characters.
 *
 * Both failures are silent — one loses an edge, the other prints mojibake — and
 * both are things a parser gets right for free. **One inert parse for the whole
 * article** is the cost, inside a memo that already walks every block.
 *
 * **One thing that is true of no implementation**: an id can be gone entirely.
 * DOMPurify deletes clobber-prone ids, which is why stage 3 stamps its own
 * before sanitisation (src/blocks.ts, and docs/project/block-ids.md § the one
 * class of id DOMPurify deletes). A link whose target was removed that way
 * resolves to nothing here — correctly, since it resolves to nothing in the
 * reading view either.
 */
function fragmentRows(doc: Document | null, blocks: readonly Block[]): Map<string, number> {
  const rows = new Map<string, number>();
  const put = (key: string | null | undefined, row: number) => {
    if (key && !rows.has(key)) rows.set(key, row);
  };
  for (const [row, b] of blocks.entries()) put(b.id, row);
  if (!doc) return rows;

  /* **Two passes, and the order between them is the rule rather than a
     detail.** Every `id` in the document beats every `<a name>`, wherever each
     sits — the order the HTML spec resolves a fragment in, and the order stage
     3 renames them in. Interleaved, a `name` in block 2 would beat an `id` in
     block 40, which is neither of those orders and is a divergence from what a
     click actually does. */
  for (const el of doc.querySelectorAll("[id]")) {
    const row = rowOfElement(el);
    if (row !== null) put(el.getAttribute("id"), row);
  }
  for (const el of doc.querySelectorAll("a[name]")) {
    const row = rowOfElement(el);
    if (row !== null) put(el.getAttribute("name"), row);
  }
  return rows;
}

/** `decodeURIComponent` throws on a lone `%`; a malformed fragment is just text. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * **The article's own cross-references** — the one kind of edge in this picture
 * that somebody meant.
 *
 * Greg, 2026-08-27: *"Add thin links if there's an anchor link between
 * sections."*
 *
 * A published page links to itself, and by the time the HTML reaches here stage
 * 3 has already repointed every such href at our block id (`retargetAnchors` in
 * src/blocks.ts). So this is a scan and a lookup: no model, no network, nothing
 * to be wrong about except the lookup itself.
 *
 * Everything else in this file is a *guess* about relatedness — good arithmetic
 * over the words, or a model's opinion. This is a fact about the document, and
 * it gets its own colour and the author's own link text for that reason.
 *
 * Rare, and that is the correct output rather than a failure: measured across
 * the whole corpus on 2026-08-27, six of seven articles have **no** internal
 * links at all and the constitution has five. All five are long-range, which is
 * what makes them worth drawing — they span distances no other line here can
 * cross truthfully.
 */
function anchorEdges(blocks: readonly Block[], nodes: readonly GraphNode[]): GraphEdge[] {
  const doc = parseBlocks(blocks);
  const rows = fragmentRows(doc, blocks);
  /** One entry per pair of nodes, however many links join them. */
  const pairs = new Map<string, AnchorPair>();

  if (doc) collectAnchorLinks(doc, blocks, nodes, rows, pairs);

  const ranked = [...pairs.values()].sort(
    (a, b) =>
      b.weight - a.weight ||
      b.distance - a.distance ||
      `${a.source}${a.target}`.localeCompare(`${b.source}${b.target}`),
  );

  /* **A degree cap as well as a total, which is not belt and braces.** A total
     of twelve is still twelve lines converging on one bubble if the article has
     an endnotes section that every prose section links into — the picture would
     be a star, and the star would be *true* and would tell the reader nothing
     they did not know about a bibliography. The degree cap is what makes the
     total spread out. Same division of labour as `MAX_EDGES_PER_NODE` and
     `EDGE_FLOOR` above, where the cap does more work than the threshold. GPT
     Sol's finding, 2026-08-27. */
  const degree = new Map<NodeId, number>();
  const out: GraphEdge[] = [];
  for (const { distance: _distance, ...e } of ranked) {
    if (out.length >= MAX_ANCHOR_EDGES) break;
    if ((degree.get(e.source) ?? 0) >= MAX_ANCHOR_PER_NODE) continue;
    if ((degree.get(e.target) ?? 0) >= MAX_ANCHOR_PER_NODE) continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    out.push(e);
  }
  return out;
}

/**
 * **What the embedding model thinks is alike**, folded into the graph.
 *
 * The pairs arrive from `GET /api/similar/:slug` as *block* pairs, because that
 * is the unit that was embedded — Greg asked for "an embedding for each block".
 * The picture draws *sections*, so each pair is mapped to the two drawn nodes
 * containing its blocks and pairs landing inside one node are dropped: a
 * section being about itself is not a finding.
 *
 * **One edge per node pair, and it remembers which two passages earned it.**
 * Several block pairs can point at the same two sections; the best-scoring one
 * wins and its block ids ride along on the edge, so the card can name the
 * passages rather than asking the reader to trust a dotted line. Same rule as
 * `shared` on a vocabulary edge, and for the same reason.
 */
function semanticEdges(
  blocks: readonly Block[],
  nodes: readonly GraphNode[],
  similar: readonly SimilarPair[],
  /**
   * The node pairs the reading-order chain already joins.
   *
   * **The server's `|i − j| ≤ 1` guard is not enough, and this is where the
   * rest of that job has to be done.** That guard is about *blocks*; the
   * picture draws *sections*. Two paragraphs six rows apart can sit in
   * consecutive sections, sail past the block-adjacency test, and come out as a
   * dotted line drawn along exactly the thick arrow that is already there —
   * a finding that is not a finding, spending one of ten slots to restate the
   * thing the picture says loudest. And the set changes under collapse, which
   * only this side knows about. GPT Sol's finding, 2026-08-27.
   */
  consecutive: ReadonlySet<string>,
): GraphEdge[] {
  if (similar.length === 0) return [];
  const rowOf = new Map<BlockId, number>();
  for (const [row, b] of blocks.entries()) if (!rowOf.has(b.id)) rowOf.set(b.id, row);

  const pairs = new Map<string, GraphEdge>();
  for (const p of similar) {
    const ra = rowOf.get(p.a);
    const rb = rowOf.get(p.b);
    // A block the article no longer has: the similarity answer is cached
    // against a source hash, so this should not happen — and if it does, the
    // honest response is to drop the pair rather than to guess at a row.
    if (ra === undefined || rb === undefined) continue;
    const from = nodeAtRow(nodes, ra);
    const to = nodeAtRow(nodes, rb);
    if (!from || !to || from.id === to.id) continue;

    const key = pairKey(from.id, to.id);
    // Already drawn, thick, with an arrow on it. See the parameter's note.
    if (consecutive.has(key)) continue;
    const existing = pairs.get(key);
    if (existing && existing.weight >= p.score) continue;
    pairs.set(key, {
      source: from.id,
      target: to.id,
      kind: "semantic",
      weight: p.score,
      passages: [p.a, p.b],
    });
  }

  return [...pairs.values()]
    .sort(
      (a, b) => b.weight - a.weight || `${a.source}${a.target}`.localeCompare(`${b.source}${b.target}`),
    )
    .slice(0, MAX_SEMANTIC_EDGES);
}

/** Whether any node in the list claims this one as its container. */
function hasChild(nodes: readonly GraphNode[], n: GraphNode): boolean {
  return nodes.some((c) => c.depth === n.depth + 1 && c.startRow >= n.startRow && c.endRow <= n.endRow);
}
