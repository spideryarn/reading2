/**
 * **What Marginalia mode puts beside which block** — the pure half.
 *
 * Everything here is drawn from what the article already has: the Socratic
 * question the structure call wrote on each top-level part
 * (src/hierarchy.ts § `questionFor`), the arc, and the ideas where the reader
 * has made them. Nothing is generated for this mode.
 *
 * **Sparse on purpose.** The risk this mode runs against vision.md is a second
 * article down the margin, so it never draws a gist or a label per paragraph:
 * one question per part, a stamp where an idea occurs, and nothing else.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 *
 * Ranges are resolved by block position, never by comparing id strings
 * (docs/project/block-ids.md).
 */
import type {
  Arc,
  Block,
  BlockId,
  CitedWork,
  Comment,
  FaqQuestion,
  Idea,
  IdeaProvenance,
  Tree,
} from "../../types.js";
import type { PublicClaimDebateRow, PublicComment } from "../../public-types.js";
import { findQuote } from "../../quote-match.js";
import { blockIndex, sectionNodesOf } from "../../section-path.js";

/** A Debate claim row, the owner's or a visitor's — every owner row is one. */
export type MarginClaim = PublicClaimDebateRow;
/** A comment or bookmark, the owner's or a visitor's. */
export type MarginComment = Comment | PublicComment;

export type MarginaliaNote =
  /** The question a part — or, at `depth` 0, the whole article — answers. */
  | { kind: "question"; depth: number; text: string }
  /** An idea the piece assumes or introduces, occurring in this block. */
  | {
      kind: "idea";
      ideaId: string;
      name: string;
      statement: string;
      provenance: IdeaProvenance;
    }
  /* **Other modes' items, one shut line per kind per block** — report 82,
     docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md.
     `items` is never empty. */
  /** FAQ questions this block answers, each with the words here that do. */
  | { kind: "faq"; items: { question: FaqQuestion; quote: string }[] }
  /** Pages on the web that answer a claim made in this block. */
  | { kind: "debate"; items: MarginClaim[] }
  /** Works first cited in this block. Owner only — the caller's rule. */
  | { kind: "citation"; items: CitedWork[] }
  /** The reader's own comments and bookmarks on this block. */
  | { kind: "comment"; items: MarginComment[] };

/**
 * **What other modes have already stored**, each already filtered by the caller
 * for whether it may be shown at all (owner, fresh). Absent or null is "none".
 */
export type MarginSources = {
  faq?: readonly FaqQuestion[] | null;
  claims?: readonly MarginClaim[] | null;
  citations?: readonly CitedWork[] | null;
  comments?: readonly MarginComment[] | null;
};

type GroupedKind = Extract<MarginaliaNote, { items: unknown }>;
/** The order the kinds are drawn in below the question and the stamps. */
const GROUPED_ORDER = ["faq", "debate", "citation", "comment"] as const;

/** A sentence's worth: fewer words than this is a heading, a date or a byline. */
export const PARAGRAPH_MIN_WORDS = 12;

/**
 * The notes for every block that has any, in the order they are drawn.
 *
 * The part's question first, then ideas in the artefact's own order
 * (assumed first — src/types.ts § `Ideas.ideas`), each once, beside the first
 * block it occurs in. A node or occurrence naming a block this article no
 * longer has is skipped, so a stale artefact cannot place a note nowhere.
 */
