/**
 * **The tree the author's own headings give us for free.** Deterministic, no
 * model, milliseconds — against ~163 seconds and a real bill for the model's.
 *
 * It began as arm zero of the ToC structure eval, the denominator every model
 * arm is read against, and that is still one of its two jobs: an eval that
 * scored model arms against nothing would credit the model for work the
 * headings did for free. **This file is the one implementation of both jobs**,
 * deliberately. If the eval measured one carving and the product shipped
 * another, every number in evals/results/ would describe something nobody
 * reads.
 *
 * What it is worth, measured on 2026-08-30 over seven development documents and
 * five held out (docs/investigations/260830a-opening-an-article-before-the-toc.md § 2, § 7b):
 *
 * - **6 of 7** have enough headings to carve at all;
 * - **4 of 7** reproduce the model's depth-one carving exactly;
 * - and on a *headingless* article the model is not merely better, it is
 *   unstable — identical input gave 8, 7, 8 and 3 parts across four runs. So
 *   the free tree is weakest exactly where the paid one is least trustworthy,
 *   and strongest where the paid one agrees with it anyway.
 *
 * What it deliberately cannot do, and where that shows up in the measures:
 * - **No gists.** There is nowhere free to get one, so every internal node
 *   trips checkTree's gist rule. scoreTree reports those separately
 *   (`validity.gistProblems`) so the structural questions stay askable.
 * - **No boundaries between headings.** A 40-block run under one heading stays
 *   one section; the model is asked to cut runs longer than ~9 blocks at topic
 *   shifts. Shows up in `fanout` and `parts.balanceCv`.
 * - **A preamble part with a stock title** when the article does not open on a
 *   heading — exactly the label the model is told not to write.
 *
 * ## The section-level rule
 *
 * "Which heading level is the section level" is a real sub-problem, and the
 * naive rule — the shallowest tag that appears more than once — gets
 * fowler-phrenology wrong: it has two h1s (title-ish) and six h2s. So, two
 * rules rather than one:
 *
 * 1. **The section level is the shallowest level with at least three headings,
 *    falling back to at least two, else no sections at all** (flat
 *    root+leaves). Three, because one heading is a title and two is as likely
 *    a title plus an afterword as it is a structure; three of anything is a
 *    series. Headings *shallower* than the section level still cut (a section
 *    must not cross an h1); deeper ones nest one level down, capped at
 *    internal depth 2 to match the shape the prompt asks the model for.
 * 2. **A segment with almost no prose merges into the next one** (the last
 *    merges backwards). Level alone leaves three kinds of stub on this corpus:
 *    the constitution's `h1` title makes a 6-word part before "Overview";
 *    scaling-hypothesis's "Appendix" heading is immediately followed by the
 *    next heading; and its trailing "Backlinks"/"Bibliography" furniture makes
 *    1–7-word parts. A merged segment is titled by the first heading block
 *    anywhere inside it, which is also what stops a heading-less preamble that
 *    merged into its first section wearing the stock preamble title.
 *
 * fowler-phrenology is the rule's honest failure and stays one: every heading
 * sits in the first ten blocks (catalogue front-matter), so merging collapses
 * the carving toward one part and the build falls back to flat. No heading
 * rule can carve that document — which is precisely the case where the model
 * arm earns its money, and why fowler stays in the corpus.
 */

import { isStructural } from "./block-policy.js";
import { PREAMBLE_TITLE, sameHeading, UNTITLED_WINDOW_TITLE } from "./heading-text.js";
import { MAX_BATCH } from "./labels.js";
import { appendSupplement, splitBlocks } from "./supplement.js";
import type { Block, NodeId, Tree, TreeNode } from "./types.js";

