/**
 * **What Marginalia mode puts beside which block** — the pure half.
 *
 * Everything here is drawn from what the article already has: the Socratic
 * question the whole-document call wrote on each top-level part
 * (src/structure.ts § `questionFor`), the arc, and the ideas where the reader
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
  Relation,
  TimelineEvent,
  Tree,
} from "../../types.js";
import type { PublicClaimDebateRow, PublicComment } from "../../public-types.js";
import { findQuote } from "../../quote-match.js";
import { blockIndex, sectionNodesOf } from "../../section-path.js";
import { isSupplementNode } from "../../supplement.js";
import { titleVoice } from "../tree.js";
import { type AskedQuestion, type CommentKind, commentKind } from "../comment-nav.js";
import type { Voice } from "../voice.js";

/** A Debate claim row, the owner's or a visitor's — every owner row is one. */
export type MarginClaim = PublicClaimDebateRow;
/** A comment or bookmark, the owner's or a visitor's. */
export type MarginComment = Comment | PublicComment;

/**
 * **The relation words that are drawn, and the word each is drawn as.** The
 * step stores one of ten per paragraph (src/types.ts § `RELATIONS`); the margin
 * draws only the turns, where the argument changes direction or lands a
 * conclusion — Greg's "BUT, SO", and *vs* beside them. *And-also* on a third
 * of all paragraphs would be the second article down the margin this mode must
 * not become. Widening this is one row here and one in tips.ts, and no model
 * call. Plan 261003f.
 */
export const DRAWN_RELATIONS = {
  therefore: "so",
  but: "but",
  contrast: "vs",
} as const satisfies Partial<Record<Relation, string>>;
export type DrawnRelation = keyof typeof DRAWN_RELATIONS;

const isDrawn = (relation: Relation): relation is DrawnRelation => Object.hasOwn(DRAWN_RELATIONS, relation);

export type MarginaliaNote =
  /** How this paragraph bears on the one before it. First in its note. */
  | { kind: "relation"; relation: DrawnRelation }
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
  | {
      kind: "faq";
      items: { question: FaqQuestion; quote: string; morePassages: number }[];
    }
  /** Events the piece dates in this block, each with the words here that
      mention it — plan 261003f. */
  | { kind: "timeline"; items: { event: TimelineEvent; quote: string }[] }
  /** Pages on the web that answer a claim made in this block. */
  | { kind: "debate"; items: MarginClaim[] }
  /** Works first cited in this block. Owner only — the caller's rule. */
  | { kind: "citation"; items: CitedWork[] }
  /** The reader's own comments on this block, and the questions they asked
      from it — each with its kind (SPIDERYARN-READING2-9H, plan 261002j). */
  | { kind: "comment"; items: MarginEntry[] };

/**
 * **One of the reader's marks, with which of three it is** — a comment, a
 * comment that also asked the AI, or a question (a conversation started from
 * the passage). `commentKind` in comment-nav.ts says which; a bare bookmark
 * never gets here.
 */
export type MarginEntry =
  | { as: Exclude<CommentKind, "bookmark" | "highlight">; comment: MarginComment }
  | { as: "question"; asked: AskedQuestion };

/**
 * **What other modes have already stored**, each already filtered by the caller
 * for whether it may be shown at all (owner, fresh). Absent or null is "none".
 */
export type MarginSources = {
  faq?: readonly FaqQuestion[] | null;
  timeline?: readonly TimelineEvent[] | null;
  claims?: readonly MarginClaim[] | null;
  citations?: readonly CitedWork[] | null;
  comments?: readonly MarginComment[] | null;
  /** Questions the reader asked from a passage — the owner's only; a visitor's payload has no chats. */
  asked?: readonly AskedQuestion[] | null;
  /** How each paragraph bears on the one before — the owner's only in v1. */
  relations?: Readonly<Record<BlockId, Relation>> | null;
};