export function marginaliaNotes(
  tree: Tree | null | undefined,
  blocks: readonly Block[],
  ideas: readonly Idea[] | null | undefined,
  more: MarginSources = {},
): Map<BlockId, MarginaliaNote[]> {
  const index = blockIndex(blocks);
  const out = new Map<BlockId, MarginaliaNote[]>();
  const add = (blockId: BlockId, note: MarginaliaNote) => {
    if (!index.has(blockId)) return;
    const list = out.get(blockId);
    if (list) list.push(note);
    else out.set(blockId, [note]);
  };

  /* **Beside the part's first paragraph, not its first block.** A part's range
     starts at its heading, or at the date line under the title, and a question
     drawn level with those reads as a caption for them (GPT Astra's design
     pass, 2026-10-01). The first gistable text block of at least a sentence's
     words, then; the range's own start when it has none.

     **The word floor is the rule that does the work, and it is a heuristic.**
     `kind` alone is not enough: an essay that bolds a one-word line for a
     heading ("Jobs", "Bounds") stores it as `text`, and so is the date line
     and the "~23 min read" under a title — measured on `love-spya-kwm06n` in
     the browser, where a kind-only rule put every one of six questions beside
     one of those. */
  const firstParagraph = (range: readonly [BlockId, BlockId]): BlockId => {
    const lo = index.get(range[0]);
    const hi = index.get(range[1]);
    if (lo === undefined || hi === undefined) return range[0];
    for (let i = lo; i <= hi; i++) {
      const block = blocks[i];
      if (block && block.kind === "text" && block.gistable && block.words >= PARAGRAPH_MIN_WORDS) {
        return block.id;
      }
    }
    return range[0];
  };

  /* **The parts' questions, and not the article's own** (`depth` 0). Drawn
     beside the first lines it ran straight into the first part's question —
     nine lines of questions before a word of the argument — so the root's is
     left out, and the column asks one question per part. GPT Astra's design
     pass, 2026-10-01. */
  const root = tree?.nodes[tree.rootId];
  if (tree && root) {
    for (const id of root.children) {
      const part = tree.nodes[id];
      if (part?.question) {
        add(firstParagraph(part.range), { kind: "question", depth: 1, text: part.question });
      }
    }
  }

  /* **One stamp per idea, at its first occurrence in the article** — not at
     every one. An Ideas list is three to ten ideas with two to five
     occurrences each, so stamping them all could put fifty notes down the
     margin before a single question: the second article this mode must not
     become. The first is where the reader meets it. GPT Sol, F10. */
  for (const idea of ideas ?? []) {
    let first: BlockId | null = null;
    let firstAt = Number.POSITIVE_INFINITY;
    for (const occurrence of idea.occurrences) {
      const at = index.get(occurrence.blockId);
      if (at !== undefined && at < firstAt) {
        first = occurrence.blockId;
        firstAt = at;
      }
    }
    if (first === null) continue;
    add(first, {
      kind: "idea",
      ideaId: idea.id,
      name: idea.name,
      statement: idea.statement,
      provenance: idea.provenance,
    });
  }

  for (const [blockId, notes] of groupedNotes(index, blocks, more)) {
    for (const note of notes) add(blockId, note);
  }
  return out;
}

/**
 * **Other modes' items** (report 82): each placed at its earliest block *by
 * position* that still holds it, and grouped per kind per block, so a block
 * carries at most one line of each kind however many items land there. In
 * `GROUPED_ORDER` within a block; `marginaliaNotes` appends them after the
 * question and the stamps.
 */