/** What one build chose, alongside the tree itself. */
export interface HeadingTreeResult {
  tree: Tree;
  /** The heading level used for depth-one cuts, or null when the tree is flat. */
  sectionLevel: number | null;
  /**
   * True when the tree is root + one leaf per block — either no level
   * qualified, or (fowler's case) merging left fewer than two real segments.
   * `sectionLevel` stays non-null in the second case so the two are tellable
   * apart.
   */
  flat: boolean;
  /** Depth-one body parts (0 when flat). */
  parts: number;
}

/**
 * Stamped into `tree.version` / `tree.generator` so nothing mistakes this for a
 * model's work.
 *
 * **Neither field is what tells a consumer this tree is provisional** — nothing
 * in the app branches on `version` or `generator`, they are shown in the
 * metadata panel and otherwise inert. `provisional` on the tree is the load-
 * bearing one; these two are for a human reading `tree.json`.
 */
export const HEADING_TREE_VERSION = "headings/1";
export const HEADING_TREE_GENERATOR = "deterministic-headings";

/* `PREAMBLE_TITLE` lives in src/heading-text.ts, so the browser can tell it is ours. */
export { PREAMBLE_TITLE };

/**
 * A segment whose non-heading prose is under this many words is a stub — a
 * bare title, a heading followed directly by another heading, a "Backlinks"
 * footer — and merges into its neighbour.
 *
 * **20 was fitted to the seven dev documents**, not discovered: it sits
 * between the biggest stub this corpus produces (a 14-word preamble) and the
 * smallest real section, and a different corpus could want a different value.
 * That is why the dev set is frozen (corpus.ts) and why the runner's
 * `--sensitivity` mode reports the carving at 0/10/20/40 — held-out documents
 * judge the rule as it stands, with no re-tuning after seeing them.
 */
export const MIN_SEGMENT_PROSE_WORDS = 20;

function headingLevel(block: Block): number | null {
  if (block.kind !== "heading") return null;
  if (block.level) return block.level;
  const m = /^h([1-6])$/.exec(block.tag);
  return m ? Number(m[1]) : 6;
}

/**
 * The shallowest level with at least `min` headings. Levels are searched
 * shallow-to-deep so an article with three h2s and twenty h3s sections on the
 * h2s, as it should.
 */
function pickLevel(counts: Map<number, number>, min: number): number | null {
  const levels = [...counts.keys()].sort((a, b) => a - b);
  for (const level of levels) if ((counts.get(level) ?? 0) >= min) return level;
  return null;
}

interface Segment {
  lo: number;
  hi: number;
}

/** Cut [cuts[0], hi] at every index in `cuts`. */
const segmentsFrom = (cuts: number[], hi: number): Segment[] =>
  cuts.map((lo, s) => ({ lo, hi: s + 1 < cuts.length ? cuts[s + 1]! - 1 : hi }));

/** The words a reader would actually read in a segment — headings excluded. */
function proseWords(body: Block[], seg: Segment): number {
  let sum = 0;
  for (let i = seg.lo; i <= seg.hi; i++) {
    const b = body[i]!;
    if (headingLevel(b) === null) sum += b.words;
  }
  return sum;
}

/**
 * Rule 2: a stub segment merges into the one after it (a heading introduces
 * what follows), and a trailing run of stubs merges back into the last real
 * segment. One left-to-right pass, so a run of stubs chains into whichever
 * real segment comes next.
 */
function mergeStubs(segments: Segment[], isStub: (seg: Segment) => boolean): Segment[] {
  const merged: Segment[] = [];
  let pendingLo: number | null = null;
  for (const seg of segments) {
    const lo: number = pendingLo ?? seg.lo;
    if (isStub(seg)) {
      pendingLo = lo;
      continue;
    }
    merged.push({ lo, hi: seg.hi });
    pendingLo = null;
  }
  if (pendingLo !== null) {
    const last = merged.at(-1);
    const hi = segments.at(-1)!.hi;
    if (last) last.hi = hi;
    else merged.push({ lo: pendingLo, hi });
  }
  return merged;
}

