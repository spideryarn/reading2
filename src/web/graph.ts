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
 *     the first round — `strata` promised "how much of the piece" and delivered
 *     a count of blocks, so eight long paragraphs and eight one-line list items
 *     came out the same height (docs/project/diagram.md).
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
 * paid a model call for — which is the property that made `strata` the default
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
import type { Block, BlockId, NodeId } from "../types.js";
import type { SummaryNode } from "./tree.js";
import { MAX_DRAWN_DEPTH, walk } from "./diagram.js";

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
 * What an edge means. Three kinds, and they are not interchangeable — a layout
 * chooses which to obey, and says so.
 */
export type EdgeKind =
  /** Containment: a part to one of its sections. */
  | "parent"
  /** Reading order: this section is followed by that one. */
  | "sequence"
  /** Shared subject matter, from term overlap. The one a tree cannot hold. */
  | "vocabulary";

export interface GraphEdge {
  source: NodeId;
  target: NodeId;
  kind: EdgeKind;
  /** 0–1. For `vocabulary`, how much the two sections' distinctive terms agree. */
  weight: number;
  /** `vocabulary` only: the terms they share, best first. For the hover card. */
  shared?: string[];
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
   * This is what lets `strata` be to scale in words instead of in blocks. Length
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
 * Exported on its own because `strata` wants it and wants **nothing else** from
 * this file: it is one pass over an array the panel already holds, where
 * `buildGraph` builds a whole term index. A picture that does not use the graph
 * should not have to build one to be measured in words.
 */
export function wordsBefore(blocks: readonly Block[]): number[] {
  const out: number[] = [0];
  for (const b of blocks) out.push((out[out.length - 1] ?? 0) + b.words);
  return out;
}

export function buildGraph(
  root: SummaryNode,
  blocks: readonly Block[],
  collapsed: ReadonlySet<NodeId> = new Set(),
): ArticleGraph {
  const prefix = wordsBefore(blocks);

  const entries = walk(root, collapsed, MAX_DRAWN_DEPTH);

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

  // Containment and reading order, straight off the tree.
  const visit = (s: SummaryNode) => {
    if (collapsed.has(s.node.id)) return;
    let prev: SummaryNode | null = null;
    for (const c of s.children) {
      if (!byId.has(c.node.id)) continue;
      edges.push({ source: s.node.id, target: c.node.id, kind: "parent", weight: 1 });
      if (prev) {
        edges.push({ source: prev.node.id, target: c.node.id, kind: "sequence", weight: 1 });
      }
      prev = c;
      visit(c);
    }
  };
  visit(root);

  /* Vocabulary, between the deepest drawn nodes only. Between a part and its own
     section it would be near 1 by construction and would say nothing. */
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
    edges.push(e);
  }

  return {
    nodes,
    edges,
    byId,
    totalWords: prefix[prefix.length - 1] ?? 0,
    wordsBefore: prefix,
  };
}

/** Whether any node in the list claims this one as its container. */
function hasChild(nodes: readonly GraphNode[], n: GraphNode): boolean {
  return nodes.some((c) => c.depth === n.depth + 1 && c.startRow >= n.startRow && c.endRow <= n.endRow);
}