type GroupedKind = Extract<MarginaliaNote, { items: unknown }>;
type GroupedItems = Partial<{
  [K in GroupedKind["kind"]]: Extract<GroupedKind, { kind: K }>["items"];
}>;
/** The order the kinds are drawn in below the question and the stamps. */
const GROUPED_ORDER = ["faq", "timeline", "debate", "citation", "comment"] as const;

/** Turn the placement accumulator into the discriminated notes the renderer consumes. */
function inGroupedOrder(grouped: ReadonlyMap<BlockId, GroupedItems>): Map<BlockId, GroupedKind[]> {
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

  /* **The relation word first**: it is about the paragraph's opening, and it
     is the shortest thing in the note. In article order, like everything
     else, so the column's collision pass sees notes top to bottom. */
  for (const block of blocks) {
    const relation = more.relations?.[block.id];
    if (relation !== undefined && isDrawn(relation)) add(block.id, { kind: "relation", relation });
  }

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
  const grouped = new Map<BlockId, GroupedItems>();
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
    const surviving = question.passages.filter((p) => holds(p.blockId, p.quote, p.start));
    const passage = earliest(
      surviving,
      (p) => p.blockId,
      () => true,
    );
    if (passage) {
      put(passage.blockId, "faq", {
        question,
        quote: passage.quote,
        morePassages: surviving.length - 1,
      });
    }
  }
  /* **Only the events the piece dates** — a date, its own words for when
     ("a month later"), or a date with no year ("On July 7"), which the band
     also shows in the article's words (`datingWords`, TimelinePanel.tsx). An
     untimed event is a label with nothing to say about time, and the other
     rejected dates are our failure rather than the article's; those stay in
     the band, which says what each means (timeline.md § The four dating
     states).

     **Beside the passage the date was read from, not the first mention.** An
     event mentioned undated and later as "By 12 July…" would otherwise put
     "at or before 12 Jul" beside words that give no date (GPT Sol, P1 on plan
     261003f). A date's passage is `when.at`; the article's own phrase, which
     is stored without a position, is found in the earliest mention whose
     quote still holds it. Either way the phrase must still be in the block.

     **Inside the mention's quote, not merely in its block.** The server keeps
     a phrase only when it lies within an occurrence's quote (`locatePhrase`,
     src/timeline.ts), so a block that says "On July 7" of another event and
     quotes this one without it is not where this one is dated (GPT Sol, F4 on
     plan 261005h). */
  const quoteHolds = (o: TimelineEvent["occurrences"][number], phrase: string): boolean => {
    const at = index.get(o.blockId);
    const text = at === undefined ? undefined : blocks[at]?.text;
    if (text === undefined || o.quote.trim() === "" || phrase.trim() === "") return false;
    const span = findQuote(text, o.quote, o.start);
    return span !== null && findQuote(text.slice(span.start, span.end), phrase) !== null;
  };
  const besidePhrase = (event: TimelineEvent, phrase: string) => {
    const mention = earliest(
      event.occurrences,
      (o) => o.blockId,
      (o) => quoteHolds(o, phrase),
    );
    if (mention) put(mention.blockId, "timeline", { event, quote: mention.quote });
  };
  for (const event of more.timeline ?? []) {
    const { dating } = event;
    switch (dating.kind) {
      case "dated": {
        const { blockId, start } = dating.when.at;
        if (!holds(blockId, dating.when.phrase, start)) break;
        const mention = event.occurrences.find((o) => o.blockId === blockId && holds(o.blockId, o.quote, o.start));
        if (mention) put(blockId, "timeline", { event, quote: mention.quote });
        break;
      }
      case "words":
        besidePhrase(event, dating.phrase);
        break;
      case "rejected":
        if (dating.reason === "noYearFrame" && dating.phrase !== null) besidePhrase(event, dating.phrase);
        break;
      case "untimed":
        break;
      default:
        dating satisfies never;
    }
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
     criterion. A visitor's payload never carries one. GPT Sol, F6 on the plan.
     **Nor is a bare bookmark**: with no words and no answer there is nothing to
     say, the gutter already marks its block, and in the browser a column of
     lone "Bookmark" stamps read as noise (2026-10-02). "Bare" is
     `commentKind`'s bookmark, so a wordless comment that asked the AI (it has a
     `threadId`) still shows — GPT Sol, P1 on plan 261002j.
     **Nor a wordless highlight** (2026-10-03, plan 261003e S9), for the same
     reason: its colour is already on the words, and there is nothing to say
     beside them. A coloured comment with words or an AI answer is a `comment`
     or `comment-ai` and still shows. */
  for (const comment of more.comments ?? []) {
    if ("criterionId" in comment && comment.criterionId !== undefined) continue;
    const as = commentKind(comment);
    if (as === "bookmark" || as === "highlight") continue;
    if (index.has(comment.blockId)) put(comment.blockId, "comment", { as, comment });
  }
  /* **The questions asked from a passage, in the same line as its comments**:
     Greg named them as the third kind of the same thing (9H), and a second line
     per block would spend the density 261002b bought. */
  for (const asked of more.asked ?? []) {
    if (index.has(asked.blockId)) put(asked.blockId, "comment", { as: "question", asked });
  }

  return inGroupedOrder(grouped);
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
 * **The block the head speaks for.** The reader's own block, with one
 * exception: an uncovered block *above the first part* (a title, a byline, an
 * abstract), or no block at all, answers with the first part's first
 * block. So the head names the first part from the very top of the article,
 * where the headings breadcrumb is hidden while the column is drawn and nothing
 * else would say where the reader is (qi-2ymfq3ek).
 *
 * The caller passes the one answer to both `headPath` and `arcAt`, so the path
 * and the arc cannot name different parts.
 *
 * **Nothing else falls back**, each on purpose: a block in a gap further down
 * (there is no part to borrow there without claiming the reader is somewhere
 * they are not), a block id the index does not know (a stale `?at=` is not
 * "the top"), and a missing or empty tree all answer with what was passed in.
 *
 * "Above" is a comparison of **positions in the index**, never of id strings:
 * ids carry no order (docs/project/block-ids.md § the warning on range checks).
 * docs/plans/261004l-four-small-queued-fixes-fetch-failure-sentences-composer-focus-stale-remember-param-marginalia-head-at-the-top.md § D
 */