/** How many headings the body has at each level, and rule 1's choice among them. */
function sectionLevelOf(body: Block[]): { levels: Map<number, number>; sectionLevel: number | null } {
  const levels = new Map<number, number>();
  for (const b of body) {
    const level = headingLevel(b);
    if (level !== null) levels.set(level, (levels.get(level) ?? 0) + 1);
  }
  return { levels, sectionLevel: pickLevel(levels, 3) ?? pickLevel(levels, 2) };
}

/** Indices in [lo, hi] of headings at `level` or shallower. */
function headingCuts(body: Block[], lo: number, hi: number, level: number): number[] {
  const cuts: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const l = headingLevel(body[i]!);
    if (l !== null && l <= level) cuts.push(i);
  }
  return cuts;
}

/** The level sub-sections cut at: the next one down, chosen once for the whole article. */
function subLevelOf(levels: Map<number, number>, sectionLevel: number): number {
  const deeper = [...levels.keys()].filter((l) => l > sectionLevel).sort((a, b) => a - b);
  return deeper[0] ?? sectionLevel;
}

export function buildHeadingTree(
  blocks: Block[],
  slug: string,
  articleTitle?: string,
  /** Override for --sensitivity only; every arm uses the fitted default. */
  stubThreshold: number = MIN_SEGMENT_PROSE_WORDS,
): HeadingTreeResult {
  /* Body only, apparatus appended after — the same order generateStructure uses
     (src/structure.ts), so a bibliography can never sit inside a section. */
  const { body, groups } = splitBlocks(blocks);

  const { levels, sectionLevel } = sectionLevelOf(body);
  const isStub = (seg: Segment): boolean => proseWords(body, seg) < stubThreshold;

  const nodes: Record<NodeId, TreeNode> = {};
  let counter = 0;
  const nextId = (): NodeId => `n${String(++counter).padStart(4, "0")}`;

  const addNode = (node: TreeNode): TreeNode => {
    nodes[node.id] = node;
    return node;
  };

  /** Grow one leaf per block of [lo, hi] under `parent`. Heading leaves carry their own text as navLabel. */
  const growLeaves = (parent: TreeNode, lo: number, hi: number): void => {
    for (let i = lo; i <= hi; i++) {
      const block = body[i]!;
      const label = block.kind === "heading" && isStructural(block) ? block.text : undefined;
      const leaf = addNode({
        id: nextId(),
        depth: parent.depth + 1,
        parent: parent.id,
        children: [],
        range: [block.id, block.id],
        title: "",
        ...(label ? { navLabel: label } : {}),
      });
      parent.children.push(leaf.id);
    }
  };

  /**
   * One node per segment under `parent`. A segment is titled by the first
   * heading block anywhere inside it — not only at its start, because a merge
   * can put a heading-less preamble in front of the section's own heading —
   * and only a segment with no heading at all wears the stock preamble title,
   * which is honestly this arm's weakest node.
   */
  const addSections = (parent: TreeNode, segments: Segment[], subLevel: number | null): void => {
    for (const seg of segments) {
      let sectionHeading: Block | null = null;
      for (let i = seg.lo; i <= seg.hi && !sectionHeading; i++) {
        if (headingLevel(body[i]!) !== null) sectionHeading = body[i]!;
      }
      const section = addNode({
        id: nextId(),
        depth: parent.depth + 1,
        parent: parent.id,
        children: [],
        range: [body[seg.lo]!.id, body[seg.hi]!.id],
        title: sectionHeading ? sectionHeading.text : PREAMBLE_TITLE,
        ...(sectionHeading ? { sourceHeading: sectionHeading.text } : {}),
      });
      parent.children.push(section.id);

      /* One nesting step, capped at internal depth 2 — the prompt's own shape.
         Sub-cuts are headings strictly after the segment's start, at the
         section level or the shallowest deeper one (a merge can leave a
         section-level heading in the interior), and only when there are at
         least two of them: one sub-heading makes a preamble-plus-stub pair
         that navigates worse than the flat section. */
      let subSegments: Segment[] = [];
      if (subLevel !== null && section.depth < 2) {
        const candidates = headingCuts(body, seg.lo + 1, seg.hi, subLevel);
        if (candidates.length >= 2) {
          subSegments = mergeStubs(segmentsFrom([seg.lo, ...candidates], seg.hi), isStub);
        }
      }
      if (subSegments.length >= 2) {
        addSections(section, subSegments, null);
      } else {
        growLeaves(section, seg.lo, seg.hi);
      }
    }
  };

  const firstHeading = body.find((b) => headingLevel(b) !== null);
  const root = addNode({
    id: nextId(),
    depth: 0,
    parent: null,
    children: [],
    range: [body[0]!.id, body.at(-1)!.id],
    title: articleTitle ?? firstHeading?.text ?? slug,
  });

  let parts = 0;
  let flat = sectionLevel === null;
  if (sectionLevel !== null) {
    const cuts = headingCuts(body, 0, body.length - 1, sectionLevel);
    if (cuts[0] !== 0) cuts.unshift(0);
    const segments = mergeStubs(segmentsFrom(cuts, body.length - 1), isStub);
    /* Fewer than two survivors means the headings carried no prose structure —
       fowler's catalogue front-matter — and one section wrapping the whole
       article is a worse rendering of "no structure" than none. */
    if (segments.length < 2) {
      flat = true;
    } else {
      /* The next level down, chosen once for the whole article rather than per
         part, so two chapters with h3s and h4s respectively do not nest by
         different rules. */
      addSections(root, segments, subLevelOf(levels, sectionLevel));
      parts = root.children.length;
    }
  }
  if (flat) growLeaves(root, 0, body.length - 1);

  const tree: Tree = {
    version: HEADING_TREE_VERSION,
    generator: HEADING_TREE_GENERATOR,
    slug,
    rootId: root.id,
    nodes,
    /* **The marker, and it is set here rather than by the caller.** A tree from
       this file has no gists and can never acquire them, so it fails the gist
       rule by construction — and the exemption `checkTree` makes for it must be
       keyed on something a caller cannot forget to set. Tree-level rather than
       per-node because the whole tree is replaced at once and no node of it
       becomes final on its own; explicit rather than inferred from the missing
       gists for the same reason `treatment` exists at all. See
       src/tree-invariants.ts and docs/investigations/260830a-opening-an-article-before-the-toc.md § 2. */
    provisional: "headings",
  };

  return {
    tree: appendSupplement(tree, groups),
    sectionLevel,
    flat,
    parts,
  };
}

