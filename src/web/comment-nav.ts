/**
 * Putting comments in reading order, and stepping between them.
 *
 * Pure, so it can be tested without a DOM — the same split as layout.ts and
 * position.ts. See docs/project/comments.md § Several at once.
 *
 * > [!WARNING]
 * > Document order comes from the **index in `blocks.json`**, never from the id
 * > string. Ids are random (docs/project/block-ids.md#why-random-and-not-sequential),
 * > so sorting comments by `blockId` compiles, runs, returns a plausible order,
 * > and is meaningless. That is the one way to get this silently wrong.
 */
import type { BlockId, Comment } from "../types.js";

/**
 * Comments in the order the reader meets them coming down the page.
 *
 * Reading order rather than the order they were asked in, because the panel is
 * a way of moving through the article: pressing "next" three times should walk
 * you *down* the piece, not replay your own afternoon. Ties inside a block are
 * broken by offset, then by `createdAt`, so the sequence is stable across
 * renders and two comments on the same words never swap places.
 *
 * A comment whose block is gone — the article was re-extracted and that
 * paragraph did not survive — sorts to the end rather than being dropped. It is
 * still the reader's question, and it can still be read and deleted.
 */
export function orderComments(comments: Comment[], blocks: { id: BlockId }[]): Comment[] {
  return [...comments].sort(byPassage(blocks));
}

/** As much of an item as reading order needs. */
interface Passaged {
  readonly id: string;
  readonly blockId: BlockId;
  readonly start?: number | undefined;
  readonly createdAt: string;
}

/**
 * **The one reading-order rule**, for anything anchored to a passage — a
 * comment, or a question asked from one (`AskedQuestion`), so the two cannot
 * come to disagree about where a paragraph's items go.
 */
function byPassage(blocks: { id: BlockId }[]): (a: Passaged, b: Passaged) => number {
  const index = new Map(blocks.map((b, i) => [b.id, i]));
  const rank = (c: Passaged) => index.get(c.blockId) ?? Number.POSITIVE_INFINITY;
  /* A whole-block bookmark comes first in its block: it is about the paragraph,
     so it precedes anything about part of it. `CommentAnchor`. */
  const at = (c: Passaged) => c.start ?? -1;
  return (a, b) =>
    rank(a) - rank(b) ||
    at(a) - at(b) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id);
}

/**
 * **A conversation the reader started from a passage**, as the Comments drawer
 * lists it: the gutter's "?" (the whole block) or *Chat about this* on a
 * selection (a quote). `askedQuestions` in useChatAnchors.ts makes these from
 * the chat summaries the reading view already holds — there is no second store.
 * docs/plans/260930f-gutter-questions-listed-in-the-comments-drawer.md.
 */
export interface AskedQuestion {
  readonly id: string;
  readonly blockId: BlockId;
  readonly quote?: string | undefined;
  readonly start?: number | undefined;
  readonly createdAt: string;
  /** The first line of the newest answer; absent while it is being written. */
  readonly lastLine?: string | undefined;
}

/** One row of the Comments drawer. */
export type DrawerEntry =
  | { kind: "comment"; item: Comment }
  | { kind: "asked"; item: AskedQuestion };

/**
 * The reader's comments and the questions they asked, as **one list in reading
 * order** — so a question sits beside the comments on its paragraph rather than
 * in a second section the reader has to know to look in. Greg,
 * SPIDERYARN-READING2-6W: *"I expect that to show up in the comments so that I
 * can find it again or find the answer again."*
 */
export function orderDrawer(
  comments: readonly Comment[],
  asked: readonly AskedQuestion[],
  blocks: { id: BlockId }[],
): DrawerEntry[] {
  const order = byPassage(blocks);
  const entries: DrawerEntry[] = [
    ...comments.map((item) => ({ kind: "comment" as const, item })),
    ...asked.map((item) => ({ kind: "asked" as const, item })),
  ];
  return entries.sort((a, b) => order(a.item, b.item));
}

/** How much of a paragraph a whole-block bookmark shows before it is cut. */
const OPENING_CHARS = 120;

/**
 * What to show for the passage a comment is about.
 *
 * Its quote — or, on a whole-block bookmark (`CommentAnchor`), the opening of
 * the paragraph, so a drawer holding several of them can still be scanned. A
 * paragraph that has gone from this version of the article leaves the bookmark
 * with nothing of its own to show, and it says so rather than showing a blank.
 * GPT Sol's plan review of 260912c.
 */
export function passageOf(
  c: { readonly quote?: string | undefined },
  paragraph: string | undefined,
): { whole: boolean; text: string } {
  if (c.quote !== undefined) return { whole: false, text: c.quote };
  if (paragraph === undefined) return { whole: true, text: "no longer in this version of the article" };
  const flat = paragraph.replace(/\s+/g, " ").trim();
  return {
    whole: true,
    text: flat.length > OPENING_CHARS ? `${flat.slice(0, OPENING_CHARS).trimEnd()}…` : flat,
  };
}