export function headBlock(
  tree: Tree | null | undefined,
  index: ReadonlyMap<string, number>,
  blockId: BlockId | null,
): BlockId | null {
  if (!tree) return blockId;
  /* The first part: the root's first child that is not the apparatus —
     src/tree-parts.ts § `partsOf`, which throws on a rootless tree where this
     has nothing to say. */
  const first = (tree.nodes[tree.rootId]?.children ?? [])
    .map((id) => tree.nodes[id])
    .find((node) => node !== undefined && !isSupplementNode(node));
  if (!first) return blockId;
  const start = index.get(first.range[0]);
  if (start === undefined) return blockId;
  if (blockId === null) return first.range[0];
  const at = index.get(blockId);
  if (at === undefined) return blockId;
  if (at >= start) return blockId;
  /* A supplement before the argument already has its own place in the tree.
     Earlier in the index does not mean uncovered preamble. */
  return sectionNodesOf(blockId, index, tree).length > 0 ? blockId : first.range[0];
}

/**
 * **The head's path**: the part and the section that hold `blockId`, at most
 * two titles — Sol's "current section title" plus the one ancestor that says
 * where it sits. `[]` where the tree does not cover the block: a gap between
 * parts or after the last one. The rows above the first part are `[]` here too,
 * and are the caller's to resolve first, through `headBlock` above. Each title
 * carries whose words it is, read off the node while we have it — tree.ts §
 * `titleVoice`.
 */
export function headPath(
  tree: Tree | null | undefined,
  index: ReadonlyMap<string, number>,
  blockId: BlockId | null,
): HeadStep[] {
  if (!tree || blockId === null) return [];
  return sectionNodesOf(blockId, index, tree)
    .slice(0, 2)
    .map((node) => ({ title: node.title, voice: titleVoice(node) }));
}

/** One title on the head's path, and its voice. */
export interface HeadStep {
  title: string;
  voice: Voice;
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