/* ------------------------------------------------- the bounded tree -- */

/** What one bounded build chose, alongside the tree itself. */
export interface BoundedHeadingTreeResult {
  tree: Tree;
  /** True when the parts are runs of windows rather than the author's sections. */
  flat: boolean;
  /** Depth-one body parts. */
  parts: number;
  /** Depth-two sections: the author's sub-headings, and the windows. */
  sections: number;
}

/** Its own pair, so a stored tree says which of the two builders in this file made it. */
export const BOUNDED_TREE_VERSION = "headings-bounded/1";
export const BOUNDED_TREE_GENERATOR = "deterministic-headings-bounded";

/* Lives in src/heading-text.ts beside `PREAMBLE_TITLE`, so the browser can tell it is ours. */
export { UNTITLED_WINDOW_TITLE };

/** A window's title is at most this much of its opening block. */
const WINDOW_TITLE_WORDS = 8;
const WINDOW_TITLE_CHARS = 60;
/** Words with a letter in them that a block needs before its opening titles a window. */
const WINDOW_TITLE_MIN_WORDS = 3;

/** A heading this many times over is a running page header, not a section. Five: no real book has that many "Exercises". A guess. */
export const REPEATED_HEADING_MIN = 5;

/** Root, two parts, two sections each, a leaf apiece: the least a depth-3 tree can be. */
const MIN_BOUNDED_BODY = 4;