/**
 * The item `delta` steps away from `currentId`, or null if there is none.
 *
 * **Generic over anything with an `id`**, since 2026-08-27, because the ideas
 * mode needed exactly this and a second copy of a stepper is a second set of
 * end conditions to get wrong. Only `orderComments` above stayed
 * comment-specific — ordering really is about a comment's blockId, start and
 * clock, where stepping is about a list.
 *
 * Stops at the ends rather than wrapping. Wrapping would make the two arrows
 * always live, which reads as "there is more this way" when there isn't — and
 * from the last comment it would fling the reader back to the top of the
 * article, which is a big move to get from a small button.
 */
export function stepComment<T extends { id: string }>(
  ordered: readonly T[],
  currentId: string | null,
  delta: number,
): string | null {
  const at = ordered.findIndex((c) => c.id === currentId);
  if (at === -1) return null;
  return ordered[at + delta]?.id ?? null;
}

/** Where the open one sits, 1-based, for the "3 / 5" counter. */
export function positionOf<T extends { id: string }>(
  ordered: readonly T[],
  currentId: string | null,
): number {
  return ordered.findIndex((c) => c.id === currentId) + 1;
}

/**
 * Every comment on each block, in reading order — what the prose gutter marks.
 *
 * > [!WARNING]
 * > Grouped by **`comment.blockId` alone**, never by whether the comment's
 * > quote still resolves against the prose. That is the whole point of the
 * > gutter marker: `resolveMark` returns null when the article was re-extracted
 * > and the quoted words are gone, so an orphaned comment draws no inline mark
 * > and would otherwise be invisible in the article. The block id is the
 * > permanent spine and never drifts (docs/project/block-ids.md), so a marker
 * > keyed on it survives what the underline cannot.
 *
 * Reading order inside a block, because the marker opens the *first* comment
 * and "first" has to mean the same thing on every render. `orderComments` is
 * the one place that ordering lives; this only groups what it returns, so the
 * two can never disagree.
 *
 * Blocks with no comments are absent rather than present-and-empty, so a caller
 * asks `get(id)?.length` and gets `undefined` for "none" rather than a lie
 * about an empty list it now has to keep.
 */
export function commentsByBlock(
  comments: Comment[],
  blocks: { id: BlockId }[],
): Map<BlockId, Comment[]> {
  const byBlock = new Map<BlockId, Comment[]>();
  for (const c of orderComments(comments, blocks)) {
    const list = byBlock.get(c.blockId);
    if (list) list.push(c);
    else byBlock.set(c.blockId, [c]);
  }
  return byBlock;
}

/**
 * **What kind of mark a comment is**, in the reader's terms — Greg,
 * SPIDERYARN-READING2-9H: *"a comment from the user that didn't want an AI chat
 * response, or one that did want an AI chat response, or a question with AI chat
 * response."*
 *
 * **What happened, not what was wanted.** Read off what is already stored,
 * not a field of its own: *Also ask the AI* links the chat the reader then
 * sends as `threadId`, and a comment from before 2026-08-28 carries the
 * model's explanation in place (`status` other than `none`) — so the label is
 * "+ AI reply", which is true of both, rather than "+ AI chat". A reader who
 * ticked the box and closed the chat draft unsent, or whose chat failed before
 * it existed, gets `comment`: that is what they ended up with. Storing the
 * tick itself would be a column, and is deferred in the plan (GPT Sol, P1 on
 * the plan). A `threadId` outlives a deleted conversation, so the label can
 * name a reply that is gone; it is still a reply that happened.
 *
 * A visitor's copy carries no `threadId` or `status` (public-types.ts), so an
 * owner's comment reads to them as `comment-ai` only when it carries a legacy
 * answer, and as `comment` otherwise — less than the owner sees, never more.
 *
 * The question — the gutter's "?" or *Chat about this* — is not a comment at
 * all but an `AskedQuestion`, and `askedQuestions` already leaves out the chats
 * a comment points at, so the three never overlap.
 * docs/plans/261002j-visible-bookmark-comment-without-ai-and-comment-kinds-in-the-margin.md.
 */
export type CommentKind = "bookmark" | "comment" | "comment-ai";
export type MarkKind = CommentKind | "question";

export function commentKind(c: {
  readonly body?: string | null | undefined;
  readonly answer?: string | undefined;
  readonly threadId?: string | undefined;
  readonly status?: string | undefined;
}): CommentKind {
  if (c.threadId || c.answer || (c.status !== undefined && c.status !== "none")) return "comment-ai";
  return c.body ? "comment" : "bookmark";
}

/** One label per kind, for the drawer and the margin alike. */
export const MARK_KIND_LABEL: Record<MarkKind, string> = {
  bookmark: "Bookmark",
  comment: "Comment",
  "comment-ai": "Comment + AI reply",
  question: "Question",
};