function groupedNotes(
  index: ReadonlyMap<string, number>,
  blocks: readonly Block[],
  more: MarginSources,
): Map<BlockId, GroupedKind[]> {
  const grouped = new Map<BlockId, Partial<{ [K in GroupedKind["kind"]]: Extract<GroupedKind, { kind: K }>["items"] }>>();
  const put = <K extends GroupedKind["kind"]>(
    blockId: BlockId,
    kind: K,
    item: Extract<GroupedKind, { kind: K }>["items"][number],
  ) => {
    let byKind = grouped.get(blockId);
    if (!byKind) {
      byKind = {};
      grouped.set(blockId, byKind);
    }
    const list = (byKind[kind] ?? []) as unknown[];
    list.push(item);
    byKind[kind] = list as never;
  };
  /* **A quote is checked against the block it names, every time.** A
     visitor's payload carries no freshness verdict (src/store/public-reader.ts),
     so an artefact written against an earlier version of a block whose id
     survived could otherwise sit confidently beside prose that no longer says
     it. The forgiving pass, as every browser-side check against a block uses
     (quote-match.ts § `findQuote`); `start` only picks between repeats. */
  const holds = (blockId: BlockId, quote: string, near?: number): boolean => {
    const at = index.get(blockId);
    const block = at === undefined ? undefined : blocks[at];
    return block !== undefined && quote.trim() !== "" && findQuote(block.text, quote, near) !== null;
  };
  const earliest = <T>(candidates: readonly T[], blockOf: (c: T) => BlockId, ok: (c: T) => boolean): T | null => {
    let best: T | null = null;
    let bestAt = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const at = index.get(blockOf(c));
      if (at !== undefined && at < bestAt && ok(c)) {
        best = c;
        bestAt = at;
      }
    }
    return best;
  };

  for (const question of more.faq ?? []) {
    const passage = earliest(
      question.passages,
      (p) => p.blockId,
      (p) => holds(p.blockId, p.quote, p.start),
    );
    if (passage) put(passage.blockId, "faq", { question, quote: passage.quote });
  }
  for (const row of more.claims ?? []) {
    if (holds(row.blockId, row.claimQuote)) put(row.blockId, "debate", row);
  }
  for (const work of more.citations ?? []) {
    const first = earliest(work.citedAt, (id) => id, () => true);
    if (first !== null) put(first, "citation", work);
  }
  /* **Referee notes are not reading notes**: a comment with a `criterionId` is
     a peer-review placement (referee-mode.md), meaningless here without its
     criterion. A visitor's payload never carries one. GPT Sol, F6 on the plan. */
  for (const comment of more.comments ?? []) {
    if ("criterionId" in comment && comment.criterionId !== undefined) continue;
    if (index.has(comment.blockId)) put(comment.blockId, "comment", comment);
  }

  const out = new Map<BlockId, GroupedKind[]>();
  for (const [blockId, byKind] of grouped) {
    const list: GroupedKind[] = [];
    for (const kind of GROUPED_ORDER) {
      const items = byKind[kind];
      if (items && items.length > 0) list.push({ kind, items } as GroupedKind);
    }
    if (list.length > 0) out.set(blockId, list);
  }
  return out;
}

/**
 * **Where each note goes, given where it wants to be** — the one collision
 * rule, in document order: a note sits level with its block unless the note
 * above it is still in the way, in which case it starts `gap` below that one.
 *
 * O(n), order-preserving, and the rule Gwern's sidenotes and the Tufte
 * variants all use. Pure, so it is tested without a browser.
 */
export function layoutNotes(
  desired: readonly number[],
  heights: readonly number[],
  gap: number,
): number[] {
  const tops: number[] = [];
  let floor = Number.NEGATIVE_INFINITY;
  for (const [i, want] of desired.entries()) {
    const top = Math.max(want, floor);
    tops.push(top);
    floor = top + (heights[i] ?? 0) + gap;
  }
  return tops;
}

/**
 * **The head's path**: the part and the section that hold `blockId`, at most
 * two titles — Sol's "current section title" plus the one ancestor that says
 * where it sits. `[]` above the first part, or where the tree does not cover
 * the block.
 */
export function headPath(
  tree: Tree | null | undefined,
  index: ReadonlyMap<string, number>,
  blockId: BlockId | null,
): string[] {
  if (!tree || blockId === null) return [];
  return sectionNodesOf(blockId, index, tree)
    .slice(0, 2)
    .map((node) => node.title);
}

/** **The arc's sentence for the part holding `blockId`**, or null. */
export function arcAt(
  arc: Arc | null | undefined,
  index: ReadonlyMap<string, number>,
  blockId: BlockId | null,
): string | null {
  if (!arc || blockId === null) return null;
  const at = index.get(blockId);
  if (at === undefined) return null;
  for (const entry of arc.entries) {
    const lo = index.get(entry.range[0]);
    const hi = index.get(entry.range[1]);
    if (lo !== undefined && hi !== undefined && lo <= at && at <= hi) return entry.text;
  }
  return null;
}