const hasText = (b: Block): boolean => b.text.trim() !== "";

/** The opening words of `text`, cut at a word, with an ellipsis only when something was cut. */
function openingWords(text: string): string {
  /* Four dots or more is a contents line's leader, not an ellipsis. */
  const all = text.replace(/(?:\.\s*){4,}/g, " ").trim().split(/\s+/);
  const kept: string[] = [];
  for (const word of all.slice(0, WINDOW_TITLE_WORDS)) {
    if (kept.length > 0 && [...kept, word].join(" ").length > WINDOW_TITLE_CHARS) break;
    kept.push(word);
  }
  /* A title is a label, not a sentence: checkTree advises against the full stop. */
  const title = kept.join(" ").slice(0, WINDOW_TITLE_CHARS).replace(/[.,;:!?]+$/, "");
  if (title === "") return UNTITLED_WINDOW_TITLE;
  return kept.length < all.length ? `${title}…` : title;
}

/** What a node will be called, and the heading it is quoting if it is. */
type Titled = Pick<TreeNode, "title" | "sourceHeading" | "titleFrom">;

interface PlannedPart extends Titled {
  seg: Segment;
  sections: (Titled & { seg: Segment })[];
}

/**
 * `body` as the heading rules should see it: a heading repeated down the
 * document is a PDF's running page header transcribed as one, so it is shown to
 * them as ordinary text and cuts, counts for and titles nothing. So is the
 * article's own title once it appears twice. Compared by `sameHeading`, so a
 * curly apostrophe on some pages does not split the count.
 */
function demoteFurniture(body: Block[], articleTitle: string | undefined): Block[] {
  const seen: { text: string; count: number }[] = [];
  const kindOf = body.map((b) => {
    if (headingLevel(b) === null) return null;
    const kind = seen.find((k) => sameHeading(k.text, b.text)) ?? { text: b.text, count: 0 };
    if (kind.count === 0) seen.push(kind);
    kind.count++;
    return kind;
  });
  const title = articleTitle?.trim();
  /* And a "heading" with no letter in it: a scene break or a page number. */
  const isFurniture = (kind: { text: string; count: number }): boolean =>
    !/\p{L}/u.test(kind.text) ||
    kind.count >= REPEATED_HEADING_MIN || (!!title && kind.count > 1 && sameHeading(kind.text, title));
  return body.map((b, i) => {
    const kind = kindOf[i];
    /* No words either, so a window is not titled by its opening "words". */
    return kind && isFurniture(kind) ? { ...b, kind: "text" as const, words: 0 } : b;
  });
}

/**
 * Where the parts and sections of a bounded tree fall, and what each is called.
 * `body` is `demoteFurniture`'s, and indices into it are indices into the real one.
 */
function planBoundedParts(body: Block[]): { planned: PlannedPart[]; flat: boolean } {
  const quoting = (i: number): Titled => ({ title: body[i]!.text, sourceHeading: body[i]!.text });
  /** A heading with words in it. One without titles nothing: checkTree refuses an empty title. */
  const isTitleHeading = (i: number): boolean => headingLevel(body[i]!) !== null && hasText(body[i]!);

  /** The heading [lo, hi] opens on, allowing a stub's worth of prose before it as rule 2 does. */
  const openingHeading = (seg: Segment, not: number | null): number | null => {
    let prose = 0;
    for (let i = seg.lo; i <= seg.hi && prose < MIN_SEGMENT_PROSE_WORDS; i++) {
      if (isTitleHeading(i) && i !== not) return i;
      if (headingLevel(body[i]!) === null) prose += body[i]!.words;
    }
    return null;
  };

  /**
   * The heading it opens on, else the opening words of its first paragraph
   * that has any, else a heading anywhere in it, else the stock title. `not`
   * is the heading the parent wears, so a part's first section does not repeat
   * the part.
   */
  const titleOf = (seg: Segment, not: number | null): Titled => {
    const opens = openingHeading(seg, not);
    if (opens !== null) return quoting(opens);
    /* A paragraph of real words first: a scene break ("#"), a page number or a
       one-word line of dialogue opens many windows and names none. */
    for (const enough of [WINDOW_TITLE_MIN_WORDS, 0]) {
      for (let i = seg.lo; i <= seg.hi; i++) {
        const b = body[i]!;
        if (headingLevel(b) !== null || b.words === 0 || !hasText(b)) continue;
        if ((b.text.match(/\S*\p{L}\S*/gu) ?? []).length < enough) continue;
        const title = openingWords(b.text);
        /* The author's words, and the node says so: src/types.ts § `TreeNode.titleFrom`. */
        return title === UNTITLED_WINDOW_TITLE ? { title } : { title, titleFrom: "opening-words" };
      }
    }
    for (let i = seg.lo; i <= seg.hi; i++) if (isTitleHeading(i)) return quoting(i);
    return { title: UNTITLED_WINDOW_TITLE };
  };

  /**
   * [lo, hi] as consecutive windows of at most `MAX_BATCH` blocks, near-equal,
   * and at least `atLeast` of them (the caller guarantees that many blocks). A
   * window does not end on a heading where it can help it: the heading opens
   * the next one.
   */
  const windows = (seg: Segment, atLeast: number): Segment[] => {
    const out: Segment[] = [];
    let lo = seg.lo;
    for (let owed = atLeast; ; owed--) {
      const left = seg.hi - lo + 1;
      const count = Math.max(owed, Math.ceil(left / MAX_BATCH));
      if (count <= 1) {
        out.push({ lo, hi: seg.hi });
        return out;
      }
      let hi = lo + Math.ceil(left / count) - 1;
      while (hi > lo && headingLevel(body[hi]!) !== null) hi--;
      out.push({ lo, hi });
      lo = hi + 1;
    }
  };

  /** `own` is the heading the part wears, if it wears one. */
  const partOf = (seg: Segment, own: number | null, cut: Segment[]): PlannedPart => ({
    seg,
    ...(own !== null ? quoting(own) : titleOf(seg, null)),
    sections: cut.map((w) => ({ seg: w, ...titleOf(w, own) })),
  });

  const { levels, sectionLevel } = sectionLevelOf(body);
  const whole: Segment = { lo: 0, hi: body.length - 1 };

  if (sectionLevel !== null) {
    const cuts = headingCuts(body, 0, whole.hi, sectionLevel);
    if (cuts[0] !== 0) cuts.unshift(0);
    const isStub = (seg: Segment): boolean => proseWords(body, seg) < MIN_SEGMENT_PROSE_WORDS;
    /* A one-block part cannot hold a section (a sole child covering its parent
       is refused by checkTree), so it merges as a stub does. */
    const segments = mergeStubs(segmentsFrom(cuts, whole.hi), (seg) => seg.lo === seg.hi || isStub(seg));
    if (segments.length >= 2) {
      const subLevel = subLevelOf(levels, sectionLevel);
      const planned = segments.map((seg) => {
        const own = headingCuts(body, seg.lo, seg.hi, 6).find((i) => isTitleHeading(i)) ?? null;
        /* One sub-heading is enough here, where `buildHeadingTree` wants two:
           this part must be cut somewhere, and the author's cut beats ours. */
        const subs = mergeStubs(
          segmentsFrom([seg.lo, ...headingCuts(body, seg.lo + 1, seg.hi, subLevel)], seg.hi),
          isStub,
        );
        return partOf(seg, own, subs.length >= 2 ? subs.flatMap((sub) => windows(sub, 1)) : windows(seg, 2));
      });
      return { planned, flat: false };
    }
  }

  /* No usable headings. Four windows at least, so there can be two parts of
     two. Parts are near-equal runs of windows, about as many as each then has
     sections. */
  const all = windows(whole, MIN_BOUNDED_BODY);
  const count = Math.max(2, Math.min(Math.floor(all.length / 2), Math.ceil(Math.sqrt(all.length))));
  const planned: PlannedPart[] = [];
  for (let p = 0, at = 0; p < count; p++) {
    const take = Math.floor(all.length / count) + (p < all.length % count ? 1 : 0);
    const run = all.slice(at, at + take);
    at += take;
    const seg = { lo: run[0]!.lo, hi: run.at(-1)!.hi };
    planned.push(partOf(seg, openingHeading(seg, null), run));
  }
  return { planned, flat: true };
}

/**
 * **The tree for a document no model can be asked about in one call**: the
 * shape a model's tree has (root, parts, sections, every body block a leaf at
 * depth 3) with no section holding more than `MAX_BATCH` leaves.
 *
 * Both halves of that are for a consumer that cannot cope with less. The client
 * takes one section depth for the whole article (src/web/position.ts §
 * `sectionDepth`), and the labels step never cuts a sibling set
 * (src/labels.ts § `planBatches`), so a flat or mixed-depth tree breaks the
 * first and one long run under a heading breaks the second.
 * docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md.
 *
 * Parts are `buildHeadingTree`'s, by the same two rules. Sections are a part's
 * sub-headings, and any run longer than the bound is cut into near-equal
 * consecutive windows. Without usable headings the windows are the sections and
 * runs of them are the parts.
 *
 * Throws on a body under four blocks, which cannot have this shape.
 */
export function buildBoundedHeadingTree(
  blocks: Block[],
  slug: string,
  articleTitle?: string,
): BoundedHeadingTreeResult {
  const { body, groups } = splitBlocks(blocks);
  if (body.length < MIN_BOUNDED_BODY) {
    throw new Error(
      `A bounded headings tree needs at least ${MIN_BOUNDED_BODY} body blocks and "${slug}" has ${body.length}.`,
    );
  }

  const { planned, flat } = planBoundedParts(demoteFurniture(body, articleTitle));
  const whole: Segment = { lo: 0, hi: body.length - 1 };

  const nodes: Record<NodeId, TreeNode> = {};
  let counter = 0;
  const add = (parent: TreeNode | null, seg: Segment, extra: Partial<TreeNode>): TreeNode => {
    const node: TreeNode = {
      id: `n${String(++counter).padStart(4, "0")}`,
      depth: parent ? parent.depth + 1 : 0,
      parent: parent ? parent.id : null,
      children: [],
      range: [body[seg.lo]!.id, body[seg.hi]!.id],
      title: "",
      ...extra,
    };
    nodes[node.id] = node;
    parent?.children.push(node.id);
    return node;
  };

  const rootTitle = [articleTitle ?? "", ...body.filter((b) => headingLevel(b) !== null).map((b) => b.text), slug]
    .map((t) => t.trim())
    .find((t) => t !== "");
  const root = add(null, whole, { title: rootTitle ?? slug });
  let sections = 0;
  for (const { seg, sections: inside, ...titled } of planned) {
    const part = add(root, seg, titled);
    for (const { seg: at, ...sectionTitled } of inside) {
      const section = add(part, at, sectionTitled);
      sections++;
      for (let i = at.lo; i <= at.hi; i++) {
        const b = body[i]!;
        /* A heading leaf carries its own text, as in `buildHeadingTree`. */
        const label = b.kind === "heading" && isStructural(b) ? b.text : undefined;
        add(section, { lo: i, hi: i }, label ? { navLabel: label } : {});
      }
    }
  }

  const tree: Tree = {
    version: BOUNDED_TREE_VERSION,
    generator: BOUNDED_TREE_GENERATOR,
    slug,
    rootId: root.id,
    nodes,
    /* The same marker, for the same reason: no gists, and checkTree's exemption is keyed on it. */
    provisional: "headings",
  };
  return { tree: appendSupplement(tree, groups), flat, parts: planned.length, sections };
}
